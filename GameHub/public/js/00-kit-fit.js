/* =====================================================================
   Kit.Fit — content-aware auto-scaling for ALL games (Card Kit).

   The smart, general answer to "use the void / make boards adaptive": instead of
   per-game CSS breakpoints guessing sizes, Kit.Fit MEASURES a board's natural
   size and scales it (CSS transform) to fill the space its container actually
   gives it — growing into empty room, shrinking to avoid overflow. One call,
   any game, any board structure.

   Usage (typically automatic — see GameShell.renderTable, which fits the focus
   board for you). Manual:

     Kit.Fit.apply(containerEl, contentEl, {
       min: 0.6, max: 2.2,     // clamp the scale factor
       axis: 'both',           // 'both' | 'width' | 'height'
       align: 'center',        // where to anchor the scaled content
       padding: 8,             // px breathing room inside the container
       grow: true,             // allow scaling ABOVE 1 to fill the void
     });

     Kit.Fit.release(contentEl);   // stop observing + reset transform

   How it works:
   • The content is measured at scale 1 (we read its untransformed box via a
     temporary reset), giving its NATURAL size.
   • scale = clamp(min, fit(container, natural, padding, axis), max).
   • We apply transform:scale() with a transform-origin matching `align`, and
     reserve layout space so siblings/centering still work (the container keeps
     the SCALED footprint via a min-height hint).
   • A shared ResizeObserver re-fits on container resize; a MutationObserver
     re-fits when the board's content changes (new round, more cards, etc).

   Why transform-scale (not font-size/relayout): it's O(1), GPU-friendly, works
   on ANY internal layout (grids, flex, SVG, canvas) without the game knowing,
   and never fights the game's own responsive rules.
   ===================================================================== */
(function () {
  'use strict';
  if (typeof Kit === 'undefined') { console.error('[Kit.Fit] Kit not loaded'); return; }

  const REDUCE = (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

  // Per-content state, keyed off the element (via a WeakMap so it GCs cleanly).
  const STATE = new WeakMap();

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Measure the content's NATURAL (unscaled) size. Two subtleties:
  //  • clear the transform so layout reflects scale 1;
  //  • neutralize any width:100%/height:100% on the content while measuring —
  //    otherwise a responsive board resolves its size against the (scaled)
  //    wrapper, creating a feedback loop where upscaling grows the measured
  //    natural width and the board overflows. We pin it to its intrinsic
  //    content size for the measurement, then restore.
  //
  // `availW` lets us measure the board at the width it WILL actually live at
  // (its responsive `width:100%`/`min(...)` resolved against the container),
  // rather than `max-content` — which would let a nowrap header blow out to a
  // huge intrinsic width and corrupt the fit. We then union descendant rects so
  // any element that still overflows (a stubborn nowrap row) is accounted for,
  // guaranteeing the scaled board never clips.
  function naturalSize(content, availW) {
    const s = content.style;
    const prev = { transform: s.transform, width: s.width, height: s.height, maxWidth: s.maxWidth, maxHeight: s.maxHeight };
    s.transform = 'none';
    // Constrain to the real available width so responsive widths resolve sanely;
    // height stays content-driven. Use !important so a game's own
    // `width:…!important` can't override our measurement constraint.
    if (availW) {
      s.setProperty('width', Math.round(availW) + 'px', 'important');
      s.setProperty('max-width', Math.round(availW) + 'px', 'important');
    } else {
      s.width = 'max-content'; s.maxWidth = 'none';
    }
    s.height = 'max-content';
    s.maxHeight = 'none';
    let w = Math.max(content.offsetWidth, content.scrollWidth);
    let h = Math.max(content.offsetHeight, content.scrollHeight);
    // Union descendant extents (captures children that overflow the box).
    const base = content.getBoundingClientRect();
    const kids = content.querySelectorAll('*');
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const right = r.right - base.left;
      const bottom = r.bottom - base.top;
      if (right > w) w = right;
      if (bottom > h) h = bottom;
    }
    w = Math.ceil(w); h = Math.ceil(h);
    // Restore (clear our !important measurement constraints first).
    s.removeProperty('width'); s.removeProperty('max-width');
    s.transform = prev.transform;
    if (prev.width) s.width = prev.width;
    s.height = prev.height;
    if (prev.maxWidth) s.maxWidth = prev.maxWidth;
    s.maxHeight = prev.maxHeight;
    return { w, h };
  }

  function computeScale(st) {
    const { container, content, opts } = st;
    if (!container || !content || !container.isConnected) return null;
    const pad = opts.padding || 0;
    // Available area = the container's true CONTENT box. clientHeight/Width
    // include the element's own padding, so we must subtract it explicitly —
    // otherwise a reserved bottom safe-zone (padding-bottom for the floating
    // control bar) is ignored and the board grows under the buttons / clips.
    const cs = getComputedStyle(container);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const availW = Math.max(0, container.clientWidth - padX - pad * 2);
    const availH = Math.max(0, container.clientHeight - padY - pad * 2);
    const nat = naturalSize(content, availW);
    if (!nat.w || !nat.h || !availW || !availH) return null;
    const sw = availW / nat.w;
    const sh = availH / nat.h;
    let s;
    if (opts.axis === 'width') s = sw;
    else if (opts.axis === 'height') s = sh;
    else s = Math.min(sw, sh);
    if (!opts.grow) s = Math.min(s, 1);          // shrink-only mode
    // IMPORTANT: max may only ever SHRINK the fit scale, never grow it past what
    // actually fits — otherwise a short/wide board upscaled to `max` overflows
    // its container and gets visually clipped. So clamp the floor to min, but the
    // ceiling is min(max, fit).
    s = Math.max(opts.min, Math.min(s, opts.max));
    return { s, nat, availW, availH };
  }

  function applyScale(st) {
    const res = computeScale(st);
    if (!res) return;
    const { content, opts } = st;
    const s = res.s;
    // Hysteresis: ignore tiny scale deltas so the board doesn't micro-oscillate
    // when the container jitters by a pixel or two (which otherwise reads as the
    // board "breathing" between renders).
    if (st.lastScale != null && Math.abs(st.lastScale - s) < 0.02) return;
    st.lastScale = s;
    const origin = opts.align === 'top' ? 'center top'
      : opts.align === 'bottom' ? 'center bottom'
      : 'center center';
    content.style.transformOrigin = origin;
    // Smooth scale changes so a board that re-fits mid-game (e.g. the top area
    // grew/shrank and handed the board more/less room) GLIDES to its new size
    // instead of popping. The very first fit is instant (no intro animation).
    if (!REDUCE && opts.smooth !== false) {
      content.style.transition = st.didFirstFit ? 'transform .22s cubic-bezier(.22,.61,.36,1)' : 'none';
    }
    st.didFirstFit = true;
    // Pin the content to its measured NATURAL size so a responsive width:100% /
    // height:100% can't re-expand against the (scaled) wrapper — the transform
    // alone then does the scaling. This breaks the upscale feedback loop.
    content.style.setProperty('width', Math.round(res.nat.w) + 'px', 'important');
    content.style.setProperty('height', Math.round(res.nat.h) + 'px', 'important');
    content.style.transform = s === 1 ? '' : `scale(${s.toFixed(4)})`;

    // Reserve the SCALED footprint so the flex parent centres/space-distributes
    // correctly (a transform doesn't change layout box, so we hint via wrapper).
    if (st.wrapper) {
      st.wrapper.style.height = Math.round(res.nat.h * s) + 'px';
      st.wrapper.style.width = Math.round(res.nat.w * s) + 'px';
    }
    st.lastScale = s;            // remember the CORRECTED scale for hysteresis
    content.dataset.kitFitScale = s.toFixed(3);

    // ── Deferred overflow correction ─────────────────────────────────────
    // Measurement can under-report height (a fixed-size hand/row that doesn't
    // shrink, or content that reflows taller once pinned). On the NEXT frame —
    // after layout has fully flushed — measure the ACTUAL rendered extent and, if
    // it still overflows the container, shrink the scale to truly fit so the
    // board can never clip (top or bottom). Guarded against feedback loops.
    if (st._correcting) return;
    st._correctRaf && cancelAnimationFrame(st._correctRaf);
    st._correctRaf = requestAnimationFrame(() => {
      st._correctRaf = 0;
      if (!content.isConnected || !st.container) return;
      const pad = (st.opts.padding || 0);
      const ccs = getComputedStyle(st.container);
      const cpadX = (parseFloat(ccs.paddingLeft) || 0) + (parseFloat(ccs.paddingRight) || 0);
      const cpadY = (parseFloat(ccs.paddingTop) || 0) + (parseFloat(ccs.paddingBottom) || 0);
      const availW = Math.max(1, st.container.clientWidth - cpadX - pad * 2);
      const availH = Math.max(1, st.container.clientHeight - cpadY - pad * 2);
      // Real rendered extent of the content (transform included), via union.
      const base = content.getBoundingClientRect();
      let realW = base.width, realH = base.height;
      const kids = content.querySelectorAll('*');
      for (let i = 0; i < kids.length; i++) {
        const r = kids[i].getBoundingClientRect();
        if (!r.width && !r.height) continue;
        realW = Math.max(realW, r.right - base.left);
        realH = Math.max(realH, r.bottom - base.top);
      }
      const over = Math.max(realW / availW, realH / availH);
      if (over <= 1.01) return;                       // fits — done
      const corrected = Math.max(st.opts.min, (st.lastScale || s) / over);
      if (Math.abs(corrected - (st.lastScale || s)) < 0.005) return;
      st._correcting = true;
      st.lastScale = corrected;
      content.style.transform = corrected === 1 ? '' : `scale(${corrected.toFixed(4)})`;
      if (st.wrapper) {
        st.wrapper.style.height = Math.round(res.nat.h * corrected) + 'px';
        st.wrapper.style.width = Math.round(res.nat.w * corrected) + 'px';
      }
      content.dataset.kitFitScale = corrected.toFixed(3);
      st._correcting = false;
    });
  }

  // Shared observers (created lazily) so N boards cost one observer each.
  let _ro = null;
  function ro() {
    if (_ro || typeof ResizeObserver === 'undefined') return _ro;
    _ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        // The observed target is the CONTAINER; find states whose container is it.
        const st = e.target.__kitFitState;
        if (st) scheduleFit(st);
      }
    });
    return _ro;
  }

  // Coalesce fits to one per frame per state.
  function scheduleFit(st) {
    if (st.raf) return;
    st.raf = requestAnimationFrame(() => { st.raf = 0; applyScale(st); });
  }

  /** Fit `content` inside `container`. Wraps content in a sizing wrapper so the
   *  parent layout sees the scaled footprint. Idempotent per content element. */
  function apply(container, content, options = {}) {
    if (!container || !content) return;
    const opts = Object.assign({
      min: 0.4, max: 1.9, axis: 'both', align: 'center', padding: 8, grow: true, smooth: true,
    }, options || {});

    // Reuse existing state if re-applied to the same content.
    let st = STATE.get(content);
    if (st) { st.container = container; st.opts = opts; container.__kitFitState = st; scheduleFit(st); return st; }

    // Insert a sizing wrapper around content (keeps the parent's flex/centre
    // logic working against the scaled size). The wrapper is display:flex so the
    // content can be centred within its reserved footprint.
    let wrapper = content.parentElement && content.parentElement.classList.contains('kit-fit-wrap')
      ? content.parentElement : null;
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'kit-fit-wrap';
      content.parentElement && content.parentElement.insertBefore(wrapper, content);
      wrapper.appendChild(content);
    }

    st = { container, content, wrapper, opts, raf: 0, lastScale: null, mo: null };
    STATE.set(content, st);
    container.__kitFitState = st;

    // FIRST fit runs SYNCHRONOUSLY (not via rAF) so a freshly-mounted board is
    // scaled before the browser paints — never shown full-size for a frame. This
    // is what kills the per-render "twitch". didFirstFit stays false here so this
    // first apply is instant (no transition); subsequent re-fits glide.
    applyScale(st);

    // Re-fit when the board's CONTENT changes (new round / more cards). We ignore
    // mutations to the content's OWN style/transform attrs (those are ours) to
    // avoid a self-triggered re-measure loop; only real content changes refit.
    if (typeof MutationObserver !== 'undefined') {
      st.mo = new MutationObserver((muts) => {
        // Skip if every mutation is just our own style bookkeeping on `content`.
        const meaningful = muts.some((m) => !(m.type === 'attributes' && m.target === content && (m.attributeName === 'style' || m.attributeName === 'data-kit-fit-scale')));
        if (!meaningful) return;
        st.lastScale = null; scheduleFit(st);
      });
      st.mo.observe(content, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style'] });
    }
    const r = ro();
    if (r) r.observe(container);
    return st;
  }

  /** Stop fitting `content`, reset its transform, and unwrap it. */
  function release(content) {
    if (!content) return;
    const st = STATE.get(content);
    if (!st) { content.style.transform = ''; return; }
    if (st.mo) st.mo.disconnect();
    if (st.raf) cancelAnimationFrame(st.raf);
    if (_ro && st.container) { try { _ro.unobserve(st.container); } catch {} }
    if (st.container) delete st.container.__kitFitState;
    content.style.transform = '';
    content.style.transformOrigin = '';
    content.style.transition = '';
    content.style.removeProperty('width');
    content.style.removeProperty('height');
    delete content.dataset.kitFitScale;
    // Unwrap (move content back out, drop the wrapper).
    if (st.wrapper && st.wrapper.parentElement && st.wrapper.contains(content)) {
      st.wrapper.parentElement.insertBefore(content, st.wrapper);
      st.wrapper.remove();
    }
    STATE.delete(content);
  }

  /** Re-fit everything currently managed (e.g. after an orientation change). */
  function refresh() {
    // We don't keep a global list (WeakMap), but container-keyed states cover it:
    document.querySelectorAll('.kit-fit-wrap > *').forEach((content) => {
      const st = STATE.get(content);
      if (st) { st.lastScale = null; scheduleFit(st); }
    });
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('orientationchange', () => setTimeout(refresh, 120), { passive: true });
  }

  Kit.Fit = { apply, release, refresh };
})();

/* kit-layout.js — declarative screen layout API.
 *
 * Games declare layout intent; the platform translates it into CSS custom
 * properties on #gameScreen. The shared shell (GameShell.renderTable) reads
 * those properties via main.css rules. Concrete shape:
 *
 *   Kit.Layout.apply({
 *     minis:   { maxHeight: '24dvh', minColWidth: 132 },  // opponent strip
 *     main:    { fit: 'contain', maxWidth: 1040 },        // focus board
 *     center:  { maxHeight: '30dvh' },                    // dice/piles zone
 *     status:  { sticky: true },                          // status bar
 *     mobile:  { breakpoint: 560, stack: 'vertical' },    // small-screen rules
 *   });
 *
 * Each known field becomes a CSS custom property on #gameScreen:
 *   --gs-minis-max-h: 24dvh
 *   --gs-minis-mincol: 132px
 *   --gs-main-max-w: 1040px
 *   --gs-center-max-h: 30dvh
 *   ...
 *
 * Rules in main.css already use these custom properties (with sensible
 * defaults), so a game opting in is purely additive. Games can call apply()
 * any time (typically once on first render, then never).
 *
 * Why custom-property-based and not direct style mutation: it lets the same
 * declarative intent drive media queries (which can override the property
 * with a different value at breakpoints, in CSS, declaratively) AND keeps
 * the shell's grid logic in CSS rather than JS.
 */
(function () {
  'use strict';
  if (typeof Kit === 'undefined') { console.error('[Kit.Layout] Kit not loaded'); return; }

  const TARGET_ID = 'gameScreen';
  // Whitelist of fields → CSS custom property name. Anything else is silently
  // ignored so a game can pass forward-compatible fields without breaking.
  const FIELD_MAP = {
    'minis.maxHeight':  '--gs-minis-max-h',
    'minis.minColWidth':'--gs-minis-mincol',
    'minis.gap':        '--gs-minis-gap',
    'main.maxWidth':    '--gs-main-max-w',
    'main.minHeight':   '--gs-main-min-h',
    'main.padding':     '--gs-main-pad',
    'center.maxHeight': '--gs-center-max-h',
    'center.padding':   '--gs-center-pad',
    'status.sticky':    '--gs-status-sticky',   // 1 / 0
    'mobile.breakpoint':'--gs-mobile-bp',
  };

  function setVar(name, value) {
    const target = document.getElementById(TARGET_ID);
    if (!target) return;
    if (value == null || value === false) { target.style.removeProperty(name); return; }
    if (value === true) value = '1';
    if (typeof value === 'number') value = value + 'px'; // numeric → px
    target.style.setProperty(name, String(value));
  }

  function flatten(obj, prefix) {
    const out = {};
    for (const k of Object.keys(obj || {})) {
      const path = prefix ? prefix + '.' + k : k;
      const v = obj[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, path));
      else out[path] = v;
    }
    return out;
  }

  /** Apply a layout spec. Pass the entire intent object every time you want
   *  the layout to change (we don't merge with previous calls). */
  function apply(spec) {
    if (!spec || typeof spec !== 'object') return;
    // Clear previously-set vars so removed fields actually disappear.
    const target = document.getElementById(TARGET_ID);
    if (target) {
      for (const cssVar of Object.values(FIELD_MAP)) target.style.removeProperty(cssVar);
    }
    const flat = flatten(spec, '');
    for (const [path, val] of Object.entries(flat)) {
      const cssVar = FIELD_MAP[path];
      if (!cssVar) continue; // unknown field — silently ignore
      setVar(cssVar, val);
    }
  }

  /** Read back the currently-applied spec (resolved values, as strings). */
  function current() {
    const target = document.getElementById(TARGET_ID);
    if (!target) return {};
    const out = {};
    for (const [path, cssVar] of Object.entries(FIELD_MAP)) {
      const v = target.style.getPropertyValue(cssVar);
      if (v) out[path] = v;
    }
    return out;
  }

  /** Reset the layout to defaults (called by GameShell.unmount). */
  function reset() {
    const target = document.getElementById(TARGET_ID);
    if (!target) return;
    for (const cssVar of Object.values(FIELD_MAP)) target.style.removeProperty(cssVar);
  }

  /* ────────────────────────────────────────────────────────────────────
   * Kit.Layout.fit — viewport-aware section budget solver.
   *
   * Per user ask (mobile UX optimization): each game declares a list of
   * vertical sections (minis / center / main / controls / status) with
   * a min, preferred, max, and priority. The solver computes a pixel
   * height for each that uses all available viewport height with no
   * cutoffs, shrinking the LEAST-important section first when space is
   * tight, never below min. Output goes to CSS custom properties.
   *
   *   Kit.Layout.fit({
   *     // Game-screen vertical real estate to allocate. Defaults to
   *     // window.innerHeight - topbar - safe-area-inset-bottom.
   *     sections: [
   *       { id: 'minis',    min:60,  preferred:140, max:200, priority:1 },
   *       { id: 'center',   min:90,  preferred:170, max:260, priority:2 },
   *       { id: 'main',     min:140, preferred:380, max:9999,priority:3 },
   *       { id: 'controls', min:48,  preferred:56,  max:80,  priority:9 },
   *       { id: 'status',   min:24,  preferred:36,  max:48,  priority:5 },
   *     ],
   *   });
   *
   * Higher priority = LATER to shrink (matches "controls > board >
   * minis" intent: controls have priority 9 → shrunk last).
   *
   * Output (CSS custom props on #gameScreen):
   *   --gs-fit-minis-h:    140px;
   *   --gs-fit-center-h:   170px;
   *   --gs-fit-main-h:     380px;
   *   --gs-fit-controls-h: 56px;
   *   --gs-fit-status-h:   36px;
   *
   * Games that opt in read those vars in their CSS (with fallbacks for
   * other browsers / SSR). The solver re-runs on resize + orientation
   * change.
   */
  const FIT_VAR_PREFIX = '--gs-fit-';
  let _fitSpec = null;     // last spec passed in, used by the resize hook
  let _fitResizer = null;  // ResizeObserver listening on document.documentElement

  function _availableHeight() {
    // Total viewport height MINUS the topbar (always present in-game)
    // and the iOS safe-area at the bottom. Game-screen padding is
    // applied per game in CSS so we leave it.
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    let topbar = 0;
    const tb = document.querySelector('#gameScreen .game-topbar');
    if (tb) topbar = tb.getBoundingClientRect().height || 0;
    // env() can't be read from JS; budget a sane default for safe-area.
    const safeBottom = 0; // CSS handles it; we don't want to subtract twice.
    return Math.max(120, vh - topbar - safeBottom);
  }

  /** Core solver. Pure function — no DOM. Exposed for tests. */
  function solveSections(sections, available) {
    if (!Array.isArray(sections) || !sections.length) return {};
    // Normalise + defensive copy.
    const list = sections.map((s) => ({
      id: String(s.id),
      min: Math.max(0, Number(s.min) || 0),
      preferred: Math.max(0, Number(s.preferred) || 0),
      max: Number.isFinite(s.max) ? Math.max(0, Number(s.max)) : Infinity,
      priority: Number(s.priority) || 0,
    }));

    // Clamp preferred to [min, max] up-front (a misconfigured game
    // shouldn't crash the solver).
    for (const s of list) {
      s.preferred = Math.min(Math.max(s.preferred, s.min), s.max);
    }

    // Phase 1: start at preferred.
    const alloc = Object.fromEntries(list.map((s) => [s.id, s.preferred]));
    let total = list.reduce((sum, s) => sum + alloc[s.id], 0);

    if (total <= available) {
      // Underused: distribute the slack to sections with headroom.
      // Sections with max=Infinity are "open-ended" — they absorb all
      // remaining slack EQUALLY (they can grow without bound, no
      // proportional weight applies). Sections with finite max take a
      // proportional share of slack scaled by their headroom (max -
      // preferred), capped at max.
      const slack = available - total;
      const openEnded = list.filter((s) => !Number.isFinite(s.max));
      if (openEnded.length > 0) {
        // Step 1: fill every finite-max section up to its max (cheap +
        // predictable). Step 2: split the remaining slack equally
        // among open-ended sections.
        let remaining = slack;
        for (const s of list) {
          if (!Number.isFinite(s.max)) continue;
          const grow = s.max - alloc[s.id];
          if (grow > 0) { alloc[s.id] += grow; remaining -= grow; }
        }
        if (remaining > 0) {
          const each = Math.floor(remaining / openEnded.length);
          for (const s of openEnded) alloc[s.id] += each;
        }
        return alloc;
      }
      // All finite — proportional split.
      const gaps = list.map((s) => ({ id: s.id, gap: Math.max(0, s.max - s.preferred) }));
      const gapTotal = gaps.reduce((sum, g) => sum + g.gap, 0);
      if (gapTotal > 0) {
        for (const g of gaps) {
          const grow = Math.floor(slack * (g.gap / gapTotal));
          alloc[g.id] = Math.min(alloc[g.id] + grow, list.find((s) => s.id === g.id).max);
        }
      }
      return alloc;
    }

    // Phase 2: overcommitted — shrink in REVERSE priority order
    // (lowest priority first) until each section hits its min.
    const sortable = [...list].sort((a, b) => a.priority - b.priority);
    let overshoot = total - available;
    for (const s of sortable) {
      if (overshoot <= 0) break;
      const slack = alloc[s.id] - s.min;
      if (slack <= 0) continue;
      const cut = Math.min(slack, overshoot);
      alloc[s.id] -= cut;
      overshoot -= cut;
    }
    // If still overshoot > 0, every section is at min. Live with the
    // overflow — the game's overflow:auto / scrollbars take over.
    return alloc;
  }

  /** Public solver entry. Computes + writes CSS vars + re-binds on resize. */
  function fit(spec) {
    if (!spec || !Array.isArray(spec.sections)) return {};
    _fitSpec = spec;
    const available = (typeof spec.available === 'number' && spec.available > 0)
      ? spec.available
      : _availableHeight();
    const alloc = solveSections(spec.sections, available);
    const target = document.getElementById(TARGET_ID);
    if (target) {
      for (const [id, px] of Object.entries(alloc)) {
        target.style.setProperty(FIT_VAR_PREFIX + id + '-h', Math.round(px) + 'px');
      }
    }
    // Re-run on resize + orientation change (debounced).
    if (!_fitResizer) {
      let raf = null;
      _fitResizer = () => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => { raf = null; if (_fitSpec) fit(_fitSpec); });
      };
      window.addEventListener('resize', _fitResizer);
      window.addEventListener('orientationchange', _fitResizer);
    }
    return alloc;
  }

  /** Clear all fit vars. Called from GameShell.unmount() to avoid stale
   *  budgets leaking between games. */
  function fitReset() {
    const target = document.getElementById(TARGET_ID);
    if (!target) { _fitSpec = null; return; }
    // CSSStyleDeclaration lacks an iterate-over-set-vars API; we don't
    // know which were set, but we know they all share the FIT_VAR_PREFIX.
    // Walking the inline style works.
    for (let i = target.style.length - 1; i >= 0; i--) {
      const prop = target.style[i];
      if (prop && prop.startsWith(FIT_VAR_PREFIX)) target.style.removeProperty(prop);
    }
    _fitSpec = null;
  }

  Kit.Layout = {
    apply, current, reset, FIELD_MAP,
    fit, fitReset, solveSections,
    FIT_VAR_PREFIX,
  };
})();

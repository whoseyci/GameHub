/**
 * Kit.Cards — the unified, declarative CARD + BOARD framework.
 *
 * WHY: every game used to draw cards its own way (4+ geometries) and re-implement
 * deck/hand/discard wiring + flights. That caused drift and visual bugs (e.g. a
 * card flying as a pointy rectangle, or scaling to screen width). This framework
 * makes the look UNIFORM and the bugs STRUCTURALLY IMPOSSIBLE:
 *
 *   • ONE card geometry & ONE shared back (CSS .kc). Games theme only the FRONT.
 *   • A strict-but-expressive SPEC for the front (bg / border / content as solid
 *     #hex, gradient, or multicolor; content with text, font, size, rotation,
 *     align, color). No raw HTML/CSS injection — the framework renders every pixel.
 *   • Board ZONES (hand / grid / deck / discard / drop) as reusable primitives that
 *     auto-wire to the CardManager, so a new game declares WHAT its table is, not HOW.
 *   • All movement (deal/place/draw/discard) flows through CardManager via Cards.*,
 *     always staging a card-sized source (no ballooning) and keeping the canonical
 *     rounded geometry the whole flight (no pointy edges).
 *
 * Depends on Kit.CardManager / Kit.CardBoard (defined in 00-core.js, loaded first).
 */
(function(){
  if (typeof Kit === 'undefined') { console.error('[Kit.Cards] Kit not loaded'); return; }

  // ---- color tokens → CSS paint ------------------------------------------------
  // Accepts: '#rrggbb' | 'red' | {gradient:[c1,c2,...], angle?} | {multicolor:[...]}
  // multicolor = hard-stops (stripes); gradient = smooth blend.
  function paint(token, fallback){
    if (token == null) return fallback || '';
    if (typeof token === 'string') return token;
    if (Array.isArray(token)) return blend(token, 160); // bare array → gradient
    if (token.gradient) return blend(token.gradient, token.angle ?? 160);
    if (token.multicolor) return stripes(token.multicolor, token.angle ?? 135);
    if (token.color) return token.color;
    return fallback || '';
  }
  function blend(colors, angle){
    const cs = (colors && colors.length) ? colors : ['#475569','#1e293b'];
    return `linear-gradient(${angle}deg,${cs.join(',')})`;
  }
  function stripes(colors, angle){
    const cs = (colors && colors.length) ? colors : ['#475569'];
    const step = 100 / cs.length;
    const stops = cs.map((c,i)=>`${c} ${(i*step).toFixed(2)}% ${((i+1)*step).toFixed(2)}%`).join(',');
    return `linear-gradient(${angle}deg,${stops})`;
  }
  // numbers/strings allowed for sizes; everything else dropped (strict).
  const SIZES = { md:'kc-md', sm:'kc-sm', xs:'kc-xs', mini:'kc-mini' };
  const ALIGN = { center:'', tl:'kc-tl', tr:'kc-tr', bl:'kc-bl', br:'kc-br' };
  // Enumerated, strict state tokens → framework classes. No free-form classes.
  const STATES = { cleared:'kc-cleared', dim:'kc-dim', shake:'kc-shake', highlight:'kc-highlight', selectable:'kc-selectable', selected:'kc-selected' };
  // Enumerated border-width tokens.
  const BWIDTH = { thin:'1px', normal:'2px', thick:'3px' };
  // A structural ZONE tag (sizing context only) → kc-zone-<id>. NOT for visual
  // styling — the lockdown only permits kc-zone-* selectors to set --kc-w.
  const SAFE_ZONE = /^[a-z][a-z0-9-]{0,23}$/;

  /**
   * Build a card element from a declarative spec. The ONLY way to make a card.
   * STRICT (tokens only — no raw classes, no HTML) but very expressive:
   *
   *   spec = {
   *     size:    'md'|'sm'|'xs'|'mini',
   *     faceDown:bool,                          // → the ONE shared back
   *     bg:      colorToken,                    // '#hex' | {gradient:[…],angle} | {multicolor:[…],angle}
   *     border:  colorToken,
   *     borderWidth: 'thin'|'normal'|'thick',
   *     emblem:  glyph-string,                  // faint centred watermark behind content
   *     content: 'A' | {                        // text ONLY (rendered as text, never HTML)
   *       text, font, size, rotation, align,    // align: center|tl|tr|bl|br
   *       color: colorToken, weight, italic, shadow:bool
   *     },
   *     pips:    [tl, br],                       // optional corner pips (use content.color)
   *     state:   'cleared'|'dim'|'shake'|'highlight'|'selectable'|'selected' | [..],
   *     zone:    'skyjo'|'f7'|…,                 // structural sizing tag (kc-zone-<id>)
   *     data:    {k:v},                          // data-* (for click wiring / board sync)
   *   }
   */
  function el(spec){
    spec = spec || {};
    const card = document.createElement('div');
    try { card.dataset.kcSpec = encodeSpec(spec); } catch {}
    // 'md' is the implicit default size (no class) so board-context --kc-w wins by
    // normal specificity. Only non-md sizes add a class.
    const cls = ['kc'];
    if (spec.size && spec.size !== 'md' && SIZES[spec.size]) cls.push(SIZES[spec.size]);
    if (spec.zone && SAFE_ZONE.test(spec.zone)) cls.push('kc-zone-' + spec.zone);
    for (const st of normStates(spec.state)) if (STATES[st]) cls.push(STATES[st]);
    card.className = cls.join(' ');

    if (spec.faceDown){ card.classList.add('kc-back'); applyData(card, spec.data); return card; }

    // background + border (declarative paint tokens)
    const bg = paint(spec.bg); if (bg) card.style.setProperty('--kc-bg', bg);
    const bd = paint(spec.border); if (bd) card.style.setProperty('--kc-bd', bd);
    if (spec.borderWidth && BWIDTH[spec.borderWidth]) card.style.setProperty('--kc-bw', BWIDTH[spec.borderWidth]);

    // faint centred emblem/watermark (expressive, but a tokenised glyph — text only)
    if (spec.emblem != null && spec.emblem !== '') {
      const em = document.createElement('div'); em.className = 'kc-emblem'; em.textContent = String(spec.emblem); card.appendChild(em);
    }
    // Side ornaments + small instructional notes. These are intentionally small
    // and muted: they help first-time players without overpowering the card face.
    const muted = paint(spec.mutedColor) || '';
    const accent = paint(spec.accentColor) || '';
    if (spec.sideGlyph != null && spec.sideGlyph !== '') {
      const l = document.createElement('div'); l.className = 'kc-side-glyph left'; l.textContent = String(spec.sideGlyph); if (accent) l.style.color = accent; card.appendChild(l);
      const r = document.createElement('div'); r.className = 'kc-side-glyph right'; r.textContent = String(spec.sideGlyph); if (accent) r.style.color = accent; card.appendChild(r);
    }
    if (spec.topNote != null && spec.topNote !== '') {
      const n = document.createElement('div'); n.className = 'kc-note top'; n.textContent = String(spec.topNote); if (muted) n.style.color = muted; card.appendChild(n);
    }
    if (spec.bottomNote != null && spec.bottomNote !== '') {
      const n = document.createElement('div'); n.className = 'kc-note bottom'; n.textContent = String(spec.bottomNote); if (muted) n.style.color = muted; card.appendChild(n);
    }
    if (spec.caption != null && spec.caption !== '') {
      const cap = document.createElement('div'); cap.className = 'kc-caption'; cap.textContent = String(spec.caption);
      if (spec.captionPos === 'center') cap.classList.add('pos-center');
      else if (spec.captionPos === 'top') cap.classList.add('pos-top');
      if (spec.captionBg) cap.style.background = paint(spec.captionBg);
      if (spec.captionColor) cap.style.color = paint(spec.captionColor);
      if (spec.captionSize) cap.style.setProperty('--kc-caption-fs', typeof spec.captionSize === 'number' ? spec.captionSize + 'px' : spec.captionSize);
      card.appendChild(cap);
    }

    // content (text only)
    const c = (typeof spec.content === 'string' || typeof spec.content === 'number') ? { text: spec.content } : (spec.content || {});
    const fg = paint(c.color);
    if (c.text != null && c.text !== '') {
      const ce = document.createElement('div');
      ce.className = 'kc-content ' + (ALIGN[c.align] || '');
      ce.textContent = String(c.text);                 // text only — never innerHTML (water-tight)
      if (c.font)     ce.style.fontFamily = c.font;
      if (c.size)     ce.style.setProperty('--kc-fs', typeof c.size === 'number' ? c.size + 'px' : c.size);
      if (c.rotation) ce.style.setProperty('--kc-rot', (typeof c.rotation === 'number' ? c.rotation + 'deg' : c.rotation));
      if (c.weight)   ce.style.fontWeight = String(c.weight);
      if (c.italic)   ce.style.fontStyle = 'italic';
      if (c.shadow === false) ce.style.textShadow = 'none';
      if (fg) ce.style.setProperty('--kc-fg', fg);
      card.appendChild(ce);
    }
    // optional corner pips
    if (Array.isArray(spec.pips)) {
      if (spec.pips[0] != null){ const p=document.createElement('div'); p.className='kc-pip tl'; p.textContent=String(spec.pips[0]); if(fg)p.style.color=fg; card.appendChild(p); }
      if (spec.pips[1] != null){ const p=document.createElement('div'); p.className='kc-pip br'; p.textContent=String(spec.pips[1]); if(fg)p.style.color=fg; card.appendChild(p); }
    }
    applyData(card, spec.data);
    return card;
  }
  function normStates(s){ return Array.isArray(s) ? s : (s ? [s] : []); }
  function applyData(card, data){ if (data) for (const k in data) card.dataset[k] = data[k]; }

  // ---- card ANCHORS (the DOM mount point a permanent card pins onto) -----------
  // anchor(id, spec) builds a spec'd card element + stamps data-card-reg + the spec
  // (serialized) so Cards.board() can rebuild the overlay from the anchor alone.
  // anchor(id, spec, opts?): the DOM mount point a permanent card pins onto.
  //   By default the anchor renders the full face (handy for static boards). But when
  //   a permanent CardManager overlay sits on top of it (Kit.Cards.board), a faced
  //   anchor shows THROUGH as a duplicate. Pass {placeholder:true} to render an empty
  //   .kc shell of the right geometry: the overlay is the only visible face (no ghost),
  //   while the anchor stays in the layout + clickable. The spec is still embedded so
  //   board() can render the overlay from it.
  function anchor(id, spec, opts){
    const a = (opts && opts.placeholder) ? el({ size: spec && spec.size, zone: spec && spec.zone }) : el(spec);
    a.dataset.cardReg = id;
    a.dataset.kcSpec = encodeSpec(spec);
    return a;
  }
  function encodeSpec(spec){ try { return JSON.stringify(spec || {}); } catch { return '{}'; } }
  function decodeSpec(s){ try { return JSON.parse(s || '{}'); } catch { return {}; } }

  // ---- BOARD wiring: one call to register/pin/reconcile every anchor on screen --
  // Cards.board(prefix, {location?}) reads every [data-card-reg^=prefix] anchor and
  // its embedded spec, then drives Kit.CardBoard.sync — so the permanent overlay is
  // always rebuilt from the SAME declarative spec (uniform look guaranteed).
  function board(prefix, opts){
    opts = opts || {};
    return Kit.CardBoard.sync(prefix, {
      renderer: (a) => el(decodeSpec(a.dataset.kcSpec)),
      location: opts.location || ((a,i)=>({ zone:'board', slot:i })),
      faceUp: opts.faceUp,
      hideAnchor: opts.hideAnchor,
    });
  }
  function snapshot(prefix){ return Kit.CardBoard.snapshot(prefix); }

  // ---- ZONE primitives: reusable board parts a game composes --------------------
  // Each returns a DOM element; cards are mounted via anchor() inside them.
  function hand(opts){ const e=document.createElement('div'); e.className='kc-hand'+(opts&&opts.classes?' '+opts.classes:''); return e; }
  function grid(cols, opts){ const e=document.createElement('div'); e.className='kc-grid'+(opts&&opts.classes?' '+opts.classes:''); e.style.gridTemplateColumns=`repeat(${cols||1},auto)`; return e; }
  function deck(opts){ opts=opts||{};
    const e=document.createElement('div'); e.className='kc-deck'+(opts.onClick?' kc-clickable':'')+(opts.classes?' '+opts.classes:'');
    if(opts.id) e.id=opts.id;
    if(opts.count!=null){ const c=document.createElement('span'); c.className='kc-pile-count'; c.textContent=opts.label!=null?opts.label:('deck '+opts.count); e.appendChild(c); }
    if(opts.onClick) e.onclick=opts.onClick;
    return e;
  }
  function discard(opts){ opts=opts||{};
    const e=document.createElement('div'); e.className='kc-discard'+(opts.classes?' '+opts.classes:'');
    if(opts.id) e.id=opts.id;
    if(opts.count!=null){ const c=document.createElement('span'); c.className='kc-pile-count'; c.textContent=opts.label!=null?opts.label:('discard '+opts.count); e.appendChild(c); }
    return e;
  }
  function drop(target, opts){ if(!target) return target; target.classList.add('kc-drop'); if(opts&&opts.onClick) target.onclick=opts.onClick; return target; }
  // slot(): an EMPTY, card-shaped placeholder (an empty grid/stone cell). Card-sized
  // via --kc-w + the canonical card aspect, so a row of slots + cards lines up. Games
  // add their own class for any extra look. (Replaces hand-rolled empty-cell divs.)
  function slot(opts){ opts=opts||{}; const e=document.createElement('div'); e.className='kc-slot'+(opts.size&&opts.size!=='md'&&SIZES[opts.size]?(' '+SIZES[opts.size]):'')+(opts.classes?' '+opts.classes:''); if(opts.onClick){e.classList.add('kc-clickable');e.onclick=opts.onClick;} return e; }

  // ---- MOVEMENT (all flights go through CardManager via CardBoard.fly) ----------
  // deal:   deck → slot, face-down with mid-flip reveal (the canonical deal).
  // move:   slot → slot (e.g. hand → board), card-sized source from a snapshot rect.
  // toPile: card → deck/discard, then leave it logically in the pile.
  async function deal(id, deckEl, toAnchor, extra){
    if(deckEl && deckEl.classList){ deckEl.classList.remove('deal'); void deckEl.offsetWidth; deckEl.classList.add('deal'); }
    return Kit.CardBoard.fly(id, Object.assign({
      to: toAnchor, fromEl: deckEl, updateContent:false,
      duration:520, arc:46, flip:true, startFaceDown:true,
      backHTML:'<div class="kc kc-back"></div>', backClass:'kc-back',
      revealMidway:true, revealAt:0.5, land:true, hideTarget:true,
    }, extra||{}));
  }
  async function move(id, fromRect, toAnchor, extra){
    return Kit.CardBoard.fly(id, Object.assign({
      to: toAnchor, fromRect, duration:460, arc:40, land:true, hideTarget:true,
    }, extra||{}));
  }
  async function toPile(id, pileEl, extra){
    return Kit.CardBoard.fly(id, Object.assign({
      to: pileEl, duration:480, arc:34, spin:true, land:true, hideTarget:false,
    }, extra||{}));
  }

  // ---- shared FLOATING CONTROL BAR -------------------------------------------
  // Every game hand-rolled its own bottom control bar (create a fixed div, append
  // to body, fill with buttons, remember to remove it on unmount). Kit.Controls is
  // the one preset: declare buttons, it renders/auto-cleans a single shared bar.
  //   Kit.Controls.set([{ label:'End turn ▶', onClick, kind:'green', disabled }], { id })
  //   Kit.Controls.clear(id?)
  //
  // The bar is position:fixed at the bottom and on top (z-index) so it is NEVER
  // covered by a board — and crucially, it RESERVES its own height + the status
  // bar's height as a bottom safe-zone on #gameScreen (via --gs-bottom-reserve),
  // so the boards area (and Kit.Fit's available height) stops ABOVE the buttons
  // instead of growing a board underneath them. This is the contract: action
  // controls and boards never overlap.
  const CONTROLS_ID = 'kcControls';
  function syncBottomReserve(){
    // Measure the live control bar + status bar and reserve that band at the
    // bottom of the game screen so boards never grow under them.
    const gs = document.getElementById('gameScreen');
    if (!gs) return;
    const bar = document.getElementById(CONTROLS_ID);
    const status = gs.querySelector('.status-bar');
    // Reserve = distance from the viewport bottom up to the TOP of the highest
    // floating element, so boards never grow under it. Measure each element's
    // actual top relative to the viewport bottom (covers the fixed bottom offsets
    // + the element height in one go), then add a small gap.
    const topGap = (el) => (el && el.offsetParent !== null)
      ? Math.max(0, window.innerHeight - el.getBoundingClientRect().top) : 0;
    const reserve = Math.round(Math.max(topGap(bar), topGap(status)) + 10);
    gs.style.setProperty('--gs-bottom-reserve', reserve + 'px');
    // Boards may have shrunk → re-fit.
    if (typeof Kit !== 'undefined' && Kit.Fit && Kit.Fit.refresh) requestAnimationFrame(() => Kit.Fit.refresh());
  }
  function controlsSet(buttons, opts){
    opts = opts || {};
    const id = opts.id || CONTROLS_ID;
    let bar = document.getElementById(id);
    if (!bar){ bar = document.createElement('div'); bar.id = id; bar.className = 'kc-controls'; document.body.appendChild(bar); }
    bar.innerHTML = '';
    (buttons || []).forEach((b) => {
      if (!b) return;
      const btn = document.createElement('button');
      btn.className = 'btn' + (b.kind ? ' ' + b.kind : '');
      btn.textContent = b.label || '';
      if (b.disabled) btn.disabled = true;
      if (typeof b.onClick === 'function') btn.onclick = b.onClick;
      bar.appendChild(btn);
    });
    if (!bar.children.length) bar.remove();
    syncBottomReserve();
    return bar;
  }
  function controlsClear(id){ const bar = document.getElementById(id || CONTROLS_ID); if (bar) bar.remove(); syncBottomReserve(); }
  Kit.Controls = { set: controlsSet, clear: controlsClear, syncReserve: syncBottomReserve };

  // ---- shared STATUS line -----------------------------------------------------
  // Every game wrote sb.innerHTML with ad-hoc inline-styled spans (your turn / waiting
  // / prompt / spectating). Kit.Status is the one preset: a message with an enumerated
  // TONE, optionally an inline action button (e.g. "Next Round" / "Play Again").
  //   Kit.Status.set({ text:'Your turn!', tone:'go' })
  //   Kit.Status.set({ button:{ label:'Next Round', onClick } })           // host action
  //   Kit.Status.set({ text:'Waiting for host…', tone:'muted' })
  // Tones: 'go' (green) | 'warn' (amber) | 'muted' (dim) | 'info' (default text).
  const TONE = { go:'#10b981', warn:'#f59e0b', muted:'var(--text-dim)', info:'var(--text)' };
  function statusSet(opts){
    opts = opts || {};
    const sb = document.getElementById('statusBar');
    if (!sb) return;
    sb.style.color = 'var(--text)';
    if (opts.button) {
      const b = opts.button;
      const btn = document.createElement('button');
      btn.className = 'btn' + (b.kind ? ' ' + b.kind : '');
      btn.style.cssText = 'margin:0;padding:10px 20px';
      btn.textContent = b.label || '';
      if (typeof b.onClick === 'function') btn.onclick = b.onClick;
      sb.replaceChildren(btn);
      return;
    }
    const span = document.createElement('span');
    span.style.color = TONE[opts.tone] || TONE.info;
    span.style.display = 'inline-flex';
    span.style.alignItems = 'center';
    span.style.gap = '6px';
    // opts.html lets games include Kit.Icon SVG strings inline; opts.text stays
    // safe-text-only for everything else. Use one or the other, never both.
    if (opts.html != null) span.innerHTML = String(opts.html);
    else span.textContent = opts.text != null ? String(opts.text) : '';
    sb.replaceChildren(span);
  }
  Kit.Status = { set: statusSet, TONE };

  // ---- shared MINI-BOARD / OPPONENT panel -------------------------------------
  // Every game hand-rolled its own opponent/mini panel: a wrapper with active/you/
  // dimmed states, a header (name + a score badge) and a clickable body. Kit.MiniBoard
  // owns that CHROME and takes the BODY from the caller — so card games pass a cards
  // row, and dice games (Qwixx) pass their dot grid. Maximum design freedom in the
  // body; full consistency in the frame, states, header and inspect-click.
  //   Kit.MiniBoard({
  //     name, badge,                 // header: player name + a small badge (string/Element)
  //     you, active, dim,            // states (you = highlight as the viewer)
  //     body,                        // Element OR HTML string — the game-specific guts
  //     onClick,                     // click handler (e.g. inspect this seat)
  //     seat,                        // stamped as data-seat
  //     variant,                     // optional extra class (e.g. 'strip'|'investigate')
  //     headExtra,                   // optional extra header markup (string)
  //   }) -> Element
  // ─── W1: legibility-at-any-scale contract ────────────────────────────
  // The "essentials manifest" lets a game DECLARE the three pieces of info
  // every mini-board must show, in priority order — and the platform owns
  // the rendering so size-aware adaptation is consistent across games.
  //
  // Manifest shape (all fields optional except `name`):
  //   {
  //     name:      'Alice',                  // shown verbatim at large sizes,
  //                                          // collapses to initials at small
  //     score:     14,                       // total/banked score (numeric)
  //     status:    'BUST' | 'STAYED' | ...,  // optional one-word state
  //     pulse:     'live' | 'bust' | 'win' | null, // optional state colour
  //                                          //  pip beside the name
  //     essentials: [                        // 0–3 game-specific essentials
  //       { label: 'Now', value: 7 },        //  each renders as a 2-line
  //       { label: 'Bust risk', value: '12%' }, //  micro-stat that scales down
  //     ],
  //   }
  //
  // Tier classes the platform applies via container queries:
  //   .kc-mini-tier-lg  ≥ 160px wide  → name + status + all 3 essentials + body
  //   .kc-mini-tier-md   96–159px     → name + status + first 2 essentials + body
  //   .kc-mini-tier-sm   72–95px      → initials + first essential + body (clipped)
  //   .kc-mini-tier-xs    <72px       → initials + score only (body hidden)
  //
  // The optional `body` (Element OR HTML string) is still supported as the
  // ESCAPE HATCH for game-specific visualisations (Qwixx's row dots, Skyjo's
  // card grid, etc). Body is hidden at xs tier; games are encouraged to
  // promote critical glance-info to essentials[] instead.
  function initialsOf(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function miniBoard(opts){
    opts = opts || {};
    const tag = opts.onClick ? 'button' : 'div';
    const el = document.createElement(tag);
    el.className = 'kc-mini'
      + (opts.you ? ' kc-mini-you' : '')
      + (opts.active ? ' kc-mini-active' : '')
      + (opts.dim ? ' kc-mini-dim' : '')
      + (opts.variant ? ' kc-mini-' + opts.variant : '');
    if (opts.seat != null) el.dataset.seat = opts.seat;
    if (opts.onClick) { el.type = 'button'; el.onclick = opts.onClick; }
    // The manifest, stashed for re-render on resize.
    el.dataset.miniInitials = initialsOf(opts.name);

    // ── Header: name (collapses to initials at sm/xs), score-pulse pip, badge.
    const head = document.createElement('div'); head.className = 'kc-mini-head';
    const nameWrap = document.createElement('span'); nameWrap.className = 'kc-mini-name-wrap';
    if (opts.pulse) {
      const pip = document.createElement('span');
      pip.className = 'kc-mini-pulse kc-mini-pulse-' + opts.pulse;
      pip.setAttribute('aria-hidden', 'true');
      nameWrap.appendChild(pip);
    }
    const nmFull = document.createElement('span'); nmFull.className = 'kc-mini-name-full';
    nmFull.textContent = (opts.active ? '\u25b8 ' : '') + (opts.name != null ? opts.name : '');
    const nmInit = document.createElement('span'); nmInit.className = 'kc-mini-name-init';
    nmInit.textContent = (opts.active ? '\u25b8' : '') + initialsOf(opts.name);
    nameWrap.appendChild(nmFull); nameWrap.appendChild(nmInit);
    head.appendChild(nameWrap);

    if (opts.badge != null) {
      const bd = document.createElement('span'); bd.className = 'kc-mini-badge';
      if (opts.badge instanceof Element) bd.appendChild(opts.badge); else bd.textContent = String(opts.badge);
      head.appendChild(bd);
    }
    if (opts.headExtra) {
      const ex = document.createElement('span'); ex.className = 'kc-mini-headx';
      ex.textContent = String(opts.headExtra);
      head.appendChild(ex);
    }
    el.appendChild(head);

    // ── Essentials row: 0–3 micro-stats the platform renders consistently.
    if (Array.isArray(opts.essentials) && opts.essentials.length) {
      const row = document.createElement('div'); row.className = 'kc-mini-essentials';
      opts.essentials.slice(0, 3).forEach((e, i) => {
        const cell = document.createElement('span');
        cell.className = 'kc-mini-essential kc-mini-essential-' + i;
        const val = document.createElement('b'); val.className = 'kc-mini-essential-value';
        val.textContent = String(e.value != null ? e.value : '');
        const lab = document.createElement('em'); lab.className = 'kc-mini-essential-label';
        lab.textContent = String(e.label || '');
        cell.appendChild(val); cell.appendChild(lab);
        row.appendChild(cell);
      });
      el.appendChild(row);
    }

    // ── Body (game-specific escape hatch). Hidden by CSS at xs tier.
    if (opts.body != null) {
      const body = document.createElement('div'); body.className = 'kc-mini-body';
      if (opts.body instanceof Element) body.appendChild(opts.body);
      else body.innerHTML = String(opts.body);
      el.appendChild(body);
    }

    // ── Status one-liner. At xs tier the badge already shows the score,
    // so status text duplicates and is hidden. At sm+ it appears as a chip.
    if (opts.status) {
      const st = document.createElement('span'); st.className = 'kc-mini-status';
      st.textContent = String(opts.status);
      el.appendChild(st);
    }

    return el;
  }

  // Observe width to apply the correct tier class. We use a single shared
  // ResizeObserver for efficiency; the per-element subscribe is automatic
  // when the mini is appended to the DOM (we hook MutationObserver on the
  // gameScreen). For browsers without ResizeObserver we tier on first paint
  // only via getBoundingClientRect.
  const TIER_BREAKS = [
    { name: 'xs', max: 71 },
    { name: 'sm', max: 95 },
    { name: 'md', max: 159 },
    { name: 'lg', max: Infinity },
  ];
  function tierFor(width) {
    for (const t of TIER_BREAKS) if (width <= t.max) return t.name;
    return 'lg';
  }
  function setTier(el, width) {
    const tier = tierFor(width);
    if (el.dataset.miniTier === tier) return;
    el.dataset.miniTier = tier;
    // Remove every old tier class then add the active one.
    el.classList.remove('kc-mini-tier-xs', 'kc-mini-tier-sm', 'kc-mini-tier-md', 'kc-mini-tier-lg');
    el.classList.add('kc-mini-tier-' + tier);
  }
  // Single shared ResizeObserver — installed lazily.
  let _miniRO = null;
  function ensureRO() {
    if (_miniRO || typeof ResizeObserver === 'undefined') return _miniRO;
    _miniRO = new ResizeObserver((entries) => {
      for (const e of entries) setTier(e.target, e.contentRect.width);
    });
    // Watch the document for new .kc-mini elements and auto-subscribe.
    const mo = new MutationObserver((muts) => {
      for (const m of muts) for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.classList?.contains('kc-mini')) _miniRO.observe(node);
        node.querySelectorAll?.('.kc-mini').forEach((mn) => _miniRO.observe(mn));
      }
    });
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    // First-paint sweep for any minis already in the DOM.
    document.querySelectorAll('.kc-mini').forEach((mn) => _miniRO.observe(mn));
    return _miniRO;
  }
  // Boot lazily on first miniBoard call so tests in a clean jsdom don't pay
  // the MutationObserver setup cost unless they actually use minis.
  const _origMiniBoard = miniBoard;
  function miniBoardWithObserver(opts) {
    ensureRO();
    const el = _origMiniBoard(opts);
    // Set an initial tier guess from the parent if we can measure it.
    queueMicrotask(() => {
      try {
        const w = el.getBoundingClientRect().width || (el.offsetWidth || 0);
        if (w > 0) setTier(el, w);
        else setTier(el, 132); // assume default md tier; ResizeObserver will correct
      } catch { setTier(el, 132); }
    });
    return el;
  }
  Kit.MiniBoard = miniBoardWithObserver;
  // Expose helpers for tests + downstream tools.
  Kit.MiniBoard.initialsOf = initialsOf;
  Kit.MiniBoard.tierFor = tierFor;

  // ─── API-11: legality-hint helper ─────────────────────────────────────
  // Consume the server-emitted view.state.legal (API-8) into a normalized
  // shape every client renderer can use without re-encoding rules:
  //
  //   const hints = Kit.Cards.legalHints(view);
  //   hints.byAction.place      → [{index, target, raw}, ...]
  //   hints.byField.target      → Set([0, 3, 7])      // legal stones
  //   hints.byField.index       → Set([0, 1, 2])      // legal hand slots
  //   hints.byPair.place[0]     → Set([3, 7])         // hand 0 → stones {3,7}
  //   hints.has('claim', {target:3})                  → boolean
  //
  // Used by `Kit.Cards.markHints(el, hints, {action})` to dash-highlight every
  // .kit-drop-target on a board in one call.
  function legalHints(view){
    const out = { all: [], byAction: {}, byField: {}, byPair: {}, has: () => false, raw: [] };
    const legal = (view && view.state && Array.isArray(view.state.legal)) ? view.state.legal : null;
    if (!legal) return out;
    out.raw = legal;
    out.all = legal.slice();
    for (const a of legal) {
      if (!a || typeof a !== 'object') continue;
      const action = String(a.action || '');
      (out.byAction[action] = out.byAction[action] || []).push(a);
      // Per-field set (e.g. all `target` values, all `index` values).
      for (const k of Object.keys(a)) {
        if (k === 'action') continue;
        const v = a[k];
        if (typeof v !== 'number' && typeof v !== 'string') continue;
        const set = (out.byField[k] = out.byField[k] || new Set()); set.add(v);
      }
      // Pair index: byPair[action][primary] = Set of "secondaries".
      // Heuristic: if action carries (index, target), keyed by index → set of targets.
      if ('index' in a && 'target' in a) {
        const m = (out.byPair[action] = out.byPair[action] || {});
        const set = (m[a.index] = m[a.index] || new Set()); set.add(a.target);
      }
    }
    out.has = (action, fields) => {
      const bucket = out.byAction[action]; if (!bucket) return false;
      if (!fields) return bucket.length > 0;
      return bucket.some((entry) => Object.keys(fields).every((k) => entry[k] === fields[k]));
    };
    return out;
  }

  // Visual helper: paint a "valid drop target" highlight on a DOM node when
  // it appears in `hints.byField[fieldName]`. Idempotent. Cleared by
  // .markHints(el, null) or by re-rendering. Uses CSS hooks defined in main.css.
  function markHints(els, hints, opts){
    opts = opts || {};
    const field = opts.field || 'target';
    const list = Array.isArray(els) ? els : [els];
    for (const el of list) {
      if (!el || !el.dataset) continue;
      const key = opts.keyAttr ? el.dataset[opts.keyAttr] : (el.dataset.hintKey || el.dataset.target || el.dataset.index);
      const k = (key != null && !isNaN(Number(key))) ? Number(key) : key;
      const set = hints?.byField?.[field];
      const on = !!(set && set.has(k));
      el.classList.toggle('kit-drop-target', on);
    }
  }

  // ─── Universal card inspection / zoom ─────────────────────────────────
  // Reusable for every face-up card-ish element. Single tap opens inspection for
  // non-actionable cards; double-click, context-menu, or long-press opens it even
  // for cards that also have gameplay click handlers. Tapping the zoom closes it.
  let inspectOverlay = null;
  function isFaceUpInspectable(node){
    if (!node || !node.classList) return false;
    if (node.closest('.kit-card-inspect-overlay')) return false;
    const kc = node.closest('.kc');
    if (kc) {
      const spec = decodeSpec(kc.dataset.kcSpec || '');
      if (spec.faceDown || kc.classList.contains('kc-back') || kc.classList.contains('kc-cleared')) return false;
      return true;
    }
    const legacy = node.closest('.card-slot');
    if (!legacy || legacy.classList.contains('face-down')) return false;
    const txt = (legacy.textContent || '').replace(/deck\s*\d+/i, '').trim();
    return !!txt && txt !== 'Empty' && txt !== '?';
  }
  function inspectEl(source){
    const src = source?.closest?.('.kc') || source?.closest?.('.card-slot') || source;
    if (!isFaceUpInspectable(src)) return false;
    closeInspect();
    inspectOverlay = document.createElement('div');
    inspectOverlay.className = 'kit-card-inspect-overlay';
    const stage = document.createElement('div');
    stage.className = 'kit-card-inspect-stage';
    let card;
    const spec = src.classList.contains('kc') ? decodeSpec(src.dataset.kcSpec || '') : null;
    if (spec && Object.keys(spec).length && !spec.faceDown) card = el(spec);
    else card = src.cloneNode(true);
    if (card.classList) {
      card.classList.remove('held-card-mini','pile-hint','clickable','kc-clickable','kit-drop-target');
      if (card.classList.contains('card-slot')) card.classList.add('revealed');
    }
    if (card.id) card.removeAttribute('id');
    card.classList.add('kit-card-inspect-card');
    card.style.visibility = '';
    card.style.display = '';
    card.style.pointerEvents = 'none';
    stage.appendChild(card);
    inspectOverlay.appendChild(stage);
    document.body.appendChild(inspectOverlay);
    const close = (e) => { e.preventDefault(); e.stopPropagation(); closeInspect(); };
    inspectOverlay.addEventListener('click', close, { once:true });
    return true;
  }
  function closeInspect(){
    if (inspectOverlay) { inspectOverlay.remove(); inspectOverlay = null; }
  }
  function mountInspect(root){
    root = root || document;
    if (document._kitCardInspectMounted) return;
    document._kitCardInspectMounted = true;
    let pressTimer = null;
    let pressTarget = null;
    document.addEventListener('dblclick', (e) => {
      const t = e.target.closest?.('.kc,.card-slot');
      if (t && isFaceUpInspectable(t) && inspectEl(t)) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    document.addEventListener('contextmenu', (e) => {
      const t = e.target.closest?.('.kc,.card-slot');
      if (t && isFaceUpInspectable(t) && inspectEl(t)) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    document.addEventListener('pointerdown', (e) => {
      const t = e.target.closest?.('.kc,.card-slot');
      if (!t || !isFaceUpInspectable(t)) return;
      pressTarget = t;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        if (pressTarget === t && inspectEl(t)) { try { navigator.vibrate?.(12); } catch {} }
      }, 520);
    }, true);
    document.addEventListener('pointerup', () => { clearTimeout(pressTimer); pressTarget = null; }, true);
    document.addEventListener('pointercancel', () => { clearTimeout(pressTimer); pressTarget = null; }, true);
    document.addEventListener('click', (e) => {
      const t = e.target.closest?.('.kc,.card-slot');
      if (!t || !isFaceUpInspectable(t)) return;
      // Do not steal the primary tap from game-action cards/cells/piles.
      if (t.classList.contains('clickable') || t.classList.contains('pile-hint') || t.classList.contains('kc-clickable') || t.classList.contains('kit-drop-target') || typeof t.onclick === 'function' || t.closest('.clickable,button,a')) return;
      if (inspectEl(t)) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInspect(); });
  }
  mountInspect(document);

  Kit.Cards = { el, anchor, board, snapshot, hand, grid, deck, discard, drop, slot, deal, move, toPile, paint, legalHints, markHints, inspect: inspectEl, closeInspect, mountInspect, _decodeSpec:decodeSpec };
})();

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
  const CONTROLS_ID = 'kcControls';
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
    return bar;
  }
  function controlsClear(id){ const bar = document.getElementById(id || CONTROLS_ID); if (bar) bar.remove(); }
  Kit.Controls = { set: controlsSet, clear: controlsClear };

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
    span.textContent = opts.text != null ? String(opts.text) : '';
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

    const head = document.createElement('div'); head.className = 'kc-mini-head';
    const nm = document.createElement('span'); nm.className = 'kc-mini-name';
    nm.textContent = (opts.active ? '▶ ' : '') + (opts.name != null ? opts.name : '');
    head.appendChild(nm);
    if (opts.badge != null) {
      const bd = document.createElement('span'); bd.className = 'kc-mini-badge';
      if (opts.badge instanceof Element) bd.appendChild(opts.badge); else bd.textContent = String(opts.badge);
      head.appendChild(bd);
    }
    if (opts.headExtra) { const ex = document.createElement('span'); ex.className = 'kc-mini-headx'; ex.textContent = String(opts.headExtra); head.appendChild(ex); }
    el.appendChild(head);

    const body = document.createElement('div'); body.className = 'kc-mini-body';
    if (opts.body instanceof Element) body.appendChild(opts.body);
    else if (opts.body != null) body.innerHTML = String(opts.body); // game-built guts (its own markup)
    el.appendChild(body);
    return el;
  }
  Kit.MiniBoard = miniBoard;

  Kit.Cards = { el, anchor, board, snapshot, hand, grid, deck, discard, drop, deal, move, toPile, paint, _decodeSpec:decodeSpec };
})();

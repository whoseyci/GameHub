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

  /**
   * Build a card element from a declarative spec. The ONLY way to make a card.
   *   spec = {
   *     size: 'md'|'sm'|'xs'|'mini',
   *     faceDown: bool,                        // → the ONE shared back
   *     bg:      colorToken,                   // background fill
   *     border:  colorToken,                   // border color (geometry is fixed)
   *     content: {                             // the front content (text only — no HTML)
   *       text, font, size, rotation, align, color
   *     } | 'A' (shorthand for {text:'A'}),
   *     pips:    [tl,br] strings (optional corner pips),
   *     classes: extra CSS classes (visual modifiers only),
   *     data:    {k:v} extra data-* (e.g. for click wiring)
   *   }
   */
  function el(spec){
    spec = spec || {};
    const card = document.createElement('div');
    card.className = 'kc ' + (SIZES[spec.size] || 'kc-md') + (spec.classes ? ' ' + spec.classes : '');
    if (spec.faceDown){ card.classList.add('kc-back'); applyData(card, spec.data); return card; }

    // background + border (declarative paint)
    const bg = paint(spec.bg); if (bg) card.style.setProperty('--kc-bg', bg);
    const bd = paint(spec.border); if (bd) card.style.setProperty('--kc-bd', bd);

    // content
    const c = (typeof spec.content === 'string') ? { text: spec.content } : (spec.content || {});
    if (c.text != null && c.text !== '') {
      const ce = document.createElement('div');
      ce.className = 'kc-content ' + (ALIGN[c.align] || '');
      ce.textContent = String(c.text);                 // text only — never innerHTML (water-tight)
      if (c.font)     ce.style.fontFamily = c.font;
      if (c.size)     ce.style.setProperty('--kc-fs', typeof c.size === 'number' ? c.size + 'px' : c.size);
      if (c.rotation) ce.style.setProperty('--kc-rot', (typeof c.rotation === 'number' ? c.rotation + 'deg' : c.rotation));
      const fg = paint(c.color);
      if (fg) ce.style.setProperty('--kc-fg', fg);
      card.appendChild(ce);
    }
    // optional corner pips
    if (Array.isArray(spec.pips)) {
      const fg = paint((typeof spec.content === 'object' && spec.content) ? spec.content.color : null);
      if (spec.pips[0] != null){ const p=document.createElement('div'); p.className='kc-pip tl'; p.textContent=String(spec.pips[0]); if(fg)p.style.color=fg; card.appendChild(p); }
      if (spec.pips[1] != null){ const p=document.createElement('div'); p.className='kc-pip br'; p.textContent=String(spec.pips[1]); if(fg)p.style.color=fg; card.appendChild(p); }
    }
    applyData(card, spec.data);
    return card;
  }
  function applyData(card, data){ if (data) for (const k in data) card.dataset[k] = data[k]; }

  // ---- card ANCHORS (the DOM mount point a permanent card pins onto) -----------
  // anchor(id, spec) builds a spec'd card element + stamps data-card-reg + the spec
  // (serialized) so Cards.board() can rebuild the overlay from the anchor alone.
  function anchor(id, spec){
    const a = el(spec);
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

  Kit.Cards = { el, anchor, board, snapshot, hand, grid, deck, discard, drop, deal, move, toPile, paint, _decodeSpec:decodeSpec };
})();

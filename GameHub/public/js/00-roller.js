/* =====================================================================
   Kit.Roller — a cartoony 2D "slot machine" rolling API (Card Kit).

   An ALTERNATIVE to the WebGL Kit.Dice3D roller, for dice AND anything else
   that "rolls" (symbols, colours, words). Pure DOM + CSS animation, so it works
   everywhere (no WebGL needed) and reads as playful/arcade rather than physical.

   UX: a lever sits beside the reels. The active player pulls it → each reel
   spins (blurred symbols streaming past) → reels lock in one-by-one with a
   bouncy overshoot → the whole machine gives a little settle-bounce.

   ── Two ways to use it ──────────────────────────────────────────────────

   1) Generic, fully customizable:

      Kit.Roller.spin(container, {
        reels: [                                  // ONE entry per reel (=per die)
          { color:'red',    symbol:'6' },         // what this reel LANDS on
          { color:'white',  symbol:'3' },
          { color:'blue',   icon:'star' },        // a Kit.Icon name instead of text
        ],
        // OPTIONAL per-reel/global customization:
        symbols: ['1','2','3','4','5','6'],        // the strip of faces shown while spinning
        size: 56,                                  // reel size in px
        lever: true,                               // show + require a lever pull (default true)
        autoPull: false,                           // pull automatically (no lever) — for opponents
        onPull, onLock, onClack,                   // callbacks
      }) -> Promise   // resolves once all reels have locked + the machine settled

   2) Drop-in dice compatibility (same shape as Kit.Dice3D.roll):

      Kit.Roller.roll(container, [{color,value}, ...], {size}) -> Promise
      Kit.Roller.showStatic(container, [{color,value}, ...], {size})
      Kit.Roller.supported()  // always true (no WebGL)

   Customization summary (the three dimensions asked for):
     • HOW MANY reels  → reels.length  (roll(): dice.length)
     • REEL COLOUR     → reels[i].color (roll(): dice[i].color)
     • REEL SYMBOLS    → reels[i].symbol/.icon for the landed face; opts.symbols
                         (or reels[i].symbols) for the spinning strip.
   ===================================================================== */
(function () {
  'use strict';
  if (typeof Kit === 'undefined') { console.error('[Kit.Roller] Kit not loaded'); return; }

  const PALETTE = {
    white:  { face:'#ffffff', edge:'#cbd5e1', text:'#111827' },
    red:    { face:'#ef4444', edge:'#b91c1c', text:'#ffffff' },
    yellow: { face:'#f1c40f', edge:'#b88704', text:'#241800' },
    green:  { face:'#22c55e', edge:'#15803d', text:'#ffffff' },
    blue:   { face:'#3b82f6', edge:'#1d4ed8', text:'#ffffff' },
    purple: { face:'#a855f7', edge:'#7e22ce', text:'#ffffff' },
    orange: { face:'#f97316', edge:'#c2410c', text:'#ffffff' },
  };
  const COLOR_ALIAS = { r:'red', y:'yellow', g:'green', b:'blue', w:'white' };
  const norm = c => PALETTE[COLOR_ALIAS[c] || c] ? (COLOR_ALIAS[c] || c) : 'white';
  const REDUCE = (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  const DEFAULT_SYMBOLS = ['1', '2', '3', '4', '5', '6'];

  // Render one symbol's inner HTML — text or a Kit.Icon glyph.
  function symbolHTML(sym, color) {
    if (sym && typeof sym === 'object' && sym.icon) {
      const c = PALETTE[norm(color)];
      try { return Kit.Icon.html(sym.icon, { size: '60%', color: c.text }); } catch { return ''; }
    }
    return `<span class="kit-reel-glyph">${sym == null ? '' : String(sym)}</span>`;
  }

  // Build the DOM for one reel: a viewport that masks a vertical strip of cells.
  function buildReel(spec, opts, idx) {
    const color = norm(spec.color);
    const pal = PALETTE[color];
    const size = opts.size || 56;

    const reel = document.createElement('div');
    reel.className = 'kit-reel';
    reel.style.setProperty('--reel-size', size + 'px');
    reel.style.setProperty('--reel-face', pal.face);
    reel.style.setProperty('--reel-edge', pal.edge);
    reel.style.setProperty('--reel-text', pal.text);
    reel.dataset.color = color;

    const window_ = document.createElement('div');
    window_.className = 'kit-reel-window';

    const strip = document.createElement('div');
    strip.className = 'kit-reel-strip';

    // The spinning strip: a run of random faces, then the FINAL face last so the
    // strip ends on the predetermined result when it stops.
    const faces = spec.symbols || opts.symbols || DEFAULT_SYMBOLS;
    const landed = spec.icon ? { icon: spec.icon } : (spec.symbol != null ? spec.symbol : spec.value);
    const runLen = REDUCE ? 1 : (10 + idx * 3);           // staggered length → staggered stop
    const cells = [];
    for (let i = 0; i < runLen; i++) {
      cells.push(faces[Math.floor(Math.random() * faces.length)]);
    }
    cells.push(landed);                                    // last cell = the result
    strip.innerHTML = cells
      .map(s => `<div class="kit-reel-cell">${symbolHTML(s, color)}</div>`)
      .join('');

    window_.appendChild(strip);
    reel.appendChild(window_);
    reel._strip = strip;
    reel._cellCount = cells.length;
    return reel;
  }

  // Core: render the machine, run the spin, resolve when locked + settled.
  function spin(container, opts = {}) {
    if (!container) return Promise.resolve();
    opts = opts || {};
    const reels = (opts.reels || []).slice(0, 12);
    const size = opts.size || 56;
    const wantLever = opts.lever !== false && !opts.autoPull;

    container.innerHTML = '';
    container.classList.add('kit-roller');

    const machine = document.createElement('div');
    machine.className = 'kit-slot';
    machine.style.setProperty('--reel-size', size + 'px');

    const bank = document.createElement('div');
    bank.className = 'kit-slot-bank';
    const reelEls = reels.map((r, i) => buildReel(r, opts, i));
    reelEls.forEach(el => bank.appendChild(el));
    machine.appendChild(bank);

    // Lever
    let lever = null;
    if (wantLever) {
      lever = document.createElement('button');
      lever.className = 'kit-slot-lever';
      lever.setAttribute('aria-label', 'Pull the lever to roll');
      lever.innerHTML = `<span class="kit-lever-track"><span class="kit-lever-knob"></span></span>`;
      machine.appendChild(lever);
    }

    container.appendChild(machine);

    return new Promise(resolve => {
      let started = false;

      function lockAll() {
        if (started) return; started = true;
        if (lever) lever.classList.add('pulled');
        machine.classList.add('spinning');
        if (typeof opts.onPull === 'function') opts.onPull();
        if (typeof SFX !== 'undefined' && SFX.draw) SFX.draw();

        if (REDUCE) {
          // Reduced motion: skip the animation, show the landed faces at once.
          reelEls.forEach(el => { el.classList.add('locked'); el._strip.style.transform = `translateY(calc(-1 * var(--reel-size) * ${el._cellCount - 1}))`; });
          machine.classList.remove('spinning');
          if (typeof opts.onLock === 'function') opts.onLock();
          setTimeout(resolve, 60);
          return;
        }

        const stopBase = 700, stopStep = 360;            // first reel stops at 700ms, each +360ms
        let stopped = 0;
        reelEls.forEach((el, i) => {
          el.classList.add('blur');
          const finalShift = el._cellCount - 1;          // land on the last cell (the result)
          const stopAt = stopBase + i * stopStep;
          // Animate the strip to its final position; CSS transition gives the
          // bouncy overshoot-and-settle (see .kit-reel-strip.landing).
          setTimeout(() => {
            el.classList.remove('blur');
            el.classList.add('landing');
            el._strip.style.transform = `translateY(calc(-1 * var(--reel-size) * ${finalShift}))`;
            el.classList.add('locked');
            if (typeof SFX !== 'undefined' && SFX.flip) SFX.flip();
            if (typeof opts.onClack === 'function') opts.onClack();
            stopped++;
            if (stopped === reelEls.length) {
              // Whole machine settle-bounce, then resolve.
              machine.classList.remove('spinning');
              machine.classList.add('settle');
              if (typeof SFX !== 'undefined' && SFX.reveal) SFX.reveal();
              if (typeof opts.onLock === 'function') opts.onLock();
              setTimeout(() => { machine.classList.remove('settle'); resolve(); }, 420);
            }
          }, stopAt);
        });
      }

      if (wantLever) {
        lever.addEventListener('click', lockAll, { once: true });
        // Nudge so the player notices the lever.
        machine.classList.add('await-pull');
      } else {
        // Auto-pull after a short beat (opponents / replay).
        setTimeout(lockAll, opts.autoPullDelay != null ? opts.autoPullDelay : 250);
      }
    });
  }

  // Static (resting) readout — no animation. Used for re-renders + as the
  // settled display. Mirrors Kit.Dice3D.showStatic's role.
  function showStatic(container, reelsOrDice, opts = {}) {
    if (!container) return;
    const size = opts.size || 56;
    const reels = (reelsOrDice || []).map(toReel);
    container.classList.add('kit-roller');
    container.innerHTML = `<div class="kit-slot" style="--reel-size:${size}px"><div class="kit-slot-bank">` +
      reels.map(r => {
        const color = norm(r.color);
        const pal = PALETTE[color];
        const landed = r.icon ? { icon: r.icon } : (r.symbol != null ? r.symbol : r.value);
        return `<div class="kit-reel locked" data-color="${color}" style="--reel-size:${size}px;--reel-face:${pal.face};--reel-edge:${pal.edge};--reel-text:${pal.text}">` +
          `<div class="kit-reel-window"><div class="kit-reel-strip"><div class="kit-reel-cell">${symbolHTML(landed, color)}</div></div></div></div>`;
      }).join('') +
      `</div></div>`;
  }

  // Map a {color,value} (dice API) OR a {color,symbol/icon} (generic) to a reel.
  function toReel(d) {
    if (!d || typeof d !== 'object') return { color: 'white', symbol: '' };
    return { color: d.color, value: d.value, symbol: d.symbol, icon: d.icon, symbols: d.symbols };
  }

  // ── Dice-compatible adapter (drop-in for Kit.Dice3D.roll) ───────────────
  // dice: [{color, value}, ...]. The lever is shown only when it's the local
  // player's roll (opts.lever); opponents auto-pull so they see the animation
  // without a lever to click. Resolves when the machine has locked + settled.
  function roll(container, dice, opts = {}) {
    dice = dice || [];
    return spin(container, {
      reels: dice.map(toReel),
      size: opts.size || 56,
      symbols: opts.symbols || DEFAULT_SYMBOLS,
      lever: opts.lever !== false && opts.autoPull !== true,
      autoPull: opts.autoPull === true,
      autoPullDelay: opts.autoPullDelay,
      onPull: opts.onPull, onLock: opts.onLock, onClack: opts.onClack,
    });
  }

  function supported() { return true; }   // pure DOM/CSS — always available

  Kit.Roller = { spin, roll, showStatic, supported, PALETTE };
})();

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
        marquee: 'QWIXX',                          // PER-GAME themed crown text (alias: title)
        jackpot: (reels) => boolean,               // PER-GAME: should sparkles fire on this lock?
        jackpotColor: 'yellow',                    // optional sparkle tint (palette colour)
        onPull, onLock, onClack,                   // callbacks (see timing below)
      }) -> Promise   // resolves once all reels have locked + the machine settled

   Callback timing (HARDENED): onPull fires when the lever is pulled (spin
   START); onLock fires ONLY after the reels have VISUALLY settled (spin END).
   Games that gate other players/bots on "results are official" MUST use onLock,
   not onPull — otherwise options appear before the animation finishes.

   FX (per game): a coin-drop plays on every pull. Jackpot sparkles fire on lock
   ONLY when opts.jackpot(reels) returns true — each game defines its own win
   condition (e.g. all reels equal, a specific symbol, etc). Omit it for none.

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

  function faceColor(face, fallback) {
    if (face && typeof face === 'object' && face.color) return norm(face.color);
    return norm(fallback);
  }
  function faceSymbol(face) {
    if (face && typeof face === 'object') {
      if (face.icon) return { icon: face.icon };
      if (Object.prototype.hasOwnProperty.call(face, 'symbol')) return face.symbol;
      if (Object.prototype.hasOwnProperty.call(face, 'value')) return face.value;
    }
    return face;
  }

  // Render one symbol's inner HTML — text or a Kit.Icon glyph.
  function symbolHTML(sym, color) {
    if (sym && typeof sym === 'object' && sym.icon) {
      const c = PALETTE[norm(color)];
      try { return Kit.Icon.html(sym.icon, { size: '60%', color: c.text }); } catch { return ''; }
    }
    return `<span class="kit-reel-glyph">${sym == null ? '' : String(sym)}</span>`;
  }
  function cellHTML(face, fallbackColor) {
    const color = faceColor(face, fallbackColor);
    const pal = PALETTE[color];
    const sym = faceSymbol(face);
    return `<div class="kit-reel-cell" style="--reel-face:${pal.face};--reel-text:${pal.text}">${symbolHTML(sym, color)}</div>`;
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

    // The spinning strip: a long run of random faces ending on the FINAL face
    // (the predetermined result), so the strip's LAST cell is the result. The
    // animator (in spin()) translates the strip upward by N full strip-heights
    // for the "streaming" effect, then settles on this last cell. Cell 0 (shown
    // at rest) is a random face so the result isn't visible before the pull.
    const landedColor = spec.resultColor || spec.color;
    const landed = spec.icon ? { icon: spec.icon, color: landedColor } : { symbol: (spec.symbol != null ? spec.symbol : spec.value), color: landedColor };
    // Pick the spinning-strip faces. Priority: explicit per-reel symbols, then
    // global opts.symbols. If neither is given, INFER from what this reel lands
    // on so a COLOUR reel (a plain coloured swatch, or one that lands on an icon/
    // single glyph like ★) streams that SAME kind of face — never the default
    // 1-6 number strip. (Bug fix: colour dice were leaking numbers while spinning
    // because they fell through to DEFAULT_SYMBOLS.)
    let faces = spec.symbols || opts.symbols;
    if (!faces) {
      const landedSym = faceSymbol(landed);
      const s = typeof landedSym === 'string' ? landedSym : null;
      if (spec.icon) faces = [{ icon: spec.icon, color }];  // icon reel → stream that icon
      else if (s === '') faces = [''];                       // pure colour swatch → stream blanks
      else if (s != null && /^[0-9]$/.test(s)) faces = DEFAULT_SYMBOLS;       // number reel → 1-6 strip
      else if (s === '?') faces = DEFAULT_SYMBOLS.concat('?');                // wild number → numbers + ?
      else if (s != null) faces = [s];                       // single glyph reel (e.g. ★) → stream that glyph
      else faces = DEFAULT_SYMBOLS;
    }
    const runLen = REDUCE ? 0 : 16;                        // streaming faces before the result
    const cells = [];
    for (let i = 0; i < runLen; i++) {
      cells.push(faces[Math.floor(Math.random() * faces.length)]);
    }
    cells.push(landed);                                    // last cell = the result
    strip.innerHTML = cells.map((face) => cellHTML(face, color)).join('');

    window_.appendChild(strip);
    reel.appendChild(window_);
    reel._strip = strip;
    reel._cellCount = cells.length;
    reel._faces = faces;
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

    // ── Cabinet ───────────────────────────────────────────────────────────
    // An artsy little arcade machine: a lit marquee crown on top, a glass reel
    // housing (with a centre payline + a ring of blinking bulbs), and a chunky
    // side lever. The whole cabinet (.kit-slot) is what bounces/settles.
    const machine = document.createElement('div');
    machine.className = 'kit-slot';
    machine.style.setProperty('--reel-size', size + 'px');

    // Marquee crown — themed per game via opts.marquee (string) / opts.title.
    // Shows the call-to-action while idle, "<text> · GO!" while spinning.
    const marquee = document.createElement('div');
    marquee.className = 'kit-slot-marquee';
    const marqueeLabel = (opts.marquee != null) ? opts.marquee : (opts.title != null ? opts.title : 'ROLL');
    marquee.innerHTML =
      `<span class="kit-marquee-bulbs" aria-hidden="true">${'<i></i>'.repeat(7)}</span>` +
      `<span class="kit-marquee-text">${marqueeLabel}</span>`;
    machine.appendChild(marquee);

    // Body = housing (reels + payline) on the left, lever on the right.
    const body = document.createElement('div');
    body.className = 'kit-slot-body';

    const housing = document.createElement('div');
    housing.className = 'kit-slot-housing';

    const bank = document.createElement('div');
    bank.className = 'kit-slot-bank';
    const reelEls = reels.map((r, i) => buildReel(r, opts, i));
    reelEls.forEach(el => bank.appendChild(el));
    housing.appendChild(bank);

    // Centre payline (the win line) — flashes when the reels lock.
    const payline = document.createElement('span');
    payline.className = 'kit-slot-payline';
    payline.setAttribute('aria-hidden', 'true');
    housing.appendChild(payline);

    body.appendChild(housing);

    // Lever (chunky, with a mounting base) on the side.
    let lever = null;
    if (wantLever) {
      lever = document.createElement('button');
      lever.className = 'kit-slot-lever';
      lever.setAttribute('aria-label', 'Pull the lever to roll');
      lever.innerHTML =
        `<span class="kit-lever-track"><span class="kit-lever-arm"></span><span class="kit-lever-knob"></span></span>` +
        `<span class="kit-lever-base" aria-hidden="true"></span>`;
      body.appendChild(lever);

      // "Your turn — pull it!" cue: a bobbing label stacked VERTICALLY above a
      // DOWN arrow that points at the lever, so the active player knows the roll
      // is theirs to start. opts.leverHint sets the label (default "ROLL");
      // hidden once the lever is pulled.
      const cue = document.createElement('div');
      cue.className = 'kit-lever-cue';
      cue.setAttribute('aria-hidden', 'true');
      const hint = (opts.leverHint != null) ? opts.leverHint : 'ROLL';
      // vertical text: one glyph per line
      const vtext = String(hint).split('').map(ch => `<span>${ch === ' ' ? '&nbsp;' : ch}</span>`).join('');
      cue.innerHTML = `<span class="kit-lever-cue-label">${vtext}</span><span class="kit-lever-cue-arrow">\u2193</span>`;
      body.appendChild(cue);
      lever._cue = cue;
    }

    machine.appendChild(body);

    // Little coin-slot / brand plate foot for personality.
    const foot = document.createElement('div');
    foot.className = 'kit-slot-foot';
    foot.innerHTML = `<span class="kit-slot-coin" aria-hidden="true"></span>`;
    machine.appendChild(foot);

    // FX layer (above everything): coin drops on pull + jackpot sparkles on a
    // winning lock. Pointer-events:none so it never blocks the lever.
    const fx = document.createElement('div');
    fx.className = 'kit-slot-fx';
    fx.setAttribute('aria-hidden', 'true');
    machine.appendChild(fx);

    container.appendChild(machine);

    // ── FX helpers (per-game customizable) ────────────────────────────────
    // Jackpot sparkles: fired on a winning lock. WHETHER a roll is a "jackpot"
    // is DEFINED PER GAME via opts.jackpot(reels) -> boolean. (Omit it and no
    // sparkles ever fire.) opts.jackpotColor themes the sparkles.
    function jackpotSparkles() {
      if (REDUCE) {
        // Reduced motion: a single static banner, no particle storm.
        const banner = document.createElement('div');
        banner.className = 'kit-fx-banner';
        banner.textContent = opts.jackpotText || 'JACKPOT!';
        fx.appendChild(banner);
        setTimeout(() => banner.remove(), 1600);
        if (typeof SFX !== 'undefined' && SFX.win) SFX.win();
        return;
      }
      // ── Big game-deciding celebration ──────────────────────────────────
      machine.classList.add('jackpot');
      const tintPal = opts.jackpotColor ? PALETTE[norm(opts.jackpotColor)] : null;
      // A palette of bright confetti colours (uses the tint if given, plus golds).
      const confettiCols = [
        tintPal ? tintPal.face : '#fde68a', '#fbbf24', '#fde68a', '#f59e0b',
        '#fb7185', '#60a5fa', '#34d399', '#c084fc', '#ffffff',
      ];

      // 1) Full-cabinet flash + radial burst behind the reels.
      const flash = document.createElement('div');
      flash.className = 'kit-fx-flash';
      fx.appendChild(flash);
      setTimeout(() => flash.remove(), 700);

      // 2) Sparkle ring (gold) shooting out from centre.
      const N = 26;
      for (let i = 0; i < N; i++) {
        const s = document.createElement('span');
        s.className = 'kit-fx-spark';
        const ang = (i / N) * Math.PI * 2 + Math.random() * 0.5;
        const dist = 80 + Math.random() * 120;
        s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
        s.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
        s.style.animationDelay = (Math.random() * 150) + 'ms';
        if (tintPal) s.style.background = tintPal.face;
        fx.appendChild(s);
        setTimeout(() => s.remove(), 1200);
      }

      // 3) Confetti rain — colourful pieces tumbling down over the cabinet.
      const C = 46;
      for (let i = 0; i < C; i++) {
        const c = document.createElement('span');
        c.className = 'kit-fx-confetti';
        c.style.left = (Math.random() * 120 - 10) + '%';
        c.style.background = confettiCols[(Math.random() * confettiCols.length) | 0];
        c.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
        c.style.setProperty('--drift', (Math.random() * 60 - 30) + 'px');
        c.style.width = (5 + Math.random() * 6) + 'px';
        c.style.height = (8 + Math.random() * 8) + 'px';
        c.style.animationDelay = (Math.random() * 350) + 'ms';
        c.style.animationDuration = (900 + Math.random() * 700) + 'ms';
        if (Math.random() < 0.4) c.style.borderRadius = '50%';   // mix circles + ribbons
        fx.appendChild(c);
        setTimeout(() => c.remove(), 1800);
      }

      // 4) A big "JACKPOT!" banner that pops, holds, and fades.
      const banner = document.createElement('div');
      banner.className = 'kit-fx-banner';
      banner.textContent = opts.jackpotText || 'JACKPOT!';
      fx.appendChild(banner);
      setTimeout(() => banner.remove(), 1700);

      // Sound: a richer fanfare than the single win chime if available.
      if (typeof SFX !== 'undefined') {
        if (SFX.win) SFX.win();
        if (SFX.triplet) setTimeout(() => SFX.triplet(), 160);
        if (SFX.good) setTimeout(() => SFX.good(), 340);
      }
      setTimeout(() => machine.classList.remove('jackpot'), 1500);
    }
    function maybeJackpot() {
      try { if (typeof opts.jackpot === 'function' && opts.jackpot(reels)) jackpotSparkles(); }
      catch (e) { /* a bad predicate must never break the roll */ }
    }

    // Mark reels the player NEEDS (per-game predicate) so they can flash on land.
    // opts.needed(reel, index) -> bool. Used purely for the playful win-flash.
    const isNeeded = (i) => {
      try { return typeof opts.needed === 'function' && !!opts.needed(reels[i], i); }
      catch { return false; }
    };

    // Per-reel RNG spin profile — gives each wheel its own personality so no two
    // spins feel identical: a randomized duration, one of a few deceleration
    // "flavours" (snap = sudden stop, glide = slow roll-onto-target, normal),
    // and a randomized streaming speed (via extra travel distance). This is the
    // "sometimes faster, sometimes slower, sometimes a sudden stop, sometimes a
    // slow roll-on" the design called for.
    const FLAVOURS = ['snap', 'glide', 'normal', 'normal'];   // weight 'normal'
    function spinProfile(i) {
      const flavour = FLAVOURS[(Math.random() * FLAVOURS.length) | 0];
      const baseDur = 1100 + Math.random() * 700;             // 1.1–1.8s of spin
      const stagger = i * (220 + Math.random() * 160);        // staggered stops
      return { flavour, dur: baseDur + stagger };
    }
    // Easing per flavour (t in 0..1 -> eased 0..1, ending at 1 = on target).
    function easeFor(flavour) {
      if (flavour === 'snap') {
        // mostly linear, then a hard late stop (sudden)
        return (t) => (t < 0.86 ? t * 0.92 : 0.79 + (t - 0.86) / 0.14 * 0.21);
      }
      if (flavour === 'glide') {
        // long slow roll onto the target (strong ease-out)
        return (t) => 1 - Math.pow(1 - t, 3.4);
      }
      // normal — classic ease-out
      return (t) => 1 - Math.pow(1 - t, 2.2);
    }

    return new Promise(resolve => {
      let started = false;

      function finishReel(el, i, done) {
        el.classList.remove('blur');
        el.classList.add('locked');
        // individual lock bounce (each reel snaps with its own little jolt)
        el.classList.remove('reel-land'); void el.offsetWidth; el.classList.add('reel-land');
        // playful flash if this reel landed on a value the player needs
        if (isNeeded(i)) { el.classList.add('reel-need'); }
        if (typeof SFX !== 'undefined' && SFX.flip) SFX.flip();
        if (typeof opts.onClack === 'function') opts.onClack();
        done();
      }

      function lockAll() {
        if (started) return; started = true;
        if (lever) { lever.classList.add('pulled'); if (lever._cue) lever._cue.classList.add('gone'); }
        machine.classList.add('spinning');
        if (typeof opts.onPull === 'function') opts.onPull();
        if (typeof SFX !== 'undefined' && SFX.draw) SFX.draw();

        if (REDUCE) {
          reelEls.forEach((el, i) => { el.classList.add('locked'); el._strip.style.transform = `translateY(calc(-1 * var(--reel-size) * ${el._cellCount - 1}))`; if (isNeeded(i)) el.classList.add('reel-need'); });
          machine.classList.remove('spinning');
          machine.classList.add('locked-in');
          maybeJackpot();
          if (typeof opts.onLock === 'function') opts.onLock();
          setTimeout(resolve, 60);
          return;
        }

        const sizePx = size;
        let stopped = 0;
        const onAllStopped = () => {
          machine.classList.remove('spinning');
          machine.classList.add('settle', 'locked-in');
          if (typeof SFX !== 'undefined' && SFX.reveal) SFX.reveal();
          maybeJackpot();
          // HARDENING: onLock (the game's "results are official" hook) fires ONLY
          // here, after every reel has VISUALLY settled — never on pull.
          if (typeof opts.onLock === 'function') opts.onLock();
          setTimeout(() => { machine.classList.remove('settle'); resolve(); }, 420);
        };

        reelEls.forEach((el, i) => {
          el.classList.add('blur');
          // Travel from cell 0 (shown at rest) UP to the last cell (the result):
          // translateY goes 0 → -targetPx. The strip is a fixed run of faces, so
          // the streaming speed/feel is shaped entirely by the per-reel duration
          // + easing flavour (snap / glide / normal) — that's the RNG variety.
          const targetPx = (el._cellCount - 1) * sizePx;
          const prof = spinProfile(i);
          const ease = easeFor(prof.flavour);
          // Use our OWN clock (performance.now) rather than the rAF-passed
          // timestamp: some environments (and the jsdom test polyfill) pass
          // Date.now() to rAF callbacks, which wouldn't share an origin with a
          // performance.now() t0 and would make t jump straight to >=1.
          const clock = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          const t0 = clock();
          function frame() {
            const t = (clock() - t0) / prof.dur;
            if (t >= 1) {
              el._strip.style.transform = `translateY(${-targetPx}px)`;
              finishReel(el, i, () => { stopped++; if (stopped === reelEls.length) onAllStopped(); });
              return;
            }
            const pos = -targetPx * ease(t);                 // negative = upward
            el._strip.style.transform = `translateY(${pos}px)`;
            if (t > 0.82) el.classList.remove('blur');       // crisp final number
            requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        });
      }

      if (wantLever) {
        lever.addEventListener('click', lockAll, { once: true });
        machine.classList.add('await-pull');
      } else {
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
    // A PHASE PROMPT (first-class API): an animated marquee phrase for a phase
    // that isn't a spin — e.g. "SELECT" while players choose their dice. Set
    // opts.prompt to a string (or {text}) and it loops in the marquee. Falls
    // back to opts.title / 'ROLL' for a plain resting readout.
    const promptText = (opts.prompt != null)
      ? (typeof opts.prompt === 'object' ? (opts.prompt.text || '') : String(opts.prompt))
      : null;
    const marqueeLabel = promptText != null ? promptText : ((opts.title != null) ? opts.title : 'ROLL');
    // When reels are PICKABLE the player taps them to choose; reelState(i) tints
    // each reel: 'chosen' (selected) / 'dim' (unavailable) / 'pick' (selectable).
    const pickable = !!opts.pickable;
    const reelState = typeof opts.reelState === 'function' ? opts.reelState : () => null;
    container.classList.add('kit-roller');
    const reelsHTML = reels.map((r, i) => {
      const color = norm(r.color);
      const landedColor = r.resultColor || r.color;
      const pal = PALETTE[norm(landedColor)];
      const landed = r.icon ? { icon: r.icon, color: landedColor } : { symbol: (r.symbol != null ? r.symbol : r.value), color: landedColor };
      const st = reelState(i);
      const cls = ['kit-reel', 'locked'];
      if (pickable) cls.push('kit-reel-pickable');
      if (st === 'chosen') cls.push('kit-reel-chosen');
      else if (st === 'dim') cls.push('kit-reel-dim');
      else if (st === 'pick') cls.push('kit-reel-pick');
      return `<div class="${cls.join(' ')}" data-reel="${i}" data-color="${norm(landedColor)}" style="--reel-size:${size}px;--reel-face:${pal.face};--reel-edge:${pal.edge};--reel-text:${pal.text}">` +
        `<div class="kit-reel-window"><div class="kit-reel-strip">${cellHTML(landed, landedColor)}</div></div></div>`;
    }).join('');
    const slotCls = 'kit-slot kit-slot-static' + (promptText != null ? ' kit-slot-prompt' : '') + (pickable ? ' kit-slot-pickable' : '');
    // Same cabinet chrome as spin() so the resting readout matches the machine.
    container.innerHTML =
      `<div class="${slotCls}" style="--reel-size:${size}px">` +
        `<div class="kit-slot-marquee"><span class="kit-marquee-bulbs" aria-hidden="true">${'<i></i>'.repeat(7)}</span><span class="kit-marquee-text">${marqueeLabel}</span></div>` +
        `<div class="kit-slot-body"><div class="kit-slot-housing"><div class="kit-slot-bank">${reelsHTML}</div><span class="kit-slot-payline" aria-hidden="true"></span></div></div>` +
        `<div class="kit-slot-foot"><span class="kit-slot-coin" aria-hidden="true"></span></div>` +
      `</div>`;
    // Wire reel clicks for pick mode.
    if (pickable && typeof opts.onReelClick === 'function') {
      container.querySelectorAll('.kit-reel[data-reel]').forEach((el) => {
        const i = parseInt(el.getAttribute('data-reel'), 10);
        el.addEventListener('click', () => opts.onReelClick(i));
      });
    }
  }

  // Map a {color,value} (dice API) OR a {color,symbol/icon} (generic) to a reel.
  function toReel(d) {
    if (!d || typeof d !== 'object') return { color: 'white', symbol: '' };
    return { color: d.color, resultColor: d.resultColor, value: d.value, symbol: d.symbol, icon: d.icon, symbols: d.symbols };
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
      // Only forward a GLOBAL spinning-strip override if the caller explicitly
      // gave one. Otherwise leave it undefined so each reel INFERS its own strip
      // (colour reels stream colours/blanks, number reels stream digits) — a
      // global default of DEFAULT_SYMBOLS here is what made colour reels show
      // numbers while spinning.
      ...(opts.symbols ? { symbols: opts.symbols } : {}),
      lever: opts.lever !== false && opts.autoPull !== true,
      autoPull: opts.autoPull === true,
      autoPullDelay: opts.autoPullDelay,
      // Forward the per-game customizations: themed crown + jackpot rule + lever cue.
      marquee: opts.marquee, title: opts.title, leverHint: opts.leverHint,
      jackpot: opts.jackpot, jackpotColor: opts.jackpotColor,
      onPull: opts.onPull, onLock: opts.onLock, onClack: opts.onClack,
    });
  }

  function supported() { return true; }   // pure DOM/CSS — always available

  Kit.Roller = { spin, roll, showStatic, supported, PALETTE };
})();

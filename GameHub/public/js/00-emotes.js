/* =====================================================================
   Kit.Emotes — a CAST of self-contained animated emotion characters.

   Each emotion is a distinct little character (face + colour + signature
   animation) that conveys the FEELING on its own — no emoji attached. Think
   Clash-Royale / Among-Us emotes: a furious red face that shakes & steams, a
   smug purple one that smirks & leans, a teary blue one, etc.

   Games fire these CONTEXTUALLY (busted → 'furious', great discard → 'smug'…).
   Pure inline SVG: themeable, scalable, works in the sandboxed preview, no
   assets, reduced-motion aware.

   API:
     Kit.Emotes.has(id) -> bool
     Kit.Emotes.list()  -> [{id,label}]              (for the picker)
     Kit.Emotes.svg(id) -> '<svg ...>'               (one character, animated)
   ===================================================================== */
(function () {
  'use strict';
  if (typeof Kit === 'undefined') { console.error('[Kit.Emotes] Kit not loaded'); return; }

  // Shared head geometry so the whole cast reads as one family.
  // Each emotion supplies: skin colour, the FACE (eyes/brows/mouth/extras as SVG
  // markup), an animation class for the actor, and a picker label.
  // viewBox is 0 0 100 100, head centred ~ (50,52).
  function head(skin, shade) {
    return `<circle cx="50" cy="52" r="34" fill="${skin}"/>` +
           `<ellipse cx="50" cy="84" rx="22" ry="7" fill="${shade}" opacity=".25"/>`;
  }

  const E = {
    happy: {
      label: 'Happy', skin: '#34d399', shade: '#065f46', anim: 'emo-bounce',
      face:
        // bright round eyes + huge smile + cheeks
        '<circle cx="38" cy="48" r="5" fill="#0f172a"/><circle cx="62" cy="48" r="5" fill="#0f172a"/>' +
        '<circle cx="39.5" cy="46.5" r="1.6" fill="#fff"/><circle cx="63.5" cy="46.5" r="1.6" fill="#fff"/>' +
        '<circle cx="32" cy="58" r="4.5" fill="#fb7185" opacity=".5"/><circle cx="68" cy="58" r="4.5" fill="#fb7185" opacity=".5"/>' +
        '<path d="M36 60 Q50 76 64 60" stroke="#0f172a" stroke-width="3.4" fill="none" stroke-linecap="round"/>',
      extra: '<g class="emo-spark"><path d="M16 30 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#fde68a"/><path d="M82 26 l1.5 4 4 1.5 -4 1.5 -1.5 4 -1.5 -4 -4 -1.5 4 -1.5z" fill="#fde68a"/></g>',
    },
    laugh: {
      label: 'Laughing', skin: '#fbbf24', shade: '#92400e', anim: 'emo-laugh',
      face:
        // squeezed-shut happy eyes (^ ^) + wide open laughing mouth
        '<path d="M32 50 Q38 44 44 50" stroke="#0f172a" stroke-width="3.2" fill="none" stroke-linecap="round"/>' +
        '<path d="M56 50 Q62 44 68 50" stroke="#0f172a" stroke-width="3.2" fill="none" stroke-linecap="round"/>' +
        '<path d="M36 60 Q50 80 64 60 Q50 66 36 60Z" fill="#0f172a"/>' +
        '<path d="M44 67 Q50 71 56 67" fill="#fb7185"/>',
    },
    furious: {
      label: 'Furious', skin: '#ef4444', shade: '#7f1d1d', anim: 'emo-rage',
      face:
        // angry slanted brows + glaring eyes + gritted mouth
        '<path d="M30 42 L46 49" stroke="#0f172a" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M70 42 L54 49" stroke="#0f172a" stroke-width="4" stroke-linecap="round"/>' +
        '<circle cx="40" cy="54" r="4.5" fill="#0f172a"/><circle cx="60" cy="54" r="4.5" fill="#0f172a"/>' +
        '<rect x="38" y="64" width="24" height="9" rx="2" fill="#0f172a"/>' +
        '<path d="M40 64 v9 M46 64 v9 M52 64 v9 M58 64 v9" stroke="#ef4444" stroke-width="1.4"/>',
      extra: '<g class="emo-steam"><path d="M20 24 q-4 -6 0 -12 q4 -6 0 -12" stroke="#fca5a5" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M80 24 q4 -6 0 -12 q-4 -6 0 -12" stroke="#fca5a5" stroke-width="3" fill="none" stroke-linecap="round"/></g>',
    },
    smug: {
      label: 'Smug', skin: '#a855f7', shade: '#581c87', anim: 'emo-lean',
      face:
        // half-lidded confident eyes + raised brow + smirk
        '<path d="M32 44 Q39 41 45 43" stroke="#0f172a" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
        '<path d="M34 50 h10" stroke="#0f172a" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M56 50 h10" stroke="#0f172a" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M38 64 Q50 70 64 60" stroke="#0f172a" stroke-width="3.2" fill="none" stroke-linecap="round"/>',
    },
    cool: {
      label: 'Cool', skin: '#0ea5e9', shade: '#0c4a6e', anim: 'emo-nod',
      face:
        // sunglasses + chill grin
        '<rect x="28" y="46" width="20" height="11" rx="3" fill="#0f172a"/>' +
        '<rect x="52" y="46" width="20" height="11" rx="3" fill="#0f172a"/>' +
        '<rect x="48" y="50" width="4" height="2.5" fill="#0f172a"/>' +
        '<path d="M30 46 h-6 M70 46 h6" stroke="#0f172a" stroke-width="2.4" stroke-linecap="round"/>' +
        '<rect x="31" y="48" width="6" height="2" rx="1" fill="#7dd3fc" opacity=".7"/>' +
        '<path d="M38 66 Q50 73 62 64" stroke="#0f172a" stroke-width="3.2" fill="none" stroke-linecap="round"/>',
    },
    shocked: {
      label: 'Shocked', skin: '#fde047', shade: '#854d0e', anim: 'emo-jolt',
      face:
        // huge round eyes + raised brows + small O mouth
        '<path d="M32 40 Q38 37 44 40" stroke="#0f172a" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
        '<path d="M56 40 Q62 37 68 40" stroke="#0f172a" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
        '<circle cx="38" cy="50" r="7" fill="#fff" stroke="#0f172a" stroke-width="2"/><circle cx="38" cy="51" r="3.2" fill="#0f172a"/>' +
        '<circle cx="62" cy="50" r="7" fill="#fff" stroke="#0f172a" stroke-width="2"/><circle cx="62" cy="51" r="3.2" fill="#0f172a"/>' +
        '<ellipse cx="50" cy="68" rx="5" ry="6.5" fill="#0f172a"/>',
    },
    sad: {
      label: 'Sad', skin: '#60a5fa', shade: '#1e3a8a', anim: 'emo-droop',
      face:
        // worried brows + downturned eyes + frown + tear
        '<path d="M32 46 Q39 43 44 47" stroke="#0f172a" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
        '<path d="M56 47 Q61 43 68 46" stroke="#0f172a" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
        '<circle cx="38" cy="53" r="4" fill="#0f172a"/><circle cx="62" cy="53" r="4" fill="#0f172a"/>' +
        '<path d="M40 70 Q50 62 60 70" stroke="#0f172a" stroke-width="3.2" fill="none" stroke-linecap="round"/>' +
        '<path class="emo-tear" d="M36 57 q-3 6 0 9 q3 -3 0 -9z" fill="#38bdf8"/>',
    },
    cry: {
      label: 'Crying', skin: '#3b82f6', shade: '#1e3a8a', anim: 'emo-sob',
      face:
        '<path d="M32 46 Q39 42 44 47" stroke="#0f172a" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
        '<path d="M56 47 Q61 42 68 46" stroke="#0f172a" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
        '<path d="M34 52 Q38 49 42 52" stroke="#0f172a" stroke-width="3" fill="none" stroke-linecap="round"/>' +
        '<path d="M58 52 Q62 49 66 52" stroke="#0f172a" stroke-width="3" fill="none" stroke-linecap="round"/>' +
        '<ellipse cx="50" cy="69" rx="6" ry="7" fill="#0f172a"/>' +
        '<g class="emo-tears"><path d="M38 56 q-2 10 0 16" stroke="#7dd3fc" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M62 56 q2 10 0 16" stroke="#7dd3fc" stroke-width="3.5" fill="none" stroke-linecap="round"/></g>',
    },
    think: {
      label: 'Thinking', skin: '#2dd4bf', shade: '#115e59', anim: 'emo-tilt',
      face:
        // one raised brow + looking-up eyes + small flat thinking mouth + hand
        '<path d="M32 44 Q39 40 45 43" stroke="#0f172a" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
        '<path d="M56 47 h10" stroke="#0f172a" stroke-width="2.6" stroke-linecap="round"/>' +
        '<circle cx="39" cy="50" r="4" fill="#0f172a"/><circle cx="61" cy="50" r="4" fill="#0f172a"/>' +
        '<path d="M44 67 h12" stroke="#0f172a" stroke-width="3" stroke-linecap="round"/>' +
        // chin hand
        '<g class="emo-hand"><ellipse cx="58" cy="76" rx="8" ry="6" fill="#2dd4bf" stroke="#115e59" stroke-width="1.5"/></g>',
      extra: '<g class="emo-dots"><circle cx="78" cy="34" r="2.5" fill="#5eead4"/><circle cx="85" cy="27" r="3.5" fill="#5eead4"/><circle cx="92" cy="18" r="4.5" fill="#5eead4"/></g>',
    },
    love: {
      label: 'Love it', skin: '#fb7185', shade: '#9f1239', anim: 'emo-throb',
      face:
        // heart eyes + big grin
        '<path class="emo-heart-eye" d="M34 50 a3 3 0 0 1 5 0 a3 3 0 0 1 5 0 q0 4 -5 7 q-5 -3 -5 -7z" fill="#be123c"/>' +
        '<path class="emo-heart-eye" d="M56 50 a3 3 0 0 1 5 0 a3 3 0 0 1 5 0 q0 4 -5 7 q-5 -3 -5 -7z" fill="#be123c"/>' +
        '<path d="M36 64 Q50 76 64 64" stroke="#0f172a" stroke-width="3.2" fill="none" stroke-linecap="round"/>',
      extra: '<g class="emo-hearts"><path d="M14 40 a3 3 0 0 1 5 0 a3 3 0 0 1 5 0 q0 4 -5 7 q-5 -3 -5 -7z" fill="#fb7185"/><path d="M80 30 a2.4 2.4 0 0 1 4 0 a2.4 2.4 0 0 1 4 0 q0 3 -4 5.6 q-4 -2.6 -4 -5.6z" fill="#fb7185"/></g>',
    },
    nervous: {
      label: 'Oops', skin: '#fcd34d', shade: '#92400e', anim: 'emo-wobble',
      face:
        // worried squiggle mouth + sweat drop + side-glance eyes
        '<path d="M33 47 Q39 45 45 47" stroke="#0f172a" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
        '<path d="M55 47 Q61 45 67 47" stroke="#0f172a" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
        '<circle cx="41" cy="53" r="4" fill="#0f172a"/><circle cx="61" cy="53" r="4" fill="#0f172a"/>' +
        '<path d="M40 67 q5 -4 10 0 q5 4 10 0" stroke="#0f172a" stroke-width="3" fill="none" stroke-linecap="round"/>' +
        '<path class="emo-sweat" d="M72 40 q-3 6 0 9 q3 -3 0 -9z" fill="#7dd3fc"/>',
    },
    party: {
      label: 'Party', skin: '#c084fc', shade: '#6b21a8', anim: 'emo-party',
      face:
        '<path d="M32 50 Q38 44 44 50" stroke="#0f172a" stroke-width="3.2" fill="none" stroke-linecap="round"/>' +
        '<path d="M56 50 Q62 44 68 50" stroke="#0f172a" stroke-width="3.2" fill="none" stroke-linecap="round"/>' +
        '<path d="M36 60 Q50 78 64 60 Q50 66 36 60Z" fill="#0f172a"/>' +
        // party hat
        '<path d="M50 8 L40 30 L60 30 Z" fill="#f472b6" stroke="#be185d" stroke-width="1.5"/><circle cx="50" cy="8" r="3" fill="#fde68a"/>',
      extra: '<g class="emo-confetti"><rect x="18" y="44" width="4" height="6" fill="#fde68a"/><rect x="80" y="40" width="4" height="6" fill="#34d399"/><rect x="24" y="64" width="4" height="6" fill="#38bdf8"/><rect x="76" y="62" width="4" height="6" fill="#fb7185"/></g>',
    },
  };

  // Build one animated emotion character.
  function svg(id, opts) {
    opts = opts || {};
    const e = E[id];
    if (!e) {
      // Legacy / unknown: a neutral face that still animates (graceful fallback).
      return `<svg class="emo-char emo-bounce" viewBox="0 0 100 100" width="${opts.size || 96}" height="${opts.size || 96}" aria-hidden="true">${head('#94a3b8', '#334155')}<circle cx="40" cy="50" r="4" fill="#0f172a"/><circle cx="60" cy="50" r="4" fill="#0f172a"/><path d="M40 64 h20" stroke="#0f172a" stroke-width="3" stroke-linecap="round"/></svg>`;
    }
    const size = opts.size || 96;
    return (
      `<svg class="emo-char ${e.anim}" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">` +
      (e.extra || '') +
      head(e.skin, e.shade) +
      e.face +
      '</svg>'
    );
  }

  function has(id) { return !!E[id]; }
  function list() { return Object.keys(E).map((id) => ({ id, label: E[id].label })); }

  // ── CONTEXTUAL auto-emotes: map a game event → an emotion the actor "feels".
  // Central, game-aware but tiny. Returns { mood, seat } or null. The dispatch
  // hook (01-network-local.js) fires these for NEW events so reactions happen
  // automatically on dramatic moments — no per-game wiring beyond emitting events
  // (which the games already do). `prob` lets us keep it punchy, not spammy.
  function fromEvent(game, ev) {
    if (!ev || typeof ev !== 'object') return null;
    // Games normalize events (e.g. Flip 7 emits type:"effect.bust", legacy:"bust").
    // Match on the LEGACY (original) name when present, else the type, and strip
    // any "effect."/"card." namespace prefix so we compare the plain verb.
    const raw = ev.legacy || ev.type || '';
    const t = String(raw).replace(/^(effect|card|deck|target)\./, '');
    const seat = (ev.player != null) ? ev.player : (ev.actor != null ? ev.actor : (ev.seat != null ? ev.seat : -1));
    // Flip 7
    if (game === 'flip7') {
      if (t === 'bust') return { mood: 'furious', seat, prob: 0.85 };
      if (t === 'flip7') return { mood: 'party', seat, prob: 1 };
      if (t === 'stay' && !ev.forced) return { mood: 'cool', seat, prob: 0.4 };
      if (t === 'second_used') return { mood: 'shocked', seat, prob: 0.7 };
      if (t === 'freeze' || t === 'freeze_done' || (t === 'play_action' && ev.actionKind === 'freeze')) return { mood: 'smug', seat, prob: 0.6 };
      return null;
    }
    // Skyjo — dumping a great (low/negative) card to the discard, or a column clear.
    if (game === 'skyjo') {
      if (t === 'column_clear' || t === 'clear') return { mood: 'party', seat, prob: 0.9 };
      if ((t === 'discard' || t === 'to_discard') && typeof ev.value === 'number' && ev.value <= 0) return { mood: 'smug', seat, prob: 0.7 };
      if ((t === 'swap' || t === 'place') && typeof ev.value === 'number' && ev.value >= 10) return { mood: 'nervous', seat, prob: 0.5 };
      return null;
    }
    // Qwixx — locking a row (big!) or taking a penalty.
    if (game === 'qwixx') {
      if (t === 'lock' || ev.locked) return { mood: 'party', seat, prob: 0.9 };
      if (t === 'penalty' || ev.penalty) return { mood: 'sad', seat, prob: 0.7 };
      return null;
    }
    // Schotten — claiming a stone.
    if (game === 'schotten') {
      if (t === 'claim' || t === 'stone_won') return { mood: 'smug', seat, prob: 0.85 };
      return null;
    }
    // Schema games (press-your-luck) — bust / bonus.
    if (t === 'bust') return { mood: 'furious', seat, prob: 0.8 };
    if (t === 'bonus' || t === 'flip7') return { mood: 'party', seat, prob: 1 };
    return null;
  }

  Kit.Emotes = { svg, has, list, fromEvent, IDS: Object.keys(E) };
})();

/**
 * Schotten Totten — client renderer (UI/UX redesign).
 *
 * Built on the shared CardManager (Kit.CardManager) so cards are first-class,
 * permanent objects that ANIMATE between zones:
 *   • PLACE  — the chosen hand card flies from your hand onto the stone.
 *   • DRAW   — a fresh card flies from the visible DECK pile into your hand.
 *   • CLAIM  — the contested stone flips to a claimed marker with a flourish.
 *
 * Rules live ONCE in the shared engine (src/games/schotten) — bundled to the
 * browser as window.GameModules.schotten and run for offline play by the generic
 * LocalEngine adapter. This file is presentation only.
 *
 * Contract:
 *   window.GameClients['schotten'].render(view, ctx?)
 *   window.GameClients['schotten'].act(action, extra?)
 *   window.GameClients['schotten'].unmount()
 */
(function(){
  const ID = 'schotten';
  const PREFIX = 'schotten:';

  // ---- Rulebook (menu / in-game help) ----
  window.GameRules[ID] = {
    title: '🪨 Schotten Totten',
    quick: 'Win border stones by building the strongest 3-card formations.',
    steps: [
      'Each turn: play one clan card (1–9, six colours) on your side of a stone, then draw a new card.',
      'A stone holds up to 3 cards per side. Play on any unclaimed stone with room.',
      'Claim a stone when your formation beats your opponent’s — or can’t possibly be beaten.',
      'Formations, strongest→weakest: colour run > three of a kind > colour > run > sum.',
      'Ties: higher total wins; still tied, whoever completed their 3rd card first.',
    ],
    tip: 'Win 5 stones total, or 3 stones in a row. Don’t reveal your strongest stones too early.',
  };

  let selectedHand = null;          // index of the currently picked hand card
  let lastSeq = -1;                 // last animated lastAction.seq (avoid re-animating)

  // Stable CardManager id for a card sitting somewhere. We key on the card's own
  // intrinsic id (st_<colour>_<value>) so a card keeps ITS identity as it moves
  // hand → stone, which is exactly what makes the flight smooth.
  const cmId = (card) => PREFIX + card.id;

  function send(action, extra = {}) {
    const seat = window._renderView?.yourSeat ?? 0;
    GameActions.send(action, extra, seat);
  }
  function act(action, extra = {}) { send(action, extra); }

  // Renderer for a managed card (also used for the static board anchors).
  function renderClanCard(face, faceUp, { small=false } = {}) {
    const el = document.createElement('div');
    el.className = 'kit-card st-clan' + (small ? ' kit-sm' : '');
    if (!faceUp) { el.classList.add('kit-face-down'); return el; }
    el.dataset.suit = face.c;
    el.innerHTML = `<span class="kit-pip tl">${esc(face.v)}</span>`
      + `<span class="st-val">${esc(face.v)}</span>`
      + `<span class="kit-pip br">${esc(face.v)}</span>`;
    return el;
  }
  // A plain anchor element placed in the DOM grid; the CardManager overlay sits on
  // top of it. Anchors carry data-card-reg so the manager can find/pin them.
  function clanAnchor(card, { small=false } = {}) {
    const a = renderClanCard({ v: card.v, c: card.c }, true, { small });
    a.classList.add('st-anchor');
    a.dataset.cardReg = cmId(card);
    return a;
  }

  // Register (or update) a permanent CardManager card for `card`, then pin it onto
  // its anchor so the overlay covers it.
  function pinCard(card, anchor, location, { small=false } = {}) {
    const id = cmId(card);
    if (!Kit.CardManager.has(id)) {
      Kit.CardManager.create({ v: card.v, c: card.c }, location, {
        id, faceUp: true,
        renderer: (face, up) => renderClanCard(face, up, { small }),
      });
    } else {
      const c = Kit.CardManager.get(id);
      if (c) { c.location = { ...location }; c.renderer = (face, up) => renderClanCard(face, up, { small }); }
    }
    Kit.CardManager.pin(id, anchor, { hideAnchor:false, updateContent:true });
  }

  function render(view, ctx = {}) {
    const s = view[ID];
    if (!s) return;
    const viewer = s.viewerSeat;
    const me = viewer < 0 ? 0 : viewer;
    const opp = 1 - me;
    const myTurn = s.current === viewer && viewer >= 0 && !view.over;

    // ---------- BORDER: 9 stones ----------
    const border = document.createElement('div');
    border.className = 'st-border';
    s.stones.forEach((st, i) => {
      const col = document.createElement('div');
      col.className = 'st-stone-col';

      // opponent side (top)
      const top = document.createElement('div'); top.className = 'st-side st-side-opp';
      for (let slot = 0; slot < 3; slot++) {
        const card = st.sides[opp][slot];
        if (card) top.appendChild(clanAnchor(card, { small:true }));
        else { const ph = document.createElement('div'); ph.className = 'st-slot-empty'; top.appendChild(ph); }
      }

      // stone marker (center)
      const stone = document.createElement('div');
      const claimed = st.claimedBy;
      stone.className = 'st-stone'
        + (claimed === me ? ' st-mine' : claimed === opp ? ' st-theirs' : '');
      stone.dataset.stone = i;
      stone.innerHTML = claimed >= 0
        ? `<span class="st-stone-flag">${claimed === me ? '✓' : '✕'}</span>`
        : `<span class="st-stone-rock">🪨</span>`;
      if (myTurn && s.placedThisTurn && claimed < 0) {
        stone.classList.add('st-claimable');
        stone.title = 'Claim this stone';
        stone.onclick = () => act('claim', { target: i });
      }

      // my side (bottom)
      const bottom = document.createElement('div'); bottom.className = 'st-side st-side-me';
      for (let slot = 0; slot < 3; slot++) {
        const card = st.sides[me][slot];
        if (card) bottom.appendChild(clanAnchor(card, { small:true }));
        else { const ph = document.createElement('div'); ph.className = 'st-slot-empty'; bottom.appendChild(ph); }
      }
      // drop target: a selected hand card may be placed on a stone with room
      if (myTurn && !s.placedThisTurn && selectedHand != null && claimed < 0 && st.sides[me].length < 3) {
        bottom.classList.add('kit-drop');
        bottom.onclick = () => {
          const h = selectedHand; selectedHand = null;
          act('place', { index: h, target: i });
        };
      }

      col.append(top, stone, bottom);
      border.appendChild(col);
    });

    // ---------- HAND ----------
    const hand = document.createElement('div');
    hand.className = 'kit-hand st-hand';
    const myHand = s.players[me]?.hand || [];
    myHand.forEach((card, idx) => {
      const el = clanAnchor(card);
      el.classList.add('st-hand-card');
      if (myTurn && !s.placedThisTurn) {
        el.classList.add('kit-selectable');
        if (selectedHand === idx) el.classList.add('kit-selected');
        el.onclick = () => {
          selectedHand = (selectedHand === idx ? null : idx);
          GameShell.render(window._renderView, window.GameClients[ID]);
        };
      }
      hand.appendChild(el);
    });

    // ---------- TABLE FRAME ----------
    const focus = document.createElement('div');
    focus.className = 'player-board st-board';

    // header rail: scores + deck pile
    const head = document.createElement('div'); head.className = 'st-head';
    const myWon = s.players[me]?.stonesWon || 0;
    const oppWon = s.players[opp]?.stonesWon || 0;
    head.innerHTML =
      `<div class="st-scorebox st-scorebox-me"><span class="st-pname">${esc(s.players[me]?.name || 'You')}</span>`
      + `<span class="st-stonecount">🪨 ${myWon}</span></div>`
      + `<div class="st-deckrail"><div id="stDeck" class="kit-deck"><span class="kit-count">deck ${esc(s.deckCount)}</span></div></div>`
      + `<div class="st-scorebox st-scorebox-opp"><span class="st-pname">${esc(s.players[opp]?.name || 'Opponent')}</span>`
      + `<span class="st-stonecount">🪨 ${oppWon}</span></div>`;

    focus.append(head, border, hand);

    // status line
    let status;
    if (view.over) status = (s.winner === me ? '🏆 You win the border!' : s.winner < 0 ? '🤝 Draw' : 'You lose — better luck next time.');
    else if (viewer < 0) status = 'Spectating';
    else if (!myTurn) status = `Waiting for ${esc(s.players[opp]?.name || 'opponent')}…`;
    else if (!s.placedThisTurn) status = selectedHand != null ? '📍 Tap a stone to place your card' : '🎴 Your turn — pick a card to play';
    else status = '⚖️ Claim a stone you’ve won, or end your turn';

    // ---------- FLIP snapshot: where is each managed card RIGHT NOW (pre-rebuild)?
    // We capture each card overlay's current screen rect BEFORE renderTable rebuilds
    // the DOM, so a card that just moved zones can fly from its true previous
    // position (a card-sized rect) — never from a wide container. (Fixes cards
    // ballooning to screen width: the flight source must be card-sized.)
    const preRects = {};
    Kit.CardManager.ids().forEach((id) => {
      if (!id.startsWith(PREFIX)) return;
      const c = Kit.CardManager.get(id);
      if (c && c.overlayEl) {
        const r = c.overlayEl.getBoundingClientRect();
        if (r.width > 0) preRects[id] = { left: r.left, top: r.top, width: r.width, height: r.height };
      }
    });

    GameShell.renderTable({ game: ID, focus, topMode: 'hidden', status });

    // ---------- pin all on-table + hand cards to their anchors ----------
    const active = [];
    document.querySelectorAll(`[data-card-reg^="${PREFIX}"]`).forEach((anchor) => {
      const id = anchor.dataset.cardReg;
      active.push(id);
    });
    // (re)pin cards from the view model so each overlay tracks its anchor
    s.stones.forEach((st, i) => {
      [me, opp].forEach((seat, sideIdx) => {
        st.sides[seat].forEach((card, slot) => {
          const anchor = document.querySelector(`[data-card-reg="${cmId(card)}"]`);
          if (anchor) pinCard(card, anchor, { zone:'stone', player:seat, slot: i*10+slot }, { small:true });
        });
      });
    });
    myHand.forEach((card, idx) => {
      const anchor = document.querySelector(`[data-card-reg="${cmId(card)}"]`);
      if (anchor) pinCard(card, anchor, { zone:'hand', player:me, slot:idx });
    });
    Kit.CardManager.reconcile(PREFIX, active);
    requestAnimationFrame(() => Kit.CardManager.sync());

    // ---------- ANIMATE the latest action ----------
    runAnimation(s, me, preRects).catch(() => {});

    // ---------- end-turn control ----------
    let ctrl = document.getElementById('stControls');
    if (!ctrl) { ctrl = document.createElement('div'); ctrl.id = 'stControls'; ctrl.className = 'f7-controls'; document.body.appendChild(ctrl); }
    ctrl.innerHTML = '';
    if (myTurn && s.placedThisTurn) {
      const end = document.createElement('button');
      end.className = 'btn green'; end.textContent = 'End turn ▶';
      end.onclick = () => act('end'); ctrl.appendChild(end);
    }

    if (view.summary && typeof showSummary === 'function' && !summaryShown) showSummary(view);
  }

  // Animate the most recent lastAction (place / draw-on-end / claim). The cards
  // are already pinned at their FINAL anchors by render(); we re-stage the moving
  // card at its source and fly it to the (already-correct) anchor.
  // A card-sized, invisible proxy anchor placed at an absolute screen rect. We pin
  // a permanent card to it so the flight SOURCE is exactly card-sized (never a wide
  // container) — moveTo derives its source size from the anchor. Cleaned up after.
  function rectAnchor(rect) {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;pointer-events:none;visibility:hidden`;
    document.body.appendChild(el);
    return el;
  }

  async function runAnimation(s, me, preRects = {}) {
    const a = s.lastAction;
    if (!a || a.seq == null || a.seq === lastSeq) {
      if (a && a.seq != null) lastSeq = a.seq;
      return;
    }
    lastSeq = a.seq;

    if (a.type === 'place' && a.card) {
      const id = cmId(a.card);
      const dest = document.querySelector(`[data-card-reg="${id}"]`);
      if (Kit.CardManager.has(id) && dest) {
        // Fly the SAME permanent card from where it sat last frame (its hand slot,
        // captured pre-rebuild) to its stone slot. Source = a card-sized proxy at
        // the captured rect, so the card never scales to the hand-row's width.
        const src = preRects[id];
        const fromEl = src ? rectAnchor(src) : dest;
        Kit.CardManager.pin(id, fromEl, { hideAnchor:false, updateContent:true });
        await Kit.CardManager.moveTo(id, dest, {
          duration: 460, arc: 40, land: true, hideTarget: true,
          toLocation: { zone:'stone', player:a.player },
        });
        if (src) fromEl.remove();
        if (typeof SFX !== 'undefined' && SFX.flip) SFX.flip();
      }
      return;
    }

    if (a.type === 'end') {
      // A draw happened from the visible deck pile.
      const deck = document.getElementById('stDeck');
      if (!deck) return;
      deck.classList.remove('deal'); void deck.offsetWidth; deck.classList.add('deal');
      if (a.player === me && a.drew) {
        // The drawer sees the real card fly deck→hand with a mid-flight reveal.
        // It's the SAME permanent card that now lives in the hand (no throwaway).
        const id = cmId(a.drew);
        const dest = document.querySelector(`[data-card-reg="${id}"]`);
        if (Kit.CardManager.has(id) && dest) {
          Kit.CardManager.pin(id, deck, { hideAnchor:false, updateContent:false });
          await Kit.CardManager.moveTo(id, dest, {
            duration: 520, arc: 46, flip: true, startFaceDown: true,
            backHTML: '<div class="kit-card kit-face-down"></div>', backClass: 'kit-face-down',
            revealMidway: true, revealAt: 0.5, land: true, hideTarget: true,
            toLocation: { zone:'hand', player:me },
          });
          if (typeof SFX !== 'undefined' && SFX.flip) SFX.flip();
        }
      } else {
        // Opponent drew: their card is hidden info with no on-screen home, so there
        // is nothing permanent to fly. We just pulse the deck (set above) — no
        // transient throwaway card. (Eliminates flyTransient usage entirely.)
        if (typeof SFX !== 'undefined' && SFX.flip) SFX.flip();
      }
      return;
    }

    if (a.type === 'claim') {
      const stoneEl = document.querySelector(`.st-stone[data-stone="${a.stone}"]`);
      if (stoneEl) {
        stoneEl.classList.remove('st-claim-pop'); void stoneEl.offsetWidth; stoneEl.classList.add('st-claim-pop');
        if (typeof Kit.floatText === 'function') Kit.floatText(stoneEl, a.player === me ? 'Claimed!' : 'Lost', a.player === me ? '#22c55e' : '#ef4444');
        if (typeof SFX !== 'undefined' && SFX.good) SFX.good();
      }
      return;
    }
  }

  function unmount() {
    selectedHand = null; lastSeq = -1;
    const c = document.getElementById('stControls'); if (c) c.remove();
    Kit.CardManager.clear(PREFIX);
  }

  window.GameClients[ID] = { render, act, unmount };
})();

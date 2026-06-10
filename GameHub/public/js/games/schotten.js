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

  // A clan card uses the SHARED card look (Kit.cardFace → .kit-card). We render the
  // anchor with Kit.cardFace and stamp data-* so the unified Kit.CardBoard.sync()
  // loop can rebuild each managed overlay from the anchor alone.
  function clanAnchor(card, { small=false, loc=null } = {}) {
    const a = Kit.cardFace({ value: card.v, suit: card.c, className: 'st-clan', sm: small });
    a.classList.add('st-anchor');
    a.dataset.cardReg = cmId(card);
    a.dataset.val = card.v; a.dataset.suit = card.c; if (small) a.dataset.sm = '1';
    if (loc) { a.dataset.zone = loc.zone; a.dataset.player = loc.player; a.dataset.slot = loc.slot; }
    return a;
  }
  // The renderer Kit.CardBoard.sync() calls for each anchor: read its data-* and
  // produce the shared card spec. ONE place describes what a Schotten card looks like.
  function clanSpec(anchor) {
    return { value: anchor.dataset.val, suit: anchor.dataset.suit, className: 'st-clan', sm: anchor.dataset.sm === '1' };
  }
  function clanLoc(anchor) {
    return { zone: anchor.dataset.zone || 'board', player: Number(anchor.dataset.player) || 0, slot: Number(anchor.dataset.slot) || 0 };
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
        if (card) top.appendChild(clanAnchor(card, { small:true, loc:{ zone:'stone', player:opp, slot:i*10+slot } }));
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
        if (card) bottom.appendChild(clanAnchor(card, { small:true, loc:{ zone:'stone', player:me, slot:i*10+slot } }));
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
      const el = clanAnchor(card, { loc:{ zone:'hand', player:me, slot:idx } });
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

    // Capture where every card sits NOW (pre-rebuild) so a card that changed zones
    // can fly from its true previous spot. (Unified: Kit.CardBoard.snapshot.)
    const preRects = Kit.CardBoard.snapshot(PREFIX);

    GameShell.renderTable({ game: ID, focus, topMode: 'hidden', status });

    // Wire every [data-card-reg] anchor to its permanent card in ONE shared call —
    // create-if-missing, refresh renderer, pin, reconcile, sync. (Unified: CardBoard.)
    Kit.CardBoard.sync(PREFIX, { renderer: clanSpec, location: clanLoc });

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
  // card at its source (via Kit.CardBoard.fly) and fly it to the final anchor.
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
        // Fly the SAME permanent card from its previous (hand) spot → stone, via the
        // unified flight (card-sized source from the snapshot — no ballooning).
        await Kit.CardBoard.fly(id, {
          to: dest, fromRect: preRects[id],
          duration: 460, arc: 40, land: true, hideTarget: true,
          toLocation: { zone:'stone', player:a.player },
        });
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
        // Same permanent card that now lives in the hand (no throwaway).
        const id = cmId(a.drew);
        const dest = document.querySelector(`[data-card-reg="${id}"]`);
        if (Kit.CardManager.has(id) && dest) {
          await Kit.CardBoard.fly(id, {
            to: dest, fromEl: deck, updateContent: false,
            duration: 520, arc: 46, flip: true, startFaceDown: true,
            backHTML: '<div class="kit-card kit-face-down"></div>', backClass: 'kit-face-down',
            revealMidway: true, revealAt: 0.5, land: true, hideTarget: true,
            toLocation: { zone:'hand', player:me },
          });
          if (typeof SFX !== 'undefined' && SFX.flip) SFX.flip();
        }
      } else {
        // Opponent drew: hidden info, no on-screen home → just the deck pulse above.
        // No transient throwaway card.
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

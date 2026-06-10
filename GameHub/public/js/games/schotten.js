/**
 * Client renderer + local engine for Schotten Totten (schotten).
 *
 * Contract:
 *   window.GameClients['schotten'].render(view, ctx)
 *   window.GameClients['schotten'].act(action, extra?)
 *   window.GameClients['schotten'].unmount()
 *   window.LocalEngines['schotten'](names)  — offline single-device play
 */
(function(){
  const ID = 'schotten';
  const COLORS = { red:'#ef4444', orange:'#f97316', yellow:'#eab308', green:'#22c55e', blue:'#3b82f6', purple:'#a855f7' };

  window.GameRules[ID] = {
    title: '🪨 Schotten Totten',
    quick: 'Win border stones by building the strongest 3-card formations.',
    steps: [
      'Each turn: play one clan card (1–9, six colours) on your side of a stone, then draw.',
      'A stone holds up to 3 cards per side. You can play on any unclaimed stone.',
      'Claim a stone when your formation beats your opponent’s (or can’t be beaten).',
      'Formations, strongest→weakest: colour run > three of a kind > colour > run > sum.',
      'Ties: higher total wins; still tied, whoever completed their 3rd card first.',
    ],
    tip: 'Win 5 stones total or 3 adjacent stones. Don’t reveal your strong stones too early.',
  };

  let selectedHand = null; // index of selected hand card (place flow)

  function send(action, extra = {}) {
    const seat = window._renderView?.yourSeat ?? 0;
    GameActions.send(action, extra, seat);
  }
  function act(action, extra = {}) { send(action, extra); }

  function cardEl(card, {small=false}={}) {
    const el = document.createElement('div');
    el.className = 'st-card' + (small ? ' st-card-sm' : '');
    el.style.background = COLORS[card.c] || '#888';
    el.textContent = card.v;
    return el;
  }

  function render(view, ctx = {}) {
    const s = view[ID];
    if (!s) return;
    const viewer = s.viewerSeat;
    const myTurn = s.current === viewer && viewer >= 0 && !view.over;

    // ---- The border: 9 stones, opponent side on top, my side on bottom ----
    const opp = 1 - (viewer < 0 ? 0 : viewer);
    const me = viewer < 0 ? 0 : viewer;
    const border = document.createElement('div');
    border.className = 'st-border';
    s.stones.forEach((st, i) => {
      const col = document.createElement('div');
      col.className = 'st-stone-col';

      const top = document.createElement('div'); top.className = 'st-side';
      st.sides[opp].forEach(c => top.appendChild(cardEl(c)));

      const stone = document.createElement('div');
      stone.className = 'st-stone' + (st.claimedBy === me ? ' st-mine' : st.claimedBy === opp ? ' st-theirs' : '');
      stone.textContent = st.claimedBy >= 0 ? (st.claimedBy === me ? '✓' : '✗') : '🪨';
      // Claim button when it's my turn, I've placed, and I can target this stone.
      if (myTurn && s.placedThisTurn && st.claimedBy < 0) {
        stone.classList.add('st-claimable');
        stone.onclick = () => act('claim', { target: i });
        stone.title = 'Claim this stone';
      }

      const bottom = document.createElement('div'); bottom.className = 'st-side st-side-me';
      st.sides[me].forEach(c => bottom.appendChild(cardEl(c)));
      // If a hand card is selected and this stone has room on my side, allow placing.
      if (myTurn && !s.placedThisTurn && selectedHand != null && st.claimedBy < 0 && st.sides[me].length < 3) {
        bottom.classList.add('st-droppable');
        bottom.onclick = () => { const h = selectedHand; selectedHand = null; act('place', { index: h, target: i }); };
      }

      col.appendChild(top); col.appendChild(stone); col.appendChild(bottom);
      border.appendChild(col);
    });

    // ---- My hand ----
    const handWrap = document.createElement('div');
    handWrap.className = 'st-hand';
    const myHand = s.players[me]?.hand;
    if (myHand) {
      myHand.forEach((c, idx) => {
        const el = cardEl(c);
        el.classList.add('st-hand-card');
        if (selectedHand === idx) el.classList.add('st-selected');
        if (myTurn && !s.placedThisTurn) el.onclick = () => { selectedHand = (selectedHand === idx ? null : idx); GameShell.render(window._renderView, window.GameClients[ID]); };
        handWrap.appendChild(el);
      });
    }

    const focus = document.createElement('div');
    focus.className = 'player-board st-board';
    const head = document.createElement('div'); head.className = 'st-head';
    head.innerHTML = `<span>${esc(s.players[me]?.name||'You')}: ${s.players[me]?.stonesWon||0} stones</span>`
      + `<span class="muted">vs ${esc(s.players[opp]?.name||'Opp')}: ${s.players[opp]?.stonesWon||0} · deck ${s.deckCount}</span>`;
    focus.appendChild(head);
    focus.appendChild(border);
    focus.appendChild(handWrap);

    let statusText;
    if (view.over) statusText = (s.winner === me ? '🏆 You win!' : 'You lose.');
    else if (viewer < 0) statusText = 'Spectating';
    else if (!myTurn) statusText = `Waiting for ${esc(s.players[opp]?.name||'opponent')}…`;
    else if (!s.placedThisTurn) statusText = selectedHand != null ? 'Tap a stone to place' : 'Your turn — pick a card';
    else statusText = 'Claim a stone, or end your turn';

    GameShell.renderTable({ game: ID, focus, topMode: 'hidden', status: statusText });

    // End-turn control (after placing).
    let ctrl = document.getElementById('stControls');
    if (!ctrl) { ctrl = document.createElement('div'); ctrl.id = 'stControls'; ctrl.className = 'f7-controls'; document.body.appendChild(ctrl); }
    ctrl.innerHTML = '';
    if (myTurn && s.placedThisTurn) {
      const end = document.createElement('button'); end.className = 'btn green'; end.textContent = 'End turn';
      end.onclick = () => act('end'); ctrl.appendChild(end);
    }

    if (view.summary && !summaryShown) showSummary(view);
  }

  function unmount() { selectedHand = null; const c = document.getElementById('stControls'); if (c) c.remove(); }

  window.GameClients[ID] = { render, act, unmount };

})();

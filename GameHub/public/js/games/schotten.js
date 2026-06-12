/**
 * Schotten Totten — GameClientFramework migration.
 *
 * Uses the declarative framework for:
 *   • Card reconciliation (Kit.CardManager via spec.cards + spec.cardSpec)
 *   • Mini board rendering (auto mini body from card list)
 *   • Inspect popup navigation (auto inspect)
 *   • Turn change detection + banner + SFX
 *   • Animation gating (animating / pendingView / flushView)
 *   • Summary overlay management
 *
 * Game-specific custom code preserved as:
 *   • renderBoard() — the stone border + hand + deck layout
 *   • controls() — end-turn button when placedThisTurn
 *   • status() — Schotten-specific status messages
 *   • animations — place/draw/claim flight choreography
 *
 * Contract:
 *   window.GameClients['schotten'].render(view, ctx?)
 *   window.GameClients['schotten'].act(action, extra?)
 *   window.GameClients['schotten'].unmount()
 */
(function(){
  const ID = 'schotten';
  const PREFIX = 'schotten:';

  // ---- Rulebook ----
  window.GameRules[ID] = {
    title: '🪨 Schotten Totten',
    quick: 'Win border stones by building the strongest 3-card formations.',
    steps: [
      'Each turn: play one clan card (1–9, six colours) on your side of a stone, then draw a new card.',
      'A stone holds up to 3 cards per side. Play on any unclaimed stone with room.',
      'Claim a stone when your formation beats your opponent\'s — or can\'t possibly be beaten.',
      'Formations, strongest→weakest: colour run > three of a kind > colour > run > sum.',
      'Ties: higher total wins; still tied, whoever completed their 3rd card first.',
    ],
    tip: 'Win 5 stones total, or 3 stones in a row. Don\'t reveal your strongest stones too early.',
  };

  let selectedHand = null;
  let lastSeq = -1;

  const cmId = (card) => PREFIX + card.id;

  function send(action, extra = {}) {
    const seat = window._renderView?.yourSeat ?? 0;
    GameActions.send(action, extra, seat);
  }

  // Clan colours → card visual spec
  const CLAN = {
    red:    { bg:{gradient:['#f87171','#dc2626']}, border:'#fca5a5', fg:'#fff' },
    orange: { bg:{gradient:['#fb923c','#ea580c']}, border:'#fdba74', fg:'#fff' },
    yellow: { bg:{gradient:['#eab308','#a16207']}, border:'#fde68a', fg:'#fff' },
    green:  { bg:{gradient:['#4ade80','#16a34a']}, border:'#86efac', fg:'#fff' },
    blue:   { bg:{gradient:['#60a5fa','#2563eb']}, border:'#93c5fd', fg:'#fff' },
    purple: { bg:{gradient:['#c084fc','#9333ea']}, border:'#d8b4fe', fg:'#fff' },
  };
  function clanSpec(card, { small=false } = {}) {
    const t = CLAN[card.c] || CLAN.blue;
    return {
      size: small ? 'sm' : 'md',
      bg: t.bg, border: t.border,
      content: { text: card.v, color: t.fg },
      pips: [card.v, card.v],
    };
  }
  function clanAnchor(card, { small=false, loc=null } = {}) {
    const spec = clanSpec(card, { small });
    const a = Kit.Cards.anchor(cmId(card), spec, { placeholder: true });
    a.classList.add('st-anchor');
    if (loc) { a.dataset.zone = loc.zone; a.dataset.player = loc.player; a.dataset.slot = loc.slot; }
    return a;
  }
  function clanLoc(anchor) {
    return { zone: anchor.dataset.zone || 'board', player: Number(anchor.dataset.player) || 0, slot: Number(anchor.dataset.slot) || 0 };
  }

  function act(action, extra = {}) { send(action, extra); }

  // ── Register with the framework ──────────────────────────────────────
  GameClientFramework.register(ID, {
    // Card identity: enumerate all cards in the view
    cards(view) {
      const s = view[ID];
      if (!s) return [];
      const list = [];
      const viewer = s.viewerSeat;
      const me = viewer < 0 ? 0 : viewer;

      // Stones: both sides
      s.stones.forEach((st, stoneIdx) => {
        [0, 1].forEach(side => {
          st.sides[side].forEach((card, slot) => {
            if (card) list.push({
              id: cmId(card),
              card,
              zone: 'stone',
              seat: side,
              slot: stoneIdx * 10 + slot,
            });
          });
        });
      });

      // My hand
      const myHand = s.players[me]?.hand || [];
      myHand.forEach((card, idx) => {
        list.push({
          id: cmId(card),
          card,
          zone: 'hand',
          seat: me,
          slot: idx,
        });
      });

      return list;
    },

    // Card visual spec
    cardSpec(card, ctx) {
      if (!card || !card.c) return null;
      return clanSpec(card, { small: ctx?.mini || ctx?.static });
    },

    // Custom board: the stone border + hand + deck rail
    renderBoard(view) {
      const s = view[ID];
      if (!s) return document.createElement('div');
      const viewer = s.viewerSeat;
      const me = viewer < 0 ? 0 : viewer;
      const opp = 1 - me;
      const myTurn = s.current === viewer && viewer >= 0 && !view.over;

      // ── 9 stones ──
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
          else { top.appendChild(Kit.Cards.slot({ classes: 'st-slot-empty' })); }
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
          else { bottom.appendChild(Kit.Cards.slot({ classes: 'st-slot-empty' })); }
        }
        if (myTurn && !s.placedThisTurn && selectedHand != null && claimed < 0 && st.sides[me].length < 3) {
          Kit.Cards.drop(bottom, { onClick: () => {
            const h = selectedHand; selectedHand = null;
            act('place', { index: h, target: i });
          }});
        }

        col.append(top, stone, bottom);
        border.appendChild(col);
      });

      // ── Hand ──
      const hand = Kit.Cards.hand({ classes: 'st-hand' });
      const myHand = s.players[me]?.hand || [];
      myHand.forEach((card, idx) => {
        const el = clanAnchor(card, { loc:{ zone:'hand', player:me, slot:idx } });
        el.classList.add('st-hand-card');
        if (myTurn && !s.placedThisTurn) {
          el.classList.add('kc-selectable');
          if (selectedHand === idx) el.classList.add('kc-selected');
          el.onclick = () => {
            selectedHand = (selectedHand === idx ? null : idx);
            GameShell.render(window._renderView, window.GameClients[ID]);
          };
        }
        hand.appendChild(el);
      });

      // ── Header rail ──
      const head = document.createElement('div'); head.className = 'st-head';
      const myWon = s.players[me]?.stonesWon || 0;
      const oppWon = s.players[opp]?.stonesWon || 0;
      const scoreMe = document.createElement('div'); scoreMe.className = 'st-scorebox st-scorebox-me';
      scoreMe.innerHTML = `<span class="st-pname">${esc(s.players[me]?.name || 'You')}</span><span class="st-stonecount">🪨 ${myWon}</span>`;
      const scoreOpp = document.createElement('div'); scoreOpp.className = 'st-scorebox st-scorebox-opp';
      scoreOpp.innerHTML = `<span class="st-pname">${esc(s.players[opp]?.name || 'Opponent')}</span><span class="st-stonecount">🪨 ${oppWon}</span>`;
      const deckRail = document.createElement('div'); deckRail.className = 'st-deckrail';
      deckRail.appendChild(Kit.Cards.deck({ id: 'stDeck', count: s.deckCount, label: 'deck ' + s.deckCount }));
      head.append(scoreMe, deckRail, scoreOpp);

      const focus = document.createElement('div');
      focus.className = 'player-board st-board';
      focus.append(head, border, hand);
      return focus;
    },

    // Status messages
    status(view) {
      const s = view[ID];
      if (!s) return '';
      const viewer = s.viewerSeat;
      const me = viewer < 0 ? 0 : viewer;
      const opp = 1 - me;
      const myTurn = s.current === viewer && viewer >= 0 && !view.over;

      if (view.over) return (s.winner === me ? '🏆 You win the border!' : s.winner < 0 ? '🤝 Draw' : 'You lose — better luck next time.');
      if (viewer < 0) return 'Spectating';
      if (!myTurn) return `Waiting for ${esc(s.players[opp]?.name || 'opponent')}…`;
      if (!s.placedThisTurn) return selectedHand != null ? '📍 Tap a stone to place your card' : '🎴 Your turn — pick a card to play';
      return '⚖️ Claim a stone you\'ve won, or end your turn';
    },

    // Controls
    controls(view) {
      const s = view[ID];
      if (!s) return [];
      const viewer = s.viewerSeat;
      const me = viewer < 0 ? 0 : viewer;
      const myTurn = s.current === viewer && viewer >= 0 && !view.over;
      if (myTurn && s.placedThisTurn) {
        return [{ label: 'End turn ▶', kind: 'green', onClick: () => act('end') }];
      }
      return [];
    },

    // Mini body: render stone cards as card thumbnails
    miniBody(playerIdx, view) {
      const s = view[ID];
      if (!s) return document.createElement('div');
      const viewer = s.viewerSeat;
      const me = viewer < 0 ? 0 : viewer;
      const opp = 1 - me;
      const isMe = playerIdx === me;

      const wrap = document.createElement('div');
      wrap.className = 'kc-mini-grid st-mini-stones';
      s.stones.forEach((st, stoneIdx) => {
        const side = isMe ? st.sides[me] : st.sides[opp];
        side.forEach(card => {
          if (card) {
            const cs = clanSpec(card, { small: true });
            cs.size = 'xs';
            wrap.appendChild(Kit.Cards.el(cs));
          }
        });
      });
      return wrap;
    },

    // Animation recipes
    animations: {
      place: [
        { sfx: 'flip' },
      ],
      end: [
        { sfx: 'flip' },
      ],
      claim: [
        { sfx: 'good' },
      ],
    },

    // Custom unmount
    unmount() {
      selectedHand = null;
      lastSeq = -1;
    },
  });

  // ── Extend the framework-generated client with custom animation logic ──
  // The framework handles card reconciliation, turn banners, mini boards,
  // and inspect popups automatically. We override the animation to use
  // the existing Kit.Cards.move flight API for smooth card transit.
  const baseClient = window.GameClients[ID];
  const originalRender = baseClient.render;

  // Replace render with our animation-enhanced version
  baseClient.render = function(view, ctx = {}) {
    const s = view[ID];
    if (!s) return;

    // Capture pre-render positions for flight animation
    const preRects = Kit.Cards.snapshot(PREFIX);

    // Call the framework render (handles cards, boards, turn detection, etc.)
    originalRender.call(this, view, ctx);

    // Wire every [data-card-reg] anchor to its permanent card
    Kit.Cards.board(PREFIX, { location: clanLoc });

    // Run custom animation
    runAnimation(s, s.viewerSeat < 0 ? 0 : s.viewerSeat, preRects).catch(() => {});
  };

  // Custom animation using the same Kit.Cards.move API the original used
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
        await Kit.Cards.move(id, preRects[id], dest, { toLocation: { zone:'stone', player:a.player } });
        if (typeof SFX !== 'undefined' && SFX.flip) SFX.flip();
      }
      return;
    }

    if (a.type === 'end') {
      const deck = document.getElementById('stDeck');
      if (!deck) return;
      if (a.player === me && a.drew) {
        const id = cmId(a.drew);
        const dest = document.querySelector(`[data-card-reg="${id}"]`);
        if (Kit.CardManager.has(id) && dest) {
          await Kit.Cards.deal(id, deck, dest, { toLocation: { zone:'hand', player:me } });
          if (typeof SFX !== 'undefined' && SFX.flip) SFX.flip();
        }
      } else {
        deck.classList.remove('deal'); void deck.offsetWidth; deck.classList.add('deal');
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

  // Re-export act (the framework's act works but we keep our local reference)
  baseClient.act = function(action, extra = {}) {
    send(action, extra);
  };
})();

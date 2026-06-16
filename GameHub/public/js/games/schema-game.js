/* =====================================================================
   Generic SCHEMA-game client — renders ANY data-defined game from its
   viewFor() payload (namespaced under view[meta.id]). No per-game client code:
   that's the point of schema games (foundation for the visual creator). See
   docs/GAME_SCHEMA.md + src/games/schema/engine.ts.

   Cards are built through the framework (Kit.Cards.el) so they inherit the
   shared geometry/back/sheen + card-flight system — never bespoke elements.
   ===================================================================== */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  window.GameClients = window.GameClients || {};
  window.GameRules = window.GameRules || {};

  const NUMCOL = ['#94a3b8', '#38bdf8', '#22d3ee', '#34d399', '#4ade80', '#a3e635', '#facc15', '#fb923c', '#f97316', '#ef4444', '#ec4899', '#d946ef', '#a855f7'];
  function numFace(n) { return NUMCOL[Math.max(0, Math.min(NUMCOL.length - 1, n | 0))]; }

  function node(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;   // only ever trusted, non-card markup
    return n;
  }
  // A schema number card via the framework (declarative spec → .kc element).
  function card(value, opts) {
    opts = opts || {};
    const spec = {
      zone: 'schema',
      size: opts.size || 'sm',
      bg: numFace(value),
      content: { text: value, color: '#fff' },
    };
    if (opts.dim) spec.state = ['dim'];
    return Kit.Cards.el(spec);
  }
  function cardsRow(cls, values, opts) {
    const row = node('div', cls);
    (values || []).forEach((v) => row.appendChild(card(v, opts)));
    return row;
  }

  function miniBoard(p, isActive) {
    const mini = node('div', 'schema-mini' + (isActive ? ' active' : ''));
    const head = node('div', 'schema-mini-head');
    head.appendChild(node('b', '', escText(p.name)));
    const tag = p.status === 'busted' ? node('span', 'schema-tag bust', 'BUST')
      : p.status === 'stayed' ? node('span', 'schema-tag stay', 'STAY')
      : (isActive ? node('span', 'schema-tag active', '\u25CF') : null);
    if (tag) head.appendChild(tag);
    mini.appendChild(head);
    const cardsWrap = cardsRow('schema-mini-cards', p.kept, { size: 'xs', dim: p.status === 'busted' });
    if (!p.kept || !p.kept.length) cardsWrap.appendChild(node('span', 'schema-empty', '\u2014'));
    mini.appendChild(cardsWrap);
    mini.appendChild(node('div', 'schema-mini-foot', `now ${p.live | 0} \u00b7 total ${p.banked | 0}`));
    return mini;
  }

  function escText(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }

  function render(view) {
    const sc = view[view.game];
    if (!sc || sc.kind == null) return;
    const seat = view.yourSeat;
    const me = sc.players[seat] || sc.players[0] || { seat: 0, name: 'You', kept: [], live: 0, banked: 0, status: 'active' };
    const activeSeat = view.state ? view.state.currentSeat : -1;
    const activeName = (sc.players[activeSeat] && sc.players[activeSeat].name) || '';

    // Opponents strip.
    const opponents = node('div', 'schema-mini-strip');
    sc.players.filter((p) => p.seat !== me.seat).forEach((p) => opponents.appendChild(miniBoard(p, p.seat === activeSeat)));

    // Center: deck + progress + discard.
    const center = node('div', 'schema-center');
    const deckPile = node('div', 'schema-pile');
    deckPile.appendChild(node('div', 'schema-pile-label', 'DECK'));
    const deckCard = Kit.Cards.el({ zone: 'schema', faceDown: true });
    deckCard.classList.add('schema-pile-card');
    deckCard.appendChild(node('span', 'schema-deck-count', String(sc.deckCount | 0)));
    deckPile.appendChild(deckCard);
    center.appendChild(deckPile);
    const prog = node('div', 'schema-progress');
    prog.appendChild(node('div', 'schema-round', `Round ${sc.round | 0}`));
    prog.appendChild(node('div', 'schema-target', `First to <b>${sc.target | 0}</b>` + (sc.bonus ? ` \u00b7 ${sc.bonus.uniqueCount} distinct = +${sc.bonus.points}` : '')));
    center.appendChild(prog);
    const discPile = node('div', 'schema-pile');
    discPile.appendChild(node('div', 'schema-pile-label', 'DISCARD'));
    const dc = node('div', 'schema-pile-card' + (sc.discardCount ? '' : ' empty'), sc.discardCount ? String(sc.discardCount) : '');
    discPile.appendChild(dc);
    center.appendChild(discPile);

    // Focus: your hand.
    const focus = node('div', 'schema-board player-board' + (me.seat === activeSeat ? ' active' : ''));
    const header = node('div', 'board-header');
    header.appendChild(node('span', '', escText(me.name) + (me.seat === seat ? ' (you)' : '')));
    header.appendChild(node('span', 'score-badge', `Now ${me.live | 0} \u00b7 Total ${me.banked | 0}`));
    focus.appendChild(header);
    if (me.kept && me.kept.length) {
      focus.appendChild(cardsRow('schema-hand', me.kept, { size: 'md', dim: me.status === 'busted' }));
    } else {
      const empty = node('div', 'schema-hand');
      empty.appendChild(node('span', 'schema-empty big', 'No cards yet \u2014 draw to start your turn'));
      focus.appendChild(empty);
    }
    const foot = node('div', 'schema-foot');
    if (sc.bonus) { const distinct = new Set(me.kept).size; foot.appendChild(node('span', 'schema-distinct', `${distinct}/${sc.bonus.uniqueCount} distinct`)); }
    if (me.status === 'busted') foot.appendChild(node('span', 'schema-tag bust', 'BUSTED'));
    else if (me.status === 'stayed') foot.appendChild(node('span', 'schema-tag stay', 'STAYED'));
    focus.appendChild(foot);

    const isMyTurn = activeSeat === seat && me.status === 'active' && !view.over;
    const status = view.over ? 'Game Over'
      : isMyTurn ? 'Your turn \u2014 Draw or Stay'
      : view.phase === 'ROUND_END' ? 'Round over'
      : `Waiting for ${escText(activeName)}\u2026`;

    GameShell.renderTable({ game: view.game, opponents, center, focus, status, topMode: 'custom', opponentClass: 'schema-top-strip' });

    // Controls via Kit.Controls (the fixed, no-overlap bottom bar).
    Kit.Controls.clear('schemaControls');
    const legal = (view.state && view.state.legal) || [];
    const can = (a) => legal.some((x) => x.action === a);
    if (view.over) { /* host's play-again handled elsewhere */ }
    else if (view.phase === 'ROUND_END') {
      if (mode === 'local' || (typeof net !== 'undefined' && net.isHost)) {
        Kit.Controls.set([{ label: 'Next round', kind: 'green', onClick: () => GameActions.send('next_round', {}, seat) }], { id: 'schemaControls' });
      }
    } else if (isMyTurn) {
      Kit.Controls.set([
        ...(can('hit') ? [{ label: 'Draw', kind: 'green', onClick: () => GameActions.send('hit', {}, seat) }] : []),
        ...(can('stay') ? [{ label: 'Stay', kind: 'secondary', onClick: () => GameActions.send('stay', {}, seat) }] : []),
      ], { id: 'schemaControls' });
    }
  }

  function unmount() {
    Kit.Controls.clear('schemaControls');
    const mini = document.getElementById('miniBoardsContainer');
    if (mini) { mini.innerHTML = ''; mini.className = 'mini-boards-container'; }
  }
  function clientAct(action, extra = {}) { GameActions.send(action, extra, window._renderView?.yourSeat ?? 0); }

  // Register the generic renderer for every SCHEMA-defined game in the bundled
  // catalogue (tagged __schema by the engine). One renderer, any schema game.
  const client = { render, unmount, act: clientAct };
  (window.GameCatalogue || []).forEach((g) => {
    if (!g.__schema) return;
    window.GameClients[g.id] = client;
    if (!window.GameRules[g.id]) {
      window.GameRules[g.id] = {
        title: g.name,
        quick: g.description || 'Push your luck \u2014 draw, don\u2019t repeat, bank before you bust.',
        steps: [
          'On your turn: <b>Draw</b> a number card or <b>Stay</b> to bank what you\u2019re holding.',
          'Drawing a number you <b>already hold this turn busts you</b> \u2014 you score 0 for the round.',
          'Collect enough <b>distinct</b> numbers for an instant bonus that ends your turn.',
          'Higher numbers have more copies in the deck \u2014 they\u2019re riskier to chase.',
          'First player to reach the target total wins.',
        ],
        tip: 'Bank a good hand rather than greedily chasing the bonus \u2014 the odds shift fast.',
      };
    }
  });
  window.__schemaClient = client;
})();

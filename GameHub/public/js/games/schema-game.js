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

  // Dispatch by schema kind — one client serves every schema game.
  function render(view) {
    const sc = view[view.game];
    if (!sc || sc.kind == null) return;
    if (sc.kind === 'rollAndWrite') return renderRollAndWrite(view, sc);
    return renderPressYourLuck(view, sc);
  }

  function renderPressYourLuck(view, sc) {
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

  // ── rollAndWrite (Encore!/Noch mal!) renderer ───────────────────────
  // Click connected same-colour cells to build a run, then Mark. The grid is
  // data (sc.grid); marks are per-player. Selection is validated live against the
  // current roll + reachability so only legal runs can be submitted.
  let rwSel = [];          // [[r,c],...] currently-selected cells (this turn)
  let rwSelColor = null;

  function rwKey(r, c) { return r + ',' + c; }
  function rwReachable(sc, mset, chosen, r, c, color) {
    const cell = sc.grid[r] && sc.grid[r][c];
    if (!cell || cell.c !== color) return false;
    if (mset.has(rwKey(r, c)) || chosen.has(rwKey(r, c))) return false;
    if (c === sc.startCol) return true;
    const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
    for (const [nr, ncx] of nb) {
      const k = rwKey(nr, ncx);
      if (mset.has(k) || chosen.has(k)) { const adj = sc.grid[nr] && sc.grid[nr][ncx]; if (adj && adj.c === color) return true; }
    }
    return false;
  }

  function renderRollAndWrite(view, sc) {
    const seat = view.yourSeat;
    const me = sc.players[seat] || sc.players[0];
    const isDraft = sc.phase === 'DRAFT';
    const amRoller = seat === sc.active;
    const amDrafting = isDraft && amRoller && !view.over;
    const amPending = (sc.pending || []).includes(seat) && !view.over;
    const faces = sc.myFaces || sc.roll;   // faces I may use right now
    if (!amPending) { rwSel = []; rwSelColor = null; }

    const opponents = node('div', 'rw-mini-strip');
    sc.players.filter((p) => p.seat !== me.seat).forEach((p) => opponents.appendChild(rwMini(sc, p)));

    // Center: dice. In DRAFT the roller clicks 1 colour + 1 number die to reserve;
    // otherwise dice the viewer can't use are dimmed.
    const center = node('div', 'rw-center');
    const dice = node('div', 'rw-dice');
    const dimmable = sc.draft && !sc.draft.noDraft && !isDraft;
    sc.roll.colors.forEach((cf, i) => {
      const d = node('div', 'rw-die rw-die-color');
      if (cf === '*') { d.classList.add('wild'); d.textContent = '\u2605'; } else { d.style.background = sc.colors[cf] || '#64748b'; }
      if (sc.draft && sc.draft.colorIdx === i) d.classList.add('drafted');
      if (amDrafting) { d.classList.add('rw-die-pick'); if (rwDraft.colorIdx === i) d.classList.add('rw-die-chosen'); d.onclick = () => rwDraftPick('color', i); }
      else if (dimmable && !faces.colors.includes(cf)) d.classList.add('rw-die-dim');
      dice.appendChild(d);
    });
    sc.roll.numbers.forEach((nf, i) => {
      const d = node('div', 'rw-die rw-die-num', nf === 0 ? '?' : String(nf));
      if (nf === 0) d.classList.add('wild');
      if (sc.draft && sc.draft.numberIdx === i) d.classList.add('drafted');
      if (amDrafting) { d.classList.add('rw-die-pick'); if (rwDraft.numberIdx === i) d.classList.add('rw-die-chosen'); d.onclick = () => rwDraftPick('number', i); }
      else if (dimmable && !faces.numbers.includes(nf)) d.classList.add('rw-die-dim');
      dice.appendChild(d);
    });
    center.appendChild(dice);
    const info = node('div', 'rw-roll-info');
    info.appendChild(node('span', 'rw-round', `Round ${sc.round | 0}`));
    const rollerName = (sc.players[sc.active] && sc.players[sc.active].name) || '';
    const sub = isDraft ? (amDrafting ? 'Pick 1 colour + 1 number die to keep' : `${escText(rollerName)} is drafting dice\u2026`)
      : `${escText(rollerName)} rolled \u00b7 finish ${sc.endColorsToFinish} colours to end`;
    info.appendChild(node('span', 'rw-roller', sub));
    center.appendChild(info);

    const focus = node('div', 'rw-board player-board' + (amPending || amDrafting ? ' active' : ''));
    const header = node('div', 'board-header');
    header.appendChild(node('span', '', escText(me.name) + (me.seat === seat ? ' (you)' : '')));
    const wildsLeft = Math.max(0, (sc.wilds | 0) - (me.wildsUsed | 0));
    header.appendChild(node('span', 'score-badge', `Score ${me.score | 0} \u00b7 ${wildsLeft} wilds`));
    focus.appendChild(header);
    focus.appendChild(rwGrid(view, sc, me, seat, amPending));
    focus.appendChild(rwSelectionBar(view, sc, me, seat, amPending, faces));

    const status = view.over ? 'Game Over'
      : amDrafting ? 'Draft your dice (the rest go to everyone else)'
      : isDraft ? `Waiting for ${escText(rollerName)} to draft\u2026`
      : amPending ? 'Cross connected boxes, then Mark \u2014 or Skip'
      : 'Waiting for other players\u2026';
    GameShell.renderTable({ game: view.game, opponents, center, focus, status, topMode: 'custom', opponentClass: 'rw-top-strip' });

    Kit.Controls.clear('schemaControls');
    if (view.over) { /* play-again handled elsewhere */ }
    else if (amDrafting) {
      const ready = rwDraft.colorIdx >= 0 && rwDraft.numberIdx >= 0;
      Kit.Controls.set([
        { label: 'Keep dice', kind: 'green', disabled: !ready, onClick: () => { const d = rwDraft; rwDraft = { colorIdx: -1, numberIdx: -1 }; GameActions.send('draft', { colorIdx: d.colorIdx, numberIdx: d.numberIdx }, seat); } },
        { label: 'Take none', kind: 'secondary', onClick: () => { rwDraft = { colorIdx: -1, numberIdx: -1 }; GameActions.send('skip', {}, seat); } },
      ], { id: 'schemaControls' });
    }
    else if (amPending) {
      const valid = rwSelValid(sc, me, faces);
      Kit.Controls.set([
        { label: rwSel.length ? `Mark ${rwSel.length}` : 'Mark', kind: 'green', disabled: !valid, onClick: () => rwSubmit(view, sc, seat, faces) },
        { label: 'Skip', kind: 'secondary', onClick: () => { rwSel = []; rwSelColor = null; GameActions.send('skip', {}, seat); } },
      ], { id: 'schemaControls' });
    }
  }

  let rwDraft = { colorIdx: -1, numberIdx: -1 };
  function rwDraftPick(kind, i) {
    if (kind === 'color') rwDraft.colorIdx = (rwDraft.colorIdx === i ? -1 : i);
    else rwDraft.numberIdx = (rwDraft.numberIdx === i ? -1 : i);
    dispatchView(window._renderView);
  }

  function rwGrid(view, sc, p, seat, interactive) {
    const wrap = node('div', 'rw-grid');
    const mset = new Set(p.marked || []);
    const chosen = new Set(rwSel.map(([r, c]) => rwKey(r, c)));
    for (let r = 0; r < sc.grid.length; r++) {
      const rowEl = node('div', 'rw-row');
      for (let c = 0; c < sc.grid[r].length; c++) {
        const cell = sc.grid[r][c];
        if (!cell) { rowEl.appendChild(node('div', 'rw-cell rw-gap')); continue; }
        const el = node('div', 'rw-cell');
        el.style.background = sc.colors[cell.c] || '#64748b';
        if (c === sc.startCol) el.classList.add('rw-start');
        if (cell.star) el.appendChild(node('span', 'rw-star', '\u2605'));
        const marked = mset.has(rwKey(r, c));
        const sel = chosen.has(rwKey(r, c));
        if (marked) el.classList.add('rw-marked');
        if (sel) el.classList.add('rw-sel');
        if (interactive && !marked) {
          el.classList.add('rw-click');
          el.onclick = () => rwToggle(view, sc, p, r, c, cell.c);
        }
        rowEl.appendChild(el);
      }
      wrap.appendChild(rowEl);
    }
    return wrap;
  }

  function rwToggle(view, sc, p, r, c, color) {
    const k = rwKey(r, c);
    const idx = rwSel.findIndex(([rr, cc]) => rr === r && cc === c);
    if (idx >= 0) { rwSel.splice(idx, 1); if (!rwSel.length) rwSelColor = null; dispatchView(window._renderView); return; }
    // must be same colour as current selection
    if (rwSelColor && color !== rwSelColor) { rwSel = []; }
    rwSelColor = color;
    // validate reachability given marks + current selection
    const mset = new Set(p.marked || []);
    const chosen = new Set(rwSel.map(([rr, cc]) => rwKey(rr, cc)));
    if (!rwReachable(sc, mset, chosen, r, c, color)) {
      // allow starting fresh on this cell if it's itself reachable from scratch
      const fresh = new Set();
      if (rwReachable(sc, mset, fresh, r, c, color)) { rwSel = [[r, c]]; rwSelColor = color; dispatchView(window._renderView); return; }
      return; // illegal — ignore
    }
    rwSel.push([r, c]);
    dispatchView(window._renderView);
  }

  function rwSelValid(sc, p, faces) {
    faces = faces || sc.myFaces || sc.roll;
    if (!rwSel.length || !rwSelColor) return false;
    const len = rwSel.length;
    if (len > 5) return false;
    const concreteNum = faces.numbers.includes(len);
    const wildNum = faces.numbers.includes(0);
    const concreteColor = faces.colors.includes(rwSelColor);
    const wildColor = faces.colors.includes('*');
    if (!concreteNum && !wildNum) return false;
    if (!concreteColor && !wildColor) return false;
    const cost = (concreteColor ? 0 : 1) + (concreteNum ? 0 : 1);
    if (cost && (p.wildsUsed | 0) + cost > (sc.wilds | 0)) return false;
    return true;
  }

  function rwSelectionBar(view, sc, p, seat, interactive, faces) {
    faces = faces || sc.myFaces || sc.roll;
    const bar = node('div', 'rw-selbar');
    if (!interactive) return bar;
    const len = rwSel.length;
    if (!len) { bar.appendChild(node('span', 'rw-hint', 'Tap connected boxes of one colour (from centre or next to a crossed box).')); return bar; }
    const concreteNum = faces.numbers.includes(len);
    const concreteColor = faces.colors.includes(rwSelColor);
    const wildCost = (concreteColor ? 0 : 1) + (concreteNum ? 0 : 1);
    const ok = rwSelValid(sc, p, faces);
    const chip = node('span', 'rw-selchip' + (ok ? ' ok' : ' bad'),
      `${len} ${rwSelColor}` + (wildCost ? ` \u00b7 ${wildCost} wild${wildCost > 1 ? 's' : ''}` : '') + (ok ? '' : ' \u2014 no matching die'));
    chip.style.setProperty('--c', sc.colors[rwSelColor] || '#64748b');
    bar.appendChild(chip);
    const clear = node('button', 'rw-clear', 'Clear');
    clear.onclick = () => { rwSel = []; rwSelColor = null; dispatchView(window._renderView); };
    bar.appendChild(clear);
    return bar;
  }

  function rwSubmit(view, sc, seat, faces) {
    faces = faces || sc.myFaces || sc.roll;
    const me = sc.players[seat];
    if (!rwSelValid(sc, me, faces)) return;
    const len = rwSel.length;
    const concreteNum = faces.numbers.includes(len);
    const concreteColor = faces.colors.includes(rwSelColor);
    const msg = { color: rwSelColor, cells: rwSel.map(([r, c]) => [r, c]) };
    if (!concreteColor) msg.wildColor = true;
    if (!concreteNum) msg.wildNumber = true;
    const cells = rwSel; rwSel = []; rwSelColor = null;   // clear before send
    GameActions.send('mark', msg, seat);
  }

  function rwMini(sc, p) {
    const mini = node('div', 'rw-mini');
    const head = node('div', 'rw-mini-head');
    head.appendChild(node('b', '', escText(p.name)));
    head.appendChild(node('span', 'rw-mini-score', String(p.score | 0)));
    mini.appendChild(head);
    const mset = new Set(p.marked || []);
    const g = node('div', 'rw-mini-grid');
    for (let r = 0; r < sc.grid.length; r++) {
      const row = node('div', 'rw-mini-row');
      for (let c = 0; c < sc.grid[r].length; c++) {
        const cell = sc.grid[r][c];
        const d = node('div', 'rw-mini-cell' + (cell ? '' : ' gap') + (cell && mset.has(rwKey(r, c)) ? ' on' : ''));
        if (cell) d.style.background = mset.has(rwKey(r, c)) ? '#1e293b' : (sc.colors[cell.c] || '#64748b');
        row.appendChild(d);
      }
      g.appendChild(row);
    }
    mini.appendChild(g);
    return mini;
  }

  function unmount() {
    rwSel = []; rwSelColor = null;
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
      window.GameRules[g.id] = (g.__schemaKind === 'rollAndWrite') ? {
        title: g.name,
        quick: g.description || 'Roll dice, cross connected boxes, race to finish columns and colours.',
        steps: [
          'Each turn the roller rolls colour dice + number dice; everyone marks boxes.',
          'Cross <b>that many connected boxes</b> of one colour \u2014 from the centre column or next to a crossed box.',
          'Be the <b>first</b> to fill a whole column or a whole colour for the most points.',
          'Stars left uncrossed cost points; leftover wilds score 1 each.',
          'The game ends right after someone completes their second whole colour.',
        ],
        tip: 'Push toward the edge columns (worth more), but never strand boxes \u2014 connectivity is everything.',
      } : {
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

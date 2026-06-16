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
  function render(view, ctx) {
    const sc = view[view.game];
    if (!sc || sc.kind == null) return;
    if (sc.kind === 'rollAndWrite') return renderRollAndWrite(view, sc, ctx || {});
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
    if (!cell || cell.c !== color) return false;             // run is one colour
    if (mset.has(rwKey(r, c)) || chosen.has(rwKey(r, c))) return false;
    if (c === sc.startCol) return true;                      // start column
    // CROSS-COLOUR adjacency: connect to any crossed/chosen box, any colour.
    const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
    for (const [nr, ncx] of nb) {
      const k = rwKey(nr, ncx);
      if (mset.has(k) || chosen.has(k)) return true;
    }
    return false;
  }

  // Can this player currently MARK a cell of `color`, given the dice they may use?
  // True if a concrete colour die matches, OR they hold a wild colour die ("*")
  // and still have wild budget left.
  function rwUsableColor(sc, p, faces, color) {
    if (!faces) return false;
    if (faces.colors && faces.colors.includes(color)) return true;      // concrete colour die
    const wildLeft = (sc.wilds || 0) - ((p && p.wildsUsed) || 0);
    return !!(faces.colors && faces.colors.includes('*') && wildLeft > 0);
  }

  // Which NUMBER values can this player play right now? Concrete number dice +
  // (if they hold a "?"/wild number and have budget) any value 1..maxRun.
  function rwUsableNumbers(sc, p, faces, maxRun) {
    const set = new Set();
    if (!faces) return set;
    (faces.numbers || []).forEach((n) => { if (n >= 1 && n <= 5) set.add(n); });
    const wildLeft = (sc.wilds || 0) - ((p && p.wildsUsed) || 0);
    if ((faces.numbers || []).includes(0) && wildLeft > 0) {
      for (let n = 1; n <= Math.min(5, maxRun || 5); n++) set.add(n);
    }
    return set;
  }

  // All REACHABLE same-colour clumps for one colour: connected runs of unmarked
  // cells where the whole run can be crossed in ONE mark (seeded from the centre
  // column or next to an existing cross of any colour, then grown by same-colour
  // adjacency). Returns [{cells:[[r,c]...], size}]. The max run you can take from
  // a clump is its size, so a clump can satisfy a die N iff size >= N.
  function rwClumpsForColor(sc, p, color) {
    const mset = new Set(p.marked || []);
    const seen = new Set();
    const clumps = [];
    for (let r = 0; r < sc.grid.length; r++) {
      for (let c = 0; c < sc.grid[r].length; c++) {
        const cell = sc.grid[r][c];
        if (!cell || cell.c !== color) continue;
        const k = rwKey(r, c);
        if (seen.has(k) || mset.has(k)) continue;
        const clump = []; const stack = [[r, c]]; const local = new Set([k]);
        while (stack.length) {
          const [cr, cc] = stack.pop();
          clump.push([cr, cc]);
          for (const [nr, nc] of [[cr - 1, cc], [cr + 1, cc], [cr, cc - 1], [cr, cc + 1]]) {
            const cel = sc.grid[nr] && sc.grid[nr][nc];
            const nk = rwKey(nr, nc);
            if (cel && cel.c === color && !mset.has(nk) && !local.has(nk)) { local.add(nk); stack.push([nr, nc]); }
          }
        }
        clump.forEach(([cr, cc]) => seen.add(rwKey(cr, cc)));
        // reachable as one mark: some cell touches centre column or a crossed box
        const reachable = clump.some(([cr, cc]) => {
          if (cc === sc.startCol) return true;
          for (const [nr, nc] of [[cr - 1, cc], [cr + 1, cc], [cr, cc - 1], [cr, cc + 1]]) {
            if (mset.has(rwKey(nr, nc))) return true;
          }
          return false;
        });
        if (reachable) clumps.push({ cells: clump.map(([cr, cc]) => [cr, cc]), size: clump.length });
      }
    }
    return clumps;
  }

  // PERFECT-MATCH blocks (pick-aware): once the player has chosen a colour + a
  // number die, a clump whose size EXACTLY equals the chosen number (and whose
  // colour the chosen colour die allows) glows gold and fills in one tap.
  // Returns Map(cellKey -> {id, color, size, cells}).
  function rwPerfectBlocks(sc, p, faces, interactive) {
    const blocks = new Map();
    if (!interactive || rwSel.length) return blocks;       // only when no run in progress
    const pick = rwPickResolved(sc, p);
    if (!pick) return blocks;                              // dice not chosen yet → no hints
    const colors = rwPickColors(sc);
    let id = 0;
    for (const color of colors) {
      for (const clump of rwClumpsForColor(sc, p, color)) {
        // size must EXACTLY equal one of the playable sizes (concrete N, or a
        // wild "?" can be exactly the clump size if ≤5).
        const exact = pick.sizes.includes(clump.size);
        if (!exact) continue;
        const meta = { id: ++id, color, size: clump.size, cells: clump.cells };
        clump.cells.forEach(([cr, cc]) => blocks.set(rwKey(cr, cc), meta));
      }
    }
    return blocks;
  }

  // "Smart hint" — cells the player can legally mark RIGHT NOW. Strictly gated on
  // the chosen dice: nothing lights up until BOTH a colour + number die are
  // picked, then ONLY cells of an allowed colour whose reachable clump is big
  // enough to fit the chosen number show (req: don't highlight areas too small
  // for the number). While a run is in progress it's locked to that one colour.
  function rwHintSet(sc, p, faces, interactive) {
    const hint = new Set();
    if (!interactive) return hint;
    const mset = new Set(p.marked || []);
    const chosen = new Set(rwSel.map(([r, c]) => rwKey(r, c)));
    // Run in progress → only extend the locked colour (engine validates final size).
    if (rwSel.length && rwSelColor) {
      for (let r = 0; r < sc.grid.length; r++) for (let c = 0; c < sc.grid[r].length; c++) {
        const cell = sc.grid[r][c];
        if (!cell || cell.c !== rwSelColor) continue;
        if (rwReachable(sc, mset, chosen, r, c, cell.c)) hint.add(rwKey(r, c));
      }
      return hint;
    }
    const pick = rwPickResolved(sc, p);
    if (!pick) return hint;                                // dice not chosen yet
    const minNeeded = Math.min.apply(null, pick.sizes);   // smallest run the die can make
    for (const color of rwPickColors(sc)) {
      for (const clump of rwClumpsForColor(sc, p, color)) {
        if (clump.size < minNeeded) continue;             // clump too small for the number
        clump.cells.forEach(([cr, cc]) => hint.add(rwKey(cr, cc)));
      }
    }
    return hint;
  }

  function renderRollAndWrite(view, sc, ctx) {
    ctx = ctx || {};
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

    // Center: the SLOT-MACHINE roller animates the 3 colour + 3 number dice
    // (like Qwixx). The tray is persisted so it survives re-renders and animates
    // once per fresh roll. After it settles, reels become draft targets.
    const center = node('div', 'rw-center');
    const tray = ctx.persist ? ctx.persist('encore:dice', () => node('div', 'rw-slot-tray')) : node('div', 'rw-slot-tray');
    center.appendChild(tray);
    const info = node('div', 'rw-roll-info');
    info.appendChild(node('span', 'rw-round', `Round ${sc.round | 0}`));
    const rollerName = (sc.players[sc.active] && sc.players[sc.active].name) || '';
    const sub = isDraft ? (amDrafting ? 'Pick 1 colour + 1 number die to keep' : `${escText(rollerName)} is drafting dice\u2026`)
      : `${escText(rollerName)} rolled \u00b7 finish ${sc.endColorsToFinish} colours to end`;
    info.appendChild(node('span', 'rw-roller', sub));
    center.appendChild(info);

    // Build the reels: colour dice (coloured faces / ★ wild) + number dice.
    const COLMAP = { B: 'blue', O: 'orange', Y: 'yellow', G: 'green', R: 'red' };
    const reels = []
      .concat(sc.roll.colors.map((cf) => cf === '*' ? { color: 'purple', symbol: '\u2605' } : { color: COLMAP[cf] || 'white', symbol: '' }))
      .concat(sc.roll.numbers.map((nf) => ({ color: 'white', symbol: nf === 0 ? '?' : String(nf) })));
    const nC = sc.roll.colors.length;
    const sig = sc.round + ':' + sc.roll.colors.join('') + '|' + sc.roll.numbers.join('');
    const dsize = (typeof innerWidth !== 'undefined' && innerWidth < 760) ? 38 : 52;
    // Whose hand is on the lever? The ROLLER pulls it — but only when the device
    // is actually focused on (controls) the roller's seat and they're a human.
    const controlled = (typeof window !== 'undefined' && Array.isArray(window._controlledSeats)) ? window._controlledSeats
      : (Array.isArray(view.controlledSeats) ? view.controlledSeats : []);
    const rollerIsBot = (typeof isLocalBotSeat === 'function') ? isLocalBotSeat(sc.active) : false;
    const rollerIsMine = controlled.includes(sc.active) && !rollerIsBot;
    const focusedOnRoller = seat === sc.active;
    const useLever = rollerIsMine && focusedOnRoller && !view.over;

    // Reset my MARK-phase pick when a fresh roll arrives.
    if (rwPick.sig !== sig) rwPickReset(sig);

    // Am I in a SELECT phase (choosing my dice)? Either the roller drafting, or a
    // pending player who hasn't picked their colour+number yet.
    const pickComplete = rwPick.colorFace != null && rwPick.numberFace != null;
    const amSelecting = !view.over && (amDrafting || (amPending && !isDraft && !pickComplete));

    // Which faces may I select from? Roller-draft picks from ALL rolled dice; a
    // marking player picks from the dice available to them (myFaces).
    function reelSelectable(i) {
      if (amDrafting) return true;                          // roller may keep any pair
      const isColor = i < nC;
      const face = isColor ? sc.roll.colors[i] : sc.roll.numbers[i - nC];
      return (isColor ? faces.colors : faces.numbers).includes(face);
    }
    // Click a reel during SELECT: choose that colour OR number (one of each).
    function pickReel(i) {
      if (!reelSelectable(i)) return;
      const isColor = i < nC;
      if (amDrafting) {
        // roller reserves by INDEX (engine draft is index-based)
        if (isColor) rwDraft.colorIdx = (rwDraft.colorIdx === i ? -1 : i);
        else rwDraft.numberIdx = (rwDraft.numberIdx === (i - nC) ? -1 : (i - nC));
        if (rwDraft.colorIdx >= 0 && rwDraft.numberIdx >= 0) {     // 2 picked → auto-lock
          const d = rwDraft; rwDraft = { colorIdx: -1, numberIdx: -1 };
          GameActions.send('draft', { colorIdx: d.colorIdx, numberIdx: d.numberIdx }, seat);
          return;
        }
      } else {
        const face = isColor ? sc.roll.colors[i] : sc.roll.numbers[i - nC];
        if (isColor) rwPick.colorFace = (rwPick.colorFace === face ? null : face);
        else rwPick.numberFace = (rwPick.numberFace === face ? null : face);
      }
      dispatchView(window._renderView);
    }
    // Visual state for each reel in SELECT mode.
    function reelState(i) {
      const isColor = i < nC;
      if (amDrafting) {
        const chosen = isColor ? rwDraft.colorIdx === i : rwDraft.numberIdx === (i - nC);
        return chosen ? 'chosen' : 'pick';
      }
      if (amSelecting) {
        if (!reelSelectable(i)) return 'dim';
        const face = isColor ? sc.roll.colors[i] : sc.roll.numbers[i - nC];
        const chosen = isColor ? rwPick.colorFace === face : rwPick.numberFace === face;
        return chosen ? 'chosen' : 'pick';
      }
      // Not selecting: after my pick, keep the chosen pair highlighted, dim the rest.
      if (amPending && pickComplete) {
        const face = isColor ? sc.roll.colors[i] : sc.roll.numbers[i - nC];
        const chosen = isColor ? rwPick.colorFace === face : rwPick.numberFace === face;
        return chosen ? 'chosen' : 'dim';
      }
      return null;
    }

    // Paint the settled machine: a SELECT prompt + pickable reels while choosing,
    // otherwise a plain static readout (with the chosen pair highlighted). NEVER
    // paint over a machine that is mid-spin or awaiting a lever pull — that would
    // destroy the animation.
    function paintStatic() {
      const slot = tray.querySelector('.kit-slot');
      if (slot) {
        // Mid-spin → never repaint (kills the animation).
        if (slot.classList.contains('spinning')) return;
        // Awaiting a lever pull (and not yet spun) → keep the lever; don't repaint.
        if (slot.classList.contains('await-pull') && !slot.classList.contains('locked-in')) return;
      }
      const promptable = amSelecting;
      Kit.Roller.showStatic(tray, reels, {
        size: dsize,
        prompt: promptable ? 'SELECT' : null,
        pickable: promptable || (amPending && pickComplete),
        onReelClick: pickReel,
        reelState,
      });
    }

    // Animate the roll once per fresh roll; the static SELECT/readout state is
    // painted ONLY after the spin resolves (or immediately on a re-render with the
    // same roll). Calling paintStatic eagerly would wipe the spin animation.
    if (tray.dataset.sig !== sig) {
      tray.dataset.sig = sig;
      try {
        Kit.Roller.roll(tray, reels, {
          size: dsize, marquee: 'ENCORE',
          lever: useLever, autoPull: !useLever, autoPullDelay: 0,
          leverHint: 'ROLL',
        }).then(() => { paintStatic(); });
      } catch (e) { paintStatic(); }
    } else {
      paintStatic();
      // re-assert next frame to cover the persisted-static re-render path
      if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(paintStatic);
    }

    const focus = node('div', 'rw-board player-board' + (amPending || amDrafting ? ' active' : ''));
    const header = node('div', 'board-header');
    header.appendChild(node('span', '', escText(me.name) + (me.seat === seat ? ' (you)' : '')));
    const wildsLeft = Math.max(0, (sc.wilds | 0) - (me.wildsUsed | 0));
    header.appendChild(node('span', 'score-badge', `Score ${me.score | 0} \u00b7 ${wildsLeft} wilds`));
    focus.appendChild(header);
    focus.appendChild(rwSheet(view, sc, me, seat, amPending, faces));
    focus.appendChild(rwSelectionBar(view, sc, me, seat, amPending, faces));

    const pickDone = rwPick.colorFace != null && rwPick.numberFace != null;
    const status = view.over ? 'Game Over'
      : amDrafting ? 'Tap a colour + a number die to keep (the rest go to everyone else)'
      : isDraft ? `Waiting for ${escText(rollerName)} to draft\u2026`
      : (amPending && !pickDone) ? 'Tap a colour die + a number die to choose your move'
      : amPending ? 'Cross connected boxes, then Mark \u2014 or Skip'
      : 'Waiting for other players\u2026';
    GameShell.renderTable({ game: view.game, opponents, center, focus, status, topMode: 'custom', opponentClass: 'rw-top-strip' });

    Kit.Controls.clear('schemaControls');
    if (view.over) { /* play-again handled elsewhere */ }
    else if (amDrafting) {
      // Dice are reserved by tapping the reels (auto-locks at 2). Only a "Take
      // none" escape hatch remains on the bar.
      Kit.Controls.set([
        { label: 'Take none', kind: 'secondary', onClick: () => { rwDraft = { colorIdx: -1, numberIdx: -1 }; GameActions.send('skip', {}, seat); } },
      ], { id: 'schemaControls' });
    }
    else if (amPending && !pickDone) {
      // Must pick dice first — no Mark yet; just a Skip escape.
      Kit.Controls.set([
        { label: 'Skip turn', kind: 'secondary', onClick: () => { rwSel = []; rwSelColor = null; rwPickReset(sig); GameActions.send('skip', {}, seat); } },
      ], { id: 'schemaControls' });
    }
    else if (amPending) {
      const valid = rwSelValid(sc, me, faces);
      Kit.Controls.set([
        { label: rwSel.length ? `Mark ${rwSel.length}` : 'Mark', kind: 'green', disabled: !valid, onClick: () => { rwSubmit(view, sc, seat, faces); rwPickReset(sig); } },
        { label: 'Change dice', kind: 'secondary', onClick: () => { rwSel = []; rwSelColor = null; rwPick.colorFace = null; rwPick.numberFace = null; dispatchView(window._renderView); } },
        { label: 'Skip', kind: 'ghost', onClick: () => { rwSel = []; rwSelColor = null; rwPickReset(sig); GameActions.send('skip', {}, seat); } },
      ], { id: 'schemaControls' });
    }
  }

  // Roller draft selection (index-based, used during the DRAFT phase).
  let rwDraft = { colorIdx: -1, numberIdx: -1 };

  // ── MARK-phase die selection (the "select dice first" flow) ──────────────
  // Each player first picks ONE colour reel + ONE number reel from the dice they
  // may use; only THEN do mark hints appear, restricted to that exact pair.
  // rwPick stores the chosen FACE values ('*' = wild colour, 0 = wild number).
  let rwPick = { colorFace: null, numberFace: null, sig: null };
  function rwPickReset(sig) { rwPick = { colorFace: null, numberFace: null, sig: sig }; }
  // What the picked dice mean for highlighting. Returns null until BOTH chosen.
  function rwPickResolved(sc, p) {
    if (rwPick.colorFace == null || rwPick.numberFace == null) return null;
    const wildColor = rwPick.colorFace === '*';
    const wildNumber = rwPick.numberFace === 0;
    const wildLeft = (sc.wilds || 0) - ((p && p.wildsUsed) || 0);
    // sizes this number die can mark: a concrete N, or 1..5 for a wild '?'
    const sizes = wildNumber ? [1, 2, 3, 4, 5].filter(() => wildLeft >= (wildColor ? 2 : 1)) : [rwPick.numberFace];
    return { wildColor, wildNumber, sizes };
  }
  // The colours a chosen colour die allows: a concrete colour, or ANY colour for
  // a wild '*' (subject to budget — checked by the caller).
  function rwPickColors(sc) {
    if (rwPick.colorFace == null) return [];
    if (rwPick.colorFace === '*') return Object.keys(sc.colors);
    return [rwPick.colorFace];
  }

  // The full sheet: a column header (letters + point values), the colour grid,
  // and a colour-bonus sidebar — all the real Encore indicators.
  function rwSheet(view, sc, p, seat, interactive, faces) {
    faces = faces || sc.myFaces || sc.roll;
    const W = sc.grid[0].length;
    const sheet = node('div', 'rw-sheet');
    const left = node('div', 'rw-sheet-left');

    // ── column header: letter + [high/low] points, claim state ──
    const head = node('div', 'rw-colhead');
    for (let c = 0; c < W; c++) {
      const h = node('div', 'rw-colhead-cell');
      h.appendChild(node('span', 'rw-colletter' + (c === sc.startCol ? ' start' : ''), 'ABCDEFGHIJKLMNO'[c] || String(c + 1)));
      const pts = (sc.columns && sc.columns[c]) || null; // [high,low] passed in payload
      if (pts) {
        const claimedBy = sc.colClaimed && sc.colClaimed[c];
        const meDone = (p.colsDone || []).includes(c);
        const box = node('div', 'rw-colpts');
        const hi = node('span', 'rw-pt hi' + (claimedBy != null ? ' claimed' : ''), String(pts[0]));
        const lo = node('span', 'rw-pt lo', String(pts[1]));
        box.appendChild(hi); box.appendChild(lo);
        if (meDone) h.classList.add('rw-col-mine');
        h.appendChild(box);
      }
      head.appendChild(h);
    }
    left.appendChild(head);

    // ── the grid ──
    const wrap = node('div', 'rw-grid');
    const mset = new Set(p.marked || []);
    const chosen = new Set(rwSel.map(([r, c]) => rwKey(r, c)));
    // Highlights only exist once the player has CHOSEN their dice (or a run is in
    // progress). Before that, nothing lights up — you pick your colour+number on
    // the slot machine first.
    const pickComplete = rwPick.colorFace != null && rwPick.numberFace != null;
    const runActive = rwSel.length > 0;
    const showHints = interactive && (pickComplete || runActive);
    const hintable = showHints ? rwHintSet(sc, p, faces, interactive) : new Set();
    const perfect = showHints ? rwPerfectBlocks(sc, p, faces, interactive) : new Map();
    for (let r = 0; r < sc.grid.length; r++) {
      const rowEl = node('div', 'rw-row');
      for (let c = 0; c < sc.grid[r].length; c++) {
        const cell = sc.grid[r][c];
        if (!cell) { rowEl.appendChild(node('div', 'rw-cell rw-gap')); continue; }
        const k = rwKey(r, c);
        const el = node('div', 'rw-cell');
        el.style.background = sc.colors[cell.c] || '#64748b';
        if (c === sc.startCol) el.classList.add('rw-start');
        if (cell.star) el.appendChild(node('span', 'rw-star', '\u2605'));
        const marked = mset.has(k);
        const sel = chosen.has(k);
        const block = perfect.get(k);
        const isHint = hintable.has(k);
        if (marked) el.classList.add('rw-marked');
        if (sel) {
          // Selected this turn → coloured cross + drop the "available" glow.
          el.classList.add('rw-sel');
          el.appendChild(node('span', 'rw-selcross', '\u2715'));
        }
        if (interactive && !marked) {
          // Once dice are chosen, GREY OUT everything that isn't a legal target
          // for the selection (and isn't already selected) — so the picked
          // colour+number's options pop and the rest recede.
          if (showHints && !sel && !block && !isHint) el.classList.add('rw-locked-out');
          if (!sel && block) { el.classList.add('rw-perfect', 'rw-click'); el.onclick = () => rwFillBlock(view, sc, p, block); }
          else if (!sel && isHint) { el.classList.add('rw-markable', 'rw-click'); el.onclick = () => rwToggle(view, sc, p, r, c, cell.c); }
          else if (sel) { el.classList.add('rw-click'); el.onclick = () => rwToggle(view, sc, p, r, c, cell.c); }
          // cells that are neither selectable nor selected get NO click handler.
        }
        rowEl.appendChild(el);
      }
      wrap.appendChild(rowEl);
    }
    left.appendChild(wrap);
    sheet.appendChild(left);

    // ── colour-bonus sidebar ──
    const side = node('div', 'rw-colorbar');
    side.appendChild(node('div', 'rw-colorbar-title', 'COLOUR'));
    const colorIds = Object.keys(sc.colors);
    colorIds.forEach((cid, ci) => {
      const row = node('div', 'rw-colorbar-row');
      const sw = node('div', 'rw-colorbar-sw');
      sw.style.background = sc.colors[cid];
      const total = countColor(sc, cid), have = countMarkedColor(sc, p, cid);
      const prog = node('span', 'rw-colorbar-prog', `${have}/${total}`);
      const bonus = (sc.colorBonus && sc.colorBonus[ci]) || null;
      row.appendChild(sw); row.appendChild(prog);
      if (bonus) {
        const claimedBy = sc.colorClaimed && sc.colorClaimed[ci];
        const meDone = (p.colorsDone || []).includes(ci);
        const b = node('div', 'rw-colorbar-pts');
        b.appendChild(node('span', 'rw-pt hi' + (claimedBy != null ? ' claimed' : '') + (meDone ? ' mine' : ''), String(bonus[0])));
        b.appendChild(node('span', 'rw-pt lo', String(bonus[1])));
        row.appendChild(b);
      }
      side.appendChild(row);
    });

    // ── joker / wild tracker ── (8 wilds total; each UNUSED scores +1 at game end).
    // Mirrors the printed "!" row on the real sheet: filled pip = still available,
    // crossed pip = spent. A wild is spent on a "*" colour die or "?"/0 number die.
    const totalWilds = sc.wilds | 0;
    if (totalWilds > 0) {
      const used = Math.min(totalWilds, p.wildsUsed | 0);
      const jbox = node('div', 'rw-jokers');
      const jhead = node('div', 'rw-jokers-head');
      jhead.appendChild(node('span', 'rw-jokers-title', 'WILDS'));
      jhead.appendChild(node('span', 'rw-jokers-count', `${totalWilds - used}/${totalWilds}`));
      jbox.appendChild(jhead);
      const pips = node('div', 'rw-jokers-pips');
      for (let i = 0; i < totalWilds; i++) {
        const pip = node('div', 'rw-joker-pip' + (i < used ? ' spent' : ''));
        pip.textContent = '!';
        pip.title = i < used ? 'wild used' : 'wild available (+1 if unused)';
        pips.appendChild(pip);
      }
      jbox.appendChild(pips);
      side.appendChild(jbox);
    }

    sheet.appendChild(side);
    return sheet;
  }

  function countColor(sc, cid) { let n = 0; for (const row of sc.grid) for (const cell of row) if (cell && cell.c === cid) n++; return n; }
  function countMarkedColor(sc, p, cid) {
    const mset = new Set(p.marked || []); let n = 0;
    for (let r = 0; r < sc.grid.length; r++) for (let c = 0; c < sc.grid[r].length; c++) { const cell = sc.grid[r][c]; if (cell && cell.c === cid && mset.has(rwKey(r, c))) n++; }
    return n;
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

  // How the current selection maps to the chosen dice. Prefers the explicit PICK
  // (the new "select dice first" flow); falls back to deriving from available
  // faces for safety. Returns {concreteColor, concreteNum} or null if no die fits.
  function rwSelDice(sc, faces) {
    const len = rwSel.length;
    if (!len || !rwSelColor) return null;
    if (rwPick.colorFace != null && rwPick.numberFace != null) {
      const wildColor = rwPick.colorFace === '*';
      const wildNumber = rwPick.numberFace === 0;
      // chosen colour die must allow the run's colour
      if (!wildColor && rwPick.colorFace !== rwSelColor) return null;
      // chosen number die must match the run length (concrete = exact)
      if (!wildNumber && rwPick.numberFace !== len) return null;
      if (wildNumber && (len < 1 || len > 5)) return null;
      return { concreteColor: !wildColor, concreteNum: !wildNumber };
    }
    // fallback: derive from faces
    const concreteNum = faces.numbers.includes(len);
    const wildNum = faces.numbers.includes(0);
    const concreteColor = faces.colors.includes(rwSelColor);
    const wildColor = faces.colors.includes('*');
    if (!concreteNum && !wildNum) return null;
    if (!concreteColor && !wildColor) return null;
    return { concreteColor, concreteNum };
  }

  function rwSelValid(sc, p, faces) {
    faces = faces || sc.myFaces || sc.roll;
    if (rwSel.length > 5) return false;
    const d = rwSelDice(sc, faces);
    if (!d) return false;
    const cost = (d.concreteColor ? 0 : 1) + (d.concreteNum ? 0 : 1);
    if (cost && (p.wildsUsed | 0) + cost > (sc.wilds | 0)) return false;
    return true;
  }

  function rwSelectionBar(view, sc, p, seat, interactive, faces) {
    faces = faces || sc.myFaces || sc.roll;
    const bar = node('div', 'rw-selbar');
    if (!interactive) return bar;
    const pickDone = rwPick.colorFace != null && rwPick.numberFace != null;
    // Before a pick: prompt to choose dice on the slot machine.
    if (!pickDone && !rwSel.length) {
      bar.appendChild(node('span', 'rw-hint', 'Choose a colour die + a number die above \u2014 then your moves light up.'));
      return bar;
    }
    // Show the chosen dice as a chip (colour swatch + number / wild glyphs).
    if (pickDone) {
      const colName = rwPick.colorFace === '*' ? 'any colour' : ({ B: 'blue', O: 'orange', Y: 'yellow', G: 'green', R: 'red' }[rwPick.colorFace] || rwPick.colorFace);
      const numTxt = rwPick.numberFace === 0 ? 'any (?)' : String(rwPick.numberFace);
      const pchip = node('span', 'rw-selchip ok', `${numTxt} \u00d7 ${colName}`);
      pchip.style.setProperty('--c', rwPick.colorFace === '*' ? '#a855f7' : (sc.colors[rwPick.colorFace] || '#64748b'));
      bar.appendChild(pchip);
    }
    const len = rwSel.length;
    if (len) {
      const ok = rwSelValid(sc, p, faces);
      const d = rwSelDice(sc, faces);
      const wildCost = d ? ((d.concreteColor ? 0 : 1) + (d.concreteNum ? 0 : 1)) : 0;
      const chip = node('span', 'rw-selchip' + (ok ? ' ok' : ' bad'),
        `${len} ${rwSelColor}` + (wildCost ? ` \u00b7 ${wildCost} wild${wildCost > 1 ? 's' : ''}` : '') + (ok ? '' : ' \u2014 doesn\u2019t fit'));
      chip.style.setProperty('--c', sc.colors[rwSelColor] || '#64748b');
      bar.appendChild(chip);
      const clear = node('button', 'rw-clear', 'Clear cells');
      clear.onclick = () => { rwSel = []; rwSelColor = null; dispatchView(window._renderView); };
      bar.appendChild(clear);
    }
    return bar;
  }

  // ONE-CLICK FILL: a perfect-match block is, by construction, a fully-legal
  // mark (exact size for a usable die, one usable colour, fully reachable). Tap
  // it → select the whole block and submit immediately. The QoL win: no tedious
  // cell-by-cell tapping for the common "fill this block" play.
  function rwFillBlock(view, sc, p, block) {
    if (!block || !block.cells || !block.cells.length) return;
    const seat = view.yourSeat;
    const faces = sc.myFaces || sc.roll;
    rwSel = block.cells.map(([r, c]) => [r, c]);
    rwSelColor = block.color;
    if (rwSelValid(sc, p, faces)) { rwSubmit(view, sc, seat, faces); return; }
    // Fallback (shouldn't happen): leave it selected for manual confirm.
    dispatchView(window._renderView);
  }

  function rwSubmit(view, sc, seat, faces) {
    faces = faces || sc.myFaces || sc.roll;
    const me = sc.players[seat];
    if (!rwSelValid(sc, me, faces)) return;
    const d = rwSelDice(sc, faces);
    const msg = { color: rwSelColor, cells: rwSel.map(([r, c]) => [r, c]) };
    if (!d.concreteColor) msg.wildColor = true;
    if (!d.concreteNum) msg.wildNumber = true;
    rwSel = []; rwSelColor = null;   // clear before send
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

  // localFocusSeat — pass-and-play focus policy for the rollAndWrite kind (Encore).
  // Encore has a roller (who drafts the dice) and then EVERYONE marks. On a shared
  // device we must rotate through the local human seats one at a time, otherwise the
  // screen stays stuck on whoever acted first. Order of focus each round:
  //   DRAFT  → the roller (if a local human) makes the draft decision first.
  //   MARK   → the roller marks first (they're in `pending`), then the device hands
  //            to the next local human still in `pending`, in seat order.
  // When nobody local is pending (bots/remote owe the marks) we keep the device on
  // a board we control so the screen never sits on a board we can't touch.
  function localFocusSeat(state, humanSeats) {
    if (!state) return (humanSeats && humanSeats[0]) || 0;
    const isHuman = (seat) => Array.isArray(humanSeats) && humanSeats.includes(seat);
    const phase = state.phase;                 // "DRAFT" | "MARK" | "GAME_OVER"
    const active = state.active;               // the roller
    const pending = Array.isArray(state.pending) ? state.pending : [];
    // DRAFT: the roller decides alone — focus them if they're ours.
    if (phase === 'DRAFT') {
      if (isHuman(active)) return active;
      return (humanSeats && humanSeats[0]) ?? active;
    }
    // MARK: roller marks first (while still pending), then next local pending human.
    if (phase === 'MARK') {
      if (isHuman(active) && pending.includes(active)) return active;
      const nextLocal = (humanSeats || []).filter((s) => pending.includes(s)).sort((a, b) => a - b)[0];
      if (nextLocal != null) return nextLocal;
    }
    // Nothing pending locally (or game over) → stay on a controlled board.
    if (isHuman(active)) return active;
    return (humanSeats && humanSeats[0]) ?? active;
  }

  // Register the generic renderer for every SCHEMA-defined game in the bundled
  // catalogue (tagged __schema by the engine). One renderer, any schema game.
  const client = { render, unmount, act: clientAct, localFocusSeat };
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

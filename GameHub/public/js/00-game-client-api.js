// 00-game-client-api.js — Declarative Game Client Framework
//
// ELIMINATES per-game copy-paste of:
//   • Card identity / reconciliation / sync
//   • Mini board rendering + inspect popup navigation
//   • Turn change detection + banner + SFX
//   • Animation gating (animating / pendingView / flushView)
//   • Summary overlay management
//   • Deal cascade timing
//   • Card flight choreography (replaced by declarative recipes)
//
// Usage:
//   GameClientFramework.register('skyjo', { cardSpec, cardId, cards, animations, ... });
//   → window.GameClients['skyjo'] is now fully functional.
//
// Legacy hand-rolled clients continue to work unchanged.

(function(){
  if (typeof Kit === 'undefined') { console.error('[GameClientFramework] Kit not loaded'); return; }

  const registeredSpecs = {};

  // ── Expression evaluator (safe, author-defined static data only) ──────
  // 'a.player' → lastAction.player
  // 'a.diff > 0 ? "#10b981" : "#ef4444"' → conditional color
  function evalExpr(expr, a, e) {
    if (typeof expr !== 'string') return expr;
    try {
      const fn = new Function('a', 'e', 'view', 'Math', 'return (' + expr + ');');
      return fn(a, e, window._renderView, Math);
    } catch (_) { return expr; }
  }

  // Resolve a location descriptor to a concrete {zone, player?, slot?}
  function resolveLoc(desc, a, e) {
    if (desc === 'held') return { zone: 'held' };
    if (desc === 'discard') return { zone: 'discard' };
    if (desc === 'deck') return { zone: 'deck' };
    if (typeof desc === 'string') return { zone: desc };
    const out = {};
    for (const k of Object.keys(desc)) {
      out[k] = evalExpr(desc[k], a, e);
    }
    return out;
  }

  // ── Animation Recipe Runner ─────────────────────────────────────────
  async function runRecipe(steps, a, e, gameId, prefix) {
    if (!Array.isArray(steps)) return;
    for (const step of steps) {
      // FLY: move a card from source to destination
      if (step.fly) {
        await runFly(step.fly, a, e, gameId, prefix);
      }
      // FLIP: in-place Y-axis reveal
      if (step.flip) {
        await runFlip(step.flip, a, e, gameId, prefix);
      }
      // GATHER: multi-card collect + fly to destination
      if (step.gather) {
        await runGather(step.gather, a, e, gameId, prefix);
      }
      // SFX
      if (step.sfx && typeof SFX !== 'undefined' && SFX[step.sfx]) {
        SFX[step.sfx]();
      }
      // FLOAT TEXT
      if (step.floatText) {
        runFloatText(step.floatText, a, e, gameId);
      }
      // BANNER
      if (step.banner) {
        const text = evalExpr(step.banner.text, a, e);
        const mine = evalExpr(step.banner.mine, a, e);
        Kit.turnBanner(text, mine);
      }
      // VFX
      if (step.vfx === 'shake') {
        // shake the acting player's board
        const seat = evalExpr(step.seat || 'a.player', a, e);
        const board = document.querySelector(`[data-f7-seat="${seat}"]`) ||
                       document.getElementById('main-board-' + seat);
        if (board) {
          board.style.animation = 'shakeX .5s ease';
          setTimeout(() => { if (board) board.style.animation = ''; }, 520);
        }
      }
      if (step.vfx === 'confetti' && typeof Kit !== 'undefined' && Kit.confetti) {
        Kit.confetti();
      }
      // SLEEP
      if (step.sleep) {
        await sleep(Math.max(0, evalExpr(step.sleep, a, e)));
      }
      // CONDITIONAL: branch to another recipe
      if (step.conditional) {
        const condition = evalExpr(step.conditional.if, a, e);
        if (condition) {
          const targetRecipe = step.conditional.then;
          const spec = registeredSpecs[gameId];
          const anims = spec.useEventTimeline ? spec.eventAnimations : spec.animations;
          if (anims && anims[targetRecipe]) {
            await runRecipe(anims[targetRecipe], a, e, gameId, prefix);
          }
        }
      }
    }
  }

  // Helper: find a DOM element for a location
  function locToElement(loc, gameId) {
    if (loc.zone === 'discard') return $('uiDiscard') || $('f7Discard');
    if (loc.zone === 'deck') return $('uiDeck') || $('f7Deck');
    if (loc.zone === 'held') return $('uiHeldCard');
    if (loc.zone === 'board' && loc.player != null && loc.slot != null) {
      // Try framework anchor first
      const spec = registeredSpecs[gameId];
      const prefix = gameId + ':';
      // Find anchor by matching data-card-reg prefix + player + slot
      const anchors = document.querySelectorAll(`[data-card-reg^="${prefix}"]`);
      for (const anchor of anchors) {
        const aLoc = anchor.dataset;
        if (Number(aLoc.player) === Number(loc.player) &&
            Number(aLoc.slot) === Number(loc.slot)) {
          return anchor;
        }
      }
      // Fallback: game-specific selectors
      const board = document.getElementById('main-board-' + loc.player);
      if (board) {
        const cards = board.querySelectorAll('.board-card');
        if (cards[loc.slot]) return cards[loc.slot];
      }
    }
    return null;
  }

  async function runFly(flyDesc, a, e, gameId, prefix) {
    const fromLoc = resolveLoc(flyDesc.from, a, e);
    const toLoc = resolveLoc(flyDesc.to, a, e);
    const toEl = locToElement(toLoc, gameId);
    if (!toEl) return;

    const cardId = evalExpr(flyDesc.cardId, a, e) || (prefix + 'fly:' + Date.now());

    // Determine source
    let fromEl;
    if (flyDesc.from === 'held') {
      fromEl = $('uiHeldCard');
    } else if (flyDesc.from === 'deck') {
      fromEl = $('uiDeck') || $('f7Deck');
    } else if (flyDesc.from === 'discard') {
      fromEl = $('uiDiscard');
    } else {
      fromEl = locToElement(fromLoc, gameId);
    }

    const opts = {};
    if (flyDesc.duration) opts.duration = evalExpr(flyDesc.duration, a, e);
    if (flyDesc.spin) opts.spin = true;
    if (flyDesc.arc) opts.arc = evalExpr(flyDesc.arc, a, e);
    if (flyDesc.startFaceDown != null) opts.startFaceDown = evalExpr(flyDesc.startFaceDown, a, e);
    if (flyDesc.revealMidway != null) opts.revealMidway = evalExpr(flyDesc.revealMidway, a, e);

    // Use framework flight if CardManager has the card
    if (Kit.CardManager.has(cardId)) {
      if (fromEl) Kit.CardManager.pin(cardId, fromEl, { hideAnchor: false, updateContent: true });
      await Kit.CardManager.moveTo(cardId, toEl, { ...opts, land: false, hideTarget: true, toLocation: toLoc });
      if (flyDesc.to === 'discard' || flyDesc.destroy) {
        Kit.CardManager.destroy(cardId);
      }
    } else if (fromEl) {
      // Transient flight using Kit.Cards.fly
      const preRects = Kit.Cards.snapshot ? Kit.Cards.snapshot(prefix) : {};
      await Kit.Cards.fly(cardId, { to: toEl, fromEl, ...opts });
    }
  }

  async function runFlip(flipDesc, a, e, gameId, prefix) {
    const loc = resolveLoc(flipDesc.at, a, e);
    const el = locToElement(loc, gameId);
    if (!el) return;

    const cardId = evalExpr(flipDesc.cardId, a, e);
    const value = evalExpr(flipDesc.value, a, e);
    const color = evalExpr(flipDesc.color, a, e);

    // Try framework reveal
    if (cardId && Kit.CardManager.has(cardId)) {
      const c = Kit.CardManager.get(cardId);
      if (c && c.overlayEl) {
        c.overlayEl.classList.remove('anim-flip');
        void c.overlayEl.offsetWidth;
        c.overlayEl.classList.add('anim-flip');
        await sleep(210);
        c.faceUp = true;
        // Update the overlay's visual from spec
        const spec = registeredSpecs[gameId];
        if (spec && spec.cardSpec) {
          // The card context would need the actual card data — for now,
          // the framework just triggers the CSS flip animation
        }
        await sleep(210);
        return;
      }
    }
    // Fallback to Kit.revealEl
    if (el && typeof Kit.CardManager.revealEl === 'function') {
      await Kit.CardManager.revealEl(el, value, { color });
    }
  }

  async function runGather(gatherDesc, a, e, gameId, prefix) {
    // Multi-card gather: collect cards from specified slots, stack them,
    // then fly the stack to the discard.
    const seats = evalExpr(gatherDesc.seats, a, e);
    const slots = evalExpr(gatherDesc.slots, a, e);
    const toLoc = resolveLoc(gatherDesc.to, a, e);
    const toEl = locToElement(toLoc, gameId);
    if (!toEl || !Array.isArray(slots)) return;

    const seat = Array.isArray(seats) ? seats[0] : seats;
    const t = Date.now();
    const moveIds = [];

    for (let k = 0; k < slots.length; k++) {
      const moveId = prefix + 'gather:' + k + ':' + t;
      const loc = { zone: 'board', player: seat, slot: slots[k] };
      const srcEl = locToElement(loc, gameId);
      if (srcEl) {
        // Create a transient card at the source, then destroy the original
        Kit.CardManager.create({}, { zone: 'transit' }, { id: moveId, faceUp: true });
        Kit.CardManager.pin(moveId, srcEl, { hideAnchor: false, updateContent: true });
        moveIds.push(moveId);
      }
    }

    // Stack them at the first card's position
    if (moveIds.length > 1) {
      const firstAnchor = locToElement({ zone: 'board', player: seat, slot: slots[0] }, gameId);
      if (firstAnchor) {
        await Promise.all(moveIds.slice(1).map(id =>
          Kit.CardManager.moveTo(id, firstAnchor, { duration: 240, arc: 18, land: false })
        ));
        await sleep(170);
      }
    }

    // Fly the stack to destination
    await Promise.all(moveIds.map(id =>
      Kit.CardManager.moveTo(id, toEl, { duration: 480, spin: true, land: false, hideTarget: true, toLocation: toLoc })
    ));

    moveIds.forEach(id => { if (Kit.CardManager.has(id)) Kit.CardManager.destroy(id); });
  }

  function runFloatText(desc, a, e, gameId) {
    const seat = evalExpr(desc.at?.seat || desc.at, a, e);
    const text = evalExpr(desc.text, a, e);
    const color = evalExpr(desc.color, a, e);
    const boardEl = document.getElementById('main-board-' + seat);
    if (boardEl && text != null) {
      Kit.floatText(boardEl, String(text), color);
    }
  }

  // ── Auto-Generated Game Client ──────────────────────────────────────

  function buildClient(gameId, spec) {
    const prefix = gameId + ':';
    let lastAnimSeq = -1;
    let lastEventSeq = -1;
    let localPrevView = null;

    // ── Card Reconciliation ──
    function reconcileCards(view) {
      const cardList = spec.cards(view);
      if (!Array.isArray(cardList)) return;

      const activeIds = new Set();
      for (const entry of cardList) {
        const id = entry.id;
        activeIds.add(id);
        const cardSpec = spec.cardSpec(entry.card, {
          zone: entry.zone,
          seat: entry.seat,
          slot: entry.slot,
          viewerSeat: view.yourSeat,
          phase: view.state?.phase,
          // Pass through any extra context from the entry
          ...entry.ctx,
        });
        if (!cardSpec) continue;

        if (!Kit.CardManager.has(id)) {
          Kit.CardManager.create({}, { zone: entry.zone, player: entry.seat, slot: entry.slot },
            { id, faceUp: !cardSpec.faceDown, renderer: () => Kit.Cards.el(cardSpec) });
        } else {
          const c = Kit.CardManager.get(id);
          if (c) {
            c.renderer = () => Kit.Cards.el(cardSpec);
            if (entry.zone) c.location = { zone: entry.zone, player: entry.seat, slot: entry.slot };
          }
        }
      }
      Kit.CardManager.reconcile(prefix, [...activeIds]);
    }

    // ── Auto Mini Board ──
    function autoMiniBody(playerIdx, view) {
      if (spec.miniBody) return spec.miniBody(playerIdx, view);

      // Default: render card thumbnails from spec.cards filtered to this player
      const wrap = document.createElement('div');
      wrap.className = 'kc-mini-grid';
      const cardList = spec.cards(view) || [];
      for (const entry of cardList) {
        if (entry.seat !== playerIdx || entry.zone === 'hand') continue;
        const cs = spec.cardSpec(entry.card, { ...entry, viewerSeat: view.yourSeat, mini: true });
        if (cs) {
          if (cs.size === undefined) cs.size = 'xs';
          wrap.appendChild(Kit.Cards.el(cs));
        }
      }
      return wrap;
    }

    // ── Auto Inspect ──
    function autoInspect(seat) {
      const view = window._renderView;
      if (!view || view.game !== gameId) return;
      const s = view[gameId];
      const gs = view.state;
      if (!s || !gs) return;

      const viewerSeat = view.yourSeat;
      const playerSeats = gs.players.map((_, i) => i).filter(i => i !== viewerSeat);
      const idx = playerSeats.indexOf(seat);
      const prev = playerSeats[(idx - 1 + playerSeats.length) % playerSeats.length];
      const next = playerSeats[(idx + 1) % playerSeats.length];

      const header = `<div class="inspect-head">
        <button class="icon-btn" onclick="window.GameClients['${gameId}'].inspect(${prev})">‹</button>
        <b>${esc(gs.players[seat]?.name || 'Player')}</b>
        <button class="icon-btn" onclick="window.GameClients['${gameId}'].inspect(${next})">›</button>
        <button class="icon-btn" onclick="GameShell.closeInspect()">✕</button>
      </div>`;

      const box = GameShell.inspect(header);
      // Static board: no CardManager overlays, just Kit.Cards.el thumbnails
      const body = spec.renderStaticBoard
        ? spec.renderStaticBoard(view, seat)
        : defaultStaticBoard(view, seat);
      box.appendChild(body);
    }

    function defaultStaticBoard(view, seat) {
      const wrap = document.createElement('div');
      wrap.className = 'player-board';
      const gs = view.state;
      const p = gs?.players?.[seat];
      const header = document.createElement('div');
      header.className = 'board-header';
      header.innerHTML = `<span>${esc(p?.name || 'Player')}${seat === view.yourSeat ? ' (You)' : ''}</span>
        <span class="score-badge">Score: ${esc(p?.score ?? '?')}</span>`;
      wrap.appendChild(header);

      const grid = document.createElement('div');
      grid.className = 'board-grid';
      const cardList = spec.cards(view) || [];
      for (const entry of cardList) {
        if (entry.seat !== seat || entry.zone === 'hand') continue;
        const cs = spec.cardSpec(entry.card, { ...entry, viewerSeat: view.yourSeat, static: true });
        if (cs) {
          const el = Kit.Cards.el(cs);
          el.classList.add('board-card');
          grid.appendChild(el);
        }
      }
      wrap.appendChild(grid);
      return wrap;
    }

    // ── Render ──
    function render(view, ctx = {}) {
      const s = view[gameId];
      const gs = view.state;
      if (!s) return;

      // Game-specific cleanup of other games' UI
      if (typeof removeQwixxUi === 'function') removeQwixxUi();

      const viewerSeat = view.yourSeat;
      const focused = ctx.focus
        ? ctx.focus({ actingSeat: gs?.currentSeat ?? -1, preferred: viewerSeat })
        : viewerSeat;

      // ── Turn change detection ──
      if (localPrevView && gs) {
        const prevGs = localPrevView.state;
        if (gs.currentSeat !== prevGs?.currentSeat &&
            gs.currentSeat >= 0 && prevGs?.currentSeat !== undefined) {
          const mine = gs.currentSeat === viewerSeat;
          const name = gs.players?.[gs.currentSeat]?.name || 'Player';
          Kit.turnBanner(mine ? 'Your turn!' : name + "'s turn", mine);
          if (typeof bumpStatus === 'function') bumpStatus();
          if (mine && typeof SFX !== 'undefined') SFX.yourTurn();
        }
      }

      // ── Build opponents strip ──
      const opponents = document.createElement('div');
      opponents.style.display = 'contents';
      const others = (gs?.players || [])
        .map((p, i) => ({ ...p, seat: i }))
        .filter(p => p.seat !== focused);

      for (const player of others) {
        opponents.appendChild(Kit.MiniBoard({
          name: player.name,
          badge: player.score != null ? player.score : undefined,
          you: player.seat === viewerSeat,
          active: player.status === 'active',
          dim: player.status === 'out' || player.status === 'busted',
          seat: player.seat,
          variant: gameId,
          body: autoMiniBody(player.seat, view),
          onClick: () => window.GameClients[gameId].inspect(player.seat),
        }));
      }

      // ── Build main board ──
      let focus;
      if (spec.renderBoard) {
        focus = spec.renderBoard(view);
      } else if (spec.layout === 'grid') {
        focus = renderGridBoard(view, focused);
      } else {
        focus = renderDefaultBoard(view, focused);
      }

      // ── Center area ──
      let center = '';
      let topMode = 'hidden';
      if (spec.centerArea) {
        const ca = spec.centerArea(view);
        center = ca.html || '';
        topMode = 'custom';
        // ca.onMount is called after renderTable (below)
      } else if (spec.usePiles) {
        topMode = 'piles';
      }

      // ── Status ──
      let status;
      if (spec.status) {
        status = spec.status(view);
      } else if (gs) {
        if (view.over) status = 'Game Over';
        else if (gs.currentSeat === viewerSeat) status = 'Your turn';
        else if (gs.currentSeat >= 0) status = (gs.players?.[gs.currentSeat]?.name || 'Player') + "'s turn";
        else status = 'Waiting…';
      }

      // ── Render table ──
      GameShell.renderTable({
        game: gameId,
        opponents,
        center,
        focus,
        status,
        topMode,
        opponentClass: gameId + '-mini-strip',
      });

      // ── Reconcile cards ──
      reconcileCards(view);
      if (typeof Kit.Cards !== 'undefined' && Kit.Cards.board) {
        Kit.Cards.board(prefix, {
          location: (anchor) => ({
            zone: anchor.dataset.zone || 'board',
            player: Number(anchor.dataset.player) || 0,
            slot: Number(anchor.dataset.slot) || 0,
          }),
        });
      }

      // ── Wire click handlers ──
      wireClickHandlers(view);

      // ── Center area onMount callback ──
      if (spec.centerArea) {
        const container = document.querySelector('.game-shell-center.' + gameId);
        if (container && spec.centerArea(view).onMount) {
          spec.centerArea(view).onMount(container);
        }
      }

      // ── Controls ──
      if (spec.controls) {
        const controls = spec.controls(view);
        if (Array.isArray(controls)) {
          Kit.Controls.set(controls, { id: gameId + 'Controls' });
        }
      } else {
        Kit.Controls.clear(gameId + 'Controls');
      }

      // ── Summary ──
      if (view.over && view.summary && typeof showSummary === 'function' && !summaryShown) {
        showSummary(view);
      } else if (!view.over && typeof hideOverlay === 'function') {
        // summaryShown reset handled by global code
      }

      // ── Animations ──
      runAnimations(view);

      localPrevView = view;
    }

    function renderGridBoard(view, focusedSeat) {
      const gs = view.state;
      const p = gs?.players?.[focusedSeat];
      const wrap = document.createElement('div');
      wrap.className = 'player-board' + (p?.status === 'active' ? ' active-turn' : '') +
                        (focusedSeat === view.yourSeat ? ' me' : '');
      wrap.id = 'main-board-' + focusedSeat;

      const header = document.createElement('div');
      header.className = 'board-header';
      header.innerHTML = `<span>${esc(p?.name || 'Player')}${focusedSeat === view.yourSeat ? ' (You)' : ''}</span>
        <span class="score-badge">Score: ${esc(p?.score ?? '?')}</span>`;
      wrap.appendChild(header);

      const grid = document.createElement('div');
      grid.className = 'board-grid';
      grid.style.gridTemplateColumns = `repeat(${spec.gridCols || 4}, 1fr)`;

      const cardList = spec.cards(view) || [];
      const playerCards = cardList.filter(c => c.seat === focusedSeat && c.zone === 'board');
      for (const entry of playerCards) {
        const cs = spec.cardSpec(entry.card, {
          ...entry, viewerSeat: view.yourSeat, focused: true,
        });
        if (!cs) {
          const ph = document.createElement('div');
          ph.className = 'board-card card-slot-empty';
          grid.appendChild(ph);
          continue;
        }
        const anchor = Kit.Cards.anchor(entry.id, cs, { placeholder: true });
        anchor.classList.add('board-card', 'registry-anchor');
        anchor.dataset.zone = entry.zone;
        anchor.dataset.player = entry.seat;
        anchor.dataset.slot = entry.slot;
        grid.appendChild(anchor);
      }
      wrap.appendChild(grid);
      return wrap;
    }

    function renderDefaultBoard(view, focusedSeat) {
      const wrap = document.createElement('div');
      wrap.className = 'player-board';
      wrap.innerHTML = `<div class="muted">${gameId} board (override renderBoard for a custom layout)</div>`;
      return wrap;
    }

    function wireClickHandlers(view) {
      if (!spec.clickable) return;
      document.querySelectorAll(`[data-card-reg^="${prefix}"]`).forEach(anchor => {
        const cardId = anchor.dataset.cardReg;
        const cardList = spec.cards(view) || [];
        const entry = cardList.find(c => c.id === cardId);
        if (!entry) return;

        const result = spec.clickable({
          ...entry,
          viewerSeat: view.yourSeat,
          phase: view.state?.phase,
          turnAction: view[gameId]?.turnAction,
          pendingAction: view.state?.pendingAction,
        });
        if (result) {
          anchor.classList.add('clickable');
          anchor.onclick = () => {
            const seat = view.yourSeat;
            GameActions.send(result.action, result.extra || {}, seat);
          };
        }
      });
    }

    // ── Animation Detection & Execution ──
    function runAnimations(view) {
      const s = view[gameId];
      if (!s) return;

      if (spec.useEventTimeline) {
        runEventTimeline(view);
        return;
      }

      // lastAction-based animation (Skyjo / Schotten pattern)
      const a = s.lastAction;
      if (!a) return;
      const seq = a.seq ?? JSON.stringify(a);
      if (seq === lastAnimSeq) return;
      lastAnimSeq = seq;

      const anims = spec.animations || {};
      const recipe = anims[a.type];
      if (!recipe) return;

      // Run the recipe asynchronously (the framework gates animating/pendingView)
      animating = true;
      runRecipe(recipe, a, null, gameId, prefix)
        .then(() => { animating = false; if (typeof flushView === 'function') flushView(); })
        .catch(() => { animating = false; });
    }

    function runEventTimeline(view) {
      const s = view[gameId];
      if (!s || !Array.isArray(s.events)) return;
      const newSeq = s.seq ?? s.events.length;
      if (newSeq === lastEventSeq) return;
      lastEventSeq = newSeq;

      // Find new events since last render
      const events = s.events;
      if (!events.length) return;

      const anims = spec.eventAnimations || {};
      animating = true;

      (async () => {
        for (const e of events) {
          const recipe = anims[e.type];
          if (!recipe) continue;
          await runRecipe(recipe, e, e, gameId, prefix);
          // Pacing between events
          const pacing = spec.eventPacing || {};
          const delay = pacing.base || 420;
          await sleep(Math.max(pacing.min || 150, Math.min(pacing.max || 1700, delay)));
        }
        animating = false;
        if (typeof flushView === 'function') flushView();
      })().catch(() => { animating = false; });
    }

    // ── Action helper ──
    function act(action, extra = {}) {
      const seat = window._renderView?.yourSeat ?? 0;
      GameActions.send(action, extra, seat);
    }

    // ── Unmount ──
    function unmount() {
      lastAnimSeq = -1;
      lastEventSeq = -1;
      localPrevView = null;
      Kit.Controls.clear(gameId + 'Controls');
      Kit.CardManager.clear(prefix);
      if (spec.unmount) spec.unmount();
    }

    return {
      render,
      act,
      unmount,
      inspect: spec.inspect || autoInspect,
    };
  }

  // ── Public API ──────────────────────────────────────────────────────

  window.GameClientFramework = {
    register(gameId, spec) {
      if (!gameId || typeof spec !== 'object') {
        console.error('[GameClientFramework] register(gameId, spec) — invalid args');
        return;
      }
      registeredSpecs[gameId] = spec;
      window.GameClients = window.GameClients || {};
      window.GameClients[gameId] = buildClient(gameId, spec);
      console.log(`[GameClientFramework] registered ${gameId}`);
    },

    // Access registered spec (for debugging / extension)
    getSpec(gameId) { return registeredSpecs[gameId] || null; },
  };

})();

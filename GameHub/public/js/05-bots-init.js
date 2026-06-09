/* ====================== BOTS — Modular Bot Driver ======================
   Bots "think" on the host's client (online) or the local device (offline) so the
   server spends ~0 compute. Easy/Medium are heuristics; Hard uses compact
   self-play-trained feature policies plus game-specific tactical heuristics.
   
   This file wires together the modular bot strategies from /js/bots/*.
   Interface: Bots.choose(gameId, view, difficulty) -> action msg (or null).
   ================================================================= */

// Load modular bot strategies (order matters: driver first, then per-game)
// These register themselves with BotDriver via BotDriver.register(...)

/* ====================== BACKWARD-COMPAT Bots INTERFACE ====================== */
const Bots = (() => {
  /**
   * Legacy compatibility layer. Routes to BotDriver for registered games,
   * falls back to built-in strategies for unregistered ones.
   */
  return {
    choose(gameId, view, difficulty) {
      // Try the modular BotDriver first
      if (typeof BotDriver !== 'undefined') {
        const gv = view[gameId] || view.state;
        if (!gv) return null;

        // For games registered with BotDriver, use the modular strategy
        const strategy = BotDriver;
        if (strategy.needsBot(view)) {
          const actingSeat = strategy.getActingSeat(view);
          if (actingSeat >= 0) {
            // Check if this seat is a bot
            const bots = window._currentBots || [];
            const bot = bots.find(b => b.seat === actingSeat);
            if (bot) {
              return strategy.choose(view, actingSeat, difficulty);
            }
          }
        }
      }

      // Fallback: built-in strategies (for legacy games not yet modularized)
      console.warn(`Bot fallback for ${gameId} — consider registering with BotDriver`);
      return null;
    }
  };
})();

/* ====================== BOT SCHEDULER ====================== */
let _botTimer = null, _botBusy = false;

function botSeatsFromView(view) {
  // online: server sends `view._bots` via the game msg (attached in handleNet)
  return window._currentBots || [];
}

function maybeRunBot(view) {
  if (_botBusy) return;
  const gid = view.game;

  // Try modular BotDriver first
  if (typeof BotDriver !== 'undefined' && BotDriver.needsBot(view)) {
    const bots = botSeatsFromView(view);
    if (!bots.length) return;
    const iAmDriver = (mode === 'local') || net.isHost;
    if (!iAmDriver) return;

    const actingSeat = BotDriver.getActingSeat(view);
    if (actingSeat < 0) return;

    const bot = bots.find(b => b.seat === actingSeat);
    if (bot) {
      scheduleBot(view, bot, actingSeat);
      return;
    }
  }

  // Fallback: legacy bot detection for unregistered games
  const gv = gid === 'qwixx' ? view.state : view[gid];
  if (!gv) return;

  let actingSeat = -1, pendingFrom = -1;
  if (gid === 'skyjo') {
    if (gv.turnAction === 'turn_end_delay') return;
    if (gv.phase === 'REVEAL') actingSeat = -1;
    else if (gv.phase === 'PLAY' || gv.phase === 'FINAL_TURNS') actingSeat = gv.currentPlayer;
  } else if (gid === 'flip7') {
    if (gv.pendingAction) pendingFrom = gv.pendingAction.from;
    else if (gv.phase === 'PLAY') actingSeat = gv.current;
  } else if (gid === 'qwixx') {
    if (gv.phase === 'COLOR_PHASE') actingSeat = gv.activeSeat;
  }

  const bots = botSeatsFromView(view);
  if (!bots.length) return;
  const iAmDriver = (mode === 'local') || net.isHost;
  if (!iAmDriver) return;

  // Parallel bot phases: Skyjo REVEAL and Qwixx WHITE_PHASE
  if (gid === 'skyjo' && gv.phase === 'REVEAL') {
    for (const b of bots) {
      const p = gv.players[b.seat];
      if (p.revealCount < 2) { scheduleBot(view, b, b.seat); return; }
    }
    return;
  }
  if (gid === 'qwixx' && gv.phase === 'WHITE_PHASE') {
    for (const b of bots) {
      if (gv.pendingWhiteDecisions.includes(b.seat)) { scheduleBot(view, b, b.seat); return; }
    }
    return;
  }

  const targetSeat = pendingFrom >= 0 ? pendingFrom : actingSeat;
  if (targetSeat < 0) return;
  const bot = bots.find(x => x.seat === targetSeat);
  if (bot) scheduleBot(view, bot, targetSeat);
}

function scheduleBot(view, bot, seat) {
  if (_botTimer) return;
  _botBusy = true;
  const think = bot.difficulty === 'hard' ? 700 : bot.difficulty === 'easy' ? 450 : 600;

  _botTimer = setTimeout(() => {
    _botTimer = null;
    const v = window._renderView || view;
    const gid = v.game;
    const gv = v[gid];

    // Build an observation-correct view for the bot
    let vv = v;
    if (gid === 'skyjo') {
      const sg = { ...gv, currentPlayer: seat };
      if (sg.myDrawnCard == null && sg.turnAction === 'deck' && sg.publicDrawn != null) sg.myDrawnCard = sg.publicDrawn;
      if (sg.myDrawnCard == null && sg.turnAction === 'discard' && sg.lastAction && sg.lastAction.type === 'take_discard' && sg.lastAction.player === seat) sg.myDrawnCard = sg.lastAction.value;
      vv = { ...v, skyjo: sg };
    }

    const msg = Bots.choose(gid, vv, bot.difficulty);
    _botBusy = false;
    if (!msg) return;
    if (mode === 'local') { localAct(seat, msg); }
    else { net.send({ type: 'action', botSeat: seat, ...msg }); }
  }, think + Math.random() * 250);
}

/* ====================== INIT ====================== */
{ const v = $('verStamp'); if (v) v.textContent = 'build ' + BUILD_VERSION; }
renderTiles('quickTiles', quickPlay);
renderLocalSeats();
refreshLocalTiles();
if (typeof syncOnlinePrimaryName === 'function') { syncOnlinePrimaryName(); renderOnlineDevicePlayers(); }
if (SFX.muted) { const b = $('soundBtn'); if (b) { b.textContent = '🔇'; b.classList.add('off'); } }
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('investigateOverlay').classList.add('hidden'); });

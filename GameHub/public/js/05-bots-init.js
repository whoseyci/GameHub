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
   * Legacy compatibility layer.
   *
   * New code should prefer BotDriver.choose(view, seat, difficulty) because the
   * scheduler already knows exactly which bot seat it is driving. This facade is
   * kept so older call sites do not explode if the modular driver is unavailable.
   */
  return {
    choose(gameId, view, difficulty, seat = null) {
      if (typeof BotDriver !== 'undefined') {
        if (seat != null) return BotDriver.choose(view, seat, difficulty);
        if (BotDriver.needsBot(view)) {
          const actingSeat = BotDriver.getActingSeat(view);
          if (actingSeat != null && actingSeat >= 0) return BotDriver.choose(view, actingSeat, difficulty);
        }
      }

      // Fallback: legacy games should return null instead of guessing.
      console.warn(`Bot fallback for ${gameId} — no modular strategy registered`);
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
    let v = window._renderView || view;
    const gid = v.game;

    // In LOCAL play the engine holds full state, so build the bot's OWN private
    // view (viewFor(seat)) — this is the correct, game-agnostic observation: the
    // bot sees exactly its own hand/drawn card and nothing hidden. (Online bots run
    // on the host and use the wire view + the strategy's observe() patch.)
    if (mode === 'local' && typeof localEngine !== 'undefined' && localEngine && typeof localEngine.viewFor === 'function') {
      try { v = localEngine.viewFor(seat) || v; } catch (e) { /* fall back to render view */ }
    }

    const msg = (typeof BotDriver !== 'undefined')
      ? BotDriver.choose(v, seat, bot.difficulty)
      : Bots.choose(gid, v, bot.difficulty, seat);
    _botBusy = false;
    if (!msg) return;
    if (mode === 'local') { localAct(seat, msg); }
    else { net.send({ type: 'action', botSeat: seat, ...msg }); }
    // Personality: bots throw the occasional emote so solo/vs-bot play feels
    // alive. Game-agnostic — a low base chance plus a bump on a "big" move
    // (scoring/finishing actions). The mascot pops up just like a human emote.
    try { maybeBotEmote(seat, msg, bot); } catch (e) { /* never break a bot turn */ }
  }, think + Math.random() * 250);
}

// Contextual bot emote: a small chance per move, higher on notable actions.
// Moods are emotion-character ids (Kit.Emotes), so bots express a FEELING.
const BOT_EMOTES = {
  good: ['party', 'happy', 'cool', 'love'],
  cheeky: ['smug', 'laugh', 'cool'],
  oops: ['nervous', 'sad', 'shocked'],
  think: ['think'],
};
function pick(a) { return a[(Math.random() * a.length) | 0]; }
function maybeBotEmote(seat, msg, bot) {
  if (typeof window.Social === 'undefined' || !window.Social.emote) return;
  const action = (msg && msg.action) || '';
  // "Big" / expressive actions worth reacting to across our games.
  const big = /^(stay|finishTurn|next_round|mark|claim|swap|take_discard)$/.test(action) || msg.use === 'color';
  const base = bot && bot.difficulty === 'easy' ? 0.16 : 0.11;   // easy bots are chattier
  const chance = big ? base + 0.20 : base;
  if (Math.random() > chance) return;
  // Pick a mood: penalties/skips → oops; scoring/big → good; otherwise cheeky/think.
  let pool = BOT_EMOTES.cheeky;
  if (/^(skip)$/.test(action) || msg.penalty) pool = BOT_EMOTES.oops;
  else if (big) pool = Math.random() < 0.7 ? BOT_EMOTES.good : BOT_EMOTES.cheeky;
  else if (Math.random() < 0.3) pool = BOT_EMOTES.think;
  const name = (typeof localSeats !== 'undefined' && localSeats[seat] && localSeats[seat].name) || 'Bot';
  window.Social.emote(pick(pool), name, seat);
}

/* ====================== INIT ====================== */
{ const v = $('verStamp'); if (v) v.textContent = 'build ' + BUILD_VERSION; }
// Phase 9: the #quickTiles / #localTiles / #localPlayers / #onlineDevicePlayers
// containers are hidden legacy DOM slots (the menu screens that hosted them
// were killed in Phase 4). Renderers still run so the helpers stay
// initialised in case any code path later references them, but the output
// goes into nodes the user never sees. Safe to remove entirely once we've
// confirmed nothing reads them — flagged for a future pass.
renderTiles('quickTiles', quickPlay);
renderLocalSeats();
refreshLocalTiles();
if (typeof syncOnlinePrimaryName === 'function') { syncOnlinePrimaryName(); renderOnlineDevicePlayers(); }
if (SFX.muted) {
  const b = $('soundBtn');
  if (b) { b.innerHTML = ''; b.appendChild(Kit.Icon('sound-off', { size: 20 })); b.classList.add('off'); }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (typeof GameShell !== 'undefined') GameShell.closeInspect(); else $('investigateOverlay')?.classList.add('hidden'); } });

/* landing.js — populates the landing page's game tiles + live stats counter.
 *
 * Game tiles: derived from window.GameCatalogue (single source of truth from
 * the hub registry). Each tile offers two actions:
 *   • Play vs Bot — jumps into local pass-and-play with auto-added bots
 *                       (no setup screen, no friction)
 *   • Read rules
 *
 * Live stats: opens a lobby WebSocket (same endpoint the public-rooms list
 * uses) and shows "N rooms · M players" with live updates. If the socket
 * can't connect we degrade silently to "no rooms yet — be the first!".
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ─── Tiles ───────────────────────────────────────────────────────────
  function renderTiles() {
    const container = $('landingGameTiles');
    if (!container || !window.GameCatalogue) return;
    // UX redesign Phase 3: tiles are mode-aware. The whole tile is one
    // big clickable surface — clicking it does the right thing based on
    // the current Mode (Local → instant vs bot; Online → quick-play).
    // The only secondary action is a small "?" rules button that
    // doesn't trigger the tile click. We removed the per-tile buttons
    // (Play Online / vs Bot / Rules) — the user picks intent ONCE in
    // the header toggle, then every tile inherits that intent.
    container.innerHTML = window.GameCatalogue.map((g) => `
      <button class="landing-tile" data-game="${esc(g.id)}" type="button" aria-label="Play ${esc(g.name)}">
        <div class="lt-head">
          <div class="lt-emoji">${Kit.Icon.forGame(g, { size: 30, cls: 'kit-icon-tile' })}</div>
          <div class="lt-titles">
            <div class="lt-title">${esc(g.name)}</div>
            <div class="lt-meta">${esc(g.minPlayers)}–${esc(g.maxPlayers)} players</div>
          </div>
          <!-- W6: per-game live count chip. Populated by renderTileCounts()
               from the lobby socket; hidden when there's nothing to show. -->
          <div class="lt-counts" data-counts="${esc(g.id)}" hidden></div>
          <!-- Rules helper. data-rules-for prevents bubbling to the tile
               click handler; openRules opens a self-contained overlay. -->
          <span class="lt-rules" data-rules-for="${esc(g.id)}" title="How to play" tabindex="0" role="button" aria-label="${esc(g.name)} rules">?</span>
        </div>
        <div class="lt-desc">${esc(g.description || '')}</div>
        <div class="lt-cta" data-cta-for="${esc(g.id)}"></div>
      </button>
    `).join('');

    container.addEventListener('click', onTileClick);
    container.addEventListener('keydown', onTileKeydown);
    renderTileCounts();
    repaintCtas();
    // Repaint the per-tile CTA labels whenever the user flips mode.
    if (!_modeSubbed && window.Mode && typeof window.Mode.onChange === 'function') {
      window.Mode.onChange(repaintCtas);
      _modeSubbed = true;
    }
  }

  let _modeSubbed = false;
  /** Per-tile CTA chip text: "vs Bot" in Local, "Quick Play" in Online. */
  function repaintCtas() {
    const mode = (window.Mode && window.Mode.get && window.Mode.get()) || 'local';
    const label = mode === 'online'
      ? `${Kit.Icon.html('rocket', { size: 13, cls: 'kit-icon-inline' })}Quick Play`
      : `${Kit.Icon.html('robot',  { size: 13, cls: 'kit-icon-inline' })}vs Bot`;
    for (const slot of document.querySelectorAll('.lt-cta[data-cta-for]')) {
      slot.innerHTML = label;
    }
  }

  // W6: paint the lt-counts chip on each tile from the latest counts payload.
  function renderTileCounts() {
    for (const id of Object.keys(lastCounts)) {
      const slot = document.querySelector(`[data-counts="${CSS.escape(id)}"]`);
      if (!slot) continue;
      const c = lastCounts[id];
      const waiting = c.waiting || 0;
      const inGame = c.inGame || 0;
      if (!waiting && !inGame) { slot.hidden = true; slot.innerHTML = ''; continue; }
      slot.hidden = false;
      const parts = [];
      if (waiting) parts.push(`<span class="lt-count lt-count-waiting" title="${waiting} waiting in lobby">${Kit.Icon.html('users',{size:11})}${waiting}</span>`);
      if (inGame)  parts.push(`<span class="lt-count lt-count-ingame" title="${inGame} playing right now">${Kit.Icon.html('play',{size:11})}${inGame}</span>`);
      slot.innerHTML = parts.join('');
    }
    // Tiles whose game has zero presence get their chip cleared (in case a
    // game emptied out since the last render).
    for (const slot of document.querySelectorAll('[data-counts]')) {
      const id = slot.getAttribute('data-counts');
      if (!lastCounts[id]) { slot.hidden = true; slot.innerHTML = ''; }
    }
  }

  function onTileClick(e) {
    // Rules helper: handled FIRST so it never bubbles to the tile action.
    const rulesEl = e.target.closest('[data-rules-for]');
    if (rulesEl) {
      e.preventDefault();
      e.stopPropagation();
      const gid = rulesEl.getAttribute('data-rules-for');
      if (typeof window.openRules === 'function') window.openRules(gid);
      return;
    }
    // Tile click → primary mode action.
    const tile = e.target.closest('.landing-tile[data-game]');
    if (!tile) return;
    const gameId = tile.getAttribute('data-game');
    dispatchTileAction(gameId);
  }
  function onTileKeydown(e) {
    // Treat Enter / Space on the rules "?" as a click (it has role="button").
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const rulesEl = e.target.closest('[data-rules-for]');
    if (!rulesEl) return;
    e.preventDefault();
    if (typeof window.openRules === 'function') window.openRules(rulesEl.getAttribute('data-rules-for'));
  }

  /**
   * Single source of truth for "the user picked a tile". Branches on
   * the current Mode — Local → instant local game with you + 2 bots;
   * Online → quick-play queue for that game (sharded room).
   */
  function dispatchTileAction(gameId) {
    if (!gameId) return;
    const mode = (window.Mode && window.Mode.get && window.Mode.get()) || 'local';
    if (typeof window.ensureName === 'function') window.ensureName();
    if (mode === 'online') {
      if (typeof window.quickPlay === 'function') window.quickPlay(gameId);
    } else {
      instantBotPlay(gameId);
    }
  }

  /**
   * Click-to-play in Local mode.
   *
   * Per user request (June): clicking a Local landing tile no longer
   * spins the engine + pops a drawer. It opens the dedicated pre-game
   * #seatScreen so the user picks seats EXPLICITLY before the game
   * starts. Default: 1 human (just you). They add players/bots and
   * tap "Start".
   */
  function instantBotPlay(gameId) {
    if (!window.GameCatalogue) return;
    const g = window.GameCatalogue.find((x) => x.id === gameId);
    if (!g) return;
    // LocalSeatEditor.openSeatScreen seeds defaults + navigates.
    if (window.LocalSeatEditor && typeof window.LocalSeatEditor.openSeatScreen === 'function') {
      window.LocalSeatEditor.openSeatScreen(gameId);
    }
  }

  // ─── Live stats counter (lobby WebSocket, owned by OnlineSession) ───
  // UX redesign Phase 2: landing no longer opens its own lobby socket.
  // OnlineSession owns the lobby WS lifecycle (opens on Mode='online' or
  // first online action, idle-closes after 60s). We just subscribe to
  // incoming lobby messages here and re-render. If the user is in Local
  // mode and never goes online, no socket is ever opened (saves a DO
  // connection per landing visit, esp. for crawlers and bots).
  let lastStats = { rooms: 0, players: 0 };
  let lastCounts = {};
  let lobbyUnsub = null;

  function handleLobbyMessage(m) {
    if (!m || m.type !== 'rooms' || !Array.isArray(m.rooms)) return;
    const rooms = m.rooms.length;
    const players = m.rooms.reduce((sum, r) => sum + (r.players || 0), 0);
    lastStats = { rooms, players };
    if (Array.isArray(m.counts)) {
      lastCounts = {};
      for (const c of m.counts) if (c && c.gameId) lastCounts[c.gameId] = c;
      renderTileCounts();
    }
    renderStats();
  }

  function subscribeLobby() {
    if (lobbyUnsub) return;
    if (window.OnlineSession && typeof window.OnlineSession.onLobbyMessage === 'function') {
      lobbyUnsub = window.OnlineSession.onLobbyMessage(handleLobbyMessage);
    }
  }
  function renderStats(failed) {
    const el = $('landingStatLive');
    if (!el) return;
    if (failed && lastStats.rooms === 0) {
      el.textContent = 'Be the first to host a room';
      return;
    }
    const { rooms, players } = lastStats;
    if (rooms === 0) el.textContent = 'No public rooms — host one!';
    else if (rooms === 1) el.textContent = `1 room · ${players} ${players === 1 ? 'player' : 'players'} online`;
    else el.textContent = `${rooms} rooms · ${players} players online`;
  }

  // Decorative drifting icons in the hero background. Replaces the old
  // emoji float-cards. We pick a small icon set + position with the same
  // CSS classes the old emojis used, keeping the floatY animation intact.
  function bootDecor() {
    const bg = document.querySelector('.landing-hero-bg');
    if (!bg || bg.dataset.decorMounted) return;
    bg.dataset.decorMounted = '1';
    const picks = [
      { icon: 'cards',  cls: 'fc1', size: 72 },
      { icon: 'dice',   cls: 'fc2', size: 64 },
      { icon: 'cube',   cls: 'fc3', size: 72 },
      { icon: 'flame',  cls: 'fc4', size: 52 },
      { icon: 'swords', cls: 'fc5', size: 68 },
    ];
    bg.innerHTML = picks.map((p) => `<div class="float-card ${p.cls}" aria-hidden="true">${Kit.Icon.html(p.icon, { size: p.size })}</div>`).join('');
  }

  // W6: invite-link routing. URL like /?join=ABC drops the user straight
  // into room ABC (any visibility — host's invite link works for private
  // rooms too because the code itself IS the invite). Cleaned from the URL
  // after acting so a refresh doesn't loop.
  function tryInviteJoin() {
    try {
      const p = new URLSearchParams(location.search);
      const code = (p.get('join') || '').trim().toUpperCase();
      if (!/^[A-Z0-9_-]{1,64}$/.test(code)) return false;
      // Strip the query so refresh doesn't replay this.
      const url = new URL(location.href);
      url.searchParams.delete('join');
      history.replaceState({}, '', url.toString());
      // Hop through the normal join path so name capture + reconnect-resilient
      // flow stay consistent.
      if (typeof window.ensureName === 'function') window.ensureName();
      if (typeof window.connectRoom === 'function') window.connectRoom(code, {});
      return true;
    } catch { return false; /* malformed URL — ignore */ }
  }

  // ─── Bootstrap ───────────────────────────────────────────────────────
  function boot() {
    if (!$('landingGameTiles')) return; // page without landing layout
    bootDecor();
    renderTiles();
    renderStats();
    subscribeLobby(); // OnlineSession decides when to actually OPEN the socket
    if (!tryInviteJoin() && typeof window.restoreOnlineSession === 'function') {
      window.restoreOnlineSession();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // No more showScreen lifecycle patch for the lobby socket — OnlineSession
  // owns that now. We just keep our subscription alive for the page's
  // lifetime; it's a no-op when no socket is open (callbacks never fire).
})();

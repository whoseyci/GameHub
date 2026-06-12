/* landing.js — populates the landing page's game tiles + live stats counter.
 *
 * Game tiles: derived from window.GameCatalogue (single source of truth from
 * the hub registry). Each tile offers two actions:
 *   • ⚡ Play vs Bot  — jumps into local pass-and-play with auto-added bots
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
    container.innerHTML = window.GameCatalogue.map((g) => `
      <div class="landing-tile" data-game="${esc(g.id)}">
        <div class="lt-head">
          <div class="lt-emoji">${esc(g.emoji || '🎮')}</div>
          <div>
            <div class="lt-title">${esc(g.name)}</div>
            <div class="lt-meta">${esc(g.minPlayers)}–${esc(g.maxPlayers)} players</div>
          </div>
        </div>
        <div class="lt-desc">${esc(g.description || '')}</div>
        <div class="lt-actions">
          <button class="ltbtn primary" data-act="bot" data-game="${esc(g.id)}">⚡ Play vs Bot</button>
          <button class="ltbtn ghost" data-act="rules" data-game="${esc(g.id)}">📖 Rules</button>
        </div>
      </div>
    `).join('');

    container.addEventListener('click', onTileClick, { passive: true });
  }

  function onTileClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const gameId = btn.dataset.game;
    const act = btn.dataset.act;
    if (act === 'rules') {
      if (typeof window.openRules === 'function') window.openRules(gameId);
      return;
    }
    if (act === 'bot') {
      instantBotPlay(gameId);
      return;
    }
  }

  /**
   * Friction-free "play vs bot": configure localSeats (you + 2 bots), pick
   * the game, and start. Bypasses the local picker screen entirely so the
   * user is one click away from playing.
   *
   * Uses the public setters exported by 01-network-local.js so we never
   * touch script-scoped lets directly.
   */
  function instantBotPlay(gameId) {
    if (!window.GameCatalogue) return;
    const g = window.GameCatalogue.find((x) => x.id === gameId);
    if (!g) return;
    const myName = (window.Identity?.getName() || 'You').trim() || 'You';
    const desiredBots = Math.min(2, Math.max(g.minPlayers - 1, 1), (g.maxPlayers || 4) - 1);
    const seats = [{ name: myName, bot: false }];
    const botNames = ['Botley', 'Chip', 'Ada', 'Turing', 'Pixel', 'Nova'];
    for (let i = 0; i < desiredBots; i++) {
      seats.push({ name: `${botNames[i] || ('Bot ' + (i + 1))} 🤖`, bot: true, difficulty: 'medium' });
    }
    if (typeof window.setLocalSeats === 'function') window.setLocalSeats(seats);
    if (typeof window.startLocalForGame === 'function') {
      window.startLocalForGame(gameId);
    } else if (typeof window.showScreen === 'function') {
      // Fall back to the manual picker if the public setters aren't there
      // (defensive — shouldn't happen in a coherent build).
      window.showScreen('localPick');
    }
  }

  // ─── Live stats counter (lobby WebSocket) ───────────────────────────
  let lobbyWs = null;
  let lastStats = { rooms: 0, players: 0 };
  function startStatsSocket() {
    try {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${location.host}/parties/lobby/public-lobby`;
      lobbyWs = new WebSocket(url);
      lobbyWs.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m && m.type === 'rooms' && Array.isArray(m.rooms)) {
            const rooms = m.rooms.length;
            const players = m.rooms.reduce((sum, r) => sum + (r.players || 0), 0);
            lastStats = { rooms, players };
            renderStats();
          }
        } catch { /* ignore non-JSON / unknown messages */ }
      };
      lobbyWs.onopen = () => renderStats();
      lobbyWs.onerror = () => renderStats(true);
      lobbyWs.onclose = () => { lobbyWs = null; };
    } catch {
      renderStats(true);
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

  // ─── Bootstrap ───────────────────────────────────────────────────────
  function boot() {
    if (!$('landingGameTiles')) return; // page without landing layout
    renderTiles();
    renderStats();
    startStatsSocket();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // Close lobby socket when navigating away from the menu screen to free the DO
  // connection. Reopen when returning. Patches showScreen (idempotent).
  function patchShowScreen() {
    if (typeof window.showScreen !== 'function' || window._landingPatched) return;
    window._landingPatched = true;
    const orig = window.showScreen;
    window.showScreen = function (id) {
      const r = orig.apply(this, arguments);
      if (id === 'menuScreen') {
        renderStats();
        if (!lobbyWs || lobbyWs.readyState !== 1) startStatsSocket();
      } else if (lobbyWs && lobbyWs.readyState === 1) {
        try { lobbyWs.close(); } catch {}
        lobbyWs = null;
      }
      return r;
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patchShowScreen);
  else patchShowScreen();
})();

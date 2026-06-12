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
    // Per-game emoji from meta still shown on the tile face — it's the game's
    // identity glyph, not a UI control. UI control buttons use Kit.Icon.
    container.innerHTML = window.GameCatalogue.map((g) => `
      <div class="landing-tile" data-game="${esc(g.id)}">
        <div class="lt-head">
          <div class="lt-emoji">${esc(g.emoji || '')}</div>
          <div>
            <div class="lt-title">${esc(g.name)}</div>
            <div class="lt-meta">${esc(g.minPlayers)}–${esc(g.maxPlayers)} players</div>
          </div>
        </div>
        <div class="lt-desc">${esc(g.description || '')}</div>
        <div class="lt-actions">
          <button class="ltbtn primary" data-act="bot" data-game="${esc(g.id)}">${Kit.Icon.html('rocket',{size:14,cls:'kit-icon-inline'})}Play vs Bot</button>
          <button class="ltbtn ghost" data-act="rules" data-game="${esc(g.id)}">${Kit.Icon.html('book',{size:14,cls:'kit-icon-inline'})}Rules</button>
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
      // No emoji in bot names — the bot badge is rendered as an icon by the
      // chip renderer (see public/js/01-network-local.js renderRoom()).
      seats.push({ name: botNames[i] || ('Bot ' + (i + 1)), bot: true, difficulty: 'medium' });
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
  // Track whether we've confirmed there's a real PartyServer behind us. A
  // static dev server (e.g. scripts/e2e-client.mjs's local file-serving
  // harness) will return HTML for /parties/* via SPA fallback, which causes
  // an "Unexpected response code: 200" WebSocket handshake failure that the
  // browser logs to console.error — which then trips the e2e error gate.
  // Probe first; only open the WS if the endpoint actually looks like a DO.
  let probedHasPartyServer = null; // null = unknown, true/false once probed.

  async function probePartyServer() {
    if (probedHasPartyServer != null) return probedHasPartyServer;
    try {
      // PartyServer responds to a plain GET on the parties route with JSON
      // (or at least NOT with text/html). A static dev server serves
      // index.html, which is text/html — that's our "no party server" signal.
      const r = await fetch('/parties/lobby/public-lobby', { method: 'GET', cache: 'no-store' });
      const ct = r.headers.get('content-type') || '';
      probedHasPartyServer = !ct.startsWith('text/html');
    } catch {
      probedHasPartyServer = false;
    }
    return probedHasPartyServer;
  }

  async function startStatsSocket() {
    const live = await probePartyServer();
    if (!live) {
      // No real party server (most likely the e2e static harness). Render the
      // empty-state copy and skip the WebSocket attempt entirely so we don't
      // pollute the console.
      renderStats(true);
      return;
    }
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

  // ─── Bootstrap ───────────────────────────────────────────────────────
  function boot() {
    if (!$('landingGameTiles')) return; // page without landing layout
    bootDecor();
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

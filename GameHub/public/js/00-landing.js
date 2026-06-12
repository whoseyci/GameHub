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
          <!-- W6: per-game live count chip. Populated by renderTileCounts()
               from the lobby socket; hidden when there's nothing to show. -->
          <div class="lt-counts" data-counts="${esc(g.id)}" hidden></div>
        </div>
        <div class="lt-desc">${esc(g.description || '')}</div>
        <div class="lt-actions">
          <button class="ltbtn primary" data-act="quick" data-game="${esc(g.id)}">${Kit.Icon.html('rocket',{size:14,cls:'kit-icon-inline'})}Play Online</button>
          <button class="ltbtn ghost" data-act="bot" data-game="${esc(g.id)}">${Kit.Icon.html('robot',{size:14,cls:'kit-icon-inline'})}vs Bot</button>
          <button class="ltbtn ghost" data-act="rules" data-game="${esc(g.id)}">${Kit.Icon.html('book',{size:14,cls:'kit-icon-inline'})}Rules</button>
        </div>
      </div>
    `).join('');

    container.addEventListener('click', onTileClick, { passive: true });
    renderTileCounts();
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
    if (act === 'quick') {
      // W6: click-to-join quick-play. Hops into the quick-<game>-1 shard;
      // the room handles fallback to -2 / -3 on full.
      if (typeof window.ensureName === 'function') window.ensureName();
      if (typeof window.quickPlay === 'function') window.quickPlay(gameId);
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
      if (!/^[A-Z0-9_-]{1,64}$/.test(code)) return;
      // Strip the query so refresh doesn't replay this.
      const url = new URL(location.href);
      url.searchParams.delete('join');
      history.replaceState({}, '', url.toString());
      // Hop through the normal join path so name capture + reconnect-resilient
      // flow stay consistent.
      if (typeof window.ensureName === 'function') window.ensureName();
      if (typeof window.connectRoom === 'function') window.connectRoom(code, {});
    } catch { /* malformed URL — ignore */ }
  }

  // ─── Bootstrap ───────────────────────────────────────────────────────
  function boot() {
    if (!$('landingGameTiles')) return; // page without landing layout
    bootDecor();
    renderTiles();
    renderStats();
    subscribeLobby(); // OnlineSession decides when to actually OPEN the socket
    tryInviteJoin();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // No more showScreen lifecycle patch for the lobby socket — OnlineSession
  // owns that now. We just keep our subscription alive for the page's
  // lifetime; it's a no-op when no socket is open (callbacks never fire).
})();

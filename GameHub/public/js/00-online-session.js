/* online-session.js — UX redesign Phase 2.
 *
 * Owns the lifecycle of the public-lobby WebSocket. The room WebSocket
 * lives on `net.ws` (each room is its own Cloudflare Durable Object, so
 * we cannot multiplex). What Phase 2 buys us:
 *
 *   1. Lobby socket is NOT opened on landing load anymore. It opens when
 *      the user actually expresses online intent (flips Mode → online, or
 *      clicks any online action from Local mode).
 *   2. Lobby socket auto-closes after 60s of inbound silence when the
 *      user is not in a room, freeing the Durable Object's open-connection
 *      slot on the free plan.
 *   3. One enterRoom() funnel — call sites stop reaching directly into
 *      net.ws. Easier to reason about lifecycle + idle-tracking.
 *
 * Backwards-compatible: `connectRoom`, `quickPlay`, `hostGroup`,
 * `joinByCode`, `leaveOnline`, and direct `net.send(...)` calls still
 * work. We only intercept the lobby-socket open path and the room-enter
 * funnel.
 *
 * Mode integration: subscribes to Mode.onChange so flipping to Local
 * closes the lobby socket (we still keep an active room socket if you
 * actively switched away from a game — leaving the room itself uses the
 * existing leaveOnline()).
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ─── Internal state ────────────────────────────────────────────────
  let lobbyWs = null;
  let lobbyIdleTimer = null;
  // 60s of inbound silence (no rooms/counts payload) AND no active room
  // closes the lobby socket. The DO sends a `rooms` broadcast on every
  // membership/game-status change, so 60s of silence means nothing is
  // happening in the world — safe to disconnect.
  const LOBBY_IDLE_MS = 60_000;
  const subscribers = new Set(); // payload-relay subscribers

  function notify(payload) {
    for (const cb of subscribers) {
      try { cb(payload); } catch (e) { console.warn('OnlineSession subscriber threw:', e); }
    }
  }

  // ─── Lobby socket lifecycle ────────────────────────────────────────
  function wsUrl(party, room) {
    const p = location.protocol === 'https:' ? 'wss' : 'ws';
    const host = (typeof window.PARTYKIT_HOST !== 'undefined') ? window.PARTYKIT_HOST : location.host;
    return `${p}://${host}/parties/${party}/${encodeURIComponent(room)}`;
  }

  function armIdleClose() {
    if (lobbyIdleTimer) clearTimeout(lobbyIdleTimer);
    lobbyIdleTimer = setTimeout(() => {
      // Only close if we're truly idle: not in a room.
      if (typeof window.net !== 'undefined' && window.net.room) {
        armIdleClose(); // still active; arm again
        return;
      }
      closeLobby('idle');
    }, LOBBY_IDLE_MS);
  }

  /**
   * Open the lobby socket if not already open. Idempotent. Probes for a
   * PartyServer-style endpoint first so a static dev harness doesn't
   * trigger an "Unexpected response code: 200" handshake error.
   */
  async function openLobby(reason) {
    if (lobbyWs && lobbyWs.readyState <= 1) {
      armIdleClose();
      return lobbyWs;
    }
    // Probe content-type: PartyServer responds with JSON or an upgrade;
    // a static file server returns text/html (the SPA fallback).
    let hasPartyServer = false;
    try {
      const r = await fetch('/parties/lobby/public-lobby', { method: 'GET', cache: 'no-store' });
      const ct = r.headers.get('content-type') || '';
      hasPartyServer = !ct.startsWith('text/html');
    } catch { hasPartyServer = false; }
    if (!hasPartyServer) return null;

    try {
      const url = wsUrl('lobby', 'public-lobby');
      lobbyWs = new WebSocket(url);
      lobbyWs.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          notify(m);
        } catch { /* ignore malformed */ }
        armIdleClose();
      };
      lobbyWs.onopen = () => { armIdleClose(); };
      lobbyWs.onerror = () => { /* swallow — error event fires on close too */ };
      lobbyWs.onclose = () => { lobbyWs = null; if (lobbyIdleTimer) { clearTimeout(lobbyIdleTimer); lobbyIdleTimer = null; } };
    } catch {
      lobbyWs = null;
    }
    return lobbyWs;
  }

  function closeLobby(_reason) {
    if (lobbyIdleTimer) { clearTimeout(lobbyIdleTimer); lobbyIdleTimer = null; }
    if (lobbyWs) { try { lobbyWs.close(); } catch {} }
    lobbyWs = null;
  }

  function lobbyState() {
    if (!lobbyWs) return 'closed';
    return ['connecting', 'open', 'closing', 'closed'][lobbyWs.readyState] || 'closed';
  }

  // ─── Room enter funnel ─────────────────────────────────────────────
  /**
   * Enter a room. Forwarded to the existing connectRoom() which owns
   * the WS open + join handshake + handleNet dispatch. We funnel through
   * here so callers stop reaching directly into net.ws and so future
   * refactors (e.g. reconnect-on-disconnect) have one place to live.
   */
  function enterRoom(code, opts = {}) {
    if (typeof window.connectRoom !== 'function') {
      console.warn('OnlineSession.enterRoom called before network module loaded');
      return;
    }
    window.connectRoom(code, opts);
    // Reset the lobby idle timer — entering a room counts as activity.
    armIdleClose();
  }
  function leaveRoom() {
    if (typeof window.leaveOnline === 'function') window.leaveOnline();
  }

  // ─── Mode integration ──────────────────────────────────────────────
  // Open the lobby socket when the user flips to Online; close it when
  // they flip back to Local (unless they're actively in a room).
  function onModeChange(next) {
    if (next === 'online') {
      openLobby('mode-toggle');
    } else if (next === 'local') {
      if (typeof window.net !== 'undefined' && window.net.room) return; // keep socket while in-room
      closeLobby('mode-toggle');
    }
  }

  // ─── Public API ────────────────────────────────────────────────────
  window.OnlineSession = {
    openLobby, closeLobby,
    enterRoom, leaveRoom,
    onLobbyMessage: (cb) => {
      if (typeof cb !== 'function') return () => {};
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    state: () => ({ lobby: lobbyState(), inRoom: !!(window.net && window.net.room) }),
    // Test / debug surface (intentionally undocumented — for the smoke).
    _idleMs: LOBBY_IDLE_MS,
    _forceIdleClose: () => closeLobby('forced'),
  };

  // Subscribe to Mode when it's available. Mode loads before us via
  // script order, but its DOM-ready boot may not have run yet.
  function hookMode() {
    if (window.Mode && typeof window.Mode.onChange === 'function') {
      window.Mode.onChange(onModeChange);
      // If the user already landed in online mode (persisted), open now.
      if (window.Mode.get() === 'online') openLobby('boot-already-online');
    } else {
      // Mode module not ready — retry once on the next tick. Worst-case
      // we open with a tiny delay.
      setTimeout(hookMode, 0);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookMode);
  } else {
    hookMode();
  }
})();

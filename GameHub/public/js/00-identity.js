/* identity.js — persistent player identity + recent-players social graph.
 *
 * Everything is localStorage-only (zero server changes): the server already
 * attaches each member's pid to every message it sends, so we just observe
 * those broadcasts to learn who we've played with.
 *
 * Storage layout (all under one root key so it's trivial to wipe):
 *
 *   gh.identity = {
 *     pid:         "p_xxxxxxxxxxxxxxxx",     // mirror of legacy hub_pid
 *     friendCode:  "FOX-94K",                 // shareable handle
 *     name:        "Ada",                     // last-used display name
 *     recents: [
 *       { pid, name, lastSeen, games: { skyjo:{w:3,l:2}, qwixx:{w:1,l:0} } },
 *       ...
 *     ]
 *   }
 *
 * Capped to MAX_RECENTS entries (LRU by lastSeen). Bots never enter the list.
 */
(function () {
  'use strict';

  const STORE_KEY = 'gh.identity';
  const MAX_RECENTS = 24;

  // ─── Friend code derivation ──────────────────────────────────────────
  // 7-char shareable code derived deterministically from the pid: 3 letters
  // (a memorable animal/color word prefix) + 3 base32 chars. Stable across
  // reloads but never reveals the raw pid.
  const PREFIXES = ['FOX','SKY','OWL','PEA','MOON','STAR','LEAF','WAVE','OAK','JAY','ELM','NOVA'];
  function deriveFriendCode(pid) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < pid.length; i++) {
      h ^= pid.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    const prefix = PREFIXES[h % PREFIXES.length];
    const suffix = (h >>> 8).toString(36).toUpperCase().padStart(3, '0').slice(0, 3);
    return `${prefix}-${suffix}`;
  }

  // ─── Storage IO (defensive — never throws on parse failure) ──────────
  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* corrupt store — reset */ }
    return null;
  }
  function saveStore(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); }
    catch { /* quota / disabled — silently degrade */ }
  }

  // Legacy: hub_pid was the original pid key (00-core.js still reads it).
  // Mirror to/from the new store so existing users keep their identity.
  function readLegacyPid() {
    try { return localStorage.getItem('hub_pid'); } catch { return null; }
  }
  function writeLegacyPid(pid) {
    try { localStorage.setItem('hub_pid', pid); } catch {}
  }

  function newPid() {
    return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  // ─── Public API on window.Identity ───────────────────────────────────
  function ensure() {
    let store = loadStore();
    if (!store) store = { pid: null, friendCode: null, name: '', recents: [] };
    if (!store.pid) {
      store.pid = readLegacyPid() || newPid();
    }
    writeLegacyPid(store.pid);
    store.friendCode = store.friendCode || deriveFriendCode(store.pid);
    if (!Array.isArray(store.recents)) store.recents = [];
    saveStore(store);
    return store;
  }

  function getName() { return ensure().name || ''; }
  function setName(n) {
    const store = ensure();
    store.name = String(n || '').slice(0, 32);
    saveStore(store);
  }

  function getRecents() { return ensure().recents.slice(); }

  /** Record an encounter with another player. `you` is your own pid (ignored). */
  function recordEncounter({ pid, name }) {
    if (!pid || !name) return;
    const store = ensure();
    if (pid === store.pid) return; // never store yourself in your own list
    const now = Date.now();
    const i = store.recents.findIndex((r) => r.pid === pid);
    if (i >= 0) {
      store.recents[i].name = name;
      store.recents[i].lastSeen = now;
    } else {
      store.recents.unshift({ pid, name, lastSeen: now, games: {} });
    }
    // LRU evict
    store.recents.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    if (store.recents.length > MAX_RECENTS) store.recents.length = MAX_RECENTS;
    saveStore(store);
  }

  /** Update head-to-head record for one finished game. */
  function recordGameResult({ gameId, winners, players }) {
    if (!gameId || !Array.isArray(winners) || !Array.isArray(players)) return;
    const store = ensure();
    const youWon = players.some((p) => p.pid === store.pid && winners.includes(p.seat));
    for (const p of players) {
      if (!p || !p.pid || p.pid === store.pid) continue;
      const i = store.recents.findIndex((r) => r.pid === p.pid);
      if (i < 0) continue; // recordEncounter handles creation; skip silently
      const opponentWon = winners.includes(p.seat);
      // Only touch storage when the counter actually moves. This keeps ties /
      // multi-winner games from polluting the stat (no { w:0, l:0 } slots).
      if (youWon === opponentWon) continue;
      store.recents[i].games = store.recents[i].games || {};
      const slot = (store.recents[i].games[gameId] = store.recents[i].games[gameId] || { w: 0, l: 0 });
      if (youWon) slot.w += 1; else slot.l += 1;
    }
    saveStore(store);
  }

  /** Forget everyone. Useful for the "clear recent players" UI. */
  function clearRecents() {
    const store = ensure();
    store.recents = [];
    saveStore(store);
  }

  /** Forget one specific person. */
  function forgetRecent(pid) {
    const store = ensure();
    store.recents = store.recents.filter((r) => r.pid !== pid);
    saveStore(store);
  }

  /** Format a "wins-losses" summary string for a recent. */
  function summarizeRecent(rec) {
    if (!rec || !rec.games) return '';
    const parts = [];
    let totalW = 0, totalL = 0;
    for (const id of Object.keys(rec.games)) {
      const g = rec.games[id]; totalW += g.w || 0; totalL += g.l || 0;
    }
    if (totalW || totalL) parts.push(`${totalW}–${totalL}`);
    const lastSeen = rec.lastSeen ? timeAgo(rec.lastSeen) : '';
    if (lastSeen) parts.push(lastSeen);
    return parts.join(' · ');
  }

  function timeAgo(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    const d = Math.floor(s / 86400);
    if (d < 7) return `${d}d ago`;
    if (d < 30) return `${Math.floor(d / 7)}w ago`;
    return `${Math.floor(d / 30)}mo ago`;
  }

  // Initialise once and expose.
  const store = ensure();
  window.Identity = {
    pid: store.pid,
    friendCode: store.friendCode,
    getName, setName,
    getRecents, recordEncounter, recordGameResult,
    clearRecents, forgetRecent,
    summarizeRecent,
    _deriveFriendCode: deriveFriendCode, // exposed for tests
  };
})();

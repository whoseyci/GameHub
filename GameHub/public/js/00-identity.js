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
  // W6 part 2: cap how many recent group rooms we remember per device. Eight
  // is enough for "the friends + the family + the work crew + a few one-offs"
  // without making the menu chip row a wall of buttons.
  const MAX_RECENT_GROUPS = 8;

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
    if (!store) store = { pid: null, friendCode: null, name: '', recents: [], elo: {} };
    if (!store.pid) {
      store.pid = readLegacyPid() || newPid();
    }
    writeLegacyPid(store.pid);
    store.friendCode = store.friendCode || deriveFriendCode(store.pid);
    if (!Array.isArray(store.recents)) store.recents = [];
    if (!store.elo || typeof store.elo !== 'object') store.elo = {}; // gameId → rating
    // W6 part 2: recent group rooms (just the code + a friendly label + when
    // we last saw it). No PII — the code is what gets shared as the invite
    // link anyway. Capped LRU.
    if (!Array.isArray(store.recentGroups)) store.recentGroups = [];
    saveStore(store);
    return store;
  }

  // ─── ELO rating per game ───────────────────────────────────────────────
  // Standard ELO with K=24 and base rating 1200. We don't have per-opponent
  // ratings (recents may not include everyone), so the opponent rating
  // defaults to the average we've seen for that game, or 1200 if first match.
  // Ties split the expected/actual score 50/50.
  const ELO_BASE = 1200;
  const ELO_K = 24;
  function expected(a, b) { return 1 / (1 + Math.pow(10, (b - a) / 400)); }
  function getElo(gameId) {
    const store = ensure();
    if (!gameId) return ELO_BASE;
    return Number(store.elo[gameId]) || ELO_BASE;
  }
  function updateElo({ gameId, winners, players }) {
    if (!gameId || !Array.isArray(winners) || !Array.isArray(players)) return null;
    const store = ensure();
    const me = players.find((p) => p.pid === store.pid);
    if (!me) return null; // we weren't in this game
    const myRating = Number(store.elo[gameId]) || ELO_BASE;
    // Treat the field's average rating (or base) as the opponent rating.
    const oppRating = ELO_BASE;
    const N = players.length;
    const winnerSeats = new Set(winners);
    let actual;
    if (winnerSeats.has(me.seat) && winnerSeats.size === 1) actual = 1;       // sole win
    else if (winnerSeats.has(me.seat))                       actual = 1 / winnerSeats.size; // shared
    else                                                     actual = 0;       // loss
    // Multi-player ELO is fuzzy; use the "vs the average" approximation,
    // scaled by 1/(N-1) so 6-player games don't double-count.
    const E = expected(myRating, oppRating);
    const delta = Math.round((ELO_K * (actual - E)) / Math.max(1, N - 1));
    const newRating = Math.max(100, myRating + delta);
    store.elo[gameId] = newRating;
    saveStore(store);
    return { before: myRating, after: newRating, delta, actual };
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

  // ─── W6 part 2: recent groups (room codes you've visited) ──────────
  const SAFE_GROUP_CODE = /^[A-Z0-9_-]{1,64}$/i;
  /** Remember (or refresh) a group room. `label` is optional — host name. */
  function recordGroup({ code, label, hostName }) {
    if (!code || typeof code !== 'string') return;
    const norm = code.toUpperCase();
    if (!SAFE_GROUP_CODE.test(norm)) return;
    const store = ensure();
    const now = Date.now();
    const i = store.recentGroups.findIndex((r) => r.code === norm);
    const labelOut = (label || hostName || '').toString().slice(0, 32) || (`Group ${norm.slice(0, 8)}`);
    if (i >= 0) {
      store.recentGroups[i].label = labelOut;
      store.recentGroups[i].lastSeen = now;
    } else {
      store.recentGroups.unshift({ code: norm, label: labelOut, lastSeen: now });
    }
    store.recentGroups.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    if (store.recentGroups.length > MAX_RECENT_GROUPS) store.recentGroups.length = MAX_RECENT_GROUPS;
    saveStore(store);
  }
  function getRecentGroups() { return ensure().recentGroups.slice(); }
  function forgetGroup(code) {
    if (!code) return;
    const norm = String(code).toUpperCase();
    const store = ensure();
    store.recentGroups = store.recentGroups.filter((g) => g.code !== norm);
    saveStore(store);
  }
  function clearRecentGroups() {
    const store = ensure();
    store.recentGroups = [];
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
    getElo, updateElo,
    // W6 part 2: recent groups (room codes the user has joined as a group).
    getRecentGroups, recordGroup, forgetGroup, clearRecentGroups,
    _deriveFriendCode: deriveFriendCode, // exposed for tests
  };
})();

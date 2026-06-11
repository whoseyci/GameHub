# GameHub — Deep Architectural Review & High-Key Change Proposals

> **Audience:** Maintainers and contributors of [whoseyci/GameHub](https://github.com/whoseyci/GameHub)  
> **Date:** 2026-06-11  
> **Scope:** Performance · Security · Engine Uniformity · New-Game Onboarding

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [What's Already Great](#2-whats-already-great)
3. [PROPOSAL 1 — Typed Action Contract (Uniformity + Security)](#3-proposal-1--typed-action-contract)
4. [PROPOSAL 2 — View Diffing & Binary Protocol (Performance)](#4-proposal-2--view-diffing--binary-protocol)
5. [PROPOSAL 3 — State Versioning & Migration Framework (Uniformity)](#5-proposal-3--state-versioning--migration-framework)
6. [PROPOSAL 4 — Middleware / Action Pipeline (Uniformity + Security)](#6-proposal-4--middleware--action-pipeline)
7. [PROPOSAL 5 — Deterministic Test Harness & Replay Verification (Performance + Uniformity)](#7-proposal-5--deterministic-test-harness--replay-verification)
8. [PROPOSAL 6 — Bot-to-Server Migration Path (Security + Performance)](#8-proposal-6--bot-to-server-migration-path)
9. [PROPOSAL 7 — Registry Auto-Discovery & Plugin Packaging (Uniformity)](#9-proposal-7--registry-auto-discovery--plugin-packaging)
10. [PROPOSAL 8 — Client Build Modernization (Performance + Uniformity)](#10-proposal-8--client-build-modernization)
11. [PROPOSAL 9 — Per-Game Sub-Store Isolation (Security + Performance)](#11-proposal-9--per-game-sub-store-isolation)
12. [PROPOSAL 10 — Structured Error & Event Bus (Uniformity)](#12-proposal-10--structured-error--event-bus)
13. [Priority Matrix](#13-priority-matrix)
14. [Appendix: Codebase Stats](#14-appendix-codebase-stats)

---

## 1. Executive Summary

GameHub is a well-designed, surprisingly mature multiplayer game platform running on Cloudflare Workers + Durable Objects. It implements **four card/dice games** (Skyjo, Flip 7, Qwixx, Schotten Totten) with a shared rules engine, a unified card animation framework, client-side bots, local play, and lobby matchmaking — all in ~5,300 lines of core code.

The architecture is **already strong**: the `GameModule` contract, the `GameViewState` standardization, the shared `client-games.ts` bundle, the scaffold script, and the `Kit.Cards` framework show thoughtful, incremental design. This review targets **the next level**: eliminating remaining per-game ad-hoc patterns, hardening the security surface, reducing wire overhead, and making it so that adding game #5 takes **hours, not days**.

The 10 proposals below are ranked by impact-to-effort ratio. The first 4 are high-priority and can be implemented incrementally without breaking changes.

---

## 2. What's Already Great

Before proposing changes, it's important to acknowledge what the repo does *right* — many of these are uncommon in indie game projects:

| Area | What's Good |
|---|---|
| **GameModule contract** | `create / applyAction / viewFor / isOver` with optional `tick/completeTick` — clean, small, game-agnostic |
| **Shared rules engine** | `src/client-games.ts` bundles the *exact same* server GameModules for the browser → offline/local play uses identical rules |
| **GameViewState** | Standardized `currentSeat / pendingAction / players / actingCount / focusSeat` — the hub drives bots, ticks, focus without per-game branches |
| **Kit.Cards** | Declarative card spec framework with `CardManager` overlay system — all 4 games share one card geometry, animation, and flight model |
| **Security** | Token-bucket rate limiting per connection, `cleanPayload()` generic bounded parser, `cleanId/cleanInt/cleanName` input sanitization, host-only bot gating with `isSeatActable()` S1 check |
| **Scaffold tooling** | `npm run scaffold:game` generates server module, client, bot stub, tests, and updates registry + index.html |
| **Hibernation** | DO hibernation with `setWebSocketAutoResponse("ping"/"pong")` — idle rooms cost ~0 GB-s |
| **Deterministic RNG** | `rng.ts` with Mulberry32, stored as plain state, fully reproducible |
| **Protocol** | Generic `cleanPayload()` means new games don't edit `protocol.ts` to add action fields |

**What follows focuses on the gaps — not the strengths.**

---

## 3. PROPOSAL 1 — Typed Action Contract

### Problem
The `msg` parameter to `applyAction(state, seat, msg)` is typed as `any`. Each game's `applyAction` does its own ad-hoc string matching on `msg.action` and manual type coercion on `msg.index`, `msg.target`, `msg.c`, `msg.i`, etc. This means:
- **No compile-time safety** when refactoring a game's action set.
- **Inconsistent validation** — Flip 7 does `msg.target | 0` inline; Skyjo passes `msg.index` directly into engine methods; Qwixx checks `!COLORS.includes(color)` manually.
- **The scaffold generates `msg.action !== "example"` checks** that new authors copy-paste into brittle switch/case chains.

### Proposal
Add an **`ActionType`** string literal union to each game's `GameMeta`, and a corresponding **typed `GameAction<T>`** generic:

```typescript
// types.ts addition
interface GameMeta {
  // ... existing fields ...
  actionTypes: readonly string[];   // e.g. ["hit", "stay", "target"] for Flip7
}

type GameAction<A extends string = string> = {
  action: A;
  [k: string]: string | number | boolean;
};
```

Then `applyAction` becomes:
```typescript
applyAction(state: any, seat: number, msg: GameAction): void;
```

The **game-contract test** already validates every game's `applyAction` — enhance it to:
1. Enumerate `meta.actionTypes` and verify each one is accepted without throwing for valid seats.
2. Verify that *unknown* action strings are silently ignored (no mutation).

### Impact
| Area | Effect |
|---|---|
| Uniformity | Every game's action vocabulary is self-documenting in one place |
| Security | Tests guarantee no unknown actions cause mutation |
| Ease of setup | Scaffold generates the full action union from the start; new authors see exactly what to implement |

---

## 4. PROPOSAL 2 — View Diffing & Binary Protocol

### Problem
On every action, the server calls `broadcastState()` which calls `viewFor()` for **every connected connection** and sends full JSON `GameView` objects over WebSocket. For a Qwixx game with 8 players, that's 8 separate full-state serializations per action. In practice:
- Each `GameView` is ~2–8 KB of JSON depending on the game.
- A rapid bot game with 15 msgs/sec can push ~120 KB/sec of outbound WebSocket data.
- Cloudflare Workers' DO outbound is billed per GB.

Additionally, `viewFor()` rehydrates the game engine (e.g., `GameEngine.fromJSON(state)` for Skyjo) on **every call** — for N connections that's N rehydrations per action.

### Proposal (Two Parts)

**Part A — Shared `viewFor` cache per broadcast:**
```typescript
// In Room.broadcastState():
private broadcastState() {
  if (!this.gameId || !this.gameState) { /* lobby broadcast */ return; }
  const g = getGame(this.gameId)!;
  const views = new Map<number, GameView>();
  for (const conn of this.getConnections<ConnState>()) {
    const seats = this.controlledSeats(conn);
    const seat = seats.length ? this.primarySeatFor(conn) : -1;
    if (!views.has(seat)) views.set(seat, g.viewFor(this.gameState, seat));
    conn.send(JSON.stringify({ type: "game", view: views.get(seat), ... }));
  }
}
```
This deduplicates identical views (spectators all get seat=-1; same-seat players share one view).

**Part B — Incremental view diffing (Phase 2):**
For high-frequency games, implement a simple JSON patch (RFC 6902) or structural sharing approach:
- Keep a `lastViewPerSeat: Map<number, string>` on the Room.
- On broadcast, compute and send only the delta: `{ type: "game-patch", patches: [...], seq: N }`.
- The client applies the patch or falls back to a full state on mismatch.

### Impact
| Area | Effect |
|---|---|
| Performance | ~4–8× reduction in outbound WebSocket bytes for typical games |
| Cost | Direct DO egress savings on Cloudflare free/paid plans |
| Latency | Smaller messages arrive faster on mobile/slow connections |

---

## 5. PROPOSAL 3 — State Versioning & Migration Framework

### Problem
Every game state includes `schemaVersion: 1`, but there is **no migration path** if `schemaVersion` needs to bump to 2. If you add a field to Skyjo's state (e.g., a new `bonusTokens` array), all rooms currently in mid-game with `schemaVersion: 1` state in DO storage will crash when the new code tries to read `state.bonusTokens`.

Today, the `schemaVersion` field is written but **never read**. It's a ticking time bomb.

### Proposal
Add a `migrate(state)` optional method to `GameModule`:

```typescript
interface GameModule {
  // ... existing ...
  /** Migrate an older schemaVersion to the current one. Called once on load. */
  migrate?(state: any): void;
}
```

In `server.ts`, after loading state from storage:
```typescript
async onStart() {
  // ...
  this.gameState = (await this.ctx.storage.get<any>("gameState")) ?? null;
  if (this.gameState && this.gameId) {
    const g = getGame(this.gameId);
    if (g?.migrate) g.migrate(this.gameState);
  }
}
```

Each game implements:
```typescript
// skyjo/server.ts
migrate(state: any) {
  if (state.schemaVersion < 2) {
    state.bonusTokens = []; // new field
    state.schemaVersion = 2;
  }
}
```

**Add a test** that for every game, creating a state at `schemaVersion: 1`, running `migrate()`, and calling `viewFor()` does not throw.

### Impact
| Area | Effect |
|---|---|
| Uniformity | Every game has an explicit, testable migration path |
| Safety | Zero-downtime deployments with state schema changes |
| Ease of setup | New games get `migrate` in the scaffold from day one |

---

## 6. PROPOSAL 4 — Middleware / Action Pipeline

### Problem
The `Room.onMessage` handler is a ~200-line monolithic chain of `if (msg.type === ...)` blocks. Each game's action routing lives inline. This means:
- Adding a new message type requires editing the monolith.
- Cross-cutting concerns (logging, metrics, anti-cheat checks) must be sprinkled throughout.
- The scaffold can only document the pattern — it can't enforce it structurally.

### Proposal
Introduce a lightweight **middleware pipeline** that processes inbound messages through a composable stack:

```typescript
type Middleware = (ctx: ActionContext, next: () => void) => void;

interface ActionContext {
  conn: Connection<ConnState>;
  msg: any;
  pid: string;
  seat: number;
  isHost: boolean;
  room: Room;
}

class Room extends Server<Env> {
  private middleware: Middleware[] = [
    rateLimitMiddleware,    // token bucket
    authMiddleware,         // seat ownership / host checks
    logMiddleware,          // replay entry
    gameActionMiddleware,   // dispatches to GameModule.applyAction
  ];

  async onMessage(conn: Connection<ConnState>, raw: string) {
    const msg = parseClientMessage(raw);
    if (!msg) return;
    const ctx = this.buildContext(conn, msg);
    let i = 0;
    const next = () => { if (i < this.middleware.length) this.middleware[i++](ctx, next); };
    next();
  }
}
```

Hub-level concerns (rate limiting, logging, host authorization) become **independent, testable middleware** that compose. Game dispatch becomes one clean middleware. New message types just add a new middleware to the stack.

### Impact
| Area | Effect |
|---|---|
| Uniformity | One pattern for all message processing |
| Security | Auth and rate limiting are isolated, auditable, and impossible to skip |
| Ease of setup | New game devs never touch `server.ts` — their game module is all they write |

---

## 7. PROPOSAL 5 — Deterministic Test Harness & Replay Verification

### Problem
The replay system (`replay.ts`) logs actions but **never replays them**. The `actionLog` is capped at 120 entries and used only for debug snapshots. This means:
- There's no way to verify that a recorded game produces the same final state when re-executed.
- Bugs in RNG determinism or state mutation order can creep in silently.
- The `rng.test.ts` tests the RNG functions but not end-to-end game determinism.

### Proposal
Add a **replay harness** that:
1. Records full game inputs (not just summaries) — `seat, msg, rngState-before` for each action.
2. Provides a `replay(log)` function that re-creates the game, replays each action, and asserts the final state matches.
3. Is used in CI to verify determinism for all games.

```typescript
// tests/replay-determinism.test.ts
for (const game of Object.values(GAMES)) {
  it(`${game.meta.id} replay is deterministic`, () => {
    const log = generateRandomGame(game, { seed: 42, maxActions: 200 });
    const finalState = replayGameLog(game, log);
    const replayedState = replayGameLog(game, log);
    expect(finalState).toEqual(replayedState);
  });
}
```

This also enables **state verification in production**: a background alarm can periodically replay the last N actions and alert if the computed state diverges from the stored state (catching DO storage corruption).

### Impact
| Area | Effect |
|---|---|
| Uniformity | Every game is determinism-tested the same way |
| Performance | Enables state compression (store only inputs, recompute state on demand) |
| Security | Detects tampered/corrupted game states |

---

## 8. PROPOSAL 6 — Bot-to-Server Migration Path

### Problem
Bots currently "think" entirely on the **host's client browser**. The server trusts the host to send correctly-timed `botSeat` actions. While `isSeatActable()` gates *when* a bot can act, it does not gate *what* a bot does. A malicious host could:
- Send a suboptimal bot move on purpose to throw the game.
- Send a bot action with fabricated `msg` fields that the game's `applyAction` doesn't validate strictly.
- Delay bot actions indefinitely (stall the game for other players).

This is an inherent trust-model issue: the server delegates computation to an untrusted client.

### Proposal (Phased)

**Phase A — Server-side bot runner (opt-in):**
Add a `runBot(state, seat, difficulty)` method to `GameModule` that returns the bot's chosen action. Initially, this can wrap the same heuristic logic currently in the client bot files:

```typescript
interface GameModule {
  // ... existing ...
  /** Server-side bot decision. Returns null if the bot can't/won't act. */
  runBot?(state: any, seat: number, difficulty: string): any | null;
}
```

The Room's alarm handler can auto-advance bot turns:
```typescript
async onAlarm() {
  // ... existing tick logic ...
  // If current seat is a bot and enough time has passed, run server bot:
  if (this.gameId && this.gameState) {
    const g = getGame(this.gameId);
    const vs = g?.viewFor(this.gameState, -1).state;
    const bot = this.members[vs?.currentSeat ?? -1];
    if (bot?.bot && g?.runBot && Date.now() - this.lastActivity > 3000) {
      const action = g.runBot(this.gameState, vs!.currentSeat, bot.difficulty);
      if (action) {
        g.applyAction(this.gameState, vs!.currentSeat, action);
        await this.persistRoom();
        this.broadcastState();
        this.armAlarm(); // re-arm for next turn
      }
    }
  }
}
```

**Phase B — Hybrid trust:** Keep client-side bots for instant feedback (low latency) but validate server-side. If the server detects a discrepancy (host sent different bot action than server would have), flag and optionally override.

### Impact
| Area | Effect |
|---|---|
| Security | Eliminates host-side bot manipulation vector |
| Uniformity | Bot logic lives in the GameModule, not in scattered client JS files |
| Performance | Server bots can be more complex (no 16KB payload limit, no client CPU budget) |

---

## 9. PROPOSAL 7 — Registry Auto-Discovery & Plugin Packaging

### Problem
Adding a game requires editing **four separate files** manually (or via scaffold):
1. `src/games/<id>/server.ts` — game logic
2. `src/games/registry.ts` — import + register
3. `public/index.html` — add `<script>` tags for client + bot
4. `src/games/<id>/meta.ts` — metadata

The scaffold script handles this, but it's fragile — if someone manually creates a game directory without the scaffold, the registry won't find it, and there's no compile-time error.

### Proposal
Replace the manual registry with **auto-discovery** using a barrel pattern enforced at build time:

```typescript
// src/games/registry.ts — auto-generated by build
// Each game directory exports a GameModule from its index.ts
// This file is generated: npm run build:registry

import { Skyjo } from "./skyjo/server";
import { Flip7 } from "./flip7/server";
import { Qwixx } from "./qwixx/server";
import { Schotten } from "./schotten/server";
// @auto-import-next-game@

export const GAMES: Record<string, GameModule> = {
  // @auto-registry-start@
  [Skyjo.meta.id]: Skyjo,
  [Flip7.meta.id]: Flip7,
  [Qwixx.meta.id]: Qwixx,
  [Schotten.meta.id]: Schotten,
  // @auto-registry-end@
};
```

Add a **validate script** that:
1. Scans `src/games/*/index.ts` for `GameModule` exports.
2. Verifies each is registered in `registry.ts`.
3. Verifies each has a matching `public/js/games/<id>.js` and `public/js/bots/<id>.js`.
4. Verifies `index.html` loads both scripts.
5. Fails CI if any are missing.

This turns "forgot to register the game" from a runtime bug into a CI failure.

### Impact
| Area | Effect |
|---|---|
| Uniformity | Every game follows the exact same directory structure |
| Ease of setup | Scaffold + validate = zero manual registration steps |
| CI | Structural enforcement prevents drift |

---

## 10. PROPOSAL 8 — Client Build Modernization

### Problem
The client-side code is a collection of **6+ plain JS files** loaded via `<script>` tags in a specific order:
```
00-game-modules.js  →  00-core.js  →  00-cards.js  →  01-network-local.js
  →  02-qwixx.js  →  03-skyjo.js  →  04-flip7.js
  →  bots/driver.js  →  bots/*.js  →  05-bots-init.js
  →  games/schotten.js
```

This has several problems:
- **No tree-shaking**: All game clients are loaded even if the player only plays Skyjo.
- **No module isolation**: All games share the global scope; a bug in one can corrupt another.
- **Load order is fragile**: The numbered prefix (00, 01, 02…) is the only thing enforcing dependency order.
- **CSP `unsafe-inline`**: The CSP headers include `'unsafe-inline'` for scripts, which weakens XSS protection.
- **No minification**: Production serves unminified JS.

### Proposal (Phased)

**Phase A — Bundle per-game clients with esbuild:**
The existing `build-client-games.mjs` already uses esbuild. Extend it to also bundle each game's client renderer + bot into a single per-game chunk:

```
public/js/games/skyjo.bundle.js   ← includes skyjo client + skyjo bot
public/js/games/flip7.bundle.js   ← includes flip7 client + flip7 bot
...
```

The hub shell (`00-core.js` + `00-cards.js` + `01-network-local.js` + `bots/driver.js`) becomes one `hub.js` bundle.

`index.html` dynamically loads only the needed game bundle after the player selects a game.

**Phase B — ES modules + strict CSP:**
Move to `<script type="module">` and remove `'unsafe-inline'` from CSP. This is a larger refactor but eliminates the last major CSP weakness.

### Impact
| Area | Effect |
|---|---|
| Performance | ~40-60% reduction in initial JS payload (only hub + selected game loads) |
| Security | Stronger CSP without `unsafe-inline` |
| Uniformity | All client code goes through the same build pipeline |

---

## 9. PROPOSAL 9 — Per-Game Sub-Store Isolation

### Problem
`Room.persistRoom()` writes the **entire room meta + game state** as two blobs (`"meta"` and `"gameState"`) on every action. For a game with frequent actions (bot games, Qwixx simultaneous turns), this means:
- Every `mark` in Qwixx writes the entire Qwixx state including all 4 rows × 8 players × 11 cells.
- The `meta` blob includes the growing `actionLog` (up to 120 entries × ~200 bytes = ~24 KB) written on every action.
- Cloudflare DO storage writes are transactional — a large write blocks the alarm handler.

### Proposal
Split storage into **granular keys**:

```typescript
// Instead of two monolithic writes:
await this.ctx.storage.put("meta", { /* everything */ });
await this.ctx.storage.put("gameState", { /* huge game state */ });

// Write granular keys:
await this.ctx.storage.put("members", this.members);
await this.ctx.storage.put("gameId", this.gameId);
await this.ctx.storage.put("gameState", this.gameState);  // unchanged
await this.ctx.storage.put("actionLog", this.actionLog);   // only when log changes
// ... etc.
```

Better yet, use DO **SQLite** storage (already configured via `new_sqlite_classes` in wrangler.jsonc) for structured data:

```typescript
// Store game state as a single JSON column, but meta fields as individual columns
await this.ctx.storage.sql.exec(
  `INSERT OR REPLACE INTO room_meta (key, value) VALUES (?, ?)`,
  "members", JSON.stringify(this.members)
);
```

**Action log append-only:** Instead of rewriting the full array, append entries to a separate key or SQLite table:

```typescript
// Append-only: only write the NEW entry, not the full array
const key = `log:${this.actionLog.length}`;
await this.ctx.storage.put(key, entry);
```

### Impact
| Area | Effect |
|---|---|
| Performance | Smaller writes per action = faster DO storage round-trips |
| Cost | DO storage is billed per write unit; smaller writes = fewer units |
| Scalability | Enables longer replay histories without capping at 120 |

---

## 12. PROPOSAL 10 — Structured Error & Event Bus

### Problem
Error handling is inconsistent across the codebase:
- `applyAction` silently ignores invalid actions (returns void, no error signal).
- `parseClientMessage` returns `null` for malformed messages — the caller silently drops them.
- The client's `handleNet` shows `toast(m.message)` for server errors but has no structured error codes.
- There's no way for the client to distinguish "your action was invalid" from "the game state changed while you were acting."

### Proposal
Introduce a **structured event protocol** between server and client:

```typescript
// Server → Client event types
type ServerEvent =
  | { type: "game"; view: GameView; isHost: boolean; bots: BotInfo[]; controlledSeats: number[] }
  | { type: "room"; code: string; members: Member[]; isHost: boolean; /* ... */ }
  | { type: "error"; code: ErrorCode; message: string; recoverable: boolean }
  | { type: "action_rejected"; reason: string; originalAction: string }
  | { type: "rooms"; rooms: RoomInfo[] }
  | { type: "hello" }
  | { type: "spectating"; message: string }
  | { type: "room_full" };

type ErrorCode =
  | "ROOM_FULL"
  | "INVALID_ACTION"
  | "NOT_YOUR_TURN"
  | "GAME_NOT_FOUND"
  | "NOT_HOST"
  | "RATE_LIMITED";
```

The server sends `{ type: "action_rejected", reason: "...", originalAction: "hit" }` when `applyAction` would silently ignore an action. This gives the client UI the information to show *why* an action didn't work instead of just silently failing.

### Impact
| Area | Effect |
|---|---|
| Uniformity | One typed protocol for all server→client communication |
| Security | Error codes prevent information leakage (no stack traces in messages) |
| Ease of setup | New game devs get clear error feedback during development |

---

## 13. Priority Matrix

| # | Proposal | Impact | Effort | Priority |
|---|---|---|---|---|
| 1 | Typed Action Contract | ⬆⬆ | ⬇ | **P0 — Do first** |
| 3 | State Migration Framework | ⬆⬆⬆ | ⬇ | **P0 — Critical safety net** |
| 2A | View Dedup Cache | ⬆⬆ | ⬇ | **P1 — Quick performance win** |
| 4 | Middleware Pipeline | ⬆⬆ | ⬆⬇ | **P1 — Clean architecture win** |
| 10 | Structured Error Events | ⬆ | ⬇ | **P1 — Easy UX improvement** |
| 5 | Replay Verification | ⬆⬆ | ⬆⬇ | **P2 — Testing infrastructure** |
| 9 | Granular Storage | ⬆⬆ | ⬆ | **P2 — Performance at scale** |
| 7 | Registry Auto-Discovery | ⬆ | ⬇ | **P2 — CI enforcement** |
| 8A | Per-Game Client Bundles | ⬆⬆ | ⬆⬆ | **P3 — Significant refactor** |
| 6 | Server-Side Bots | ⬆⬆⬆ | ⬆⬆⬆ | **P3 — Major trust model change** |

**Recommended implementation order:**
1. **Proposal 1** (Typed Actions) — 1-2 days, zero breaking changes
2. **Proposal 3** (Migrations) — 1 day, critical safety net
3. **Proposal 2A** (View Cache) — 1 day, immediate perf gain
4. **Proposal 4** (Middleware) — 3-5 days, architectural foundation
5. Then proceed to P2 items based on team bandwidth

---

## 14. Appendix: Codebase Stats

| Metric | Value |
|---|---|
| Games implemented | 4 (Skyjo, Flip 7, Qwixx, Schotten Totten) |
| Server TypeScript LOC | ~2,400 |
| Client JavaScript LOC | ~2,900 |
| Shared between server & client | `src/games/*` → bundled to browser |
| Total core code | ~5,300 LOC |
| Test files | 14 |
| Bot strategies | 4 (one per game, 3 difficulty levels each) |
| Runtime | Cloudflare Workers + Durable Objects (PartyServer) |
| Build tool | esbuild (client bundle) + Wrangler (deploy) |
| CI | GitHub Actions: validate + browser smoke test |

# GameHub — Architecture Review & High-Leverage Change Proposals

**Reviewer:** Arena.ai Agent Mode
**Date:** 2026-06-09
**Repo:** `whoseyci/GameHub` (inner `GameHub/` package, deploy name `skyjo-pro`)
**Baseline health at time of review:** `tsc --noEmit` clean · `vitest` 75/75 passing · 9 test files

---

## 1. What this project is (so the recommendations have context)

A **multiplayer card-game hub** running entirely on **Cloudflare Workers + Durable Objects** via the
**PartyServer** framework. Three games ship today: **Skyjo**, **Flip 7**, **Qwixx**.

```
                         ┌─────────────────────────────────────────────┐
  Browser (static SPA)   │  Worker entry (src/server.ts default.fetch)  │
  public/index.html      │   routePartykitRequest → DO, else ASSETS     │
  public/js/*.js (10×)   └───────────────┬─────────────────────────────┘
  public/styles/main.css                 │
        │ WebSocket /parties/room/<CODE>  │  /parties/lobby/public-lobby
        ▼                                 ▼
  ┌──────────────────┐            ┌──────────────────┐
  │  Room DO         │  cross-DO  │  Lobby DO        │
  │  (hibernatable)  │──fetch────►│  (discovery)     │
  │  members/pending │            │  public rooms    │
  │  gameId+gameState│            └──────────────────┘
  │  one alarm: tick │
  │   + idle-close   │   uses ──► src/games/registry → {skyjo, flip7, qwixx}
  └──────────────────┘            each game = GameModule (create/applyAction/viewFor/...)
```

**Design strengths worth preserving** (don't regress these):
- **Hibernation-first** DO design with WebSocket auto-response for ping/pong — keeps idle GB-s near zero.
- **Single alarm** drives both game ticks and idle-close (no extra timers).
- **Lobby pinged only on membership/status change**, not per action — minimizes cross-DO subrequests.
- **Bots "think" on the host's client**, keeping server compute ~0.
- Clean **`GameModule` contract** (`src/games/types.ts`) + **registry** so new games can't break existing ones.
- **Runtime input validation** (`src/protocol.ts`) independent of TS types; per-message size cap (16 KB).
- Sensible **CSP / security headers** in `public/_headers`; debug endpoints gated behind `DEBUG_TOKEN`.
- Deterministic, JSON-serializable **RNG** (`src/rng.ts`) — good for reproducible state & tests.

The proposals below are **high-leverage architectural** changes, grouped by **Performance**,
**Security**, and **Game-Engine Uniformity**, each with impact/effort and a concrete first step.

---

## 2. Performance

### P1 — Eliminate the per-call deep-clone in the Skyjo module ⭐ (biggest single win)
**Severity: High · Effort: Medium · Risk: Low**

`src/games/skyjo.ts` wraps a stateful class (`GameEngine`) and on **every** call does:

```ts
function load(state)  { return GameEngine.fromJSON(state); }     // Object.assign into a fresh instance
function dump(g)      { return JSON.parse(JSON.stringify(g)); }  // full deep clone of the whole engine
```

- `applyAction` calls `load()` then `Object.assign(state, dump(g))` → **two full structural clones per action**.
- `viewFor` calls `load()` again **per viewer** — and the Room's `sendTo` computes the view
  **once per controlled seat plus one extra "primary" view** (`views.map(...)` **and** `view: g.viewFor(...)`).

For an 8-seat Skyjo room, **one action** triggers: 1 action clone-pair + a broadcast that runs
`viewFor` ~9 times, each rehydrating the engine and re-serializing player boards. That's
O(players²) `JSON.parse(JSON.stringify)` per move on the hot path — exactly the kind of CPU that
eats Workers' per-request CPU budget and adds latency to every broadcast.

By contrast **Flip 7 and Qwixx are pure-function modules** that mutate plain state directly with
**zero** clones. Skyjo is the outlier.

**Fix (two layers):**
1. **Make Skyjo a pure-function module** like the other two (operate directly on the plain `state`
   object). If keeping the class is desired short-term, at minimum: `load()` once per `applyAction`
   and assign fields back without `JSON.parse(JSON.stringify)` (use a typed `toJSON()` that returns
   the already-plain fields, or mutate `state` in place).
2. **In `Room.sendTo`, compute each view once.** Build the per-seat views and reuse the
   primary-seat view instead of calling `viewFor` an extra time:
   ```ts
   const seatViews = seats.map((s) => ({ seat: s, view: g.viewFor(this.gameState, s) }));
   const primary = seatViews.find(v => v.seat === seat)?.view ?? g.viewFor(this.gameState, seat);
   ```

**Validation:** add a micro-bench test asserting `viewFor` does no `JSON.parse` (spy), plus the
existing rule/contract tests must stay green.

---

### P2 — Broadcasting recomputes the full game state per connection
**Severity: Medium · Effort: Medium · Risk: Low**

`broadcastState()` → `sendTo(conn)` rebuilds **the same** game view material for every connection.
Most fields (deck count, discard top, every other player's public board) are **identical across
viewers**; only `myDrawnCard`/`yourSeat`/`controlledSeats` differ.

**Fix:** Split views into a **shared public snapshot** (computed once) + a small **per-seat private
overlay** merged at send time. This turns an O(connections × state-size) broadcast into
O(state-size) + O(connections × small). It also sets up P5 (delta sync) cleanly.

---

### P3 — Persist less, and not on the synchronous send path
**Severity: Medium · Effort: Low–Medium · Risk: Medium**

Every gameplay action does `await this.persistRoom()` = `put("meta", …)` **and** `put("gameState", …)`
**before** broadcasting. Two issues:
- **`meta` is rewritten on every action** even though `members/hostId/isPublic/...` rarely change
  mid-game. Only `gameState`, `tickAt`, `lastActivity` change per move. Splitting "hot" vs "cold"
  storage keys avoids re-serializing the whole `meta` blob (incl. the 120-entry `actionLog`) each move.
- The `await` before broadcast adds storage latency to the player-visible response.

**Fix:**
- Keep `actionLog` in its **own storage key** (or trim writes), and only `persistMeta()` when meta
  actually changed; per-action writes touch `gameState` + a tiny `hot` key only.
- Consider `ctx.storage.put` **without `await`** before broadcast where DO write-coalescing /
  output-gating makes it safe (DO storage is durable on the same isolate); broadcast first, persist
  in the same tick. Validate against the consistency model before adopting.

---

### P4 — Client delivery: 10 unbundled scripts, all `no-store`
**Severity: Medium · Effort: Medium · Risk: Low**

`public/_headers` sets `Cache-Control: no-store` for `/js/*` and `/styles/*`, and `index.html`
loads **10 separate global-scope `<script>` tags**. Every page load re-downloads ~3,200 lines of JS
with **zero caching**, and globals create implicit load-order coupling (the `check-client-js.mjs`
relies on filename ordering `00-…05`).

**Fix:**
- Introduce a tiny **build step** (esbuild/Vite) producing **content-hashed** bundles
  (`app.<hash>.js`, `app.<hash>.css`) and switch those assets to `immutable, max-age=31536000`.
  Keep `index.html` itself `no-store` so new hashes are picked up instantly. This is the standard
  cache-busting pattern and removes the only reason `no-store` is on the JS.
- This also lets you **convert globals → ES modules**, killing the implicit ordering contract.

---

### P5 — Send state deltas, not full snapshots (after P2)
**Severity: Medium · Effort: High · Risk: Medium**

Once public/private views are separated (P2), broadcast **deltas** (or a version number + changed
fields) and let the client reconcile. Cuts WebSocket egress and client parse cost noticeably for
8-player games where each move currently ships the entire board state to everyone. Sequence numbers
already exist in Flip 7 (`state.seq`) — generalize that into the contract.

---

## 3. Security

### S1 — Host can puppet bot seats with arbitrary, rule-skipping actions ⭐
**Severity: High (fairness/integrity) · Effort: Medium · Risk: Low**

Bots run on the **host's client**; the host sends `action` messages carrying `botSeat`. The server
(`onMessage`, `action` branch) trusts:
```ts
if (msg.botSeat != null && isHost) { if (this.members[bi]?.bot) actSeat = bi; ... }
```
The **only** check is "is it a bot seat?" — there is **no server-side validation that the bot's move
is one a legitimate bot strategy would make**, nor any rate limit. A malicious or modified host can
drive bot seats with optimal/cheating play, dump bots' good cards, or grief opponents. Because all
game rules are enforced in `applyAction` the move must be *legal*, but it need not be *bot-like* or
*fair*, and the host effectively gets N extra optimized hands.

**This is the single most important integrity gap given the "bots think on host" design.**

**Fix (defense in depth):**
- **Authoritative bot scheduling on the server:** the server already owns `viewFor`/turn order. Move
  the *trigger* (whose turn, when) server-side and have the server reject `botSeat` actions unless it
  is genuinely that bot's turn and within a sane think-delay window. (You can keep heavy "thinking"
  client-side but gate acceptance.)
- **Long term / fairness-critical rooms:** run bot strategies **server-side** (they're small,
  deterministic, and already framework-free) so the host can't influence them at all. Offer it as a
  per-room "ranked/fair" toggle to preserve the zero-compute default for casual rooms.
- Add **per-connection action rate limiting** regardless (see S3).

### S2 — `pid` is a client-chosen identity (seat takeover / impersonation)
**Severity: Medium–High · Effort: Medium · Risk: Medium**

A player's identity is `pid` from `localStorage` (`getPid()`), sent in `join`. The server seats
whoever presents a `pid`. Anyone who learns/guesses another player's `pid` (it's predictable-ish:
`p_<base36 rand>+<time36>`) can **reconnect as them** and control their seat — the reconnect path
matches purely on `pid` (`memberIdx(pid) >= 0`). There is no token/secret binding a pid to a session.

**Fix:** On first join, server issues a **signed seat token** (HMAC over `room|seat|pid|nonce` with a
Worker secret) returned to the client and required on reconnect. Keeps the friendly `pid` UX but makes
seat takeover require the secret, not just the pid. Store only the nonce server-side.

### S3 — No per-connection rate limiting / flood protection
**Severity: Medium · Effort: Low · Risk: Low**

`onMessage` parses and acts on every frame up to 16 KB with no throttle. A single socket can spam
legal `action`/`add_bot`/`launch_game` messages, forcing storage writes + broadcasts (amplification:
1 inbound msg → N outbound + 2 storage puts). Combined with hibernation, a burst can rack up DO
requests and CPU.

**Fix:** Token-bucket per connection (e.g., N actions/sec, burst M) in the DO; drop or `close(1008)`
on sustained abuse. Cheap, and it directly protects the free-plan budgets the README cares about.

### S4 — `Math.random()` for security-relevant IDs / room codes
**Severity: Low–Medium · Effort: Low · Risk: Low**

Bot ids and (on the client) likely room codes use `Math.random()`. For **game RNG** the
deterministic Mulberry32 is fine and intentional. For **identifiers that gate access** (room codes,
any future tokens), use `crypto.getRandomValues` / `crypto.randomUUID()`. Public rooms are
discoverable anyway, but private rooms rely on code unguessability.

### S5 — CSP allows `'unsafe-inline'` for scripts
**Severity: Low · Effort: Medium (couples to P4) · Risk: Low**

`script-src 'self' 'unsafe-inline'` is required today because `index.html` uses inline `onclick=`
handlers and inline `<script>`. This weakens XSS protection. Once P4 introduces a bundle, move to
**nonce/hash-based CSP** and remove `'unsafe-inline'` for scripts. (Note: the in-app *preview* uses a
sandboxed iframe without network, so this only matters for the deployed site.)

---

## 4. Game-Engine Uniformity

### U1 — Two incompatible game-authoring styles (class vs. pure function) ⭐
**Severity: High (maintainability) · Effort: Medium · Risk: Low**

- **Skyjo** = a stateful **class** (`src/engine.ts` `GameEngine`) wrapped by an adapter that
  serializes/deserializes on every call.
- **Flip 7 / Qwixx** = **pure functions** mutating plain JSON state directly.
- The `_template.ts` exists but the canonical games disagree with each other on style.

This split is the root cause of P1, doubles the mental model for contributors, and makes the
`TICK_RUNNERS` registry awkward (Skyjo needs a bespoke `skyjoCompleteTurnEnd` export while the
contract already has `tick()`).

**Fix:** Pick **one** authoring model — the **pure-function-on-plain-state** model the contract
already documents ("State MUST be JSON-serializable; no class instances") — and **migrate Skyjo to
it**. Delete the adapter clones. Keep `src/engine.ts`'s logic but expose it as plain reducers, not a
class. The `_template.ts` should be the literal shape both real games follow.

### U2 — The deferred-tick mechanism is half in the contract, half in a side registry
**Severity: Medium · Effort: Low · Risk: Low**

`GameModule.tick(state)` returns a delay, but **completing** the tick uses a separate
`TICK_RUNNERS[gameId]` map (only Skyjo registered) plus a comment in `skyjo.ts` calling it a
"synthetic action." The hub thus needs game-specific knowledge it claims not to have.

**Fix:** Fold completion into the contract: either `tick(state)` itself **performs** the advance and
returns `{ nextDelayMs }`, or add an explicit `completeTick(state)` method to `GameModule`. Remove
`TICK_RUNNERS`. Now the hub is truly game-agnostic and `replay.ts`'s `kind: "tick"` is uniform.

### U3 — `replay.ts` / `summarizeGameState` hard-codes per-game fields
**Severity: Medium · Effort: Low · Risk: Low**

```ts
if (gameId === "skyjo") Object.assign(base, { round, currentPlayer, turnAction });
if (gameId === "flip7") ...
if (gameId === "qwixx") ...
```
Every new game must edit this central file — the exact coupling the registry pattern was meant to
avoid.

**Fix:** Add an optional `summarize(state)` (or reuse `viewFor(state, -1).state`, the standardized
`GameViewState`) on `GameModule` and have `summarizeGameState` call it generically. The
`GameViewState` already carries `currentSeat`, `pendingAction`, per-player status/score — most of
what's hard-coded here.

### U4 — Bot observation patching is hard-coded for Skyjo in the driver
**Severity: Medium · Effort: Low · Risk: Low**

`public/js/bots/driver.js` `buildBotObservation()` has a Skyjo-specific branch (patching
`publicDrawn`/`lastAction` into `myDrawnCard`). Other games "return the view as-is." This is the
client-side twin of U3.

**Fix:** Make observation-building part of each game's **bot strategy** (`strategy.observe(view, seat)`)
so the driver stays agnostic and each game owns its own info-hiding logic.

### U5 — Lifecycle/phase mapping is duplicated per game
**Severity: Low · Effort: Low · Risk: Low**

Each game re-implements a `lifecyclePhase()` switch mapping internal phases to the canonical
`GameLifecyclePhase`. Minor, but standardizing internal phase names (or a shared mapper keyed by a
declared map) removes copy-paste drift and the Flip 7 default-case that returns the raw string.

### U6 — Client/server contract is documented but not type-shared or runtime-checked end-to-end
**Severity: Medium · Effort: Medium · Risk: Low**

The client JS is plain globals; the server `GameView`/`GameViewState` types never reach the client.
A field rename server-side fails silently in the browser (only the Playwright smoke test might catch
it). The `_renderView`/`GameActions` glue assumes shapes by convention.

**Fix:** After P4's bundling, share the `types.ts` view interfaces with the client (import the `.d.ts`),
and add a lightweight runtime schema check on the **client** for inbound `game`/`room` messages
(mirroring `protocol.ts` on the server). Cheap insurance for refactors.

---

## 5. Priority matrix (impact ÷ effort)

| # | Change | Category | Impact | Effort | Do-now? |
|---|--------|----------|--------|--------|---------|
| **P1** | Kill Skyjo per-call deep clones | Perf | High | Med | ✅ first |
| **S1** | Authoritative/validated bot turns | Security | High | Med | ✅ first |
| **U1** | One game-authoring model (pure fn) | Uniformity | High | Med | ✅ (pairs with P1) |
| **P3** | Hot/cold storage split, fewer writes | Perf | Med | Low | ✅ quick |
| **S3** | Per-connection rate limiting | Security | Med | Low | ✅ quick |
| **U2** | Fold tick-completion into contract | Uniformity | Med | Low | ✅ quick |
| **U3** | Generic `summarize()` via contract | Uniformity | Med | Low | ✅ quick |
| **S2** | Signed seat tokens (anti-takeover) | Security | Med-High | Med | next |
| **P2** | Shared public + per-seat overlay views | Perf | Med | Med | next |
| **P4** | Bundle + content-hash + cache JS/CSS | Perf | Med | Med | next |
| **U4/U6** | Per-game observe(); shared client types | Uniformity | Med | Med | next |
| **P5** | Delta sync over WebSocket | Perf | Med | High | later |
| **S2→S5** | Nonce CSP, crypto IDs | Security | Low-Med | Med | later |

---

## 6. Suggested first PR (small, safe, high-value)

A single focused PR that pays down the worst hot-path cost **and** the worst integrity gap without
changing gameplay or breaking the 75 passing tests:

1. **P1 + U1 (partial):** Rewrite `src/games/skyjo.ts` to mutate plain state directly (drop
   `JSON.parse(JSON.stringify)`), and fix `Room.sendTo` to compute each view once.
2. **U2:** Remove `TICK_RUNNERS`; add `completeTick(state)` to the `GameModule` contract and
   implement it in Skyjo.
3. **S3:** Add a per-connection token-bucket in `Room.onMessage` (e.g., 10 actions/s, burst 20).
4. **S1 (step 1):** In the `botSeat` branch, additionally require that it is *actually* that bot's
   turn per `viewFor(state,-1).state.currentSeat` (or `actingCount` for simultaneous games) before
   accepting the action.

**Acceptance:** `npm run validate` (typecheck + client check + tests + dry-run deploy) stays green;
add one perf test asserting Skyjo `viewFor` performs no deep clone, and one security test asserting an
out-of-turn `botSeat` action is rejected.

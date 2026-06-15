# API Audit & Hardening

Audit of GameHub's platform APIs: the security/robustness hardening applied, and
a per-game map of which shared APIs each game uses (and, where it doesn't, why
and what it uses instead). Date of audit: current sprint.

---

## Part 1 — Hardening applied

The largest attack surface is the **server-side game-call path**: game modules
run inside the `Room` Durable Object on *attacker-influenced input* (the
validated-but-arbitrary action payload). The audit found that a throw inside a
game module — from a real bug or a maliciously-shaped payload — would escape the
DO's message handler. Worse, because `applyAction` mutates `gameState` **in
place**, a mid-mutation throw left state half-applied and divergent from storage
(the throwing path never reaches `persistRoom()`).

### S5 — Crash isolation + atomic mutation (`src/server.ts`)

Added `Room.safeMutate(label, fn)` and `Room.safeRead(label, fn, fallback)`:

- **`safeMutate`** snapshots `gameState` (structured clone — it's plain JSON by
  contract), runs the mutation, and **rolls back on any throw**, returning
  `false`. Callers then skip persist/broadcast and send a clean
  `INTERNAL` `ServerError` to the client instead of crashing the room.
- **`safeRead`** wraps pure reads (`isOver`, `tick`) that must never throw out of
  a handler, returning a safe fallback.

Every game-module call is now guarded:

| Call site | Method | Guard |
|---|---|---|
| gameplay action | `applyAction` | `safeMutate` (+ rollback, `INTERNAL` on fail) |
| `next_round` | `addPlayer` + `applyAction` | `safeMutate` **+ `members`/`pending` snapshot** so the roster never desyncs from state |
| alarm tick | `completeTick` | `safeMutate` |
| post-action / post-tick | `isOver` | `safeRead → false` |
| `scheduleTick` | `tick` | `safeRead → null` |
| `startGame` | `create` | `try/catch` → aborts the launch (no half-started room) |
| (pre-existing) | `migrate`, `legalActions`, summary | already guarded |

**Result:** a buggy or hostile action can no longer corrupt room state or take
down the Durable Object — the worst case is one rejected action with the room
state intact.

### S6 — Payload number-magnitude bound (`src/protocol.ts`)

`cleanPayload` accepted any **finite** number. A hostile client could send
`1e308` (passes `Number.isFinite`) which a game might feed to `Array(n)`, a loop
bound, or an index — hanging or OOM-ing the DO (amplification DoS). Added
`MAX_PAYLOAD_NUMBER = 1_000_000`; out-of-range numbers are **dropped, not
clamped** (so a game never silently acts on a coerced value). Legitimate fields
(board indices, card values, seats) are far inside this bound.

### Tests added

- `tests/protocol.test.ts` — huge finite numbers are dropped, in-range pass.
- `tests/room-sim.test.ts` — `safeMutate` rollback contract: a mutation that
  corrupts state then throws leaves state byte-identical to the pre-call
  snapshot.

### Already-solid (verified, no change needed)

- **Message validation** (`parseClientMessage`): per-type schemas, bounded
  keys/strings, reserved-key protection, ID allow-list (`/^[A-Za-z0-9_-]{1,64}$/`),
  16 KB message cap.
- **Rate limiting**: per-connection token bucket (15/s sustained, burst 30) that
  drops floods *before* any parsing/work (anti-amplification).
- **Authorization**: a connection may only act for seats it controls; the host
  may drive **bot** seats only, and only when it's actually that bot's turn
  (`isSeatActable`). `applyAction` remains the final rule authority.
- **Lobby spoofing**: the Lobby `POST /u` endpoint rejects any request whose
  hostname isn't the internal `lobby` origin (strangers can't forge rows).
- **Replay API**: exposes public game state only (no hidden card/deck state),
  immutable + cacheable; debug endpoint is `DEBUG_TOKEN`-gated.
- **Hibernation/efficiency** invariants (ping/pong auto-response, single alarm,
  per-seat view memoization) preserved.

### Recommended follow-ups (not done this pass — flagged for review)

1. **`onMessage` top-level guard.** `safeMutate` covers game calls, but a throw
   in hub bookkeeping (e.g. `lobbyUpdate`, `persistRoom`) still escapes. A
   defensive `try/catch` around the whole `onMessage` body would make the room
   fully crash-proof. Left out for now to avoid masking real bugs silently —
   wants a deliberate logging/alerting decision.
2. **Per-connection action-in-flight lock.** Actions `await persistRoom()`; a
   client could pipeline many actions before the first persists. The rate
   limiter bounds throughput, but a strict per-connection serialization would
   remove any interleaving edge cases.
3. **`structuredClone` cost.** `safeMutate` clones `gameState` on every action.
   For current games (small state) this is negligible; if a future game has
   large state, consider a cheaper snapshot (the engine `STATE_KEYS` pattern
   Skyjo uses) or copy-on-write.

---

## Part 2 — Per-game API adoption map

The platform offers two API layers:

- **Server (`GameModule`, `src/games/types.ts`):** `create`, `applyAction`,
  `viewFor`, `isOver` (required); `tick`/`completeTick`, `migrate`, `summarize`,
  `joinScore`, `addPlayer`, `legalActions` (optional).
- **Client (`window.Kit` + `GameShell` + `GameActions`):** `Kit.Cards`
  (canonical card), `Kit.CardManager`/`Kit.CardBoard` (registry + flight),
  `Kit.MiniBoard` (opponent panels w/ ResizeObserver tiers), `Kit.Controls`
  (floating action bar), `Kit.Status`, `Kit.Turn`, `Kit.Dice3D`, `Kit.Layout`,
  `Kit.Icon`, `Kit.PassPlay`, `GameShell.renderTable/persist/inspect`,
  `GameActions.send`.

### Server-side `GameModule` adoption

| Method | Skyjo | Flip 7 | Qwixx | Schotten | Notes |
|---|:--:|:--:|:--:|:--:|---|
| `create`/`applyAction`/`viewFor`/`isOver` | ✅ | ✅ | ✅ | ✅ | required — all implement |
| `legalActions` (API-8) | ✅ | ✅ | ✅ | ✅ | all opt in; clients render hints from `view.state.legal` |
| `migrate` | ✅ | ✅ | ✅ | ✅ | all version their schema |
| `summarize` | ✅ | ✅ | ✅ | ✅ | compact debug/replay summary |
| `tick`/`completeTick` | ✅ | ❌ | ❌ | ❌ | **only Skyjo** needs a server-driven delay (the "turn-end reveal" pause). The others advance synchronously on the acting player's input, so they correctly omit it — adding it would be dead code. |
| `joinScore`/`addPlayer` | ✅ | ✅ | ❌ | ❌ | **Skyjo & Flip 7** seat late-joiners at a fair running score across rounds. **Qwixx** is effectively one long game with no fair mid-game entry point; **Schotten** is strictly 2-player (`maxPlayers: 2`), so there's no seat to add — both correctly omit these. |

**Verdict:** server-side adoption is clean and intentional. Every omission is a
genuine "this game doesn't have that concept," not a workaround. No game
reimplements a contract method it should be inheriting.

### Client-side API adoption

| API | Skyjo | Flip 7 | Qwixx | Schotten | Why / what's used instead |
|---|:--:|:--:|:--:|:--:|---|
| `GameShell.renderTable` | ✅ | ✅ | ✅ | ✅ | the shared table shell — universal |
| `GameActions.send` | ✅ | ✅ | ✅ | ✅ | the one action channel — universal |
| `legalActions` consumption (`view.state.legal`) | ✅ | ✅ | ✅ | ✅ | all render legality hints from the server payload (Skyjo/Flip7 also fall back to the live `legalActions()` for non-viewer seats in pass-and-play) |
| `Kit.Icon` | ✅ | ✅ | ✅ | ✅ | Phosphor icons — universal (no UI emojis) |
| `Kit.Cards` / `Kit.CardManager` | ✅ | ✅ | **❌** | ✅ | **Qwixx has no cards** — it's a dice + scorecard game. It renders a bespoke `.qwixx-scorecard` grid (numbers crossed off) instead of the card framework. Correct: cards would be the wrong primitive. |
| `Kit.CardBoard` | ❌ | ✅ | ❌ | ✅ | board-of-cards layout helper; Skyjo manages its 4×3 grid directly via `CardManager`, Qwixx has no cards. |
| `Kit.Controls` (floating action bar) | **❌** | ✅ | ⚠️ | ✅ | **Skyjo** has no turn-end button — all input is direct board taps, so it needs no control bar. **Qwixx** uses its **own** `.qwixx-controls` (the turn-end skip/penalty button) styled in-flow under the dice rather than `Kit.Controls`' fixed bar — see note ▼. **Flip 7 / Schotten** use `Kit.Controls`. |
| `Kit.MiniBoard` (opponent panels) | ✅ | ✅ | ✅ | **❌** | **Schotten is 2-player and renders both sides inline** on the single board (`st-side-me` / `st-side-opp`, `topMode:'hidden'`), so there's no opponent strip to build with `MiniBoard`. The others show 1–7 opponents as mini panels. |
| Roller (`Kit.Roller` / `Kit.Dice3D`) | ❌ | ❌ | ✅ | ❌ | **Qwixx is the only dice game.** It rolls through the **swappable roller API**: `Kit.Roller` (cartoony 2D slot machine — lever pull, spinning reels, bouncy lock-in) is the active renderer; `Kit.Dice3D` (WebGL physics dice) is the drop-in alternative. Both share `roll/showStatic/supported`, so Qwixx selects one via `const ROLLER = …`. Unused by the non-dice games by design. |
| `Kit.Status` | ✅ | ✅ | ⚠️ | ⚠️ | Skyjo/Flip7 use `Kit.Status`; **Qwixx & Schotten pass a plain `status` string to `renderTable`** instead (simpler; no live status widget needed). Minor inconsistency, not a bug. |
| `Kit.Turn` | ✅ | ✅ | ❌ | ❌ | turn-banner helper; Qwixx/Schotten convey turn via the status line + active highlighting instead. |
| `Kit.PassPlay` | ✅ | ❌ | ❌ | ❌ | **only Skyjo** wires the pass-and-play board-rotate hand-off animation. Flip 7/Qwixx/Schotten work in pass-and-play but don't add the rotation flourish. Opportunity, not a defect. |
| `GameShell.persist` | ❌ | ❌ | ✅ | ❌ | **Qwixx persists its WebGL dice tray** across re-renders so the running canvas isn't torn down mid-roll. No other game has a long-lived stateful DOM node that needs to survive a render. |

#### Notes on the intentional divergences

- **Qwixx custom controls (⚠️ the one real inconsistency).** Qwixx renders its
  turn-end button as a bespoke `.qwixx-controls` element inside the dice zone
  rather than via `Kit.Controls`. This is deliberate: the button must sit
  **directly under the dice viewport** (a Qwixx-specific layout) and change
  through a 2-stage state machine (penalty → skip white/colour → pass), which
  `Kit.Controls`' generic fixed bottom-bar doesn't model. *Possible
  future unification:* extend `Kit.Controls` with an "anchored under element X"
  mode so Qwixx can adopt it without losing the placement.

- **Qwixx/Schotten status string vs `Kit.Status`.** Both pass a `status` string
  to `renderTable`. Harmless, but adopting `Kit.Status` everywhere would make
  the status affordance uniform (animated bumps, icons). Low priority.

### Summary

- **Server contract:** fully and correctly adopted; all omissions are
  capability-driven (no tick where none is needed, no late-joiner seating in a
  2-player or single-long-game design).
- **Client kit:** broadly adopted. The only true inconsistencies are
  **Qwixx's custom control bar** (justified by placement + 2-stage logic) and
  the **Qwixx/Schotten status string** (cosmetic). Everything else
  (`Kit.Cards`, `Kit.Dice3D`, `Kit.MiniBoard`, `Kit.PassPlay`) is correctly used
  only where the game has that concept.

No game reimplements logic that a shared API already provides; the divergences
are about *layout/placement*, not *duplicated rules or visuals*.

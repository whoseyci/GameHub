# Making a game

This is the single source of truth for adding a new game to GameHub.
It replaces the scattered `ADDING_A_GAME.md`, `RL_STRATEGY.md`, and
`MOBILE_GAME_VIEW_GUIDE.md` for the day-to-day "I want to add a game"
workflow. (The deeper docs are still authoritative for their narrow
topics; this one covers the 90% path.)

> **Target:** a new card/dice game with **bots**, **legality hints**,
> **shared animations**, and **offline pass-and-play parity** in
> **≈300 lines of game-specific code** end-to-end.

---

## 0. The contract in one diagram

```
┌─────────── GameModule (server, src/games/<id>/) ────────────┐
│                                                             │
│  meta:           GameMeta                                   │
│  create:         (names[]) → state                          │
│  applyAction:    (state, seat, msg) → mutate                │
│  viewFor:        (state, seat) → GameView                   │
│  isOver:         (state) → boolean                          │
│  legalActions?:  (state, seat) → GameAction[]   ← API-8     │
│  tick? / completeTick? / migrate? / summarize?              │
└─────────────────────────────────────────────────────────────┘
        ▲                              ▲
        │ same module                  │ via build:client-games
        │ runs in browser              │
        │                              │
┌───── server (Cloudflare DO) ──┐    ┌─── browser (Local + Render) ───┐
│  • broadcasts views           │    │  • LocalEngine adapter         │
│  • injects view.state.legal   │    │    (offline pass-and-play)     │
│  • captures ReplayBundle      │    │  • GameClients[<id>].render    │
│  • BotDriver fallback         │    │  • Kit.* shared visuals/anims  │
└───────────────────────────────┘    └────────────────────────────────┘
```

You write the **GameModule** and a **renderer**. Everything else — sockets,
hibernation, lobby, replays, identity, animations, turn UI, bot fallback —
is platform.

---

## 1. Scaffold

```bash
node scripts/scaffold-game.mjs --id=hearts --name="Hearts" --emoji=♥️ --min=3 --max=4
```

This creates and **auto-wires**:

```
src/games/hearts/{meta,server,index}.ts        ← server module
src/games/hearts.ts                            ← compat re-export
public/js/games/hearts.js                      ← client renderer stub
public/js/bots/hearts.js                       ← bot strategy stub
tests/hearts.test.ts                           ← contract tests stub
```

…and:
- Registers the game in `src/games/registry.ts` (single source of truth)
- Adds `<script>` tags for both the renderer and the bot to `public/index.html`
- Rebuilds `public/js/00-game-modules.js` so the module is immediately
  available to the browser

Run `npm run validate:ci` after scaffolding — the stub passes all 200+
platform tests on first try.

---

## 2. The 5 things you write

### a. `meta.ts` — describe the game
```ts
export const HeartsMeta: GameMeta = {
  id: "hearts", name: "Hearts",
  minPlayers: 4, maxPlayers: 4,
  description: "Avoid taking ♥ tricks. Pass the Queen of ♠.",
  emoji: "♥️",
  features: { hasBots: true, simultaneousTurns: false, usesTick: false,
              hasMultiRound: true, canSpectate: true,
              minDurationSec: 300, maxDurationSec: 1200 },
  actionTypes: ["pass", "play", "next_round"] as const, // for replay tests
};
```

### b. `server.ts` — pure reducers over JSON state
**Rules:**
1. State MUST be JSON-serializable. No class instances, no `Infinity`,
   no `Date.now()` reads, no `Math.random()`. Use `rng.ts` helpers.
2. `viewFor(seat)` hides other players' hidden info.
3. Put game-private data under `view[meta.id]`. Hub-shared fields
   (`currentSeat`, `players`, `pendingAction`) go on `view.state`.
   *(Locked by `tests/view-shape.test.ts` — any leak fails CI.)*

### c. `legalActions(state, seat)` — opt-in but **strongly recommended** (API-8)
```ts
legalActions(state, seat) {
  if (state.phase !== "PLAY") return [];
  if (seat !== state.currentSeat) return [];
  return state.players[seat].hand
    .filter((card) => isLegalToPlay(state, seat, card))
    .map((card) => ({ action: "play", card }));
}
```
What you get for free:
- Every action in your returned list lights up as a drop target in the
  client via `Kit.Cards.legalHints(view)` — **zero client-side rule code**.
- The BotDriver auto-falls back to a random legal move when your bot
  strategy returns `null`, so you have a **working bot day-one**.
- The replay scrubber can show "what moves were possible here?".
- The what-if branch simulator (`Kit.WhatIf`) uses your hints to
  sample plausible playouts in a Web Worker.

**Contract** (pinned by `tests/legal-actions.test.ts`):
- Pure read — never mutate state.
- Return `[]` for non-current seats.
- Every returned entry must be accepted by `applyAction()` (no fake hints).

### d. `public/js/games/<id>.js` — the renderer
The shell hands you a `view` and a `ctx`. You render. The platform handles:

- **Turn UI:** `Kit.Turn` is called automatically after every render —
  it shows "Your turn!" / "Alice's turn", plays the SFX, bumps the
  status bar. You write zero detection code.
- **Drop targets:** `Kit.Cards.legalHints(view)` → `.markHints(els, hints)`.
- **Card movement:** `Kit.Cards.move(id, toEl, opts)` and
  `Kit.Cards.flyTransient(from, to, opts)` — uniform spring, no per-game
  animation code.
- **Boards / hands / piles:** `Kit.Cards.hand()`, `Kit.Cards.grid()`,
  `Kit.Cards.deck()`, `Kit.Cards.discard()` — shared geometry, shared
  back, you theme only the front via the strict `Spec` (bg/border/content).
- **Inspect overlay:** `ctx.inspect(node)` for the "look at another
  player's board" popup. Don't poke `#investigateOverlay` directly.

A complete renderer for a card-with-targets game can be ~150–200 lines.

### e. `public/js/bots/<id>.js` — the bot strategy (optional logic)
The scaffold writes a stub that returns `null`. **That's enough to ship.**
With `legalActions()` defined, the driver falls back to a random legal
move. Replace `chooseFor()` body with heuristics (or load CEM weights
from `/training/`) when you're ready.

---

## 3. The platform features your game inherits for free

| Feature | What you get | Where it lives |
|---|---|---|
| Real-time multiplayer | DO + WebSocket, hibernation-safe | `src/server.ts` |
| Persistent rooms | Group survives across games | `src/server.ts` |
| Spectator + drop-in | Late joiners auto-join next round | `src/server.ts` |
| Quick Play matchmaking | "Pick a game, get matched" | `src/server.ts` |
| Bot driver + fallback | Per-game strategy + legal-action fallback | `public/js/bots/driver.js` |
| Replays | Deterministic capture + `/replay/<code>/<id>` URLs | `src/replay-capture.ts`, `public/replay.html` |
| Shareable replay links | "📺 Watch Replay / 🔗 Copy Link" on game-over | `public/js/01-network-local.js` |
| Identity + recent players | Friend code, W–L vs each opponent | `public/js/00-identity.js` |
| Live rooms counter | Landing page | `public/js/00-landing.js` |
| Instant play vs bot | One click, no setup | `public/js/00-landing.js` |
| Turn UI | "Your turn!" / SFX / status pulse | `public/js/00-kit-turn.js` |
| Drop-target highlights | From `legalActions()` | `public/js/00-cards.js` |
| Animation invariants | Catches orphan overlays, glitches | `public/js/00-core.js` (CardManager) |
| State migration | `migrate?` survives deploys | `src/games/types.ts` |
| Structured errors | Typed `action_rejected` toasts | `src/games/types.ts` |
| Determinism guarantee | RNG-in-state, replay-byte-stable | `src/rng.ts`, `tests/replay-determinism` |

---

## 4. The 11 platform contracts your game must satisfy

Each one is **a test that fails CI** if you violate it:

| # | Contract | Test |
|---|---|---|
| 1 | JSON-serializable state | `tests/game-contract` |
| 2 | `viewFor(seat)` returns same shape for spectator + viewer | `tests/view-shape` |
| 3 | Private data namespaced under `view[meta.id]` | `tests/view-shape` |
| 4 | `view.state.{currentSeat, players, ...}` populated | `tests/view-shape` |
| 5 | Spectators can't apply gameplay actions | `tests/game-contract` |
| 6 | Replay determinism: same log → same state | `tests/replay-determinism` |
| 7 | Self-play terminates (no deadlocks) | `tests/self-play` |
| 8 | If `hasBots=true`, a `BotDriver.register` exists and is loaded | `tests/game-client-parity` |
| 9 | A `GameClients[<id>]` registration exists | `tests/game-client-parity` |
| 10 | `legalActions()` is pure, off-turn-empty, and accepted | `tests/legal-actions` |
| 11 | Replay capture rehydrates byte-identically | `tests/replay-capture` |

---

## 5. Working philosophy (the boring rules that prevent all the bugs)

- **No `Math.random()` or `Date.now()` inside `applyAction`.** Use
  `nextRandom(state)` from `rng.ts`. Every wall-clock read is a future
  replay-divergence bug. (We've shipped two already; both were caught
  by `tests/replay-determinism`.)
- **No per-game rule code in the client.** If you find yourself writing
  `if (canDoX(state)) { highlight() }` in `public/js/games/<id>.js`,
  add `legalActions()` and use `hints.has('x', {...})` instead.
- **No raw DOM mutation outside Kit.** All card movement goes through
  `Kit.Cards.*` — uniform geometry, uniform spring, structurally
  impossible glitches.
- **No new client storage keys.** Use `window.Identity` for player
  data; the hub already handles room/game state.
- **No per-game CSS for card geometry.** Theme via `Kit.Cards.el(spec)`
  bg/border/content; the shared `.kc` class owns the geometry.

If the platform doesn't expose what you need, **extend the platform**,
don't fork it locally. The whole DX overhaul (API-1 through API-11)
came from exactly this discipline.

---

## 6. The list of what's still per-game (and why that's OK)

After the DX overhaul, the **only** things a game owns are:
- Its rules (`server.ts`)
- Its visual identity (cards/dice/board *theme*, not geometry)
- Its renderer (how it composes Kit primitives)
- Its bot heuristics (optional — random-legal fallback works)

Everything else is platform.

# Agent session — 2026-06-12 (part 2: DX overhaul + unlocks)

Continuation of the morning's session. This pass delivered the full DX
overhaul + all three "next unlocks" from the part-1 writeup.

## What landed

| Commit  | Phase                                                    | Tests added |
| ------- | -------------------------------------------------------- | ----------- |
| dcaa030 | DX #1 — API-8 `legalActions` + API-6 view-shape parity   | +25 (202)   |
| dd88f6b | DX #2 — Kit.Turn + Kit.Cards.legalHints + invariants     | +5  (207)   |
| c11103f | `docs/MAKING_A_GAME.md` — unified DX guide               | —           |
| 5d8828d | Unlocks #1 & #2 — replay highlights + what-if simulator  | +6  (213)   |
| 5406369 | Unlock #3 — per-game ELO from replays                    | +5  (218)   |

**218 tests + 3 JSDOM smokes + typecheck — all green at every step.**

## DX overhaul (the philosophy made concrete)

The brief was *"impossible for new games to have weird glitchy animations
or transitions or seating problem, ...  all games (current & future) to
have as little individual code as possible, doing as much as possible
over the api and if it doesnt provide the needed feature, build it into
the api/kit."*

The contract a new game owns is now exactly:

```
src/games/<id>/server.ts       — your rules (pure JSON reducers)
src/games/<id>/meta.ts         — name, players, features, action vocabulary
public/js/games/<id>.js        — your renderer (Kit primitives only)
public/js/bots/<id>.js         — optional heuristic (random-legal works for free)
tests/<id>.test.ts             — game-specific rule tests
```

Everything else is platform. There are **11 contracts** that any new
game *must* satisfy, and each one is a CI-blocking test:

1. JSON-serializable state
2. Spectator+viewer view shape match
3. Private data namespaced under `view[meta.id]`
4. Canonical `view.state` populated
5. Spectators can't apply actions
6. Replay determinism (same log → same state, byte-identical)
7. Self-play terminates
8. `hasBots` ⇒ a strategy is registered AND its script is loaded
9. `GameClients[<id>]` registration exists
10. `legalActions` is pure, off-turn-empty, and accepted by applyAction
11. Replay capture rehydrates byte-identically

Each is enumerated in `docs/MAKING_A_GAME.md` with the failing test name.

### What the DX overhaul concretely deleted from per-game code

- **Turn UI detection** — was ~10 lines/game across Skyjo, Flip 7, Qwixx,
  Schotten ("did current change? if mine, banner + SFX + bumpStatus").
  Now: 0 lines/game. `GameShell.render` calls `Kit.Turn.update(view)`
  automatically; old per-game blocks are suppressed via a 300ms
  debounce while you migrate.
- **Rule replication in renderers** — Schotten was the proof case. Its
  "is this stone a valid drop target?" / "is this hand card selectable?"
  / "can I claim this stone?" logic moved entirely to
  `server.legalActions()`. The renderer now reads
  `Kit.Cards.legalHints(view).has('place', {index, target})` — single
  source of truth, can't drift between online and local.
- **Bot strategy stubs for new games** — when your server module has
  `legalActions`, the BotDriver falls back to a random legal move
  automatically. You can ship a working game without writing any bot
  code, then iteratively replace the fallback with heuristics.

### What now catches glitches *before* they ship

- `tests/view-shape.test.ts` — any new game leaking a non-namespaced
  key, or missing `view.state.players[].score`, fails CI.
- `tests/legal-actions.test.ts` — any game that opts in to
  `legalActions` and lies about it (mutating state, returning fake
  hints, returning entries for off-turn seats) fails CI.
- `Kit.CardManager.verifyInvariants()` — orphan overlays, zone-slot
  collisions, detached overlays. Now exercised in `smoke-replay.mjs`
  for every game across every replayed action. A new game that leaks
  cards fails CI.
- Existing `tests/replay-determinism` already catches `Math.random()` /
  `Date.now()` reads inside `applyAction`.

## The three unlocks

### #1 — Replay highlights ✨

`public/js/replay-highlights.js` + `tests/highlights.test.ts`.

Generic frame-by-frame analyser. Surfaces:
- **Score swings** (≥4 pts, magnitude-scored)
- **Lead changes** (respects `meta.scoring: 'lower-is-better'`)
- **Game-ending climax** (score = 1.0)

Replay player paints them as coloured pips on the scrubber:
- 🟡 swing  🟢 win  🟣 lead change  🔴 loss
- Hover for tooltip; click to jump; **H** = next highlight, **G** = prev.

Generic — no per-game branches. Future games inherit it day-one.
Per-game enrichment hook (`module.scoreFrame?`) is documented but
optional.

### #2 — What-if branch simulator 🎲

`public/js/whatif-worker.js` + UI in `replay-player.js`.

Click **🎲 What-if?** (or press **W**) at any replay frame. A Web
Worker:
1. `importScripts('/js/00-game-modules.js')` (same engines as live).
2. Runs N=100 random-legal playouts from the current state.
3. Reports per-seat win probability + avg game length + draw rate.

Hard 8s wall-clock cap so even huge games stay snappy. Errors clearly
if a game doesn't implement `legalActions` ("what-if needs API-8").

The UI renders a per-seat probability bar that animates in.

### #3 — Per-game ELO 📈

`Identity.getElo(gameId)` / `Identity.updateElo({gameId, winners, players})`.

Standard ELO (K=24, base 1200, floor 100), scaled by 1/(N-1) for multi-
player games. Ties split 50/50. Spectators skipped. Stored in
`localStorage` alongside everything else under `gh.identity.elo`.

Hooked into the existing recordGameResult flow in
`01-network-local.js` so every finished online game updates ratings
automatically. ELO chips appear on the menu next to your W–L stat
(only when a rating has moved off the base).

## What I did not touch

- **Authoritative server-side ratings.** ELO is currently client-side
  only — if the user clears localStorage, ratings reset. Promoting to
  a server-side store (per-pid in a Profile DO) is the natural next
  step but it's a real auth/migration question I'd want to scope with
  you before sinking time.
- **Per-game `scoreFrame` enrichments for highlights.** The hook is
  documented; concrete implementations (Skyjo triplet = highlight,
  Flip 7 FLIP 7! = highlight, Schotten claim = highlight) are a 1-day
  follow-up that's most useful AFTER you've watched a few real replays
  and seen what feels generic vs game-specific.
- **GitHub Actions workflow location.** Still at
  `GameHub/.github/workflows/ci.yml` where GitHub can't see it. My PAT
  lacks `workflow` scope. The fix (3 lines) is in
  `AGENT_SESSION_2026-06-12.md` from part 1.

## What you can try in production

1. **Schotten Totten** — drop a card, watch the stones light up with
   the new dashed-blue drop-target outline. Drop, watch the claim
   button appear on provably-claimable stones. Zero rule code touched
   the client; this is pure server-emitted hints.
2. **Any finished game** — share the replay URL, drag the scrubber
   to a yellow pip on the timeline, press **W**. Watch the simulator
   spin and tell you what *should* have happened.
3. **Win a few games** — check the menu for your new ELO chip per
   game. Lose some — watch it tick down.

## State of the codebase

- 218 tests across 21 files (+41 in this session)
- 3 JSDOM smokes (client, replay, landing) all green
- typecheck green
- The local validate:ci pipeline takes ~75s end-to-end
- The DX guide (`docs/MAKING_A_GAME.md`) is the single doc to read
  before adding a 5th game

# Schema-defined games — design (prototype)

> Foundation for the visual game creator. Goal: run a **brand-new game from pure
> data** (a JSON spec) with **no custom code**, as a normal `GameModule`. If data
> can define a working multiplayer game, the no-code editor and (human-reviewed)
> community submissions become safe + tractable. See `docs/FEATURE_FEASIBILITY.md`.

## Why this is safe on the free tier
A schema is **data, not code** — the hub never runs untrusted JS (the 10ms-CPU /
sandboxing nightmare we ruled out). The engine (`src/games/schema/engine.ts`) is
OUR audited code that *interprets* the spec. A malicious spec can at worst make a
boring/broken game; it can't execute arbitrary logic, hang the DO (loops are
bounded), or read other rooms.

## What v1 can express (the "press-your-luck / flip-and-score" family)
This first prototype targets one well-understood, popular pattern (a generalised
Flip 7 / can't-stop): **turn-based, draw-from-a-deck, push-your-luck, bank-or-bust,
first-to-target wins.** It deliberately does NOT try to express every board game.

A spec (`GameSpec`) declares:
- `meta`: id, name, description, icon/emoji, min/max players.
- `deck`: a list of `{ value, count }` number cards (the bag), shuffled per round.
- `turn`: `"sequential"` (one active player at a time).
- `actions`: which of the built-in verbs are enabled — `draw`, `stay`.
- `bust`: the lose-condition for a turn — currently `"duplicate"` (draw a number
  you already have this turn → bust, score 0 for the round).
- `bonus`: optional `{ uniqueCount, points }` — N distinct cards → instant bonus +
  end your turn (the "Flip 7" moment).
- `scoring`: `"sum"` of your kept cards, banked when you `stay` (or bust → 0).
- `win`: `{ target }` — first cumulative banked score ≥ target ends the game;
  highest total wins. Rounds repeat until then.

Everything else (networking, seats, hosting, spectators, bots' random-legal
fallback via `legalActions`, hibernation, Kit.Fit rendering) is the hub's, unchanged.

## The engine
`makeSchemaGame(spec): GameModule` returns the standard contract:
- `create(names)` → state `{ schemaVersion, spec id, players[], deck, current,
  round, phase, rng }` (JSON-serializable; uses the hub's seeded `rng`).
- `applyAction(state, seat, {action})` → handles `draw` / `stay`, applying bust /
  bonus / banking per the spec. Validates it's the seat's turn.
- `viewFor(state, seat)` → standard `GameView` + a generic `state` payload the
  generic schema client renders (each player's kept cards, live/ banked score,
  status, whose turn, deck count).
- `isOver`, `canStart`, `legalActions` (so bots can play it for free), `summarize`.

## The generic client
One renderer (`public/js/games/schema-game.js` → `GameClients['schema:*']`) draws
ANY schema game from its `viewFor` payload: opponent strips + a focus board of
your kept cards + a deck/discard + the enabled action buttons (via `Kit.Controls`,
so they obey the no-overlap + Kit.Fit contracts we just hardened). No per-game
client code — that's the whole point.

## Registration
Schema games live in `src/games/schema/specs/*.ts` (just data), are wrapped by
`makeSchemaGame`, and added to the registry like any other `GameModule`. The
sample shipped with the prototype is **"Septet"** (id `septet`) — a clean Flip-7-
style demo proving the pipeline end-to-end.

## Roadmap (after the prototype is proven)
1. ✅ Engine + one data-only sample game + tests (this prototype).
2. Generic schema client renderer wired into the catalogue.
3. More patterns (roll-and-mark grid; set-collect) as additional `kind`s.
4. The **visual editor** that writes a `GameSpec` (and a layout descriptor for
   Kit.Fit) — no code.
5. Submission + **human-review** queue for community specs (never auto-publish).

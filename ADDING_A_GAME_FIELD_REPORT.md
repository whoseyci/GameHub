# Field Report: Adding "Schotten Totten" — process, bloat, friction & API ideas

**Author:** Arena.ai Agent Mode
**Date:** 2026-06-10
**Goal:** Add a real new game (Schotten Totten) end-to-end and honestly document what
the workflow is like today — what's smooth, what's bloated, what's frustrating —
and propose what should become **shared, card-game-wide API** before we add more.

**Result:** Shipped the full base game (server engine + client UI + offline local
engine + easy/medium/hard bot + rules + tests). `npm run validate:ci` green:
**126 tests + client smoke + wrangler dry-run.**

---

## 1. The happy path (what's genuinely good)

`node scripts/scaffold-game.mjs --id=schotten --name="Schotten Totten" --emoji=🪨 --min=2 --max=2`

In one command the scaffold created **and wired**:
- `src/games/schotten/{meta,server,index}.ts` (contract-compliant stub)
- `src/games/schotten.ts` (compat re-export shim)
- `public/js/games/schotten.js` (client stub)
- `tests/schotten.test.ts`
- **auto-registered** in `src/games/registry.ts`
- **auto-added** the `<script>` to `public/index.html`

…and it **typechecked + passed its 3 contract tests out of the box.** That's a
strong baseline — the `GameModule` contract, `GameViewState`, `viewFor(seat)`
hidden-info model, `GameShell.renderTable`, `GameActions.send`, and `SeatModel`
focus are all real and reusable. Writing the *server* game logic was clean: pure
reducers over plain JSON state, no framework friction.

**Verdict:** the contract + scaffold are good. The pain is everywhere the scaffold
*stops*, and everywhere card-game logic/visuals get **re-implemented per game**.

---

## 2. Friction & bloat encountered (in order hit)

### F1 — Action protocol is a fixed field whitelist ⭐ (design loophole)
`src/protocol.ts` only forwards a hard-coded set of action fields:
`index, target, botSeat, seat, use, c, i`. Schotten's "place card on stone" needs
*card index* + *stone index*; I had to **overload generic names** (`index`=hand
card, `target`=stone). It worked, but:
- `target` means "stone" here, "player" in Flip 7, "row cell" elsewhere — fragile.
- A richer game (e.g. Schotten's **tactics** cards: choose color + value + 2
  targets) would **hit a wall** and have to edit the shared protocol file.

> **Fix idea:** allow a per-game **`payload` object** that the protocol passes
> through after the game validates it (the game's `applyAction` already re-validates
> everything). Keep the size cap + type guard, drop the field whitelist. See API-1.

### F2 — The offline "local engine" is a full duplicate of the server engine ⭐⭐ (biggest bloat)
To support pass-and-play, I had to **re-implement the entire rules engine in the
browser** (`SchottenEngine` in `public/js/games/schotten.js`) — deck build, deal,
place/claim/end, formation scoring, early-claim proof, win + stall detection. That's
~120 lines that are a line-for-line port of `src/games/schotten/server.ts`. This is
exactly the audit's **L1** (three copies of every game's rules: server, client,
training). Any rule change must be made twice and **can drift** (this is a recurring
source of past bugs).

> **Fix idea (highest ROI):** make the server `GameModule`s loadable in the browser
> and have `LocalEngines[id]` wrap the *same* module. Needs a tiny build step (or
> authoring the rules as plain `.mjs`). See API-2.

### F3 — Bots are NOT scaffolded (silent gap)
The scaffold wires everything *except* bots. I set `hasBots:true`, but there was no
`public/js/bots/schotten.js` and no `<script>` for it. If I'd shipped without
noticing, the lobby would offer "add bot" and **break at runtime**. I had to:
- hand-write the `BotStrategy` (`choose/needsBot/getActingSeat`),
- manually add `<script src="/js/bots/schotten.js">` to index.html **in the right
  order** (after `driver.js`, before `05-bots-init.js`).

> **Fix idea:** scaffold a bot stub + wire its script when `--bots` (or always),
> and have the parity test require a registered `BotStrategy` when `meta.features
> .hasBots` is true. See API-3.

### F4 — Per-game card/board CSS is hand-rolled every time
Skyjo has `.board-card`, Flip 7 has `.f7-card`, I added `.st-card` + `.st-hand` +
`.st-border`. Every card game reinvents: a card chip, a hand row, a selected-card
lift, a "droppable" highlight. ~30 lines of near-identical CSS per game.

> **Fix idea:** a shared `.kit-card` base + helpers (`.kit-hand`, `.kit-selectable`,
> `.kit-drop-target`) games extend with a color/size. See API-4.

### F5 — `Infinity` silently broke the JSON-serializable contract
I used `Infinity` as a "not yet full" sentinel; `JSON.stringify(Infinity)→null`, so
state round-trip failed. The contract *says* "JSON-serializable" but **nothing
enforced it** until the scaffolded serializability test caught it (good that it did,
but only because I kept that test). A new author who weakens that test would ship a
hibernation/replay corruption bug.

> **Fix idea:** keep the serializability assertion in the shared `game-contract`
> test (it already runs over all games) AND have it reject `Infinity/NaN/undefined`
> explicitly with a clear message. (Partly there; make the message actionable.)

### F6 — A genuine game-logic edge case (turn deadlock) only surfaced via bot self-play
A 2-bot game **stalled forever**: once the deck empties and neither side can place,
my `end` action required `placedThisTurn`, so the current player could never pass →
infinite loop. Not hub-specific, but: **there's no shared "turn can't proceed"
affordance**, and no harness that automatically plays bot-vs-bot to surface stalls.
I fixed it (allow `end` when no legal placement; end-by-stone-count when fully
stuck) and added tests, but I had to *build the self-play loop myself* to find it.

> **Fix idea:** a shared dev harness `playOut(gameId, difficulty)` that runs
> bot-vs-bot to completion and asserts it terminates (no infinite loop). See API-5.

### F7 — Three different conventions for "the game's state slice" (audit L5, confirmed)
Qwixx reads `view.state`; Skyjo `view.skyjo`; Flip 7 `view.flip7`. I followed the
namespaced style (`view.schotten`). The bot driver and hub scheduler both special-
case which to use. A new author must *guess* and tell every consumer. Picking one
(`view[gameId]` for game data, `view.state` for the standardized hub fields) would
remove the ambiguity.

### F8 — My own parity guard had two bugs (caught real things + had blind spots)
The parity test I added last session **correctly flagged** that the scaffold doesn't
update the hardcoded fallback `catalogue` in `00-core.js` (real loophole — fixed).
But it also had **two false-negatives**: (a) its regex only matched
`GameClients['id']` literals, not the scaffold's own `const ID='id'; GameClients[ID]`
form; (b) it scanned `public/js/*.js` **non-recursively**, missing scaffolded
clients in `public/js/games/`. So the very guard meant to validate scaffolded games
**couldn't see them.** Both fixed. (Lesson: the guard was written against built-ins,
never tested against a scaffolded game — adding this game *was* its first real test.)

### F9 — Manual catalogue duplication
The game catalogue exists twice: server `GAME_CATALOGUE` (authoritative, sent at
runtime) and a hardcoded fallback array in `00-core.js` (offline first paint). The
scaffold updates registry+index.html but not the fallback. Minor, but it's a
hand-mirrored list (the parity test now keeps it honest).

---

## 3. What should become shared card-game API (proposals)

Ranked by value for *future* games.

### API-1 — Pass-through action payloads (kills F1)
Replace the field whitelist in `protocol.ts` with: keep `action` (string, capped) +
a single validated `payload` (plain JSON, size-capped, depth-capped). The game's
`applyAction` is already the validation authority. Removes the "overload `target`"
hack and unblocks complex games (tactics, multi-target).

### API-2 — One rules engine, run everywhere (kills F2 + F7 + audit L1/L3)
Make `GameModule`s importable in the browser; `LocalEngines[id]` becomes a thin
generic adapter over the server module (the `apply/next/actor/viewFor` wrapper is
identical across games — it can be `LocalEngineFactory(module)`). Removes ~120
LOC/game of duplicated rules and makes local == online by construction. Requires a
small build/bundle step (the repo currently hand-loads global scripts — this is the
one real infra investment, flagged as P4 in the first review).

### API-3 — Scaffold + require bots (kills F3)
`scaffold-game.mjs` emits a `bots/<id>.js` stub registering a `BotStrategy`, wires
its `<script>`, and the parity test asserts `hasBots ⇒ a strategy is registered`.

### API-4 — Shared card visual kit (kills F4)
A `.kit-card` base class (chip shape, shadow, radius, responsive sizing) + `.kit-hand`
(fanned row), `.kit-selectable`/`.kit-selected` (lift), `.kit-drop-target`
(dashed highlight). Games set CSS vars (`--card-bg`, `--card-fg`) instead of
re-authoring geometry. Also: promote the common "render a row of cards into an
element" into `Kit.CardManager.renderHand(el, cards, {onPick})`.

### API-5 — Bot self-play test harness (kills F6)
`tests/` helper `playOut(module, {difficulty, maxTurns})` that loops the registered
bot strategy against itself and asserts the game **terminates** and produces a valid
terminal state. Run it for every `hasBots` game automatically — this would have
caught the Schotten deadlock before I did.

### API-6 — Standardize the view shape (kills F7)
Document + lint: game-specific payload always under `view[meta.id]`; hub-standard
fields (`state`, `summary`, `over`, `yourSeat`) own the cross-game shape. Update
Qwixx to match. Then delete the per-game branches in the bot driver/scheduler.

### API-7 — Single source for the catalogue (kills F9)
Have the client fetch the catalogue from the server on boot (it already does at
runtime); drop the hardcoded fallback or generate it from `GAME_CATALOGUE` at build.

---

## 4. Honest scorecard

| Step | Effort | Friction |
|---|---|---|
| Scaffold + server rules | Low | 🟢 smooth — contract is good |
| Action wiring | Low | 🟡 had to overload `target`/`index` (F1) |
| Server tests | Low | 🟢 + caught the `Infinity` bug (F5) |
| Client render | Medium | 🟡 hand-rolled CSS (F4) |
| **Local engine** | **High** | 🔴 full rules duplication (F2) |
| Bot | Medium | 🟡 not scaffolded; manual wiring (F3) |
| Finding the deadlock | Medium | 🔴 had to build self-play to find it (F6) |
| Parity/catalogue | Low | 🟡 my own guard had gaps (F8/F9) |

**Bottom line:** adding a game is **very doable** — the contract, scaffold, parity
guard, single animation system, and bot driver are real and they held up. The
**bloat is concentrated in one place: the client-side rules duplication (F2)**, with
a long tail of small papercuts (protocol whitelist, un-scaffolded bots, per-game CSS,
view-shape conventions). If we do **API-2** before adding more games, the next game
is roughly half the code and can't drift between local and online.

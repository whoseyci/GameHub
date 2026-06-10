# Shared Card-Game API — implementation report

**Author:** Arena.ai Agent Mode · **Date:** 2026-06-10

This documents the round of work that turned the *proposed* shared APIs (from
`ADDING_A_GAME_FIELD_REPORT.md`) into shipped infrastructure, plus a full UI/UX
redesign of Schotten Totten. Every item below is on `main`, with
`npm run validate:ci` green (134 unit tests + client smoke + wrangler dry-run) at
each commit.

---

## The headline: one rules engine, everywhere (API-2)

**Before:** every game's rules existed in *three* places — the server
`GameModule`, a hand-copied "local engine" in each client (`window.LocalEngines`),
and (for some) a `/training/*_sim.mjs`. They drifted.

**Now:** a real build step (`esbuild`) bundles the SAME server `GameModule`s into
the browser (`public/js/00-game-modules.js`, generated from `src/client-games.ts`).
Offline local play runs those exact modules through a generic adapter
(`makeLocalEngine`) that implements the small `{apply,next,actor,viewFor}` contract
the hub expects — and even drives the server `tick`/`completeTick` loop locally for
deferred resolutions (e.g. Skyjo's turn-end delay).

The per-game client "local engine" copies (Skyjo/Flip7/Qwixx/Schotten, ~400 LOC)
were **deleted**. There is one rulebook now.

**Build/CI:**
- `npm run build:client-games` regenerates the bundle (`--watch`, `--check`).
- `npm run check:client-games` (in `validate`/`validate:ci`) fails CI if the
  committed bundle is stale.
- `tsconfig.client.json` typechecks the DOM-context browser entry separately from
  the Cloudflare-Worker `tsconfig.json`.

> **CI note:** after pulling, run `npm run build:client-games` if you change any
> `src/games/**` rules — the freshness check will otherwise fail the build.

---

## The other APIs

| ID | What shipped |
|----|--------------|
| **API-1** | `protocol.ts` no longer hand-whitelists per-game action fields. A bounded generic `cleanPayload` (shallow primitives, capped keys, bounded strings, reserved-key protection) lets a new game send its own action fields without editing the parser. The game's `applyAction` stays the rule authority. |
| **API-3** | `scaffold-game.mjs` now also generates a bot strategy stub (`public/js/bots/<id>.js`), wires its `<script>`, and rebuilds the bundle. A parity guard with teeth: `meta.features.hasBots === true` ⇒ a loaded `BotDriver.register('<id>')` must exist. |
| **API-4** | Shared `.kit-card / .kit-hand / .kit-deck / .kit-drop` CSS — one card/board visual language (glossy suited cards, face-down back, selectable/selected/dim states, deck pile, drop zones). The Schotten redesign is built on it; future games reuse it. |
| **API-5** | `tests/self-play.test.ts` — a generic bot self-play / termination harness. For every registered game it drives 6 full games to completion with a brute-force explorer bot and asserts **no deadlock** + termination within a turn cap. (Caught the need for `next_round`/`target` handling; all four games terminate cleanly.) |
| **API-6** | Standardized on `view[gameId]` everywhere. Qwixx's renderer/bot read `view.qwixx` (was `view.state`, which collided with the standardized `GameViewState` the server already put there — a latent online bug, now fixed). |
| **API-7** | The browser catalogue is no longer a hand-maintained array in `00-core.js`; it is derived from the same registry the server uses, via the bundle (`window.GameCatalogue`). Adding a game to `registry.ts` is the only edit needed. |

### Cheap cleanups folded in
- **U2** — removed the hardcoded `if (view.game === 'skyjo')` from the bot driver. Strategies may expose `observe(view, seat)`; Skyjo's moved into its strategy. In local play, bots now act on their **own private view** (`localEngine.viewFor(seat)`), which fixed a latent bug where the Schotten bot couldn't see its own hand and always passed.
- **U4** — one typed `mapPhase()` in `games/types.ts` replaced four inconsistent per-game `lifecyclePhase()` copies.
- **L4** — shared `GameActions.act(seat, msg)` replaced the duplicated per-game internal `act()`.
- **Qwixx + Schotten** server modules now handle the `next_round` action (Play Again) so the generic adapter restarts them exactly like the hub does.

---

## Schotten Totten — UI/UX redesign (+ answers to "why no deck / no animations?")

Both observations were correct and are now fixed:

1. **No deck before** — the old client only printed a `deck N` *counter*; there was
   no visual pile, so drawn cards just appeared in hand from nowhere. There is now a
   real **deck pile** (`#stDeck`, the shared `.kit-deck`), and drawing **flies a
   face-down card from the deck into your hand** with a mid-flight reveal.
2. **Zero animations before** — the board used plain coloured `<div>`s and never
   touched the shared `CardManager`, so nothing moved. **Every card is now a
   permanent `Kit.CardManager` object** keyed by its intrinsic id, so:
   - **PLACE** flies the chosen card hand → stone (it keeps identity across zones),
   - **DRAW** flies deck → hand,
   - **CLAIM** pops the boundary stone with a flourish + float text —
   all on the same animation system as Skyjo and Flip 7.

The look matches the hub's modern dark/neon aesthetic: glossy suited clan cards,
carved circular stone markers (green ✓ / red ✕ when claimed), green drop targets,
and a score rail with deck pile.

A standalone, openable preview lives at the workspace root:
`schotten-redesign-preview.html` (self-contained, click a card → click a green slot
→ watch it fly; click the deck to draw).

Smoke coverage added (`smokeSchotten`): deck visible, 9 stones, hand of 6 as
CardManager cards, place flight lands on the stone, draw-on-end refills the hand,
anchors cleaned up on quit — plus a Schotten **bot-flow** assertion.

---

## Commit trail (all on `main`)

1. `API-2/API-6` — shared rules engine in the browser via a build step.
2. `API-7 + API-3` — single catalogue source; scaffold bots & enforce them.
3. `API-1 + API-5 + U2/U4/L4` — generic action payload, self-play harness, cleanups.
4. `API-4 + redesign` — shared card kit CSS + Schotten deck/animations.
5. Bot private-view fix (local bots act on their own `viewFor(seat)`).

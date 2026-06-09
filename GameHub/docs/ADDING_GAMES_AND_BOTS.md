# Adding games and training bots

This repo is set up so a capable agent can add a new turn-based game with minimal global edits.

## Fast path: scaffold a game

```bash
npm run scaffold:game -- --id=hearts --name="Hearts" --emoji=♥️ --min=3 --max=4
```

The scaffold creates:

| File | Purpose |
|---|---|
| `src/games/<id>.ts` | Server-authoritative `GameModule` |
| `public/js/games/<id>.js` | Browser renderer/action sender |
| `tests/<id>.test.ts` | Starter rule/contract tests |

It also registers the game in `src/games/registry.ts` and loads the client script from `public/index.html`.

Then run:

```bash
npm run validate
```

## Server game contract

Each game is a plain JSON state machine:

```ts
create(names)         // initial state
applyAction(state, seat, msg)
viewFor(state, seat) // personalized view; seat -1 is spectator
tick?(state)         // optional delayed server advance
joinScore?(state)
addPlayer?(state, name, score)
```

Rules:

1. State must be JSON-serializable.
2. Include `schemaVersion: 1`.
3. Use `src/rng.ts` for randomness and store `rngState` in state.
4. Never leak hidden information in `viewFor()`.
5. Invalid actions should return without mutation.

## Frontend client contract

Build one renderer for both online multiplayer and local multiplayer. The shared
`GameShell` owns cross-game lifecycle cleanup and the shared `SeatModel` owns the
"which seats does this device control?" model. A game should not decide global
cleanup or bot/human focus by itself unless it is rendering a game-specific event.

Use `GameShell.renderTable({ opponents, center, focus, status, topMode })` for new games instead of directly mutating `miniBoardsContainer`, `topArea`, `mainBoardsContainer`, and `statusBar`. Existing games now route their main table regions through this shell so stale UI from another game is cleaned up automatically.

A browser client registers itself as:

```js
window.GameClients['hearts'] = {
  render(view) {},
  act(action, extra) {},
};
```

The recommended view shape is a **table view**:

```js
{
  game: 'hearts',
  yourSeat: 2,              // in local mode this should be whose turn it is
  hearts: {
    activeSeat: 2,
    allPlayers: [ ... ],    // enough public info to draw small opponent boards
    yourPrivateInfo: ...    // only the viewer/actor's secrets
  }
}
```

Render one full board for `view.yourSeat`/focused seat and compact clickable boards
for opponents. In local multiplayer, `localEngine.actor()` should return the seat
whose board should be shown full-size; this makes local and online use the same UI.
See `docs/MOBILE_GAME_VIEW_GUIDE.md` for the miniature-board contract and no-scroll
in-game layout rules.

Optional offline/local play:

```js
window.LocalEngines['hearts'] = function(names) {
  return { apply, next, actor, viewFor };
};
```

Use existing helpers:

- `Kit.CardRegistry.create/place/move/flip/reveal/hide/remove/sync/clear` when a card must feel like one persistent visual object across zones/renders
- `Kit.Card.move(cardIdOrOpts, opts?)` for one-off card transfer; accepts generic values or custom `render(card)`/`backHTML` for game-specific card art
- `Kit.Card.moveToSlot(...)` and `Kit.Card.reserveSlot(...)` for ordered rows where existing cards must slide aside before arrival
- `Kit.Card.flip/reveal/hide/bounce/tilt/untilt/shake/glow/stack/discard/trigger` for lower-level card object animation
- `Kit.CardEffects.triplet/bust/secondChance/actionTransfer` for common composed effects
- `Kit.EventRunner.run(events, handler)` for sequential event playback
- `Kit.CardMotion.move(cardId, fromEl, toEl, opts)` only as the low-level primitive behind `Kit.Card.move`
- `SFX` for sound
- `showSummary(view)` for end screens
- `removeQwixxUi()` / game cleanup helpers when entering a renderer

## Card-object / animation sequencing rule

For card games, treat every visible card transfer as a motion of a logical card object.
Do not update focus/effects in the middle of that motion. The standard event order is:

```text
engine emits normalized event -> EventRunner queues it -> previous visible state -> focus source -> reveal if needed -> Kit.CardMotion.move(...) -> apply event to shadow state -> redraw shadow state -> effect/score/target prompt -> next event
```

Preferred normalized event types:

```text
deck.wiggle
card.deal
card.transfer
effect.bust
effect.second_used
effect.flip7
effect.freeze_done
effect.stay
target.prompt
effect.round_end / effect.game_over
```

Avoid game-specific raw event names in new games. If legacy events exist, normalize them at the engine boundary before they reach the client runner.

Guidelines:

1. Give each motion a stable `cardId`, usually `${game}:${eventSeq}:<kind>`.
2. Use `Kit.CardMotion.move(...)` instead of ad-hoc CSS transitions.
3. Keep the board focus locked to the acting/source player while the card is moving.
4. Only after arrival should the game show busts, score changes, target prompts, or next-player focus.
5. If an action card targets another player, first deal it to the revealer, then animate board-to-board, then apply target effects.

This prevents one card appearing in multiple places or local pass-and-play switching to
the next player before the current animation has completed.

## Bot training path

For heuristic bots, add a branch to `Bots.choose()` in `public/js/05-bots-init.js`.

For small neural-net bots:

1. Create a deterministic simulator, ideally under `training/<game>_sim.mjs`.
2. Copy `training/train_new_game_nn_template.mjs` to `training/train_<game>_nn.mjs`.
3. Implement:
   - `encode(state, seat)` -> normalized feature vector
   - legal action generation
   - match evaluation vs baseline bots
4. Train with the dependency-free utilities in `training/nn.mjs`.
5. Save the resulting policy JSON in `training/<game>_policy.json`.
6. Paste/embed the compact policy in the browser bot module or load it as a static asset.

Keep neural nets small: one hidden layer of 8–32 units is usually enough for casual card/dice bots and remains easy to ship to browsers.

## Required gate

Before committing:

```bash
npm run validate
```

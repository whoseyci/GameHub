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

Build one renderer for both online multiplayer and local multiplayer. A browser
client registers itself as:

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

Optional offline/local play:

```js
window.LocalEngines['hearts'] = function(names) {
  return { apply, next, actor, viewFor };
};
```

Use existing helpers:

- `Kit` for card animation/visuals
- `SFX` for sound
- `showSummary(view)` for end screens
- `removeQwixxUi()` / game cleanup helpers when entering a renderer

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

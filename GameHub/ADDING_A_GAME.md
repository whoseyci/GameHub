# Adding a new game to the Hub

The hub is built so a new game **cannot break existing ones**. You only add files
and two registry lines. The hub handles networking, rooms, hosting, spectators,
matchmaking, hibernation, and the shared look/feel.

## The two halves of a game

A game = **server module** (authoritative rules) + **client module** (renders the
view + sends input). They communicate through one personalized object: the `view`.

```
src/games/<id>.ts        # server: implements GameModule (see src/games/types.ts)
src/games/registry.ts    # add: GAMES[id] = YourGame  (+ TICK_RUNNERS if you use tick())
public/index.html        # client: add window.GameClients['<id>'] = { render(view) }
                         #         (+ window.LocalEngines['<id>'] for offline play)
```

## Server side — implement `GameModule` (src/games/types.ts)

```ts
export const Hearts: GameModule = {
  meta: { id:"hearts", name:"Hearts", minPlayers:3, maxPlayers:4,
          description:"Avoid the hearts.", emoji:"♥️" },
  create(names){ return { /* plain JSON state */ }; },
  applyAction(state, seat, msg){ /* validate seat===whose turn, mutate state */ },
  viewFor(state, seat){ return { game:"hearts", phase, over, yourSeat:seat,
                                 summary, hearts:/* personalized snapshot */ }; },
  isOver(state){ return state.phase==="OVER"; },
  // optional:
  tick(state){ return state.needsAdvance ? 1000 : null; },  // server-driven delay
  joinScore(state){ return avgScore(state); },              // late-joiner start score
  addPlayer(state,name,score){ /* seat a late joiner */ },
};
```

Rules (enforced by convention — keep them and games stay isolated):
1. **State is plain JSON** (no class instances/functions/Dates). Persisted every change.
2. `viewFor` **hides other players' secrets** — deal a personalized snapshot.
3. Put game-specific data under a namespaced key (`view.hearts = …`) so the hub's
   shared fields (`phase`, `over`, `yourSeat`, `summary`) never clash.
4. Set `over:true` + `summary:{rows,winners}` at the end → the hub shows results to
   everyone and offers New Game / Next Round / Back to Room automatically.

Register it:
```ts
// src/games/registry.ts
import { Hearts } from "./hearts";
export const GAMES = { [Skyjo.meta.id]:Skyjo, [Hearts.meta.id]:Hearts };
// if Hearts uses tick(): TICK_RUNNERS["hearts"] = heartsAdvance;
```

## Client side — render the view + send input (public/index.html)

Reuse the **Card Kit** (`window.Kit`) and **SFX** so every game looks/feels the same:
`Kit.flyCard`, `Kit.flyToHeld`, `Kit.dealCascade`, `Kit.floatText`, `Kit.turnBanner`,
`Kit.confetti`, `Kit.cardColor`; and `SFX.draw/flip/reveal/swap/good/bad/win/...`.

```js
window.GameClients['hearts'] = {
  render(view){
    const s = view.hearts;          // your personalized snapshot
    // draw to #mainBoardsContainer / #miniBoardsContainer / #topArea using
    // the shared .card-slot / .board-card classes so it matches the theme.
    // send moves with: net.send({type:'action', action:'play', card:42})
    // the shared end screen appears automatically when view.summary is set.
  }
};
// optional offline play:
window.LocalEngines['hearts'] = function(names){ return { apply, next, actor, viewFor }; };
```

Then add it to the catalogue tile list — actually you don't need to: the server sends
its `catalogue` (from `GAME_CATALOGUE`) to the client, so your game appears in the
Quick Play and room pickers automatically once it's in `GAMES`.

## Why existing games are safe
- Each game's logic lives in its own file; the hub only calls the interface methods.
- The registry is additive. Removing or breaking a game you didn't touch is impossible
  unless you edit its file.
- Shared visuals live in the Card Kit, so restyling is centralized — no per-game
  redesign needed.

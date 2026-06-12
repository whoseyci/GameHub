// tests/replay-capture.test.ts — replay capture/rehydration contract.
//
// Verifies that a ReplayBundle built incrementally as a game is played can be
// rehydrated frame-perfect by a fresh client. This is the contract the public
// /api/replay/<code>/<id> endpoint and the client-side scrubber rely on.
//
// Why this matters: the only reason replay URLs are cheap to ship is because
// the engines are deterministic (proved by tests/replay-determinism). This
// test pins down the *capture* half of the loop.

import { describe, expect, it } from "vitest";
import { GAMES } from "../src/games/registry";
import {
  newReplayBundle, pushAction, freezeReplay, REPLAY_MAX_ACTIONS,
} from "../src/replay-capture";
import type { GameAction, GameModule } from "../src/games/types";

function namesFor(game: GameModule): string[] {
  return Array.from({ length: Math.max(2, game.meta.minPlayers) }, (_, i) => `P${i + 1}`);
}

// Same fuzzer shape as tests/replay-determinism — produce a deterministic, legal
// log of *effective* actions for a given game starting from `state`.
function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function buildLog(game: GameModule, state: any, seed: number, maxActions = 60): GameAction[] {
  const names = namesFor(game);
  const types = game.meta.actionTypes ?? [];
  const rand = mulberry(seed);
  const log: GameAction[] = [];
  const colors = ["red", "yellow", "green", "blue"];
  for (let i = 0; i < maxActions; i++) {
    if (game.isOver(state)) break;
    const before = JSON.stringify(state);
    let mutated = false;
    for (let attempt = 0; attempt < 40 && !mutated; attempt++) {
      const seat = Math.floor(rand() * names.length);
      const action = types[Math.floor(rand() * types.length)] ?? "noop";
      for (let idx = 0; idx < 13 && !mutated; idx++) {
        const msg: GameAction = {
          action, seat,
          index: idx, target: idx % 9, i: idx % 11,
          c: colors[Math.floor(rand() * 4)],
        };
        (msg as any).__seat__ = seat;
        game.applyAction(state, seat, msg);
        if (JSON.stringify(state) !== before) { log.push(msg); mutated = true; }
      }
    }
    if (!mutated) break;
  }
  return log;
}

describe("Replay capture", () => {
  for (const game of Object.values(GAMES)) {
    it(`${game.meta.id}: a captured bundle replays to the same final state`, () => {
      const names = namesFor(game);
      const initial = game.create(names);

      // Build a deterministic log against a throwaway state copy.
      const fuzzState = JSON.parse(JSON.stringify(initial));
      const log = buildLog(game, fuzzState, 4242);
      expect(log.length, `${game.meta.id} produced no effective actions`).toBeGreaterThan(0);

      // Capture path: start from a fresh copy, apply each action and push into bundle.
      const live = JSON.parse(JSON.stringify(initial));
      const bundle = newReplayBundle({
        roomCode: "TESTROOM",
        gameId: game.meta.id,
        names,
        bots: names.map(() => false),
        initialState: live,
        counter: 1,
      });
      let seq = 0;
      for (const msg of log) {
        const seat = (msg as any).__seat__ | 0;
        game.applyAction(live, seat, msg);
        seq += 1;
        pushAction(bundle, seat, msg, seq);
      }
      freezeReplay(bundle, { winners: [], rows: [] });

      // Rehydrate path: only initialState + actions[] survive a serialize hop.
      const wire = JSON.parse(JSON.stringify(bundle));
      const rehydrated = JSON.parse(JSON.stringify(wire.initialState));
      for (const a of wire.actions) {
        game.applyAction(rehydrated, a.seat | 0, a.msg);
      }
      // The capture and rehydrated states must be byte-identical to the live state.
      expect(JSON.stringify(rehydrated)).toBe(JSON.stringify(live));
    });
  }

  it("captures action payloads by value, so post-push mutation can't corrupt the replay", () => {
    const g = Object.values(GAMES)[0];
    const initial = g.create(namesFor(g));
    const bundle = newReplayBundle({
      roomCode: "X", gameId: g.meta.id, names: namesFor(g), bots: [false, false],
      initialState: initial, counter: 1,
    });
    const msg: GameAction = { action: "noop", index: 7 };
    pushAction(bundle, 0, msg, 1);
    (msg as any).index = 999; // mutate the original
    expect((bundle.actions[0].msg as any).index).toBe(7);
  });

  it("safety belt: refuses to grow past REPLAY_MAX_ACTIONS", () => {
    const g = Object.values(GAMES)[0];
    const initial = g.create(namesFor(g));
    const bundle = newReplayBundle({
      roomCode: "X", gameId: g.meta.id, names: namesFor(g), bots: [false, false],
      initialState: initial, counter: 1,
    });
    for (let i = 0; i < REPLAY_MAX_ACTIONS + 50; i++) {
      pushAction(bundle, 0, { action: "noop" }, i + 1);
    }
    expect(bundle.actions.length).toBe(REPLAY_MAX_ACTIONS);
  });

  it("freezeReplay stamps endedAt + summary so the index can show it", () => {
    const g = Object.values(GAMES)[0];
    const initial = g.create(namesFor(g));
    const bundle = newReplayBundle({
      roomCode: "X", gameId: g.meta.id, names: namesFor(g), bots: [false, false],
      initialState: initial, counter: 1,
    });
    freezeReplay(bundle, { winners: [1], rows: [{ seat: 0, name: "A", score: 12 }, { seat: 1, name: "B", score: 3 }] });
    expect(bundle.endedAt).toBeTypeOf("number");
    expect(bundle.finalSummary?.winners).toEqual([1]);
  });
});

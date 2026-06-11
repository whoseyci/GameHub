// tests/replay-determinism.test.ts — replay determinism (Proposal 5, cherry-picked)
//
// For every game: take a single seeded initial state, deep-clone it, then apply the
// SAME random-but-deterministic action log to both copies and assert their final
// states are byte-identical. This catches RNG drift, mutation-order bugs, and any
// non-deterministic wall-clock/Math.random reads inside applyAction().
import { describe, expect, it } from "vitest";
import { GAMES } from "../src/games/registry";
import type { GameModule, GameAction } from "../src/games/types";

function namesFor(game: GameModule): string[] {
  return Array.from({ length: Math.max(2, game.meta.minPlayers) }, (_, i) => `P${i + 1}`);
}
function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Drive a deterministic log of *effective* actions (each one actually mutated state).
function buildLog(game: GameModule, state: any, seed: number, maxActions = 120): GameAction[] {
  const names = namesFor(game);
  const actionTypes = game.meta.actionTypes ?? [];
  const rand = mulberry(seed);
  const log: GameAction[] = [];
  const colors = ["red", "yellow", "green", "blue"];
  for (let i = 0; i < maxActions; i++) {
    if (game.isOver(state)) break;
    const before = JSON.stringify(state);
    let mutated = false;
    // Try several seats × actions, and for each, SWEEP the index/slot/colour space
    // so we reliably hit a legal move (e.g. a Skyjo reveal needs a specific cell).
    for (let attempt = 0; attempt < 40 && !mutated; attempt++) {
      const seat = Math.floor(rand() * names.length);
      const action = actionTypes[Math.floor(rand() * actionTypes.length)] ?? "noop";
      for (let idx = 0; idx < 13 && !mutated; idx++) {
        const msg: GameAction = {
          action, seat,
          index: idx, target: idx % 9, i: idx % 11,
          c: colors[Math.floor(rand() * 4)],
        };
        game.applyAction(state, seat, msg);
        if (JSON.stringify(state) !== before) { log.push(msg); mutated = true; }
      }
    }
    if (!mutated) break; // stuck — no further legal action found by fuzzing
  }
  return log;
}

describe("Replay determinism (Proposal 5)", () => {
  for (const game of Object.values(GAMES)) {
    it(`${game.meta.id}: identical final state when the same log is replayed`, () => {
      const names = namesFor(game);
      const initial = game.create(names);
      // clone the seeded initial state BEFORE driving anything (create() seeds RNG
      // from entropy, so we must replay from the SAME snapshot, not a fresh create)
      const a = JSON.parse(JSON.stringify(initial));
      const b = JSON.parse(JSON.stringify(initial));
      const log = buildLog(game, JSON.parse(JSON.stringify(initial)), 2024);
      expect(log.length, `${game.meta.id} produced no effective actions`).toBeGreaterThan(0);
      for (const msg of log) {
        game.applyAction(a, (msg as any).seat | 0, msg);
        game.applyAction(b, (msg as any).seat | 0, msg);
      }
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it(`${game.meta.id}: meta.actionTypes is declared and non-empty`, () => {
      expect(Array.isArray(game.meta.actionTypes)).toBe(true);
      expect((game.meta.actionTypes ?? []).length).toBeGreaterThan(0);
    });
  }
});

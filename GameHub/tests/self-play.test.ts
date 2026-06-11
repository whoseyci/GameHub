// self-play.test.ts — API-5: a generic bot self-play / termination harness.
//
// For every registered game, drive a full game to completion using a brute-force
// "explorer bot" that tries a bounded space of candidate actions each turn and
// applies the first one that ADVANCES the state. This proves two things that are
// easy to regress when adding games or refactoring rules:
//   1. The game cannot DEADLOCK (every reachable state has a progressing move, or
//      the game is already over).
//   2. The game TERMINATES (reaches isOver) within a sane number of turns.
//
// The harness is deterministic given a seed offset (it shuffles candidate order
// with a small PRNG) and runs several games per module to exercise many lines.
import { describe, expect, it } from "vitest";
import { GAMES } from "../src/games/registry";
import type { GameModule } from "../src/games/types";

// A bounded candidate action space. We don't know each game's exact action set,
// so we enumerate the cross-product of common verbs × small indices/targets and
// the Qwixx color/use fields. applyAction validates everything; illegal combos are
// simply no-ops, so trying many is safe.
const VERBS = [
  "reveal", "draw_deck", "take_discard", "swap", "discard_drawn", "reveal_after_discard", "tiebreaker", // skyjo
  "hit", "stay", "target", // flip7 (target = choose a freeze/flip3/second-chance target)
  "mark", "skip", "finishTurn", // qwixx
  "place", "claim", "end", // schotten
  "next_round", // shared: advance to the next round / restart after ROUND_END
];
const COLORS = ["red", "yellow", "green", "blue"];

function* candidates() {
  for (const action of VERBS) {
    if (action === "mark") {
      for (const c of COLORS) for (let i = 0; i < 12; i++) for (const use of ["white", "color"]) {
        yield { action, c, i, use };
      }
    } else if (action === "place" || action === "swap" || action === "reveal" || action === "reveal_after_discard" || action === "tiebreaker") {
      for (let index = 0; index < 12; index++) for (let target = 0; target < 9; target++) yield { action, index, target };
    } else if (action === "claim" || action === "target") {
      for (let target = 0; target < 9; target++) yield { action, target };
    } else {
      yield { action };
    }
  }
}
const CANDIDATES = [...candidates()];

// tiny deterministic PRNG so candidate order varies per game but is reproducible.
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled<T>(arr: T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Run the game's tick→completeTick loop synchronously to flush deferred steps.
function flushTicks(module: GameModule, state: any) {
  if (!module.tick || !module.completeTick) return;
  let guard = 0;
  while (guard++ < 50) {
    const delay = module.tick(state);
    if (delay == null) break;
    module.completeTick(state);
  }
}

// Stable signature of a state to detect "did this action advance anything?".
// Hash the FULL game state (it is, by contract, JSON-serializable) so even subtle
// mutations (a card moved, a counter bumped) count as progress.
function sig(_module: GameModule, state: any): string {
  try {
    return JSON.stringify(state);
  } catch {
    return String(Date.now());
  }
}

function playOut(module: GameModule, names: string[], seed: number, maxTurns = 4000) {
  let state = module.create(names);
  flushTicks(module, state);
  let turns = 0;
  while (!module.isOver(state) && turns < maxTurns) {
    const view = module.viewFor(state, -1);
    // Whose turn(s)? Even when the view names a single currentSeat, some phases
    // need OTHER seats to act too (e.g. Skyjo's simultaneous REVEAL, Qwixx's white
    // phase). So always consider every seat, just try the named one first.
    const cs = view.state?.currentSeat ?? 0;
    const seats = cs >= 0 ? [cs, ...names.map((_, i) => i).filter((i) => i !== cs)] : names.map((_, i) => i);

    let progressed = false;
    const before = sig(module, state);
    outer: for (const seat of seats) {
      for (const cand of shuffled(CANDIDATES, mulberry32(seed + turns + seat))) {
        const snapshot = sig(module, state);
        module.applyAction(state, seat, cand);
        flushTicks(module, state);
        if (sig(module, state) !== snapshot) { progressed = true; break outer; }
      }
    }
    // For simultaneous games, the per-seat attempt above may each advance; if
    // nothing changed across all seats AND it's not over, the game is stuck.
    if (!progressed) {
      // One more chance: maybe a tick advances it.
      flushTicks(module, state);
      if (sig(module, state) === before) {
        return { over: module.isOver(state), turns, stuck: true };
      }
    }
    turns++;
  }
  return { over: module.isOver(state), turns, stuck: false };
}

describe("bot self-play termination (API-5)", () => {
  for (const id of Object.keys(GAMES)) {
    const module = GAMES[id];
    const n = Math.max(module.meta.minPlayers, 2);
    const names = Array.from({ length: n }, (_, i) => `P${i + 1}`);
    // This random self-play fuzzes 6 full games and hashes the ENTIRE state
    // (JSON.stringify) every turn, so it can take ~4–5s under parallel CPU load —
    // right at vitest's 5000ms default, which made it flaky in the full suite (it
    // always passed in isolation). The outcomes are seeded/deterministic; only the
    // wall-clock was the issue. Give it a generous timeout so CI is stable.
    it(`${id}: terminates without deadlock across several games`, () => {
      for (let g = 0; g < 6; g++) {
        const result = playOut(module, names, 1000 + g * 7);
        expect(result.stuck, `${id} game ${g} DEADLOCKED at turn ${result.turns}`).toBe(false);
        expect(result.over, `${id} game ${g} did not terminate within turn cap (turns=${result.turns})`).toBe(true);
      }
    }, 20000);
  }
});

// legal-actions.test.ts — pins the API-8 contract.
//
// Games that implement module.legalActions(state, seat) get free client-side
// legality hints via view.state.legal — but the hint is only useful if it's
// honest. This test enforces:
//
//   1) Pure read — legalActions() must NEVER mutate state.
//   2) Off-turn safety — returns [] for seats that can't act right now,
//      so client hint UIs never light up the wrong board.
//   3) Soundness — every returned action is in fact accepted by applyAction
//      (otherwise the hint lies, and the bot fallback breaks).
//   4) Hub bound — the hub caps the array at MAX_LEGAL_ACTIONS (verified
//      indirectly by the registry — we just lock the constant).
//
// Games that DON'T implement legalActions are skipped (the API is optional).

import { describe, expect, it } from "vitest";
import { GAMES } from "../src/games/registry";
import { MAX_LEGAL_ACTIONS } from "../src/games/types";

function namesFor(g: any): string[] {
  return Array.from({ length: Math.max(2, g.meta.minPlayers) }, (_, i) => `P${i + 1}`);
}

describe("legalActions (API-8 contract)", () => {
  it("MAX_LEGAL_ACTIONS is a sane upper bound (sanity)", () => {
    expect(MAX_LEGAL_ACTIONS).toBeGreaterThan(8);
    expect(MAX_LEGAL_ACTIONS).toBeLessThanOrEqual(1024);
  });

  for (const game of Object.values(GAMES)) {
    if (!game.legalActions) {
      it.skip(`${game.meta.id}: opts out of legalActions (skipped)`, () => {});
      continue;
    }
    describe(game.meta.id, () => {
      it("does not mutate state when enumerating legal actions", () => {
        const state = game.create(namesFor(game));
        const before = JSON.stringify(state);
        for (let s = -1; s < state.players.length; s++) {
          game.legalActions!(state, s);
        }
        expect(JSON.stringify(state)).toBe(before);
      });

      it("returns [] for seats that aren't currently acting", () => {
        const state = game.create(namesFor(game));
        const v = game.viewFor(state, 0);
        const current = v.state?.currentSeat ?? -1;
        if (current < 0) return; // simultaneous-turn game; off-turn semantics differ
        for (let s = 0; s < state.players.length; s++) {
          if (s === current) continue;
          const legal = game.legalActions!(state, s) || [];
          expect(legal, `seat ${s} is not current but got ${legal.length} 'legal' actions`).toEqual([]);
        }
      });

      it("every returned action is accepted by applyAction (no fake hints)", () => {
        const state = game.create(namesFor(game));
        const v = game.viewFor(state, 0);
        const current = v.state?.currentSeat ?? -1;
        if (current < 0) return;
        const legal = game.legalActions!(state, current) || [];
        // Sample at most 8 (some games have huge legal sets and applyAction
        // is fast but not free; sampling is enough to catch staleness bugs).
        const sample = legal.slice(0, 8);
        for (const msg of sample) {
          const clone = JSON.parse(JSON.stringify(state));
          const beforeStr = JSON.stringify(clone);
          game.applyAction(clone, current, msg);
          // Accepted = state actually changed (or game ended). A no-op means
          // the hint was wrong about it being legal.
          const afterStr = JSON.stringify(clone);
          expect(afterStr !== beforeStr || game.isOver(clone),
            `${game.meta.id}: legalActions returned ${JSON.stringify(msg)} but applyAction left state unchanged`,
          ).toBe(true);
        }
      });
    });
  }
});

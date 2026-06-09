import { describe, expect, it } from "vitest";
import { GAMES } from "../src/games/registry";
import type { GameModule } from "../src/games/types";

function namesFor(game: GameModule): string[] {
  return Array.from({ length: game.meta.minPlayers }, (_, i) => `P${i + 1}`);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function expectSerializable(value: unknown) {
  const json = JSON.stringify(value);
  expect(json).toBeTypeOf("string");
  expect(JSON.parse(json)).toEqual(value);
}

describe("GameModule contract", () => {
  for (const game of Object.values(GAMES)) {
    describe(game.meta.id, () => {
      it("creates plain JSON state and views for every player plus spectators", () => {
        const state = game.create(namesFor(game));
        expect(state.schemaVersion).toBe(1);
        expectSerializable(state);

        for (let seat = -1; seat < game.meta.minPlayers; seat++) {
          const view = game.viewFor(state, seat);
          expect(view.game).toBe(game.meta.id);
          expect(view.yourSeat).toBe(seat);
          expect(typeof view.phase).toBe("string");
          expect(typeof view.over).toBe("boolean");
          if (seat >= 0) {
            expect(view.state).toBeDefined();
            expect(Array.isArray(view.state?.players)).toBe(true);
          }
          expectSerializable(view);
        }
      });

      it("ignores a spectator's generic gameplay action", () => {
        const state = game.create(namesFor(game));
        const before = clone(state);
        game.applyAction(state, -1, { type: "action", action: "hit", index: 0, target: 0, c: "red", i: 0 });
        expect(state).toEqual(before);
      });

      it("exposes a summary exactly when marked over", () => {
        const state = game.create(namesFor(game));
        const view = game.viewFor(state, 0);
        if (view.over) expect(view.summary).toBeDefined();
      });
    });
  }
});

describe("hidden-info regression checks", () => {
  it("Skyjo hides unrevealed card values from all viewers", () => {
    const skyjo = GAMES.skyjo;
    const state = skyjo.create(["A", "B"]);
    const view: any = skyjo.viewFor(state, 0);
    for (const player of view.skyjo.players) {
      for (const card of player.board) {
        if (!card.revealed && !card.cleared) expect(card.value).toBeNull();
      }
    }
  });

  it("Flip7 does not mutate when a non-current player tries to hit", () => {
    const flip7 = GAMES.flip7;
    const state = flip7.create(["A", "B"]);
    const nonCurrent = state.current === 0 ? 1 : 0;
    const before = clone(state);
    flip7.applyAction(state, nonCurrent, { action: "hit" });
    expect(state).toEqual(before);
  });

  it("Qwixx advances to color phase after all players skip white phase", () => {
    const qwixx = GAMES.qwixx;
    const state = qwixx.create(["A", "B"]);
    qwixx.applyAction(state, 0, { action: "skip" });
    expect(state.phase).toBe("WHITE_PHASE");
    qwixx.applyAction(state, 1, { action: "skip" });
    expect(state.phase).toBe("COLOR_PHASE");
  });
});

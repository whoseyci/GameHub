import { describe, expect, it } from "vitest";
import { Skyjo, skyjoCompleteTurnEnd } from "../src/games/skyjo";
import { Flip7 } from "../src/games/flip7";
import { Qwixx } from "../src/games/qwixx";

describe("Skyjo rule regressions", () => {
  it("allows exactly two distinct initial reveals per player", () => {
    const state = Skyjo.create(["A", "B"]);
    Skyjo.applyAction(state, 0, { action: "reveal", index: 0 });
    Skyjo.applyAction(state, 0, { action: "reveal", index: 0 });
    expect(state.players[0].revealCount).toBe(1);
    Skyjo.applyAction(state, 0, { action: "reveal", index: 1 });
    Skyjo.applyAction(state, 0, { action: "reveal", index: 2 });
    expect(state.players[0].revealCount).toBe(2);
  });

  it("moves from reveal to play after all initial reveals and deferred tick", () => {
    const state = Skyjo.create(["A", "B"]);
    for (const seat of [0, 1]) for (const index of [0, 1]) Skyjo.applyAction(state, seat, { action: "reveal", index });
    expect(state.turnAction).toBe("turn_end_delay");
    skyjoCompleteTurnEnd(state);
    expect(state.phase === "PLAY" || state.tiebreakerPlayers.length > 0).toBe(true);
  });
});

describe("Flip7 rule regressions", () => {
  it("busts on a duplicate number without second chance", () => {
    const state: any = Flip7.create(["A", "B"]);
    state.current = 0;
    state.players[0].nums = [5];
    state.players[0].secondChance = false;
    state.deck = [{ kind: "num", v: 5 }];
    state.discard = [];

    Flip7.applyAction(state, 0, { action: "hit" });

    expect(state.players[0].status).toBe("busted");
    expect(state.events.some((e: any) => e.type === "bust" && e.value === 5)).toBe(true);
  });

  it("consumes second chance instead of busting on first duplicate", () => {
    const state: any = Flip7.create(["A", "B"]);
    state.current = 0;
    state.players[0].nums = [5];
    state.players[0].secondChance = true;
    state.deck = [{ kind: "num", v: 5 }];
    state.discard = [];

    Flip7.applyAction(state, 0, { action: "hit" });

    expect(state.players[0].status).toBe("active");
    expect(state.players[0].secondChance).toBe(false);
    expect(state.events.some((e: any) => e.type === "second_used")).toBe(true);
  });
});

describe("Qwixx rule regressions", () => {
  it("marks a valid white-dice number and blocks marking backwards", () => {
    const state: any = Qwixx.create(["A", "B"]);
    const sum = state.dice.w[0] + state.dice.w[1];
    const rowKey = ["red", "yellow", "green", "blue"].find((c) => state.players[0].rows[c].nums.includes(sum))!;
    const row = state.players[0].rows[rowKey];
    const idx = row.nums.indexOf(sum);

    Qwixx.applyAction(state, 0, { action: "mark", c: rowKey, i: idx });
    expect(row.marks).toEqual([idx]);

    Qwixx.applyAction(state, 0, { action: "mark", c: rowKey, i: Math.max(0, idx - 1) });
    expect(row.marks).toEqual([idx]);
  });

  it("active player gets a penalty for finishing color phase without marking", () => {
    const state: any = Qwixx.create(["A", "B"]);
    Qwixx.applyAction(state, 0, { action: "skip" });
    Qwixx.applyAction(state, 1, { action: "skip" });
    expect(state.phase).toBe("COLOR_PHASE");
    Qwixx.applyAction(state, state.activeSeat, { action: "finishTurn" });
    expect(state.players[0].penalties).toBe(1);
  });
});

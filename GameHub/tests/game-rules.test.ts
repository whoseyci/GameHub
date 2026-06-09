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
  it("emits normalized event schema for a normal hit", () => {
    const state: any = Flip7.create(["A", "B"]);
    state.current = 0;
    state.players[0].nums = [];
    state.players[0].mods = [];
    state.players[0].tableau = [];
    state.players[0].secondChance = false;
    state.players[0].status = "active";
    state.deck = [{ id: "test_num_9", kind: "num", v: 9 }];
    state.discard = [];

    Flip7.applyAction(state, 0, { action: "hit" });

    expect(state.events.map((e: any) => e.type)).toContain("deck.wiggle");
    expect(state.events.some((e: any) => e.type === "card.deal" && e.card.v === 9 && e.actor === 0)).toBe(true);
  });

  it("busts on a duplicate number without second chance", () => {
    const state: any = Flip7.create(["A", "B"]);
    state.current = 0;
    state.players[0].nums = [5];
    state.players[0].secondChance = false;
    state.deck = [{ kind: "num", v: 5 }];
    state.discard = [];

    Flip7.applyAction(state, 0, { action: "hit" });

    expect(state.players[0].status).toBe("busted");
    expect(state.events.some((e: any) => e.type === "effect.bust" && e.value === 5 && e.actor === 0)).toBe(true);
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
    expect(state.events.some((e: any) => e.type === "effect.second_used" && e.actor === 0)).toBe(true);
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

  it("shows/removes colored dice by real color keys when a row locks", () => {
    const state: any = Qwixx.create(["A", "B"]);
    state.dice = { w: [6, 6], r: 1, y: 2, g: 3, b: 4 };
    state.players[0].rows.red.marks = [0, 1, 2, 3, 4];
    Qwixx.applyAction(state, 0, { action: "mark", c: "red", i: 10 }); // red 12 lock via white 12
    Qwixx.applyAction(state, 1, { action: "skip" });
    expect(state.locked).toContain("red");
    expect(state.dice.r).toBe(0);
    expect(state.phase).toBe("COLOR_PHASE");
  });

  it("lets the active player take a colored mark before resolving white", () => {
    const state: any = Qwixx.create(["A", "B"]);
    state.dice = { w: [2, 5], r: 4, y: 3, g: 6, b: 1 };
    Qwixx.applyAction(state, 0, { action: "mark", c: "red", i: 5, use: "color" }); // red 7? no, red idx5 = 7; use white? Let's target red 6 at idx4 via 2+4
    expect(state.players[0].rows.red.marks).toEqual([]);
    Qwixx.applyAction(state, 0, { action: "mark", c: "red", i: 4, use: "color" });
    expect(state.players[0].rows.red.marks).toContain(4);
    expect(state.activeColorUsed).toBe(true);
    // White 7 remains legal in other rows but not in red after red color was chosen first.
    Qwixx.applyAction(state, 0, { action: "mark", c: "yellow", i: 5, use: "white" });
    expect(state.players[0].rows.yellow.marks).toContain(5);
  });


  it("honors requested white vs color use for ambiguous active-player marks", () => {
    const whiteState: any = Qwixx.create(["A", "B"]);
    whiteState.dice = { w: [2, 5], r: 5, y: 1, g: 1, b: 1 }; // red 7 is both white sum and red color sum
    Qwixx.applyAction(whiteState, 0, { action: "mark", c: "red", i: 5, use: "white" });
    expect(whiteState.players[0].rows.red.marks).toEqual([5]);
    expect(whiteState.pendingWhiteDecisions).not.toContain(0);
    expect(whiteState.activeColorUsed).toBe(false);

    const colorState: any = Qwixx.create(["A", "B"]);
    colorState.dice = { w: [2, 5], r: 5, y: 1, g: 1, b: 1 };
    Qwixx.applyAction(colorState, 0, { action: "mark", c: "red", i: 5, use: "color" });
    expect(colorState.players[0].rows.red.marks).toEqual([5]);
    expect(colorState.pendingWhiteDecisions).toContain(0);
    expect(colorState.activeColorUsed).toBe(true);
  });

  it("blocks marks in a locked row after the shared white action resolves", () => {
    const state: any = Qwixx.create(["A", "B"]);
    state.dice = { w: [6, 6], r: 6, y: 2, g: 3, b: 4 };
    state.players[0].rows.red.marks = [0, 1, 2, 3, 4];
    Qwixx.applyAction(state, 0, { action: "mark", c: "red", i: 10 });
    Qwixx.applyAction(state, 1, { action: "skip" });
    const before = JSON.stringify(state.players[0].rows.red.marks);
    Qwixx.applyAction(state, 0, { action: "mark", c: "red", i: 9 });
    expect(JSON.stringify(state.players[0].rows.red.marks)).toBe(before);
  });
});

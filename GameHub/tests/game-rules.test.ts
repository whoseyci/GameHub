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

  it("pausable Flip-Three: a freeze drawn during a flip3 waits for the TARGET to choose (not auto-applied)", () => {
    const state: any = Flip7.create(["A", "B", "C"]);
    state.current = 0;
    state.players.forEach((p: any) => { p.nums = []; p.mods = []; p.tableau = []; p.secondChance = false; p.status = "active"; });
    // P0 draws a flip3 (→ must target). Then we target P1; P1's first flip3 draw
    // is a freeze, which must PAUSE for P1 to choose a target, not auto-resolve.
    state.deck = [
      // remaining flip3 draws after the freeze (drawn last = popped last)
      { id: "n2", kind: "num", v: 2 },
      { id: "n3", kind: "num", v: 3 },
      { id: "fz", kind: "act", v: "freeze" }, // P1's first flip3 draw (popped first)
      { id: "f3", kind: "act", v: "flip3" },  // P0's hit (popped first of all)
    ];
    state.discard = [];

    // P0 hits → draws flip3 → pending target choice for P0
    Flip7.applyAction(state, 0, { action: "hit" });
    expect(state.pendingAction).toBeTruthy();
    expect(state.pendingAction.kind).toBe("flip3");
    expect(state.pendingAction.from).toBe(0);

    // P0 targets P1 → flip3 runs on P1; first draw is a freeze → must PAUSE
    Flip7.applyAction(state, 0, { action: "target", target: 1 });
    expect(state.pendingAction).toBeTruthy();
    expect(state.pendingAction.kind).toBe("freeze");
    expect(state.pendingAction.from).toBe(1); // the FLIP3 TARGET chooses, not P0
    // The flip3 is suspended mid-sequence (a frame is still on the stack).
    expect(Array.isArray(state.flip3Stack) && state.flip3Stack.length).toBeTruthy();
    // Nobody has been frozen yet (freeze not auto-applied).
    expect(state.players.every((p: any) => p.status === "active")).toBe(true);

    // P1 chooses to freeze P2 → freeze resolves, then the flip3 resumes its
    // remaining draws (the 3 and 2 land on P1).
    Flip7.applyAction(state, 1, { action: "target", target: 2 });
    expect(state.players[2].status).toBe("stayed"); // P2 frozen by P1's choice
    expect(state.players[1].nums.sort()).toEqual([2, 3]); // flip3 finished its draws
  });

  it("round-end sweeps all board cards into the discard pile", () => {
    const state: any = Flip7.create(["A", "B"]);
    state.current = 0;
    state.players[0].nums = [1, 2]; state.players[0].tableau = [{ id: "a", kind: "num", v: 1 }, { id: "b", kind: "num", v: 2 }];
    state.players[1].nums = [3]; state.players[1].tableau = [{ id: "c", kind: "num", v: 3 }];
    const before = state.discard.length;
    // Both players stay → round ends → boards swept to discard.
    Flip7.applyAction(state, 0, { action: "stay" });
    Flip7.applyAction(state, 1, { action: "stay" });
    expect(state.phase === "ROUND_END" || state.phase === "GAME_OVER").toBe(true);
    expect(state.discard.length).toBeGreaterThan(before);
    expect(state.players.every((p: any) => p.tableau.length === 0)).toBe(true);
  });
});

describe("Qwixx rule regressions", () => {
  it("marks a valid white-dice number and blocks marking backwards", () => {
    const state: any = Qwixx.create(["A", "B"]);
    // Pin the white dice deterministically so the target lands mid-row (never the
    // terminal lock cell, which would require 5 prior marks) — avoids dice RNG.
    state.dice.w = [3, 4]; // sum = 7
    const sum = 7;
    const rowKey = "red"; // red row is 2..12 ascending, so 7 is a mid index
    const row = state.players[0].rows[rowKey];
    const idx = row.nums.indexOf(sum);
    expect(idx).toBeGreaterThan(0); // mid-row: a "backwards" index exists

    Qwixx.applyAction(state, 0, { action: "mark", c: rowKey, i: idx });
    expect(row.marks).toEqual([idx]);

    Qwixx.applyAction(state, 0, { action: "mark", c: rowKey, i: idx - 1 });
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

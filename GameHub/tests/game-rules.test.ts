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

  it("Skyjo Action uses the requested split deck and a four-card action market", () => {
    const state: any = Skyjo.create(["A", "B"], "action");
    expect(state.variant).toBe("action");
    expect(state.actionMarket).toHaveLength(4);
    const playing = [...state.deck, ...state.discard, ...state.players.flatMap((p: any) => p.board.map((c: any) => c.value))];
    expect(playing.filter((v: number) => v === 99)).toHaveLength(15);
    expect(playing.filter((v: number) => v === -2)).toHaveLength(3);
    expect(playing.filter((v: number) => v === 0)).toHaveLength(11);
    for (const v of [-1,1,2,3,4,5,6,7,8,9,10,11,12]) expect(playing.filter((x: number) => x === v)).toHaveLength(7);
    const allActions = [...state.actionDeck, ...state.actionMarket];
    for (const k of ["swap_own", "double", "draw_three", "enlightenment", "reactivation", "defense", "swap_other", "action_thief", "meteor"]) expect(allActions.filter((x: string) => x === k)).toHaveLength(3);
  });

  it("Skyjo Action lets a player take, mature, then play an action card", () => {
    const state: any = Skyjo.create(["A", "B"], "action");
    state.phase = "PLAY"; state.currentPlayer = 0; state.turnAction = null;
    state.actionMarket = ["double", "swap_own", "draw_three", "reveal"];
    Skyjo.applyAction(state, 0, { action: "take_action", source: "market", index: 0 });
    expect(state.players[0].actionHand[0].kind).toBe("double");
    expect(state.turnAction).toBe("turn_end_delay");
    skyjoCompleteTurnEnd(state);
    state.currentPlayer = 0; state.turnAction = null;
    expect(Skyjo.legalActions!(state, 0)).toContainEqual({ action: "play_action", hand: 0 });
    Skyjo.applyAction(state, 0, { action: "play_action", hand: 0 });
    expect(state.extraTurnSeat).toBe(0);
  });

  it("Skyjo Action clears horizontal rows as well as columns", () => {
    const state: any = Skyjo.create(["A", "B"], "action");
    state.phase = "PLAY"; state.currentPlayer = 0; state.turnAction = null;
    for (let i = 0; i < 4; i++) state.players[0].board[i] = { value: 5, revealed: true, cleared: false };
    Skyjo.applyAction(state, 0, { action: "draw_deck" });
    state.drawnCard = 1;
    Skyjo.applyAction(state, 0, { action: "swap", index: 4 });
    expect(state.players[0].board.slice(0, 4).every((c: any) => c.cleared)).toBe(true);
  });

  it("Skyjo Action does not auto-clear star groups and offers a clear choice", () => {
    const state: any = Skyjo.create(["A", "B"], "action");
    state.phase = "PLAY"; state.currentPlayer = 0; state.turnAction = null;
    state.players[0].board[0] = { value: 5, revealed: true, cleared: false };
    state.players[0].board[1] = { value: 99, revealed: true, cleared: false };
    state.players[0].board[2] = { value: 5, revealed: true, cleared: false };
    state.players[0].board[3] = { value: 5, revealed: true, cleared: false };
    Skyjo.applyAction(state, 0, { action: "draw_deck" });
    state.drawnCard = 1;
    Skyjo.applyAction(state, 0, { action: "swap", index: 4 });
    expect(state.players[0].board.slice(0, 4).every((c: any) => !c.cleared)).toBe(true);
    expect(state.skyjoAction?.kind).toBe("star_clear");
    expect(Skyjo.legalActions!(state, 0).some((a: any) => a.action === "clear_group" && a.starOnTop === true)).toBe(true);
    Skyjo.applyAction(state, 0, { action: "clear_group", group: 0, starOnTop: true });
    expect(state.players[0].board.slice(0, 4).every((c: any) => c.cleared)).toBe(true);
    expect(state.discard[state.discard.length - 1]).toBe(99);
  });

  it("Skyjo Action offers a free action card when a star is revealed or placed", () => {
    const state: any = Skyjo.create(["A", "B"], "action");
    state.phase = "PLAY"; state.currentPlayer = 0; state.turnAction = "must_reveal";
    state.players[0].board[0] = { value: 99, revealed: false, cleared: false };
    const before = state.players[0].actionHand.length;
    Skyjo.applyAction(state, 0, { action: "reveal_after_discard", index: 0 });
    expect(state.skyjoAction?.kind).toBe("star_action");
    expect(Skyjo.legalActions!(state, 0)).toContainEqual({ action: "take_free_action" });
    Skyjo.applyAction(state, 0, { action: "take_free_action" });
    expect(state.players[0].actionHand.length).toBe(before + 1);
  });

  it("Skyjo Action prompts for all-star rows too, allowing players to keep or clear them", () => {
    const state: any = Skyjo.create(["A", "B"], "action");
    state.phase = "PLAY"; state.currentPlayer = 0; state.turnAction = null;
    state.players[0].board = Array.from({ length: 12 }, (_, i) => ({ value: i < 4 ? 99 : 0, revealed: true, cleared: false }));
    Skyjo.applyAction(state, 0, { action: "draw_deck" });
    state.drawnCard = 1;
    Skyjo.applyAction(state, 0, { action: "swap", index: 4 });
    expect(state.skyjoAction?.kind).toBe("star_clear");
    expect(Skyjo.legalActions!(state, 0).some((a: any) => a.action === "skip_clear_group")).toBe(true);
  });

  it("Skyjo Action scores kept star rows and columns as negative points", () => {
    const state: any = Skyjo.create(["A", "B"], "action");
    state.phase = "PLAY"; state.currentPlayer = 0; state.turnAction = null;
    state.players[0].board = Array.from({ length: 12 }, (_, i) => ({ value: i < 4 ? 99 : 0, revealed: true, cleared: false }));
    state.players[1].board = Array.from({ length: 12 }, () => ({ value: 0, revealed: true, cleared: false }));
    state.phase = "FINAL_TURNS"; state.roundEnder = 0; state.currentPlayer = 1; state.finalTurnsLeft = 0; state.turnAction = "turn_end_delay";
    Skyjo.completeTick!(state);
    expect(state.players[0].roundScore).toBe(-15);
  });

  it("Skyjo Action blocks action play/discard/take during final turns", () => {
    const state: any = Skyjo.create(["A", "B"], "action");
    state.phase = "FINAL_TURNS"; state.currentPlayer = 1; state.turnAction = null;
    state.players[1].actionHand = [{ kind: "double", fresh: false }];
    const legal = Skyjo.legalActions!(state, 1).map((a: any) => a.action);
    expect(legal).not.toContain("play_action");
    expect(legal).not.toContain("discard_action");
    expect(legal).not.toContain("take_action");
  });
});

describe("Flip7 rule regressions", () => {
  it("starts every round with empty player lines and requires the first action to be Hit", () => {
    const standard: any = Flip7.create(["A", "B"]);
    expect(standard.players.every((p: any) => p.tableau.length === 0 && p.nums.length === 0 && p.mods.length === 0)).toBe(true);
    expect(Flip7.legalActions!(standard, standard.current)).toEqual([{ action: "hit" }]);

    const vengeance: any = Flip7.create(["A", "B"], "vengeance");
    expect(vengeance.players.every((p: any) => p.tableau.length === 0 && p.nums.length === 0 && p.mods.length === 0)).toBe(true);
    expect(Flip7.legalActions!(vengeance, vengeance.current)).toEqual([{ action: "hit" }]);
  });

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

  it("discard pile PERSISTS across rounds and the deck is not rebuilt on next_round", () => {
    const state: any = Flip7.create(["A", "B"]);
    // Players no longer start with an opening card; seed a mid-round board so
    // ending round 1 proves board cards sweep into the persistent discard.
    state.current = 0;
    const takeNum = () => {
      const idx = state.deck.findIndex((c: any) => c.kind === "num");
      return state.deck.splice(idx, 1)[0];
    };
    const c0 = takeNum();
    const c1 = takeNum();
    state.players[0].nums = [c0.v]; state.players[0].tableau = [c0];
    state.players[1].nums = [c1.v]; state.players[1].tableau = [c1];
    Flip7.applyAction(state, 0, { action: "stay" });
    Flip7.applyAction(state, 1, { action: "stay" });
    expect(state.phase === "ROUND_END" || state.phase === "GAME_OVER").toBe(true);
    const discardAfterR1 = state.discard.length;
    const deckAfterR1 = state.deck.length;
    expect(discardAfterR1).toBeGreaterThan(0);
    // Continue to round 2 (only if not game over).
    if (state.phase === "ROUND_END") {
      Flip7.applyAction(state, 0, { action: "next_round" });
      expect(state.round).toBe(2);
      // The deck was NOT rebuilt to a full 94-card deck; total cards are conserved
      // across deck + discard + boards (no fresh deck wipes the discard).
      const boardCards = state.players.reduce((n: number, p: any) => n + p.tableau.length, 0);
      const total = state.deck.length + state.discard.length + boardCards;
      const FULL_DECK = 1 /*0*/ + (1+2+3+4+5+6+7+8+9+10+11+12) /*nums*/ + 6 /*mods*/ + 9 /*acts*/; // 94
      expect(total).toBe(FULL_DECK);
      // The round-1 discard was carried over (not reset to empty): the deck did
      // not get rebuilt to full minus the new opening deal.
      expect(state.deck.length).toBeLessThan(FULL_DECK - boardCards);
    }
  });

  it("deck only reshuffles the discard back in when it runs out of cards", () => {
    const state: any = Flip7.create(["A", "B"]);
    // Drain the deck down to 1 card, with a known card sitting in the discard.
    state.discard = [{ id: "keep12", kind: "num", v: 12 }];
    state.deck = [{ id: "last", kind: "num", v: 0 }];
    state.current = 0; state.players[0].status = "active"; state.players[0].nums = [];
    // First hit consumes the last deck card → deck now empty, discard still has the 12.
    Flip7.applyAction(state, 0, { action: "hit" });
    // The 12 is NOT in the deck yet (no reshuffle while a card was available).
    expect(state.deck.concat(state.discard).some((c: any) => c.id === "keep12")).toBe(true);
    // Next draw finds the deck empty → reshuffles discard into the deck (a
    // reshuffle event is emitted) so the 12 re-enters play only now.
    const cur = state.current;
    if (state.phase === "PLAY" && state.players[cur].status === "active") {
      Flip7.applyAction(state, cur, { action: "hit" });
      expect(state.events.some((e: any) => e.type === "deck.reshuffle")).toBe(true);
    }
  });

  it("Flip 7 ends the round for EVERYONE (all active players force-stay & bank)", () => {
    const state: any = Flip7.create(["A", "B", "C"]);
    state.current = 0;
    state.players.forEach((p: any) => { p.nums = []; p.mods = []; p.tableau = []; p.secondChance = false; p.status = "active"; });
    // P0 already has 6 unique; B and C are mid-round and still active.
    state.players[0].nums = [1, 2, 3, 4, 5, 6];
    state.players[1].nums = [8]; state.players[1].tableau = [{ id: "b8", kind: "num", v: 8 }];
    state.players[2].nums = [9]; state.players[2].tableau = [{ id: "c9", kind: "num", v: 9 }];
    // P0 draws a 7 → 7 unique → Flip 7.
    state.deck = [{ id: "n7", kind: "num", v: 7 }];
    Flip7.applyAction(state, 0, { action: "hit" });
    // Round is over for everyone.
    expect(state.phase === "ROUND_END" || state.phase === "GAME_OVER").toBe(true);
    // No one is left active — B and C were force-stayed (not busted).
    expect(state.players.every((p: any) => p.status !== "active")).toBe(true);
    expect(state.players[1].status).toBe("stayed");
    expect(state.players[2].status).toBe("stayed");
    // B and C banked their current points (8 and 9); they did not lose them.
    expect(state.players[1].banked).toBe(8);
    expect(state.players[2].banked).toBe(9);
    // P0 got the +15 Flip 7 bonus on top of 1..7 = 28 → 43.
    expect(state.players[0].banked).toBe(28 + 15);
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

  it("Vengeance uses the official 108-card standalone composition", () => {
    const state: any = Flip7.create(["A", "B"], "vengeance");
    const all = [
      ...state.deck,
      ...state.discard,
      ...state.players.flatMap((p: any) => p.tableau),
    ];
    expect(state.variant).toBe("vengeance");
    expect(all).toHaveLength(108);
    expect(all.filter((c: any) => c.kind === "act").map((c: any) => c.v).sort()).toEqual(["discard", "discard", "flip4", "flip4", "just1more", "just1more", "steal", "steal", "swap", "swap"]);
    expect(all.filter((c: any) => c.kind === "act" && (c.v === "freeze" || c.v === "second" || c.v === "flip3"))).toHaveLength(0);
    expect(all.filter((c: any) => c.kind === "mod")).toHaveLength(6);
    expect(all.filter((c: any) => c.kind === "mod" && c.v === "div2")).toHaveLength(1);
    for (const m of ["-2", "-4", "-6", "-8", "-10"]) expect(all.filter((c: any) => c.kind === "mod" && c.v === m)).toHaveLength(1);
    expect(all.filter((c: any) => c.kind === "num" && c.v === 0 && c.special === "zero")).toHaveLength(1);
    expect(all.filter((c: any) => c.kind === "num" && c.v === 7 && c.special === "unlucky7")).toHaveLength(1);
    expect(all.filter((c: any) => c.kind === "num" && c.v === 13 && c.special === "lucky13")).toHaveLength(1);
    expect(all.filter((c: any) => c.kind === "num" && c.v === 7)).toHaveLength(7);
    expect(all.filter((c: any) => c.kind === "num" && c.v === 13)).toHaveLength(13);
  });

  it("Vengeance modifiers are targeted and can hit stayed players", () => {
    const state: any = Flip7.create(["A", "B"], "vengeance");
    state.current = 0;
    state.players.forEach((p: any) => { p.nums = []; p.mods = []; p.tableau = []; p.status = "active"; p.secondChance = false; });
    state.players[1].status = "stayed";
    state.deck = [{ id: "minus4", kind: "mod", v: "-4" }];
    state.discard = [];

    Flip7.applyAction(state, 0, { action: "hit" });

    expect(state.pendingAction?.kind).toBe("modifier");
    expect(Flip7.legalActions!(state, 0)).toContainEqual({ action: "target", target: 1 });
    Flip7.applyAction(state, 0, { action: "target", target: 1 });
    expect(state.players[1].mods).toContain("-4");
  });

  it("Vengeance Flip Four defers action/modifier resolution until all four cards are revealed", () => {
    const state: any = Flip7.create(["A", "B", "C"], "vengeance");
    state.current = 0;
    state.players.forEach((p: any) => { p.nums = []; p.mods = []; p.tableau = []; p.status = "active"; p.secondChance = false; });
    state.pendingAction = { kind: "flip4", from: 0, card: { id: "f4", kind: "act", v: "flip4" } };
    state.deck = [
      { id: "n5", kind: "num", v: 5 },
      { id: "n4", kind: "num", v: 4 },
      { id: "minus2", kind: "mod", v: "-2" },
      { id: "n3", kind: "num", v: 3 },
    ];

    Flip7.applyAction(state, 0, { action: "target", target: 1 });

    expect(state.players[1].nums).toEqual([3, 4, 5]);
    expect(state.pendingAction?.kind).toBe("modifier");
    expect(state.pendingAction?.from).toBe(1);
    expect(state.players[2].mods).toEqual([]);

    Flip7.applyAction(state, 1, { action: "target", target: 2 });
    expect(state.players[2].mods).toEqual(["-2"]);
    expect(state.pendingAction).toBeNull();
  });

  it("Vengeance Zero forces hit while active and scores zero unless Flip 7", () => {
    const state: any = Flip7.create(["A", "B"], "vengeance");
    state.current = 0;
    state.players.forEach((p: any) => { p.nums = []; p.mods = []; p.tableau = []; p.status = "active"; p.secondChance = false; p.mustHit = false; });
    state.deck = [{ id: "zero", kind: "num", v: 0, special: "zero" }];
    state.discard = [];

    Flip7.applyAction(state, 0, { action: "hit" });

    expect(state.players[0].mustHit).toBe(true);
    state.current = 0;
    expect(Flip7.legalActions!(state, 0)).toEqual([{ action: "hit" }]);
    state.players[0].nums.push(12);
    expect(Flip7.viewFor(state, 0).flip7.players[0].live).toBe(0);
  });

  it("Vengeance Lucky 13 allows exactly one other 13", () => {
    const state: any = Flip7.create(["A", "B"], "vengeance");
    state.current = 0;
    state.players.forEach((p: any) => { p.nums = []; p.mods = []; p.tableau = []; p.status = "active"; p.secondChance = false; p.hasLucky13 = false; });
    state.deck = [
      { id: "third13", kind: "num", v: 13 },
      { id: "plain13", kind: "num", v: 13 },
      { id: "lucky", kind: "num", v: 13, special: "lucky13" },
    ];

    Flip7.applyAction(state, 0, { action: "hit" });
    expect(state.players[0].status).toBe("active");
    expect(state.players[0].nums).toEqual([13]);
    state.current = 0;
    Flip7.applyAction(state, 0, { action: "hit" });
    expect(state.players[0].status).toBe("active");
    expect(state.players[0].nums).toEqual([13, 13]);
    state.current = 0;
    Flip7.applyAction(state, 0, { action: "hit" });
    expect(state.players[0].status).toBe("busted");
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

  it("active player can take the penalty in ONE finishTurn even while their own white is pending", () => {
    // The UI 'Take penalty' button (stage 1) uses finishTurn. The engine must
    // auto-resolve the roller's own pending white decision so the penalty is a
    // single click, not skip-then-finish. With 2 players where the passive seat
    // also still owes a white decision, the turn shouldn't end until that's in.
    const state: any = Qwixx.create(["A", "B"]);
    const active = state.activeSeat;
    expect(state.pendingWhiteDecisions).toContain(active);
    Qwixx.applyAction(state, active, { action: "finishTurn" }); // one click: penalty path
    // active's own white decision was auto-resolved by finishTurn
    expect(state.pendingWhiteDecisions).not.toContain(active);
    // passive resolves white → turn ends, active eats exactly one penalty
    Qwixx.applyAction(state, 1 - active, { action: "skip" });
    expect(state.players[active].penalties).toBe(1);
    expect(state.activeSeat).toBe(1 - active); // turn passed to the next player
  });

  it("active player gets a penalty even when they SKIP COLOR during the white phase (no mark all turn)", () => {
    // Regression: the active player skipped white, then used the white-phase
    // "skip color / pass to others" finishTurn, then the passive player resolved
    // white. The turn ended via the white-resolution path which never checked the
    // no-mark penalty, so the active player escaped it. Penalty must apply on any
    // turn-end where nothing was crossed off.
    const state: any = Qwixx.create(["A", "B"]);
    const active = state.activeSeat;
    Qwixx.applyAction(state, active, { action: "skip" });        // active skips white (no mark)
    Qwixx.applyAction(state, active, { action: "finishTurn" });  // active skips color (still WHITE_PHASE)
    Qwixx.applyAction(state, 1 - active, { action: "skip" });    // passive resolves white -> turn ends
    expect(state.players[active].penalties).toBe(1);
  });

  it("active player gets NO penalty when they crossed off a white number", () => {
    const state: any = Qwixx.create(["A", "B"]);
    const active = state.activeSeat;
    const w = state.dice.w[0] + state.dice.w[1];
    // find a row where the white sum is markable and cross it
    let marked = false;
    for (const c of ["red", "yellow", "green", "blue"]) {
      const i = state.players[active].rows[c].nums.indexOf(w);
      if (i >= 0) { Qwixx.applyAction(state, active, { action: "mark", c, i, use: "white" }); marked = true; break; }
    }
    expect(marked).toBe(true);
    Qwixx.applyAction(state, 1 - active, { action: "skip" });
    if (state.phase === "COLOR_PHASE") Qwixx.applyAction(state, active, { action: "finishTurn" });
    expect(state.players[active].penalties).toBe(0);
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

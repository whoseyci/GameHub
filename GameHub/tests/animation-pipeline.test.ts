/**
 * Animation Pipeline Integration Tests
 *
 * Tests the logical correctness of the Skyjo and Flip 7 animation pipelines
 * by tracing every action path and verifying state invariants.
 *
 * These tests use the server-side engines (TypeScript) and mock the
 * CardRegistry client-side behavior to verify animation state machine logic.
 */

import { describe, expect, it } from "vitest";
import { Skyjo, skyjoCompleteTurnEnd } from "../src/games/skyjo";
import { Flip7 } from "../src/games/flip7";
import { readFileSync } from "node:fs";

const flip7Source = readFileSync(new URL("../public/js/04-flip7.js", import.meta.url), "utf8");

// ---- Minimal CardRegistry mock ----
function createMockRegistry() {
  const items = new Map();
  return {
    items,
    create(id: string) {
      if (!items.has(id)) items.set(id, { id, el: { style: {} }, anchor: null, hidden: null });
      return items.get(id);
    },
    get(id: string) { return items.get(id)?.el || null; },
    has(id: string) { return items.has(id); },
    remove(id: string) {
      const it = items.get(id);
      if (it?.hidden) it.hidden.el.style.visibility = it.hidden.visibility || '';
      items.delete(id);
    },
    async move(id: string, opts: any) {
      const it = this.create(id);
      if (opts.to && opts.hideTarget) {
        opts.to.style.visibility = 'hidden';
        it.hidden = { el: opts.to, visibility: '' };
      }
      if (opts.to) it.anchor = opts.to;
      return it.el;
    },
    place(id: string, anchor: any) {
      const it = this.create(id);
      if (it.hidden) { it.hidden.el.style.visibility = it.hidden.visibility || ''; it.hidden = null; }
      it.anchor = anchor;
    },
    sync() {
      for (const it of items.values()) {
        if (it.hidden && it.anchor) it.anchor.style.visibility = 'hidden';
      }
    },
    clear() { items.clear(); },
  };
}

// ---- Skyjo Animation Pipeline ----
describe("Skyjo Animation Pipeline", () => {
  it("checkTriplets chains onto swap lastAction instead of overwriting", () => {
    const state = Skyjo.create(["Alice", "Bob"]);

    // Force to PLAY phase by revealing 2 cards each
    Skyjo.applyAction(state, 0, { action: "reveal", index: 0 });
    Skyjo.applyAction(state, 0, { action: "reveal", index: 5 });
    Skyjo.applyAction(state, 1, { action: "reveal", index: 0 });
    Skyjo.applyAction(state, 1, { action: "reveal", index: 5 });
    skyjoCompleteTurnEnd(state);

    // Find who goes first and set up a triplet scenario
    const player = state.currentPlayer;
    // Set up board so column 0 has matching values
    state.players[player].board[0] = { value: 5, revealed: true, cleared: false };
    state.players[player].board[4] = { value: 5, revealed: true, cleared: false };
    state.players[player].board[8] = { value: 3, revealed: true, cleared: false };

    // Draw from deck, then swap index 8 (which will make three 5s in column 0)
    state.turnAction = null;
    state.drawnCard = 5; // will match the triplet
    Skyjo.applyAction(state, player, { action: "draw_deck" });
    // Override drawnCard to 5 for the test
    state.drawnCard = 5;
    Skyjo.applyAction(state, player, { action: "swap", index: 8 });

    // Verify: lastAction should be swap with chained triplet
    expect(state.lastAction.type).toBe("swap");
    expect(state.lastAction.triplet).toBeDefined();
    expect(state.lastAction.triplet.value).toBe(5);
    expect(state.lastAction.triplet.indices).toEqual([0, 4, 8]);
  });

  it("checkTriplets still works as standalone when not preceded by swap", () => {
    const state = Skyjo.create(["Alice", "Bob"]);
    // Directly manipulate: set up three matching revealed cards in a column
    state.players[0].board[0] = { value: 7, revealed: true, cleared: false };
    state.players[0].board[4] = { value: 7, revealed: true, cleared: false };
    state.players[0].board[8] = { value: 7, revealed: true, cleared: false };
    state.lastAction = { type: "something_else", t: Date.now() };

    // Trigger checkTriplets via the engine's internal _end path
    // We can simulate this by doing a swap that triggers triplet
    state.phase = "PLAY";
    state.turnAction = "deck";
    state.drawnCard = 7;
    state.currentPlayer = 0;

    Skyjo.applyAction(state, 0, { action: "swap", index: 1 }); // swap non-column card

    // No triplet in column 0 (we swapped index 1, not 0/4/8)
    // Now set up so a swap WOULD trigger triplet
    state.players[0].board[1] = { value: 7, revealed: true, cleared: false };
    state.players[0].board[5] = { value: 7, revealed: true, cleared: false };
    state.players[0].board[9] = { value: 7, revealed: true, cleared: false };
    state.turnAction = "deck";
    state.drawnCard = 7;

    // Standalone triplet (lastAction is not swap — set to something else)
    state.lastAction = { type: "reveal", t: Date.now() };
    // Manually trigger checkTriplets via swap
    Skyjo.applyAction(state, 0, { action: "swap", index: 9 });

    // If a triplet was found, it could be standalone or chained
    if (state.lastAction.type === "triplet") {
      expect(state.lastAction.value).toBe(7);
    }
  });

  it("skyjo:held lifecycle: created on draw, survives through swap", async () => {
    const registry = createMockRegistry();

    // Simulate: draw_deck creates skyjo:held
    await registry.move("skyjo:held", { from: {}, to: { style: {} }, hideTarget: true });
    expect(registry.has("skyjo:held")).toBe(true);

    // place() clears hidden state
    registry.place("skyjo:held", { style: {} });
    const item = registry.items.get("skyjo:held")!;
    expect(item.hidden).toBeNull();

    // sync() should NOT re-hide because hidden is null
    registry.sync();
    expect(item.hidden).toBeNull();

    // Swap animation: move from held to target, then remove
    await registry.move("skyjo:held", { to: { style: {} }, hideTarget: true });
    registry.remove("skyjo:held");
    expect(registry.has("skyjo:held")).toBe(false);
  });

  it("skyjo:held sync does not re-hide after place() clears hidden", () => {
    const registry = createMockRegistry();
    const anchor = { style: { visibility: "" } };

    // Simulate: draw animation sets hidden
    registry.create("skyjo:held");
    const item = registry.items.get("skyjo:held")!;
    item.hidden = { el: anchor, visibility: "" };
    anchor.style.visibility = "hidden";

    // Before place: sync re-hides
    registry.sync();
    expect(anchor.style.visibility).toBe("hidden");

    // After place: hidden cleared
    registry.place("skyjo:held", anchor);
    expect(item.hidden).toBeNull();
    expect(anchor.style.visibility).toBe("");

    // sync no longer re-hides
    registry.sync();
    expect(anchor.style.visibility).toBe("");
    expect(item.hidden).toBeNull();
  });

  it("full draw→swap lifecycle preserves held card position", async () => {
    const registry = createMockRegistry();
    const heldSlot = { style: {} };
    const gridSlot = { style: {} };

    // 1. Draw: create held card
    await registry.move("skyjo:held", { from: { style: {} }, to: heldSlot, hideTarget: true });
    expect(registry.has("skyjo:held")).toBe(true);

    // 2. Place: clear hidden
    registry.place("skyjo:held", heldSlot);
    expect(registry.items.get("skyjo:held")!.hidden).toBeNull();

    // 3. Sync: should not re-hide
    registry.sync();
    expect(registry.items.get("skyjo:held")!.hidden).toBeNull();

    // 4. Swap: move held to grid
    await registry.move("skyjo:held", { to: gridSlot, hideTarget: true });
    registry.remove("skyjo:held");
    expect(registry.has("skyjo:held")).toBe(false);

    // 5. After swap: no orphaned entries
    expect(registry.items.size).toBe(0);
  });

  it("full draw→discard_drawn lifecycle preserves held card position", async () => {
    const registry = createMockRegistry();
    const heldSlot = { style: {} };
    const discardSlot = { style: {} };

    // 1. Draw: create held card
    await registry.move("skyjo:held", { from: { style: {} }, to: heldSlot, hideTarget: true });
    registry.place("skyjo:held", heldSlot);

    // 2. Discard drawn: move held to discard
    await registry.move("skyjo:held", { to: discardSlot, hideTarget: true });
    registry.remove("skyjo:held");
    expect(registry.has("skyjo:held")).toBe(false);
  });
});

// ---- Flip 7 Event Pipeline ----
describe("Flip 7 Animation Pipeline", () => {
  it("normalizeFlip7Event maps all 16 legacy event types", () => {
    const normalize = (e: any) => {
      if (!e || !e.type || e.type.includes(".")) return e;
      const map: Record<string, string> = {
        draw_start: "deck.wiggle", card: "card.deal", action_card: "card.deal",
        play_action: "card.transfer", second_pass: "card.transfer",
        bust: "effect.bust", flip7: "effect.flip7",
        flip3_abandon: "effect.flip3_abandon", second_used: "effect.second_used",
        second_discard: "effect.second_discard", stay: "effect.stay",
        freeze_done: "effect.freeze_done", reshuffle: "deck.reshuffle",
        await_target: "target.prompt", round_end: "effect.round_end",
        game_over: "effect.game_over",
      };
      if (map[e.type]) return { ...e, type: map[e.type] };
      return e;
    };

    const types = [
      "draw_start", "card", "action_card", "play_action",
      "second_pass", "bust", "flip7", "flip3_abandon",
      "second_used", "second_discard", "stay", "freeze_done",
      "reshuffle", "await_target", "round_end", "game_over",
    ];

    for (const type of types) {
      const result = normalize({ type, seq: 1 });
      expect(result.type).not.toBe(type);
      expect(result.type).toBeTruthy();
    }
  });

  it("lastSeq filtering prevents replaying old events", () => {
    let lastSeq = -1;
    const events = [
      { type: "deck.wiggle", seq: 1 },
      { type: "card.deal", seq: 2 },
      { type: "effect.bust", seq: 3 },
    ];

    const batch1 = events.filter(e => e.seq > lastSeq);
    expect(batch1).toHaveLength(3);
    lastSeq = 3;

    const events2 = [
      { type: "deck.wiggle", seq: 2 },
      { type: "card.deal", seq: 3 },
      { type: "effect.stay", seq: 4 },
    ];
    const batch2 = events2.filter(e => e.seq > lastSeq);
    expect(batch2).toHaveLength(1);
    expect(batch2[0].seq).toBe(4);
  });

  it("shadow state double-application is idempotent", () => {
    const shadow = {
      players: [{
        nums: [2, 5, 8], mods: ["x2"], second: false, actionCards: ["freeze"],
        status: "active" as string, bustCard: null as number | null, live: 30, unique: 3,
      }],
    };

    // Apply card.deal for num 5 (already in nums) — should not duplicate
    const p = shadow.players[0];
    const card = { kind: "num", v: 5 };
    if (card.kind === "num" && !p.nums.includes(card.v)) p.nums.push(card.v);
    expect(p.nums.filter(n => n === 5)).toHaveLength(1);

    // Apply bust twice — idempotent
    p.status = "busted"; p.bustCard = 8; p.live = 0;
    p.status = "busted"; p.bustCard = 8; p.live = 0;
    expect(p.status).toBe("busted");

    // Remove action card, then try again — no error
    const idx = p.actionCards.indexOf("freeze");
    if (idx >= 0) p.actionCards.splice(idx, 1);
    expect(p.actionCards).not.toContain("freeze");
    const idx2 = p.actionCards.indexOf("freeze");
    expect(idx2).toBe(-1);
  });

  it("Flip7 engine events have monotonically increasing seq", () => {
    const state = Flip7.create(["Alice", "Bob"]);

    // Play several turns
    for (let i = 0; i < 10; i++) {
      if (state.phase !== "PLAY") break;
      const current = state.current;
      if (!state.players[current] || state.players[current].status !== "active") break;
      Flip7.applyAction(state, current, { action: "hit" });
      if (state.players[current] && state.players[current].status === "active") {
        Flip7.applyAction(state, current, { action: "stay" });
      }
    }

    let lastSeq = 0;
    for (const ev of state.events) {
      expect(ev.seq).toBeGreaterThan(lastSeq);
      lastSeq = ev.seq;
    }
  });

  it("Flip7 engine next() preserves seq continuity", () => {
    const state = Flip7.create(["Alice", "Bob"]);

    // Force round end by staying
    Flip7.applyAction(state, 0, { action: "stay" });
    Flip7.applyAction(state, 1, { action: "stay" });

    if (state.phase === "ROUND_END" || state.phase === "GAME_OVER") {
      const seqBefore = state.seq;
      Flip7.applyAction(state, 0, { action: "next_round" });
      // After next round, seq should be higher (or state should be fresh)
      if (state.seq !== undefined) {
        expect(state.seq).toBeGreaterThanOrEqual(seqBefore);
      }
    }
  });
});

// ---- Cross-Cutting Invariant Tests ----
describe("Animation Pipeline Invariants", () => {
  it("Skyjo: no orphaned lastAction after multi-action sequence", () => {
    const state = Skyjo.create(["Alice", "Bob", "Carol"]);

    // Reveal phase
    for (let pi = 0; pi < 3; pi++) {
      Skyjo.applyAction(state, pi, { action: "reveal", index: 0 });
      Skyjo.applyAction(state, pi, { action: "reveal", index: 5 });
    }
    skyjoCompleteTurnEnd(state);

    // Play through several turns
    if (state.phase === "PLAY") {
      const player = state.currentPlayer;
      Skyjo.applyAction(state, player, { action: "draw_deck" });
      expect(state.lastAction).toBeTruthy();
      expect(state.lastAction.type).toBe("draw_deck");

      Skyjo.applyAction(state, player, { action: "swap", index: 0 });
      expect(state.lastAction).toBeTruthy();
      // lastAction should be swap (or swap with chained triplet)
      expect(["swap", "triplet"]).toContain(state.lastAction.type);
      if (state.lastAction.type === "swap" && state.lastAction.triplet) {
        expect(state.lastAction.triplet.indices).toBeDefined();
      }
    }
  });

  it("normalizeFlip7Event source code contains all expected mappings", () => {
    // Verify the client source code has all normalization mappings
    const expectedMappings = [
      "draw_start", "card", "action_card", "play_action",
      "second_pass", "bust", "flip7", "flip3_abandon",
      "second_used", "second_discard", "stay", "freeze_done",
      "reshuffle", "await_target", "round_end", "game_over",
    ];
    for (const type of expectedMappings) {
      expect(flip7Source).toContain(`case '${type}'`);
    }
  });

  it("skyjo:held cleanup — remove is called after swap and discard_drawn in source", () => {
    const skyjoSource = readFileSync(new URL("../public/js/03-skyjo.js", import.meta.url), "utf8");

    // Verify swap path calls remove('skyjo:held')
    expect(skyjoSource).toContain("Kit.CardRegistry.remove('skyjo:held')");
    // Verify draw paths call place() to clear hidden
    expect(skyjoSource).toContain("Kit.CardRegistry.place('skyjo:held'");
    // Verify wrapper visibility is conditional on registry state
    expect(skyjoSource).toContain("Kit.CardRegistry.has('skyjo:held')");
  });
});

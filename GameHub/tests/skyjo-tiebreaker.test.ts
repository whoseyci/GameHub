// skyjo-tiebreaker.test.ts — verifies that when players tie for starter
// at the beginning of a match, ALL players flip an additional card (not just
// those who tied) to prevent information asymmetry / unfair advantage.
import { describe, expect, it } from "vitest";
import { Skyjo } from "../src/games/skyjo/server";

describe("Skyjo All-Player Tiebreaker Parity", () => {
  it("requires all players to flip a tiebreaker card when starters tie", () => {
    const state: any = Skyjo.create(["Alice", "Bob", "Charlie"]);

    // Set board cards so Alice (0) and Bob (1) tie with sum 10, Charlie (2) has sum 2.
    state.players[0].board[0].value = 5; state.players[0].board[1].value = 5;
    state.players[1].board[0].value = 5; state.players[1].board[1].value = 5;
    state.players[2].board[0].value = 1; state.players[2].board[1].value = 1;

    // Everyone flips 2 cards initially
    Skyjo.applyAction(state, 0, { action: "reveal", index: 0 });
    Skyjo.applyAction(state, 0, { action: "reveal", index: 1 });
    Skyjo.applyAction(state, 1, { action: "reveal", index: 0 });
    Skyjo.applyAction(state, 1, { action: "reveal", index: 1 });
    Skyjo.applyAction(state, 2, { action: "reveal", index: 0 });
    Skyjo.applyAction(state, 2, { action: "reveal", index: 1 });

    expect(state.turnAction).toBe("turn_end_delay");
    Skyjo.completeTick!(state);

    // After tick, since 0 and 1 tied for highest sum (10), tiebreaker is triggered.
    // Invariant: ALL players (0, 1, 2) must be in tiebreakerPlayers.
    expect(state.tiebreakerPlayers).toEqual([0, 1, 2]);

    // Check hub view state
    const view0 = Skyjo.viewFor(state, 0);
    expect(view0.state!.currentSeat).toBe(-1); // simultaneous turn
    expect(view0.state!.players[0].status).toBe("active");
    expect(view0.state!.players[1].status).toBe("active");
    expect(view0.state!.players[2].status).toBe("active");

    // All 3 players should have legal actions to flip a 3rd card
    const legal0 = Skyjo.legalActions!(state, 0);
    const legal1 = Skyjo.legalActions!(state, 1);
    const legal2 = Skyjo.legalActions!(state, 2);

    expect(legal0.length).toBeGreaterThan(0);
    expect(legal1.length).toBeGreaterThan(0);
    expect(legal2.length).toBeGreaterThan(0);
    expect(legal0[0].action).toBe("tiebreaker");
  });
});

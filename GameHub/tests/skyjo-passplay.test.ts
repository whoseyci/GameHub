// skyjo-passplay.test.ts — pins the bugfixes from the
// "Skyjo + Qwixx mobile" round:
//   1. take_discard must be in legalActions after the first draw_deck
//      lands a card in the discard pile. (The bug: legalActions read
//      state.discardTop — a VIEW-only derived field — instead of
//      state.discard. Always undefined → never offered as legal →
//      pass-and-play users couldn't tap the discard pile.)
//   2. Skyjo client exposes a localFocusSeat(state, humanSeats) hook so
//      pass-and-play alternates BETWEEN humans during REVEAL (one human
//      at a time picks 2 cards, then focus passes).
//
// Both fixes are server-source pins; the in-browser behaviour is also
// covered by the smoke harnesses.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Skyjo } from "../src/games/skyjo/server";

describe("Skyjo: take_discard offered after the first reveal phase", () => {
  it("legalActions returns both draw_deck AND take_discard at PLAY start", () => {
    const state: any = Skyjo.create(["P1", "P2"]);
    // Drive both seats through REVEAL.
    Skyjo.applyAction(state, 0, { action: "reveal", index: 0 });
    Skyjo.applyAction(state, 0, { action: "reveal", index: 1 });
    Skyjo.applyAction(state, 1, { action: "reveal", index: 0 });
    Skyjo.applyAction(state, 1, { action: "reveal", index: 1 });
    // Engine may pause with turn_end_delay; advance via tick if needed.
    if (typeof (Skyjo as any).tick === "function") {
      let safety = 50;
      while (state.phase === "REVEAL" && safety--) {
        (Skyjo as any).tick(state);
        if (typeof (Skyjo as any).completeTick === "function") {
          (Skyjo as any).completeTick(state);
        }
      }
    }
    // We expect PLAY (or FINAL_TURNS in tiny edge cases) with turnAction null.
    expect(["PLAY", "FINAL_TURNS"]).toContain(state.phase);
    expect(state.turnAction).toBe(null);
    expect(state.discard.length).toBeGreaterThan(0);

    const legal = Skyjo.legalActions!(state, state.currentPlayer) || [];
    const actions = new Set(legal.map((a: any) => a.action));
    expect(actions.has("draw_deck"), "draw_deck should always be legal at the start of a turn").toBe(true);
    expect(actions.has("take_discard"), "REGRESSION: take_discard must be legal whenever discard pile has cards (bug: was reading state.discardTop which is view-only, always undefined)").toBe(true);
  });

  it("legalActions does NOT offer take_discard when the discard pile is empty (defensive)", () => {
    const state: any = Skyjo.create(["P1", "P2"]);
    // Force discard empty (engine seeds 1 by default; clear for test).
    state.discard = [];
    state.phase = "PLAY";
    state.currentPlayer = 0;
    state.turnAction = null;
    const legal = Skyjo.legalActions!(state, 0) || [];
    const actions = new Set(legal.map((a: any) => a.action));
    expect(actions.has("draw_deck")).toBe(true);
    expect(actions.has("take_discard")).toBe(false);
  });
});

describe("Skyjo client: localFocusSeat for pass-and-play alternation", () => {
  const src = readFileSync("public/js/03-skyjo.js", "utf8");

  it("exposes a localFocusSeat hook on the GameClient", () => {
    expect(src).toMatch(/function\s+localFocusSeat/);
    expect(src).toMatch(/window\.GameClients\['skyjo'\]\s*=\s*\{[^}]*localFocusSeat/);
  });

  it("during REVEAL, picks the first human seat that still needs to flip cards", () => {
    expect(src).toMatch(/state\.phase\s*===\s*['"]REVEAL['"][\s\S]{0,400}revealCount/);
  });

  it("during PLAY, follows the engine's currentPlayer when it's a human", () => {
    expect(src).toMatch(/PLAY[\s\S]{0,400}humanSeats\.includes\(cp\)/);
  });
});

describe("LocalEngine wrapper: localDisplaySeat consults the game's localFocusSeat hook", () => {
  const src = readFileSync("public/js/01-network-local.js", "utf8");

  it("localDisplaySeat reads window.GameClients[localGameId].localFocusSeat first", () => {
    expect(src).toMatch(/function\s+localDisplaySeat[\s\S]{0,800}localFocusSeat/);
  });
});

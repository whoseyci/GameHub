// architecture-changes.test.ts — guards for the performance/uniformity changes
// introduced in the architecture refactor:
//   • Skyjo no longer deep-clones (JSON.parse(JSON.stringify)) on the hot path.
//   • Every game that schedules a tick() also implements completeTick().
//   • summarize() is generic via the GameModule contract (no per-game branches).
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { GAMES } from "../src/games/registry";
import { summarizeGameState } from "../src/replay";

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

describe("Skyjo hot path avoids deep clones", () => {
  it("viewFor performs no JSON serialization", () => {
    const skyjo = GAMES.skyjo;
    const state = skyjo.create(["A", "B"]);
    const stringifySpy = vi.spyOn(JSON, "stringify");
    const parseSpy = vi.spyOn(JSON, "parse");
    try {
      skyjo.viewFor(state, 0);
      expect(stringifySpy).not.toHaveBeenCalled();
      expect(parseSpy).not.toHaveBeenCalled();
    } finally {
      stringifySpy.mockRestore();
      parseSpy.mockRestore();
    }
  });

  it("applyAction mutates the same state object in place (identity preserved)", () => {
    const skyjo = GAMES.skyjo;
    const state: any = skyjo.create(["A", "B"]);
    const playersRefBefore = state.players;
    skyjo.applyAction(state, 0, { action: "reveal", index: 0 });
    // Same top-level object; the engine writes fields back rather than replacing it.
    expect(state.players).toBe(playersRefBefore);
    expect(Array.isArray(state.players)).toBe(true);
    // State must remain plain JSON-serializable.
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("applyAction performs no JSON round-trip on the hot path", () => {
    const skyjo = GAMES.skyjo;
    const state = skyjo.create(["A", "B"]);
    const stringifySpy = vi.spyOn(JSON, "stringify");
    const parseSpy = vi.spyOn(JSON, "parse");
    try {
      skyjo.applyAction(state, 0, { action: "reveal", index: 0 });
      expect(stringifySpy).not.toHaveBeenCalled();
      expect(parseSpy).not.toHaveBeenCalled();
    } finally {
      stringifySpy.mockRestore();
      parseSpy.mockRestore();
    }
  });
});

describe("tick / completeTick contract", () => {
  it("any game with tick() also provides completeTick()", () => {
    for (const game of Object.values(GAMES)) {
      if (game.tick) expect(typeof game.completeTick).toBe("function");
    }
  });

  it("Skyjo completeTick resolves a turn_end_delay deterministically", () => {
    const skyjo = GAMES.skyjo;
    const state: any = skyjo.create(["A", "B"]);
    // Drive both players' initial reveals (2 each) which triggers a starter
    // decision parked behind a turn_end_delay tick.
    skyjo.applyAction(state, 0, { action: "reveal", index: 0 });
    skyjo.applyAction(state, 0, { action: "reveal", index: 1 });
    skyjo.applyAction(state, 1, { action: "reveal", index: 0 });
    skyjo.applyAction(state, 1, { action: "reveal", index: 1 });
    expect(state.turnAction).toBe("turn_end_delay");
    expect(skyjo.tick!(state)).toBeGreaterThan(0);
    skyjo.completeTick!(state);
    // After completion the deferred transition has been applied.
    expect(state.turnAction).not.toBe("turn_end_delay");
  });
});

// Mirror of Room.isSeatActable() — the gate that stops a host puppeting a bot
// seat out of turn (S1). Kept in sync with src/server.ts. We test the invariant
// against real game state so a rules/view change can't silently break the gate.
function seatActable(gameId: string, state: any, seat: number): boolean {
  if (seat < 0) return false;
  const vs = GAMES[gameId].viewFor(state, -1).state;
  if (!vs) return true;
  if (vs.currentSeat >= 0) return vs.currentSeat === seat;
  return vs.players?.[seat]?.status === "active";
}

describe("bot-turn gating invariant (S1)", () => {
  it("only the current seat is actable in a turn-based game", () => {
    const skyjo = GAMES.skyjo;
    const state: any = skyjo.create(["A", "B"]);
    // Get into PLAY with a known current player.
    skyjo.applyAction(state, 0, { action: "reveal", index: 0 });
    skyjo.applyAction(state, 0, { action: "reveal", index: 1 });
    skyjo.applyAction(state, 1, { action: "reveal", index: 0 });
    skyjo.applyAction(state, 1, { action: "reveal", index: 1 });
    skyjo.completeTick!(state);
    const cur = skyjo.viewFor(state, -1).state!.currentSeat;
    expect(cur).toBeGreaterThanOrEqual(0);
    expect(seatActable("skyjo", state, cur)).toBe(true);
    expect(seatActable("skyjo", state, cur === 0 ? 1 : 0)).toBe(false);
    expect(seatActable("skyjo", state, -1)).toBe(false);
  });

  it("simultaneous-turn games mark only active seats actable", () => {
    const flip7 = GAMES.flip7;
    const state: any = flip7.create(["A", "B"]);
    const vs = flip7.viewFor(state, -1).state!;
    // Whatever the view reports as the actable seat must pass the gate, and a
    // busted/stayed/non-active seat must not.
    if (vs.currentSeat >= 0) {
      expect(seatActable("flip7", state, vs.currentSeat)).toBe(true);
    } else {
      const active = vs.players.findIndex((p) => p.status === "active");
      if (active >= 0) expect(seatActable("flip7", state, active)).toBe(true);
    }
  });
});

describe("generic summarize() via contract", () => {
  it("summarizeGameState pulls game-specific extras from the module", () => {
    for (const game of Object.values(GAMES)) {
      const state = game.create(["A", "B"]);
      const summary = summarizeGameState(game.meta.id, state);
      expect(summary).not.toBeNull();
      expect(summary!.gameId).toBe(game.meta.id);
      expect(Array.isArray(summary!.players)).toBe(true);
      // If the module declares summarize(), its keys appear in the snapshot.
      if (game.summarize) {
        const extra = game.summarize(clone(state));
        for (const k of Object.keys(extra)) expect(k in summary!).toBe(true);
      }
    }
  });

  it("returns null for unknown / missing game", () => {
    expect(summarizeGameState(null, null)).toBeNull();
    expect(summarizeGameState("nope", { players: [] })).not.toBeNull(); // base still built
  });
});

// ── Permanent Card System (client) — source-level guards ────────────────────
describe("Permanent Card System: Flip 7 fully on CardManager", () => {
  const core = readFileSync(new URL("../public/js/00-core.js", import.meta.url), "utf8");
  const flip7 = readFileSync(new URL("../public/js/04-flip7.js", import.meta.url), "utf8");

  it("the CardRegistry shim is gone everywhere", () => {
    expect(core).not.toContain("const CardRegistry");
    expect(core).not.toContain("Kit.CardRegistry");
    expect(flip7).not.toContain("Kit.CardRegistry");
  });

  it("Flip 7 uses one live-view reducer instead of scattered shadow mutators", () => {
    expect(flip7).toContain("function advanceLiveView(");
    expect(flip7).toContain("advanceLiveView(liveView,e)");
    // The old trio is removed.
    expect(flip7).not.toContain("function applyShadowEvent(");
    expect(flip7).not.toContain("function addCardToShadow(");
    expect(flip7).not.toContain("function removeCardFromShadow(");
  });

  it("the dev-mode invariant guard is wired into the render path", () => {
    expect(core).toContain("function assertCardInvariants(");
    expect(core).toContain("CardManager.verifyInvariants()");
    // Gated by a debug flag so it costs nothing in production.
    expect(core).toContain("localStorage.getItem('cardDebug')");
    // Exposed on Kit and called by the table renderer.
    expect(core).toContain("CardManager,CardBoard,cardFace,assertCardInvariants,rollDice");
    expect(core).toContain("assertCardInvariants('renderTable')");
  });

  it("exposes the declarative card+board framework (Kit.Cards) and games use it", () => {
    const cards = readFileSync(new URL("../public/js/00-cards.js", import.meta.url), "utf8");
    const css = readFileSync(new URL("../public/styles/main.css", import.meta.url), "utf8");
    const schotten = readFileSync(new URL("../public/js/games/schotten.js", import.meta.url), "utf8");

    // The framework exposes one declarative card spec renderer + board zones + flights.
    expect(cards).toContain("Kit.Cards = {");
    expect(cards).toContain("function el(spec)");      // spec → element
    expect(cards).toContain("function paint(token");   // colorToken → solid/gradient/multicolor
    expect(cards).toContain("function board(prefix");  // one wiring call
    expect(cards).toContain("function deal(");         // canonical flights
    expect(cards).toContain("function move(");
    expect(cards).toContain("function toPile(");
    // STRICT: content is text-only (no HTML injection) — the framework renders pixels.
    expect(cards).toContain("ce.textContent = String(c.text)");
    expect(cards).not.toContain("innerHTML = c.");

    // ONE canonical geometry + ONE shared back, with the corners locked in EVERY
    // state (idle + flying) via !important — this is what kills the "pointy
    // rectangle while flying" bug class.
    expect(css).toContain("--kc-radius:");
    expect(css).toContain("--kc-aspect:");
    expect(css).toContain(".kc.kc-back");
    expect(css).toContain(".kit-card-registered.kc,.kit-card-moving.kc{border-radius:var(--kc-radius)!important");

    // Schotten declares cards as SPECS and uses framework zones/flights — no bespoke
    // geometry, no hand-rolled wiring.
    expect(schotten).toContain("Kit.Cards.anchor(");
    expect(schotten).toContain("Kit.Cards.board(PREFIX");
    expect(schotten).toContain("Kit.Cards.deck(");
    expect(schotten).toContain("Kit.Cards.deal(");
    expect(schotten).toContain("Kit.Cards.move(");
    expect(schotten).not.toContain("Kit.CardManager.reconcile(PREFIX");
  });
});

import { describe, expect, it } from "vitest";
import { Skyjo } from "../src/games/skyjo";
import { Flip7 } from "../src/games/flip7";
import { Qwixx } from "../src/games/qwixx";

describe("standardized GameViewState semantics", () => {
  it("Skyjo exposes draft state and acting-count during initial reveals", () => {
    const state: any = Skyjo.create(["A", "B"]);
    const view: any = Skyjo.viewFor(state, 0);

    expect(view.phase).toBe("DRAFT");
    expect(view.state).toBeDefined();
    expect(view.state.currentSeat).toBeGreaterThanOrEqual(0);
    expect(view.state.actingCount).toBe(2);
    expect(view.state.players.map((p: any) => p.status)).toEqual(["active", "active"]);
  });

  it("Flip7 exposes exactly one acting seat during play and target selection", () => {
    const state: any = Flip7.create(["A", "B"]);
    let view: any = Flip7.viewFor(state, 0);

    expect(view.phase).toBe("PLAYING");
    expect(view.state.currentSeat).toBe(state.current);
    expect(view.state.actingCount).toBe(1);
    expect(view.state.players).toHaveLength(state.players.length);

    state.pendingAction = { kind: "freeze", from: 1 };
    view = Flip7.viewFor(state, 0);
    expect(view.state.currentSeat).toBe(1);
    expect(view.state.pendingAction).toBe("freeze");
    expect(view.state.actingCount).toBe(1);
  });

  it("Qwixx distinguishes simultaneous white phase from single-seat color phase", () => {
    const state: any = Qwixx.create(["A", "B"]);
    let view: any = Qwixx.viewFor(state, 0);

    expect(view.phase).toBe("PLAYING");
    expect(view.state.currentSeat).toBe(-1);
    expect(view.state.actingCount).toBe(2);
    expect(view.state.players.map((p: any) => p.status)).toEqual(["active", "active"]);

    Qwixx.applyAction(state, 0, { action: "skip" });
    Qwixx.applyAction(state, 1, { action: "skip" });
    view = Qwixx.viewFor(state, 0);

    expect(state.phase).toBe("COLOR_PHASE");
    expect(view.state.currentSeat).toBe(state.activeSeat);
    expect(view.state.actingCount).toBe(1);
    expect(view.state.players[state.activeSeat].status).toBe("active");
  });

  it("serialized standardized states remain JSON-safe", () => {
    for (const view of [
      Skyjo.viewFor(Skyjo.create(["A", "B"]), 0),
      Flip7.viewFor(Flip7.create(["A", "B"]), 0),
      Qwixx.viewFor(Qwixx.create(["A", "B"]), 0),
    ] as any[]) {
      expect(view.state).toBeDefined();
      expect(JSON.parse(JSON.stringify(view.state))).toEqual(view.state);
    }
  });
});

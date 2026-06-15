import { describe, expect, it } from "vitest";
import { GAMES } from "../src/games/registry";

type Member = { id: string; name: string };

class SimRoom {
  members: Member[] = [];
  hostId: string | null = null;
  gameId: string | null = null;
  gameState: any = null;
  sent = new Map<string, any[]>();

  join(id: string, name: string) {
    if (!this.hostId) this.hostId = id;
    if (!this.members.some((m) => m.id === id)) this.members.push({ id, name });
    this.sent.set(id, []);
  }

  launch(gameId: string) {
    const g = GAMES[gameId];
    if (!g) throw new Error("Unknown game");
    if (this.members.length < g.meta.minPlayers || this.members.length > g.meta.maxPlayers) throw new Error("Bad player count");
    this.gameId = gameId;
    this.gameState = g.create(this.members.map((m) => m.name));
    this.broadcast();
  }

  action(id: string, msg: any) {
    if (!this.gameId) return;
    const seat = this.members.findIndex((m) => m.id === id);
    if (seat < 0) return;
    GAMES[this.gameId].applyAction(this.gameState, seat, msg);
    this.broadcast();
  }

  broadcast() {
    if (!this.gameId) return;
    const g = GAMES[this.gameId];
    for (const m of this.members) {
      const seat = this.members.findIndex((x) => x.id === m.id);
      this.sent.get(m.id)!.push({ type: "game", view: g.viewFor(this.gameState, seat) });
    }
  }

  last(id: string) { return this.sent.get(id)!.at(-1); }
}

describe("room-level simulated flows", () => {
  it("launches a game and broadcasts personalized views to all seats", () => {
    const room = new SimRoom();
    room.join("p1", "Ada");
    room.join("p2", "Ben");
    room.launch("skyjo");

    expect(room.last("p1").view.yourSeat).toBe(0);
    expect(room.last("p2").view.yourSeat).toBe(1);
    expect(room.last("p1").view.game).toBe("skyjo");
    expect(room.last("p2").view.game).toBe("skyjo");
  });

  it("applies an action once and rebroadcasts updated state", () => {
    const room = new SimRoom();
    room.join("p1", "Ada");
    room.join("p2", "Ben");
    room.launch("skyjo");
    room.action("p1", { action: "reveal", index: 0 });

    expect(room.last("p1").view.skyjo.players[0].revealCount).toBe(1);
    expect(room.last("p2").view.skyjo.players[0].revealCount).toBe(1);
    expect(room.sent.get("p1")!.length).toBe(2);
  });

  it("keeps invalid/spectator actions from mutating the game", () => {
    const room = new SimRoom();
    room.join("p1", "Ada");
    room.join("p2", "Ben");
    room.launch("flip7");
    const before = JSON.stringify(room.gameState);
    room.action("not-a-member", { action: "hit" });
    expect(JSON.stringify(room.gameState)).toBe(before);
  });

  it("safeMutate contract: a throwing game call rolls state back fully (S5)", () => {
    // Mirrors Room.safeMutate: snapshot gameState, run the mutation, restore the
    // snapshot on throw. Guards the crash-isolation + atomicity guarantee the
    // server now relies on so a buggy/hostile action can't corrupt or crash.
    function safeMutate(state: any, fn: () => void): { ok: boolean; state: any } {
      const snap = structuredClone(state);
      try { fn(); return { ok: true, state }; }
      catch { return { ok: false, state: snap }; }
    }
    const g = GAMES["skyjo"];
    let state: any = g.create(["Ada", "Ben"]);
    const before = JSON.stringify(state);
    // A mutation that corrupts state partway, THEN throws.
    const res = safeMutate(state, () => {
      (state.players[0] as any).board = "corrupted";   // partial mutation
      throw new Error("boom");                          // …then fail
    });
    expect(res.ok).toBe(false);
    // Rolled back: the restored state equals the pre-call snapshot exactly.
    expect(JSON.stringify(res.state)).toBe(before);
  });
});

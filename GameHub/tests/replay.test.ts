import { describe, expect, it } from "vitest";
import { MAX_REPLAY_ENTRIES, appendReplay, summarizeGameState } from "../src/replay";
import { Skyjo } from "../src/games/skyjo";

describe("replay/action-log helpers", () => {
  it("assigns sequence numbers and caps the ring buffer", () => {
    let log = [] as any[];
    for (let i = 0; i < MAX_REPLAY_ENTRIES + 5; i++) log = appendReplay(log, { kind: "action", action: "x" }, i);
    expect(log).toHaveLength(MAX_REPLAY_ENTRIES);
    expect(log[0].seq).toBe(6);
    expect(log.at(-1).seq).toBe(MAX_REPLAY_ENTRIES + 5);
  });

  it("summarizes game state without exposing full hidden boards/decks", () => {
    const state: any = Skyjo.create(["A", "B"]);
    const summary = summarizeGameState("skyjo", state)!;
    expect(summary.gameId).toBe("skyjo");
    expect(summary.players).toEqual([
      expect.objectContaining({ seat: 0, name: "A" }),
      expect.objectContaining({ seat: 1, name: "B" }),
    ]);
    expect(JSON.stringify(summary)).not.toContain("board");
    expect(JSON.stringify(summary)).not.toContain("deck");
  });
});

import { describe, expect, it } from "vitest";
import { MAX_WS_MESSAGE_BYTES, cleanName, parseClientMessage } from "../src/protocol";

describe("protocol guards", () => {
  it("sanitizes join payloads", () => {
    const msg = parseClientMessage(JSON.stringify({
      type: "join",
      pid: "abc_123",
      name: "\u0000 Alice With A Very Very Long Name ",
      isPublic: "true",
      quickGame: "flip7",
      maxPlayers: 99,
    }));
    expect(msg).toEqual({
      type: "join",
      pid: "abc_123",
      name: "Alice With A Very Ve",
      isPublic: false,
      isGroup: false,
      quickGame: "flip7",
      maxPlayers: 8,
      seats: [{ pid: "abc_123", name: "Alice With A Very Ve" }],
    });
  });

  it("rejects invalid ids and oversized messages", () => {
    expect(parseClientMessage(JSON.stringify({ type: "join", pid: "../../bad" }))).toBeNull();
    expect(parseClientMessage("x".repeat(MAX_WS_MESSAGE_BYTES + 1))).toBeNull();
  });

  it("forwards a bounded generic payload, drops nested/unsafe values", () => {
    // API-1: a game can send its own action fields without editing the parser.
    // Nested objects/arrays/functions and reserved keys are stripped; primitives
    // (bounded) pass through. The game's applyAction is the final authority.
    const msg = parseClientMessage(JSON.stringify({
      type: "action", action: "mark", c: "red", i: 3, botSeat: 1, use: "white",
      exploit: { nested: true }, badArr: [1, 2, 3], pid: "spoof",
    }));
    expect(msg).toEqual({ type: "action", action: "mark", c: "red", i: 3, botSeat: 1, use: "white" });
  });

  it("bounds payload strings, keys, and rejects non-finite numbers", () => {
    const big = "x".repeat(100);
    const msg = parseClientMessage(JSON.stringify({
      type: "action", action: "play", longStr: big, ok: "short", nan: Number.NaN, "bad key": 1, n: 5,
    }));
    // longStr (>64) dropped, nan (non-finite) dropped via JSON→null, "bad key" (space) dropped.
    expect(msg).toEqual({ type: "action", action: "play", ok: "short", n: 5 });
  });

  it("normalizes empty names", () => {
    expect(cleanName("\u0000\n  ")).toBe("Player");
  });
});

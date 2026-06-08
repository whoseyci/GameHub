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
      quickGame: "flip7",
      maxPlayers: 8,
    });
  });

  it("rejects invalid ids and oversized messages", () => {
    expect(parseClientMessage(JSON.stringify({ type: "join", pid: "../../bad" }))).toBeNull();
    expect(parseClientMessage("x".repeat(MAX_WS_MESSAGE_BYTES + 1))).toBeNull();
  });

  it("keeps only allowed action fields", () => {
    const msg = parseClientMessage(JSON.stringify({
      type: "action", action: "mark", c: "red", i: 3, botSeat: 1, exploit: { nested: true }
    }));
    expect(msg).toEqual({ type: "action", action: "mark", c: "red", i: 3, botSeat: 1 });
  });

  it("normalizes empty names", () => {
    expect(cleanName("\u0000\n  ")).toBe("Player");
  });
});

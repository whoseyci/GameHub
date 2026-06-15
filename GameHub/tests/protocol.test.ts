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

  it("bounds payload number MAGNITUDE (anti-DoS): huge finite numbers are dropped", () => {
    // Hardening (S6): a hostile client could send a huge-but-finite number that
    // a game feeds to Array(n) / a loop bound / an index, hanging or OOM-ing the
    // Durable Object. Out-of-range numbers are DROPPED (not clamped) so the game
    // never acts on a coerced value; in-range ones pass through.
    const msg = parseClientMessage(JSON.stringify({
      type: "action", action: "mark",
      huge: 1e308, negHuge: -1e308, justOver: 1_000_001,
      ok: 999_999, idx: 3, neg: -7,
    }));
    expect(msg).toEqual({ type: "action", action: "mark", ok: 999_999, idx: 3, neg: -7 });
  });

  it("parses chat: trims/collapses whitespace, bounds length, drops empties", () => {
    expect(parseClientMessage(JSON.stringify({ type: "chat", text: "  hi   there  " })))
      .toEqual({ type: "chat", text: "hi there" });
    // empty / whitespace-only → null
    expect(parseClientMessage(JSON.stringify({ type: "chat", text: "   " }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "chat" }))).toBeNull();
    // length bound (240) applied AFTER collapse
    const long = parseClientMessage(JSON.stringify({ type: "chat", text: "a".repeat(500) }));
    expect(long.text.length).toBe(240);
    // optional speaking pid is sanitized + passed through
    expect(parseClientMessage(JSON.stringify({ type: "chat", text: "yo", pid: "p_abc123" })))
      .toEqual({ type: "chat", text: "yo", pid: "p_abc123" });
    expect(parseClientMessage(JSON.stringify({ type: "chat", text: "yo", pid: "../bad" })))
      .toEqual({ type: "chat", text: "yo" });   // bad pid dropped, message still valid
  });

  it("parses react: bounded emoji string, drops empties", () => {
    expect(parseClientMessage(JSON.stringify({ type: "react", emoji: "🎉" })))
      .toEqual({ type: "react", emoji: "🎉" });
    expect(parseClientMessage(JSON.stringify({ type: "react", emoji: "  " }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "react" }))).toBeNull();
    const clipped = parseClientMessage(JSON.stringify({ type: "react", emoji: "x".repeat(64) }));
    expect(clipped.emoji.length).toBe(16);
  });
});

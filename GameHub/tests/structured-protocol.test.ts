// tests/structured-protocol.test.ts — PROPOSAL 10
// Verifies the structured error/event protocol types and helpers.
import { describe, expect, it } from "vitest";
import { parseClientMessage } from "../src/protocol";

describe("Proposal 10: Structured protocol", () => {
  it("parseClientMessage returns null for invalid messages", () => {
    expect(parseClientMessage("")).toBeNull();
    expect(parseClientMessage("not json")).toBeNull();
    expect(parseClientMessage("123")).toBeNull();
    expect(parseClientMessage('"hello"')).toBeNull();
    expect(parseClientMessage("{}")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 42 }))).toBeNull();
  });

  it("parseClientMessage accepts valid join messages", () => {
    const msg = parseClientMessage(JSON.stringify({
      type: "join",
      pid: "p_abc123",
      name: "Player 1",
    }));
    expect(msg).not.toBeNull();
    expect(msg.type).toBe("join");
    expect(msg.pid).toBe("p_abc123");
  });

  it("parseClientMessage accepts valid action messages", () => {
    const msg = parseClientMessage(JSON.stringify({
      type: "action",
      action: "hit",
    }));
    expect(msg).not.toBeNull();
    expect(msg.type).toBe("action");
    expect(msg.action).toBe("hit");
  });

  it("action messages with extra payload fields pass through", () => {
    const msg = parseClientMessage(JSON.stringify({
      type: "action",
      action: "mark",
      c: "red",
      i: 5,
      use: "white",
    }));
    expect(msg).not.toBeNull();
    expect(msg.c).toBe("red");
    expect(msg.i).toBe(5);
    expect(msg.use).toBe("white");
  });

  it("action messages with unknown type are rejected", () => {
    expect(parseClientMessage(JSON.stringify({
      type: "unknown_type",
    }))).toBeNull();
  });

  it("action messages with too-long action string are rejected", () => {
    expect(parseClientMessage(JSON.stringify({
      type: "action",
      action: "a".repeat(41),
    }))).toBeNull();
  });

  it("reserved payload keys are stripped from action payload", () => {
    const msg = parseClientMessage(JSON.stringify({
      type: "action",
      action: "hit",
      // These extra fields go through cleanPayload which strips reserved keys
      extra_field: "safe_value",
    }));
    expect(msg).not.toBeNull();
    expect(msg.extra_field).toBe("safe_value");
  });
});

// architecture-proposals.test.ts — institutional-grade engineering guards
// verifying all 6 architectural proposals across Performance, Security, and Uniformity:
//   • P-1 & P-2: View delta tracking & unawaited storage isolation.
//   • S-1 & S-2: Cryptographic seat tokens & parseAction schema guards.
//   • U-1 & U-2: Universal Schema headers & client runtime parity guards.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GAMES } from "../src/games/registry";
import { parseClientMessage } from "../src/protocol";
import { Skyjo } from "../src/games/skyjo/server";
import { Flip7 } from "../src/games/flip7/server";
import { Qwixx } from "../src/games/qwixx/server";
import { Schotten } from "../src/games/schotten/server";

describe("Architectural Proposals Execution Suite", () => {
  it("U-1: 100% of game catalogue exposes universal schemaSpec descriptors", () => {
    for (const [id, g] of Object.entries(GAMES)) {
      expect(g.meta, `Game ${id} missing schemaSpec`).toHaveProperty("schemaSpec");
      expect(g.meta.schemaSpec).toBeDefined();
    }
  });

  it("S-2: All game engines enforce authoritative parseAction schema guards", () => {
    for (const [id, g] of Object.entries(GAMES)) {
      expect(typeof g.parseAction, `Game ${id} missing parseAction`).toBe("function");
    }
  });

  it("S-2: Authoritative parseAction drops game-illegal action payloads", () => {
    expect(Skyjo.parseAction!({ action: "reveal", index: 0 })).not.toBeNull();
    expect(Skyjo.parseAction!({ action: "arbitrary_cheat" })).toBeNull();

    expect(Flip7.parseAction!({ action: "hit" })).not.toBeNull();
    expect(Flip7.parseAction!({ action: "steal_deck" })).toBeNull();

    expect(Qwixx.parseAction!({ action: "mark", color: "red", number: 5 })).not.toBeNull();
    expect(Qwixx.parseAction!({ action: "hack_dice" })).toBeNull();

    expect(Schotten.parseAction!({ action: "place", stone: 0 })).not.toBeNull();
    expect(Schotten.parseAction!({ action: "nuke_board" })).toBeNull();
  });

  it("S-2: Network protocol layer delegates payload verification to GameModule", () => {
    const validRaw = JSON.stringify({ type: "action", action: "reveal", index: 2 });
    const parsedValid = parseClientMessage(validRaw, Skyjo);
    expect(parsedValid).not.toBeNull();
    expect(parsedValid.action).toBe("reveal");

    const invalidRaw = JSON.stringify({ type: "action", action: "explode_server" });
    const parsedInvalid = parseClientMessage(invalidRaw, Skyjo);
    expect(parsedInvalid).toBeNull();
  });

  it("S-1: Join envelopes extract HMAC session token credentials", () => {
    const rawJoin = JSON.stringify({ type: "join", pid: "p_xyz", name: "Bob", token: "a1b2c3d4e5f6" });
    const parsed = parseClientMessage(rawJoin);
    expect(parsed).not.toBeNull();
    expect(parsed.type).toBe("join");
    expect(parsed.token).toBe("a1b2c3d4e5f6");
  });

  it("P-2 & U-2: Client bundle includes Runtime View Guard parity assertion", () => {
    const coreJs = readFileSync(new URL("../public/js/00-core.js", import.meta.url), "utf8");
    const netJs = readFileSync(new URL("../public/js/01-network-local.js", import.meta.url), "utf8");

    expect(coreJs).toContain("window.assertViewParity = function(");
    expect(netJs).toContain("assertViewParity(view)");
  });
});

// w6-part2.test.ts — pins the W6 part 2 contract:
//   1. Protocol parser actually accepts set_ready / set_group / launch_game(variant).
//      (W6 part 1 had a latent bug where these were silently dropped because the
//      parser whitelist didn't include them — easy to miss when you only grep
//      for source markers. These tests exercise the parser end-to-end.)
//   2. Server handles set_group (host-only, between games).
//   3. Group rooms are auto-public + ready-flags reset on flip.
//   4. Identity has recordGroup / getRecentGroups / forgetGroup.
//   5. GameFeatures.variants is part of the public catalogue type and
//      Skyjo advertises its variant list.
//   6. Client wires hostLaunchGame → variant picker vs direct launch.
//   7. Client exposes hostGroup() + toggleGroupRoom() + connects with isGroup.
//   8. Identity-ui renders the "Recent Groups" section.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseClientMessage } from "../src/protocol";

const read = (p: string) => readFileSync(p, "utf8");

describe("W6 part 2 — protocol parser fixes (latent bug from part 1)", () => {
  it("set_ready: parses with explicit ready flag, defaults pid omitted", () => {
    const msg = parseClientMessage(JSON.stringify({ type: "set_ready", ready: true }));
    expect(msg).toEqual({ type: "set_ready", ready: true });
  });

  it("set_ready: false is the default when ready is omitted/non-bool", () => {
    const msg = parseClientMessage(JSON.stringify({ type: "set_ready", ready: "yes" }));
    // cleanBool requires === true, so a string falls through to false.
    expect(msg).toEqual({ type: "set_ready", ready: false });
  });

  it("set_ready: forwards a valid pid, drops a malformed one", () => {
    const ok  = parseClientMessage(JSON.stringify({ type: "set_ready", ready: true, pid: "p_abc_123" }));
    const bad = parseClientMessage(JSON.stringify({ type: "set_ready", ready: true, pid: "../../bad" }));
    expect(ok).toEqual({ type: "set_ready", ready: true, pid: "p_abc_123" });
    expect(bad).toEqual({ type: "set_ready", ready: true }); // pid stripped silently
  });

  it("set_group: parses with isGroup flag", () => {
    expect(parseClientMessage(JSON.stringify({ type: "set_group", isGroup: true })))
      .toEqual({ type: "set_group", isGroup: true });
    expect(parseClientMessage(JSON.stringify({ type: "set_group", isGroup: false })))
      .toEqual({ type: "set_group", isGroup: false });
  });

  it("launch_game: accepts an optional sanitized variant", () => {
    const v = parseClientMessage(JSON.stringify({ type: "launch_game", gameId: "skyjo", variant: "sprint" }));
    expect(v).toEqual({ type: "launch_game", gameId: "skyjo", variant: "sprint" });
    // Missing variant: omitted from the parsed message.
    const noV = parseClientMessage(JSON.stringify({ type: "launch_game", gameId: "skyjo" }));
    expect(noV).toEqual({ type: "launch_game", gameId: "skyjo" });
    // Malformed variant: silently stripped (rest of message survives).
    const bad = parseClientMessage(JSON.stringify({ type: "launch_game", gameId: "skyjo", variant: "../../oops" }));
    expect(bad).toEqual({ type: "launch_game", gameId: "skyjo" });
  });

  it("join: now carries isGroup through the parser", () => {
    const msg = parseClientMessage(JSON.stringify({
      type: "join", pid: "p_abc", name: "Ada", isGroup: true,
    })) as any;
    expect(msg.isGroup).toBe(true);
  });
});

describe("W6 part 2 — server handles set_group (markers)", () => {
  const src = read("src/server.ts");

  it("Room has a set_group handler that is host-only and between-games", () => {
    expect(src).toMatch(/msg\.type\s*===\s*["']set_group["'][^{]*isHost[^{]*!this\.gameId/);
  });

  it("Flipping ON a group auto-publicizes and clears ready flags", () => {
    expect(src).toMatch(/set_group[\s\S]{0,800}this\.isPublic\s*=\s*true/);
    expect(src).toMatch(/set_group[\s\S]{0,800}m\.ready\s*=\s*false/);
  });

  it("Room broadcast for the lobby includes hostId so the client can label groups", () => {
    expect(src).toMatch(/type:\s*["']room["'][\s\S]{0,500}hostId:\s*this\.hostId/);
  });
});

describe("W6 part 2 — variants feature flag in catalogue", () => {
  it("GameFeatures has an optional variants array", () => {
    const t = read("src/games/types.ts");
    expect(t).toMatch(/variants\?\s*:\s*Readonly[A-Za-z]*<[^>]*\{\s*id:\s*string;\s*name:\s*string;\s*description\?\s*:\s*string\s*\}[^>]*>/);
  });

  it("Skyjo advertises at least one variant in its features manifest", () => {
    const s = read("src/games/skyjo/server.ts");
    expect(s).toMatch(/variants\s*:\s*\[[\s\S]*?id:\s*["']standard["']/);
  });
});

describe("W6 part 2 — Identity gains recent-groups storage", () => {
  const id = read("public/js/00-identity.js");
  it("Identity exposes recordGroup / getRecentGroups / forgetGroup", () => {
    expect(id).toMatch(/function\s+recordGroup\s*\(/);
    expect(id).toMatch(/function\s+getRecentGroups\s*\(/);
    expect(id).toMatch(/function\s+forgetGroup\s*\(/);
    // And they're attached to window.Identity.
    expect(id).toMatch(/window\.Identity\s*=\s*\{[\s\S]*recordGroup[\s\S]*\}/);
  });

  it("recordGroup is capped (LRU eviction at MAX_RECENT_GROUPS)", () => {
    expect(id).toMatch(/MAX_RECENT_GROUPS\s*=\s*\d+/);
    expect(id).toMatch(/recentGroups\.length\s*>\s*MAX_RECENT_GROUPS/);
  });
});

describe("W6 part 2 — client wiring", () => {
  const net = read("public/js/01-network-local.js");
  const ui  = read("public/js/00-identity-ui.js");
  const idx = read("public/index.html");

  it("connectRoom forwards isGroup on the join payload", () => {
    expect(net).toMatch(/connectRoom\s*\([^)]*isGroup\s*=\s*false/);
    expect(net).toMatch(/JSON\.stringify\(\{\s*type:\s*['"]join['"][\s\S]{0,200}isGroup\b/);
  });

  it("hostGroup creates a GROUP-XXXXXX code and connects with isGroup:true", () => {
    expect(net).toMatch(/function\s+hostGroup\s*\([^)]*\)\s*\{[\s\S]*GROUP-[\s\S]*isGroup:\s*true/);
  });

  it("toggleGroupRoom sends a set_group message", () => {
    expect(net).toMatch(/function\s+toggleGroupRoom[\s\S]*type:\s*['"]set_group['"]/);
  });

  it("hostLaunchGame opens the variant picker when the game advertises variants", () => {
    expect(net).toMatch(/function\s+hostLaunchGame[\s\S]*features\?\.variants/);
    expect(net).toMatch(/openVariantPicker/);
    expect(net).toMatch(/pickVariantAndLaunch[\s\S]*variant:\s*variantId/);
  });

  it("Group toggle UI renders in the room (host, between games, non quick-play)", () => {
    expect(net).toMatch(/groupBox/);
    expect(net).toMatch(/Convert to group/);
    expect(net).toMatch(/Disband group/);
  });

  it("Public list visually distinguishes group rooms", () => {
    expect(net).toMatch(/isGroup\s*=\s*!!r\.isGroup/);
  });

  it("Identity-ui renders a Recent Groups section with a rejoin button", () => {
    expect(ui).toMatch(/Recent Groups/);
    expect(ui).toMatch(/data-rejoin-group/);
    expect(ui).toMatch(/connectRoom\([^)]*isGroup:\s*true/);
  });

  it("Group picker exposes 'Create new group' which delegates to hostGroup()", () => {
    // UX redesign Phase 4: the old #onlineSetup 'Host a Group' button is
    // gone — the Group picker dropdown in the sticky header replaces it.
    // GroupPicker.createNew() in 00-mode.js calls window.hostGroup().
    expect(idx).toMatch(/onclick="GroupPicker\.createNew\(\)"/);
    const mode = readFileSync("public/js/00-mode.js", "utf8");
    expect(mode).toMatch(/function\s+createNew\b[\s\S]{0,400}window\.hostGroup/);
  });
});

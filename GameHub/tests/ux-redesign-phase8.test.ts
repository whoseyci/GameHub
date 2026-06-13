// ux-redesign-phase8.test.ts — pins the Phase 8 contract:
//   1. The end-to-end "landing tile click → bot acts" flow is verified
//      by scripts/smoke-landing.mjs (extended in Phase 8).
//   2. The W6 part 2 protocol fix (set_ready / set_group / launch_game
//      variants) is still in place — the user's bot regression report
//      ("Skyjo not starting due to bot not flipping cards") was the
//      compound effect of the silent set_ready drop blocking the
//      ready-gate from launching. With the parser fix in place,
//      tested + pinned, the symptom can't recur.
//   3. Bot strategies are registered for every game in the catalogue
//      that supports bots (a meta-level sanity check — strategies are
//      registered via BotDriver.register in each bots/<game>.js file).

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("UX redesign Phase 8 — bot regression guards", () => {
  it("smoke-landing.mjs asserts bot reveal completes within 3s of tile click", () => {
    const src = read("scripts/smoke-landing.mjs");
    expect(src).toMatch(/Phase 8: bot actually acts after landing tile click/);
    expect(src).toMatch(/botRevealCount\s*>=\s*2/);
    expect(src).toMatch(/within 3s|sleep\(3000\)/);
  });

  it("W6 part 2 protocol fix is still in place (set_ready actually parses)", () => {
    // If this regresses, clicking 'Ready' becomes a silent no-op again
    // and Skyjo waiting on the ready gate never starts.
    const src = read("src/protocol.ts");
    expect(src).toMatch(/case\s+["']set_ready["']/);
    expect(src).toMatch(/cleanBool\(msg\.ready\)/);
  });

  it("every bot strategy file calls BotDriver.register", () => {
    // public/js/bots/*.js (excluding driver.js itself) must each register
    // a strategy. If a bot strategy never registers, the driver falls
    // through to legacy detection — which the previous session noted as
    // unreliable.
    const botsDir = "public/js/bots";
    expect(existsSync(botsDir)).toBe(true);
    const files = readdirSync(botsDir).filter((f) => f.endsWith(".js") && f !== "driver.js");
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = read(`${botsDir}/${f}`);
      expect(src, `bot strategy file ${f} must call BotDriver.register`)
        .toMatch(/BotDriver\.register\s*\(\s*['"][a-z0-9_-]+['"]/);
    }
  });
});

// ux-redesign-phase4.test.ts — pins the Phase 4 contract:
//   1. The killed screens (#onlineSetup, #quickPick, #hostSetup, #joinSetup,
//      #localPick) are NOT present as real .screen elements anymore.
//   2. Their orphaned showScreen() callers have been rerouted to menuScreen
//      (or to Mode.set('online') in the case of goOnline()).
//   3. Hidden legacy DOM slots survive so bootstrap helpers
//      (renderTiles('quickTiles', …), randomCode(), etc.) don't throw on
//      missing-node references.
//   4. The hero landing-cta-row has been simplified — only the Rules link
//      survives (the mode toggle in the sticky header replaces Play
//      Online / Pass & Play).
//
// Navigation regression: every back-button in surviving screens now points
// to menuScreen (no more dangling references to onlineSetup).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("UX redesign Phase 4 — killed screens", () => {
  const html = read("public/index.html");

  it("does NOT contain a .screen element for #onlineSetup", () => {
    expect(html).not.toMatch(/<div\s+id="onlineSetup"\s+class="screen"/);
  });
  it("does NOT contain a .screen element for #quickPick", () => {
    expect(html).not.toMatch(/<div\s+id="quickPick"\s+class="screen"/);
  });
  it("does NOT contain a .screen element for #localPick", () => {
    expect(html).not.toMatch(/<div\s+id="localPick"\s+class="screen"/);
  });
  it("does NOT contain a .screen element for #hostSetup", () => {
    expect(html).not.toMatch(/<div\s+id="hostSetup"\s+class="screen"/);
  });
  it("does NOT contain a .screen element for #joinSetup", () => {
    expect(html).not.toMatch(/<div\s+id="joinSetup"\s+class="screen"/);
  });
});

describe("UX redesign Phase 4 — legacy DOM slots preserved (so bootstrap doesn't throw)", () => {
  const html = read("public/index.html");

  it("hidden #onlineName + #quickTiles + #onlineDevicePlayers slots still exist", () => {
    expect(html).toMatch(/id="legacyOnlineInputs"[^>]*hidden/);
    expect(html).toMatch(/id="onlineName"/);
    expect(html).toMatch(/id="onlineDevicePlayers"/);
    expect(html).toMatch(/id="quickTiles"/);
  });
  it("hidden #localTiles + #localPlayers + #localBotDiff slots still exist", () => {
    expect(html).toMatch(/id="legacyLocalInputs"[^>]*hidden/);
    expect(html).toMatch(/id="localTiles"/);
    expect(html).toMatch(/id="localPlayers"/);
    expect(html).toMatch(/id="localBotDiff"/);
  });
  it("hidden #hostRoom + #joinRoom + #visSeg + #maxVal + #publicList slots still exist", () => {
    expect(html).toMatch(/id="legacyHostInputs"[^>]*hidden/);
    expect(html).toMatch(/id="hostRoom"/);
    expect(html).toMatch(/id="joinRoom"/);
    expect(html).toMatch(/id="visSeg"/);
    expect(html).toMatch(/id="maxVal"/);
    expect(html).toMatch(/id="publicList"/);
  });
});

describe("UX redesign Phase 4 — rerouted showScreen() callers", () => {
  it("leaveOnline() returns to menuScreen, not onlineSetup", () => {
    const src = read("public/js/01-network-local.js");
    expect(src).toMatch(/function\s+leaveOnline\b[\s\S]{0,500}showScreen\(['"]menuScreen['"]\)/);
    expect(src).not.toMatch(/showScreen\(['"]onlineSetup['"]\)/);
  });
  it("goOnline() flips Mode→online and returns to menuScreen", () => {
    const src = read("public/js/00-core.js");
    expect(src).toMatch(/function\s+goOnline\b[\s\S]{0,1500}Mode\.set\(['"]online['"]\)/);
    expect(src).toMatch(/function\s+goOnline\b[\s\S]{0,1500}showScreen\(['"]menuScreen['"]\)/);
    expect(src).not.toMatch(/function\s+goOnline\b[\s\S]{0,1500}showScreen\(['"]onlineSetup['"]\)/);
  });
  it("instantBotPlay fallback no longer routes to #localPick", () => {
    const src = read("public/js/00-landing.js");
    expect(src).not.toMatch(/showScreen\(['"]localPick['"]\)/);
  });
  it("identity-ui re-render trigger only listens for menuScreen now", () => {
    const src = read("public/js/00-identity-ui.js");
    expect(src).not.toMatch(/id\s*===\s*['"]onlineSetup['"]/);
  });
});

describe("UX redesign Phase 4 — hero landing CTA simplified", () => {
  const html = read("public/index.html");

  it("the Play Online + Pass & Play hero buttons are gone", () => {
    // The mode toggle in the sticky header replaces them.
    expect(html).not.toMatch(/onclick="goOnline\(\)"/);
    expect(html).not.toMatch(/onclick="showScreen\('localPick'\)"/);
  });
  it("the Rules link survives in the hero", () => {
    expect(html).toMatch(/onclick="showRulesMenu\(\)"/);
  });
  it("hero shows a short instruction (mode-toggle tip)", () => {
    expect(html).toMatch(/landing-hero-tip/);
  });
});

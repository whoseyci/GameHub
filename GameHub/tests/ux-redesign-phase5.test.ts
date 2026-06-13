// ux-redesign-phase5.test.ts — pins the Phase 5 contract:
//   1. Quick-play rooms render a fixed banner (no tile picker), so the
//      host cannot accidentally switch the game.
//   2. The banner shows the queued game's emoji + name + an auto-start
//      hint, branded as "Quick Play queue".
//   3. Custom / group rooms still see the full tile picker (only the
//      quick-play branch was locked).
//   4. Guests in a quick-play room ALSO see the banner (it identifies
//      what they queued for) — previously guests saw "Waiting for the
//      host to choose a game…" which didn't make sense for quick-play.
//   5. The "Choose a game" heading is hidden inside the quick-play
//      branch (banner replaces it).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("UX redesign Phase 5 — quick-play hard lock", () => {
  const src = read("public/js/01-network-local.js");

  it("renderRoom branches on m.quickGame to render the locked banner", () => {
    expect(src).toMatch(/quickplay-locked-banner[\s\S]*data-game="\$\{esc\(m\.quickGame\)\}"/);
  });

  it("banner shows the queued game's name + auto-start hint", () => {
    expect(src).toMatch(/Quick Play queue/);
    expect(src).toMatch(/starts automatically when everyone's ready/);
  });

  it("tile picker still runs in non-quick-play rooms (host branch)", () => {
    // The else branch falls through to renderTiles('hostTiles', …).
    expect(src).toMatch(/renderTiles\(\s*['"]hostTiles['"]\s*,\s*gid\s*=>\s*hostLaunchGame\(gid\)/);
  });

  it("guests in quick-play see the host area (banner), not the waiting message", () => {
    // The toggles use OR over m.quickGame: showHostArea = m.quickGame || m.isHost.
    expect(src).toMatch(/showHostArea\s*=\s*m\.quickGame\s*\|\|\s*m\.isHost/);
    expect(src).toMatch(/showGuestArea\s*=\s*!m\.isHost\s*&&\s*!m\.quickGame/);
  });

  it("'Choose a game' heading is hidden in quick-play (banner replaces it)", () => {
    expect(src).toMatch(/hostHeading[\s\S]{0,200}display\s*=\s*m\.quickGame\s*\?\s*['"]none['"]/);
  });
});

describe("UX redesign Phase 5 — DOM contract", () => {
  const html = read("public/index.html");

  it("'Choose a game' heading carries id=hostHeading so JS can toggle it", () => {
    expect(html).toMatch(/<h3\s+id="hostHeading"/);
  });
});

describe("UX redesign Phase 5 — banner styling", () => {
  const css = read("public/styles/landing.css");

  it("has .quickplay-locked-banner styling", () => {
    expect(css).toMatch(/\.quickplay-locked-banner\s*\{/);
    expect(css).toMatch(/\.qplb-emoji/);
    expect(css).toMatch(/\.qplb-title/);
    expect(css).toMatch(/\.qplb-hint/);
  });
});

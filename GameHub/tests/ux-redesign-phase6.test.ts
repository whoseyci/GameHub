// ux-redesign-phase6.test.ts — pins the Phase 6 contract:
//   1. LocalSeatEditor module exists with the documented surface.
//   2. The #seatsBtn in the game topbar is hidden by default; only
//      revealed when (active screen = gameScreen) AND (runtime mode =
//      local) AND (localEngine is alive).
//   3. The drawer renders one row per seat, with name + difficulty +
//      remove controls; respects the game's min/max range.
//   4. Restart funnels through window.startLocalGame() (existing
//      lifecycle), never mutates engine state in place.
//   5. window.localSeats / window.localEngine / window.mode mirrors
//      exist (so the editor can read live state without lexical-scope
//      gymnastics).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("UX redesign Phase 6 — LocalSeatEditor surface", () => {
  const src = read("public/js/00-local-seat-editor.js");

  it("exposes window.LocalSeatEditor with the documented API", () => {
    expect(src).toMatch(/window\.LocalSeatEditor\s*=\s*\{\s*open,\s*close,\s*toggle,\s*render,\s*refreshButton,\s*addHuman,\s*addBot,\s*removeSeat,\s*changeDifficulty,\s*restart/);
  });

  it("respects min/max from the game's catalogue meta when adding/removing seats", () => {
    expect(src).toMatch(/meta\?\.minPlayers/);
    expect(src).toMatch(/meta\?\.maxPlayers/);
    expect(src).toMatch(/seats\(\)\.length\s*>=\s*max/);
    expect(src).toMatch(/seats\(\)\.length\s*<=\s*min/);
  });

  it("restart() funnels through startLocalGame (no direct engine mutation)", () => {
    expect(src).toMatch(/function\s+restart[\s\S]{0,300}window\.startLocalGame\(\)/);
  });

  it("refreshButton hides #seatsBtn unless (gameScreen + local mode + engine live)", () => {
    expect(src).toMatch(/active\s*===\s*['"]gameScreen['"][\s\S]{0,200}runtimeMode\s*===\s*['"]local['"][\s\S]{0,200}engineLive/);
  });
});

describe("UX redesign Phase 6 — DOM contract", () => {
  const html = read("public/index.html");

  it("topbar has a #seatsBtn that toggles the drawer", () => {
    expect(html).toMatch(/id="seatsBtn"\s+class="icon-btn hidden"\s+onclick="LocalSeatEditor\.toggle\(\)"/);
  });

  it("game screen contains #localSeatEditor (hidden by default)", () => {
    expect(html).toMatch(/<div\s+id="localSeatEditor"\s+class="local-seat-editor hidden"/);
  });

  it("00-local-seat-editor.js loads after 00-mode.js / 00-online-session.js", () => {
    const idxSession = html.indexOf('<script src="/js/00-online-session.js"');
    const idxEditor  = html.indexOf('<script src="/js/00-local-seat-editor.js"');
    expect(idxSession).toBeGreaterThan(-1);
    expect(idxEditor).toBeGreaterThan(idxSession);
  });
});

describe("UX redesign Phase 6 — window mirrors keep cross-module reads honest", () => {
  const net = read("public/js/01-network-local.js");

  it("window.localSeats mirrors the script-scoped array", () => {
    expect(net).toMatch(/window\.localSeats\s*=\s*localSeats/);
  });
  it("window.mode + window.localEngine + window.localGameId are mirrored on game start", () => {
    expect(net).toMatch(/window\.mode\s*=\s*mode/);
    expect(net).toMatch(/window\.localEngine\s*=\s*localEngine/);
    expect(net).toMatch(/window\.localGameId\s*=\s*localGameId/);
  });
  it("resetLocalSession clears the window mirrors so #seatsBtn hides on quit", () => {
    expect(net).toMatch(/function\s+resetLocalSession[\s\S]{0,300}window\.localEngine\s*=\s*null/);
  });
});

describe("UX redesign Phase 6 — CSS", () => {
  const css = read("public/styles/landing.css");

  it("has .local-seat-editor styles + slide-in animation", () => {
    expect(css).toMatch(/\.local-seat-editor\s*\{/);
    expect(css).toMatch(/@keyframes\s+lseSlide/);
  });

  it("has seat-row + seat-diff + seat-remove styles", () => {
    expect(css).toMatch(/\.seat-row/);
    expect(css).toMatch(/\.seat-diff/);
    expect(css).toMatch(/\.seat-remove/);
  });
});

// ux-redesign-phase6.test.ts — pins the LocalSeatEditor contract.
//
// The original Phase 6 design was a slide-down drawer inside #gameScreen.
// The June redesign replaced it with TWO surfaces:
//   • #seatScreen (pre-game) — full-screen, reached when you click a
//     Local tile; default 1 human; commit() starts the game.
//   • #seatOverlay (in-game) — modal overlay opened by the topbar
//     #seatsBtn; commit() restarts the game with the new seats.
// Both share the same internal seat-row + handler core.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("LocalSeatEditor — module surface", () => {
  const src = read("public/js/00-local-seat-editor.js");

  it("exposes the two-surface API (openSeatScreen + open/closeOverlay) + commit", () => {
    // openSeatScreen: pre-game flow. openOverlay/closeOverlay: in-game modal.
    // commit: shared Start/Restart funnel. toggle: alias used by #seatsBtn.
    expect(src).toMatch(/window\.LocalSeatEditor\s*=\s*\{[\s\S]*openSeatScreen[\s\S]*openOverlay[\s\S]*closeOverlay[\s\S]*toggleOverlay[\s\S]*toggle:\s*toggleOverlay[\s\S]*commit/);
  });

  it("respects min/max from the game's catalogue meta when adding/removing seats", () => {
    expect(src).toMatch(/meta\?\.minPlayers/);
    expect(src).toMatch(/meta\?\.maxPlayers/);
    expect(src).toMatch(/seats\(\)\.length\s*>=\s*max/);
    expect(src).toMatch(/seats\(\)\.length\s*<=\s*min/);
  });

  it("commit() funnels through window.startLocalGame (no direct engine mutation)", () => {
    expect(src).toMatch(/function\s+commit[\s\S]{0,800}window\.startLocalGame\(\)/);
  });

  it("openSeatScreen seeds defaults to ONE human (per redesign)", () => {
    // The default should be a single human seat — the user explicitly
    // adds more via the +Player / +Bot buttons.
    expect(src).toMatch(/openSeatScreen[\s\S]{0,500}setSeats\(\s*\[\s*\{\s*name:\s*myName/);
    // No bots seeded by default.
    expect(src).not.toMatch(/openSeatScreen[\s\S]{0,500}bot:\s*true/);
  });

  it("refreshButton hides #seatsBtn unless (gameScreen + local mode + engine live)", () => {
    expect(src).toMatch(/active\s*===\s*['"]gameScreen['"][\s\S]{0,200}runtimeMode\s*===\s*['"]local['"][\s\S]{0,200}engineLive/);
  });
});

describe("LocalSeatEditor — DOM contract", () => {
  const html = read("public/index.html");

  it("topbar has a #seatsBtn that toggles the seat overlay", () => {
    expect(html).toMatch(/id="seatsBtn"\s+class="icon-btn hidden"\s+onclick="LocalSeatEditor\.toggle\(\)"/);
  });

  it("pre-game #seatScreen exists with a #seatScreenBody slot", () => {
    expect(html).toMatch(/<div\s+id="seatScreen"\s+class="screen"/);
    expect(html).toMatch(/id="seatScreenBody"/);
  });

  it("in-game #seatOverlay exists as a modal with a #seatOverlayBody slot", () => {
    expect(html).toMatch(/<div\s+id="seatOverlay"\s+class="overlay hidden"/);
    expect(html).toMatch(/id="seatOverlayBody"\s+class="overlay-box seat-overlay-box"/);
  });

  it("the killed slide-down #localSeatEditor drawer is GONE", () => {
    expect(html).not.toMatch(/id="localSeatEditor"/);
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

describe("LocalSeatEditor — CSS", () => {
  const css = read("public/styles/landing.css");

  it("seat-row + seat-diff + seat-remove styles are unscoped (used by both surfaces)", () => {
    // After the redesign these primitives are shared between #seatScreen
    // and #seatOverlay, so they no longer hang off .local-seat-editor.
    expect(css).toMatch(/^\.seat-row\s*\{/m);
    expect(css).toMatch(/^\.seat-diff\s*\{/m);
    expect(css).toMatch(/^\.seat-remove\s*\{/m);
  });

  it("seat-overlay-box has its own styles (modal in-game editor)", () => {
    expect(css).toMatch(/\.seat-overlay-box\s*\{/);
  });

  it("seat-screen-card + seat-screen-start cover the pre-game flow", () => {
    expect(css).toMatch(/\.seat-screen-card\s*\{/);
    expect(css).toMatch(/\.seat-screen-start\s*\{/);
  });
});

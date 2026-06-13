// qwixx-active-button.test.ts — pins the active-player button state
// machine the user asked for:
//
//   marked NOTHING this turn   → "Take Penalty" (red, warning icon)
//   marked white only          → "Skip color"   (skip-forward icon)
//   marked color only          → "Skip white"   (skip-forward icon)
//   marked both                → "Finish"       (check icon)
//   white-phase, others pending after we skipped → passive "Waiting…"
//
// Source-marker style: we inspect 02-qwixx.js for the branch structure,
// rather than rendering Qwixx in JSDOM (the engine + view + render path
// is already exercised by smoke-client). These tests prevent the
// state-machine from silently regressing back to the old one-button-fits-
// all model.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("public/js/02-qwixx.js", "utf8");

describe("Qwixx active-player button state machine", () => {
  it("has a 'Take Penalty' branch with the danger class + warning icon", () => {
    expect(src).toMatch(/Take Penalty/);
    expect(src).toMatch(/['"]danger['"]/);
    expect(src).toMatch(/icon\(['"]warning['"]\)[^)]*Take Penalty/);
  });

  it("has a 'Skip color' branch (active marked white only)", () => {
    expect(src).toMatch(/whiteMarked\s*&&\s*!colorMarked[\s\S]{0,200}Skip color/);
  });

  it("has a 'Skip white' branch (active marked color only)", () => {
    expect(src).toMatch(/!whiteMarked\s*&&\s*colorMarked[\s\S]{0,600}Skip white/);
  });

  it("has a 'Finish' branch (active marked both) with the check icon", () => {
    expect(src).toMatch(/icon\(['"]check['"]\)[^)]*Finish/);
  });

  it("guards the penalty branch behind 'others still pending' to avoid premature penalty UI", () => {
    // After the active player skips white but other humans are still
    // deciding, we MUST NOT show "Take Penalty" — the engine won't
    // accept finishTurn yet. Instead show a "Waiting…" line.
    expect(src).toMatch(/isWhite\s*&&\s*!pendingWhite\s*&&\s*!whiteMarked\s*&&\s*!colorMarked[\s\S]{0,600}Waiting for white-dice decisions/);
  });

  it("reads the engine fields the active state depends on", () => {
    // activeWhiteRow tells us whether the active player marked white;
    // activeColorUsed tells us whether they marked color. Both come
    // from the Qwixx engine (qwixx/server.ts).
    expect(src).toMatch(/activeWhiteRow/);
    expect(src).toMatch(/activeColorUsed/);
  });

  it("the 'danger' button class is styled red in main.css", () => {
    const css = readFileSync("public/styles/main.css", "utf8");
    expect(css).toMatch(/\.qwixx-ctrl-btn\.danger\s*\{[\s\S]*?qwixx-red/);
  });
});

describe("Horizontal centring is the platform default (user ask)", () => {
  const css = readFileSync("public/styles/main.css", "utf8");
  it("any board inside #mainBoardsContainer gets margin auto for h-centring", () => {
    // The platform-level rule sits at the bottom of main.css and
    // auto-margins .player-board / .qwixx-table inside the boards
    // container.
    expect(css).toMatch(/#mainBoardsContainer\s*>\s*\.player-board[\s\S]{0,200}margin-left:\s*auto[\s\S]{0,200}margin-right:\s*auto/);
  });
});

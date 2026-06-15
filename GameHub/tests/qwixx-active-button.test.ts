// qwixx-active-button.test.ts — pins the active-player turn-end button's
// 2-stage / 3-outcome state machine (the user's spec):
//
//   STAGE 1 — no die taken yet  → RED "Take penalty" (danger class, warning icon)
//   STAGE 2 — took white only    → "Skip colour"      (skip-forward icon)
//   STAGE 2 — took colour only   → "Skip white (sum)" (skip-forward icon)
//   BOTH taken                   → "Finish turn"      (check icon) → passes turn
//   skipped white but others still pending → passive "Waiting…" line
//
// Source-marker style: we inspect 02-qwixx.js for the branch structure
// rather than rendering Qwixx in JSDOM (the engine + view + render path is
// already exercised by smoke-client). These guards prevent the state machine
// from silently regressing.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("public/js/02-qwixx.js", "utf8");

describe("Qwixx active-player turn-end button state machine", () => {
  it("STAGE 1: a red 'Take penalty' button (danger class + warning icon) when nothing is taken", () => {
    expect(src).toMatch(/Take penalty/i);
    expect(src).toMatch(/['"]danger['"]/);
    expect(src).toMatch(/icon\(['"]warning['"]\)[^`]*Take penalty/i);
    // The penalty branch must be gated on nothing-taken-yet.
    expect(src).toMatch(/if\s*\(\s*!anyMarked\s*\)/);
  });

  it("STAGE 2: 'Skip colour' branch when only white was taken", () => {
    expect(src).toMatch(/whiteMarked\s*&&\s*!colorMarked[\s\S]{0,200}Skip colour/i);
  });

  it("STAGE 2: 'Skip white' branch when only colour was taken", () => {
    expect(src).toMatch(/!whiteMarked\s*&&\s*colorMarked[\s\S]{0,400}Skip white/i);
  });

  it("BOTH taken: a 'Finish turn' button with the check icon (passes the turn)", () => {
    expect(src).toMatch(/icon\(['"]check['"]\)[^`]*Finish turn/i);
  });

  it("penalty is a single click via finishTurn (engine auto-resolves pending white)", () => {
    // The stage-1 penalty button uses finishTurn, not skip — the engine now
    // auto-skips the roller's own pending white decision on finishTurn so the
    // penalty doesn't require two clicks.
    expect(src).toMatch(/Take penalty[\s\S]{0,80}finishTurn/i);
    const server = readFileSync("src/games/qwixx/server.ts", "utf8");
    // finishTurn during WHITE_PHASE must drop the active seat from
    // pendingWhiteDecisions when it's still pending.
    expect(server).toMatch(/finishTurn[\s\S]*?WHITE_PHASE[\s\S]*?pendingWhiteDecisions\.includes\(seat\)[\s\S]*?filter/);
  });

  it("still shows a passive 'Waiting…' line when others' white decisions are pending", () => {
    expect(src).toMatch(/isWhite\s*&&\s*!pendingWhite[\s\S]{0,300}Waiting for white-dice decisions/);
  });

  it("reads the engine fields the active state depends on", () => {
    // activeWhiteRow → roller took the white sum; activeColorUsed → took a
    // colour die. Both come from the Qwixx engine (qwixx/server.ts).
    expect(src).toMatch(/activeWhiteRow/);
    expect(src).toMatch(/activeColorUsed/);
  });

  it("the 'danger' button class is styled red in main.css", () => {
    const css = readFileSync("public/styles/main.css", "utf8");
    expect(css).toMatch(/\.qwixx-ctrl-btn\.danger\s*\{[\s\S]*?qwixx-red/);
  });

  it("the Qwixx controls are a fixed/floating bar so they are never clipped by #topArea", () => {
    // Regression guard for the 'skip button invisible on desktop' bug: the
    // controls live inside #topArea (max-height:38dvh; overflow:hidden), so
    // they must float (position:fixed) to escape that clip.
    const css = readFileSync("public/styles/main.css", "utf8");
    expect(css).toMatch(/\.qwixx-dice-zone\s+\.qwixx-controls\s*\{[\s\S]*?position:\s*fixed/);
  });
});

describe("Horizontal centring is the platform default (user ask)", () => {
  const css = readFileSync("public/styles/main.css", "utf8");
  it("any board inside #mainBoardsContainer gets margin auto for h-centring", () => {
    // The platform-level rule sits at the bottom of main.css and
    // auto-margins .player-board / .qwixx-table inside the boards
    // container.
    expect(css).toMatch(/#mainBoardsContainer\s*>\s*\.player-board[\s\S]{0,400}margin-left:\s*auto(?:\s*!important)?[\s\S]{0,200}margin-right:\s*auto/);
  });
});

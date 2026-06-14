// in-game-layout.test.ts — pins the in-game layout invariants after
// the Kit.Layout.fit tear-out. The browser does the layout via plain
// Flexbox; these tests pin the CSS that makes that happen.
//
// Three rules the user explicitly asked for:
//   1. Main player board sits FLUSH with the bottom of the viewport
//      (above the floating status bar / sticky controls). Achieved by
//      #mainBoardsContainer { display:flex; flex-direction:column;
//      justify-content:flex-end }.
//   2. Main board is HORIZONTALLY CENTERED by default. Achieved by
//      align-items:center on the container + margin:0 auto on the
//      inner board.
//   3. The board NEVER cuts off the deck/dice/mini sections above it.
//      Achieved by every above-section being flex:0 0 auto (so they
//      claim their content size first), and #mainBoardsContainer being
//      the SINGLE flex:1 1 auto child (absorbs leftover, never grows
//      into anyone else's space).
//
// This is a guard against the JS-solver pattern coming back — if any
// game adds Kit.Layout.fit() again, future contributors will see this
// test break and ask why before adding more rules to the pile.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("public/styles/main.css", "utf8");

describe("In-game layout (flexbox-only)", () => {
  it("#mainBoardsContainer is a column-flex GROWER docking content to the bottom", () => {
    expect(css).toMatch(/#mainBoardsContainer\s*\{[\s\S]*?display:\s*flex/);
    expect(css).toMatch(/#mainBoardsContainer\s*\{[\s\S]*?flex-direction:\s*column/);
    expect(css).toMatch(/#mainBoardsContainer\s*\{[\s\S]*?justify-content:\s*flex-end/);
    expect(css).toMatch(/#mainBoardsContainer\s*\{[\s\S]*?align-items:\s*center/);
  });

  it("Direct children of #mainBoardsContainer (.player-board, .qwixx-table) are auto-margined → horizontally centred", () => {
    expect(css).toMatch(/#mainBoardsContainer\s*>\s*\.player-board[\s\S]*?margin-left:\s*auto[\s\S]*?margin-right:\s*auto/);
    expect(css).toMatch(/#mainBoardsContainer\s*>\s*\.qwixx-table/);
  });

  it("The above-board sections are flex:0 0 auto (so they don't get squeezed by the grower)", () => {
    // .game-topbar, .top-area, .mini-boards-container, .status-bar.
    // These already lived in the mobile-fit block of main.css; we just
    // assert they're still there (and haven't been replaced by some
    // solver-based sizing).
    expect(css).toMatch(/\.game-topbar\s*\{[\s\S]*?flex:\s*0\s+0\s+(?:auto|var\(--topbar-h\))/);
    expect(css).toMatch(/\.top-area\s*\{[\s\S]*?flex:\s*0\s+0\s+auto/);
    expect(css).toMatch(/\.mini-boards-container\s*\{[\s\S]*?flex:\s*0\s+0\s+auto/);
    expect(css).toMatch(/\.status-bar\s*\{[\s\S]*?flex:\s*0\s+0\s+auto/);
  });

  it("Qwixx focus table sizes to content (height:auto) — not 100% — so it docks at bottom without dead space", () => {
    // The OLD .qwixx-table { height: 100% } was the cause of the
    // "Qwixx vertically centered with dead space" complaint.
    expect(css).toMatch(/\.qwixx-table\s*\{[^}]*?height:\s*auto/);
    // The OFFENDING property is literal `height: 100%` (not the
    // newer `max-height: 100%` which is a cap, not a claim). Use a
    // negative-lookbehind to exclude max-height matches.
    expect(css).not.toMatch(/\.qwixx-table\s*\{[^}]*?(?<!max-)height:\s*100%/);
  });
});

describe("Kit.Layout.fit JS solver was removed", () => {
  const layout = readFileSync("public/js/00-kit-layout.js", "utf8");
  it("Kit.Layout no longer exposes fit / fitReset / solveSections", () => {
    expect(layout).not.toMatch(/\bfit\s*,/);
    expect(layout).not.toMatch(/\bfitReset\b/);
    expect(layout).not.toMatch(/\bsolveSections\b/);
    expect(layout).not.toMatch(/FIT_VAR_PREFIX/);
  });
  it("Only the declarative apply / current / reset / FIELD_MAP API remains", () => {
    expect(layout).toMatch(/Kit\.Layout\s*=\s*\{\s*apply,\s*current,\s*reset,\s*FIELD_MAP\s*\}/);
  });
});

describe("No game still calls Kit.Layout.fit", () => {
  for (const file of ["02-qwixx.js", "03-skyjo.js", "04-flip7.js"]) {
    it(`${file} does not call Kit.Layout.fit`, () => {
      const src = readFileSync("public/js/" + file, "utf8");
      expect(src).not.toMatch(/Kit\.Layout\.fit\b/);
    });
  }
});

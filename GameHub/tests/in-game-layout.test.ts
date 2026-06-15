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
  it("#mainBoardsContainer is a column-flex container docking content to the bottom (with flex-wrap:nowrap)", () => {
    expect(css).toMatch(/#mainBoardsContainer\s*\{[\s\S]*?display:\s*flex/);
    expect(css).toMatch(/#mainBoardsContainer\s*\{[\s\S]*?flex-direction:\s*column/);
    expect(css).toMatch(/#mainBoardsContainer\s*\{[\s\S]*?justify-content:\s*flex-end/);
    expect(css).toMatch(/#mainBoardsContainer\s*\{[\s\S]*?align-items:\s*center/);
    // v77 fix: flex-wrap MUST be nowrap. The legacy `.boards-container`
    // rule sets flex-wrap:wrap which, in a column-direction container,
    // shrink-wraps each child to its own flex line and makes
    // `align-items: center` + `margin: auto` no-ops on the cross axis.
    // Regression of this bug produced the left-aligned board screenshots
    // the user complained about three rounds in a row.
    expect(css).toMatch(/#mainBoardsContainer\s*\{[\s\S]*?flex-wrap:\s*nowrap/);
  });

  it("v79 responsive rescale: above-board sections are content-sized; the main board is the GROWER that can SHRINK", () => {
    // ─── Regression guard for the 'doesn't rescale' bug ───────────────
    // Root cause was that EVERY child of the #gameScreen flex column was
    // `flex:0 0 auto` (incl. #mainBoardsContainer) + `margin-top:auto` on
    // the minis. With nothing able to grow OR shrink, on short viewports
    // the column exceeded 100dvh and #gameScreen's overflow:hidden CLIPPED
    // the bottom of the player's board (verified in Chromium: a 1280x720
    // laptop cut off the bottom card row + status bar). margin-top:auto
    // also resolved to 0 under overflow and spilled content off-screen.
    //
    // Fix: minis + top-area stay content-sized (hug the top); the main
    // board becomes the single flex grower AND is allowed to shrink
    // (flex:1 1 auto + min-height:0), so it absorbs spare space on tall
    // screens and contracts on short ones. Paired with height-aware card
    // caps (--card-h-cap), cards rescale to fit instead of being clipped.
    expect(css).toMatch(/#gameScreen\.active\s*>\s*\.mini-boards-container[\s\S]*?flex:\s*0\s+0\s+auto/);
    expect(css).toMatch(/#gameScreen\.active\s*>\s*#topArea[\s\S]*?flex:\s*0\s+0\s+auto/);
    expect(css).toMatch(/#gameScreen\.active\s*>\s*#mainBoardsContainer[\s\S]*?flex:\s*1\s+1\s+auto/);
    // The grower MUST be allowed to shrink below its content size, else it
    // clips again instead of rescaling.
    expect(css).toMatch(/#gameScreen\.active\s*>\s*#mainBoardsContainer[\s\S]*?min-height:\s*0/);
    // The minis must NOT carry margin-top:auto anymore (that was the
    // bottom-dock trick that pushed content off the top under overflow).
    expect(css).not.toMatch(/#gameScreen\.active\s*>\s*\.mini-boards-container[\s\S]*?margin-top:\s*auto/);
  });

  it("v79 responsive rescale: card width is bounded by viewport HEIGHT, not width alone", () => {
    // The core of the bug: --bcard-w / --slot-w used width-only
    // clamp(min, Xvw, max), so on short-but-wide viewports cards stayed
    // full size while height collapsed → overflow + clip. They must now
    // take the SMALLER of the width budget and a height-derived ceiling.
    expect(css).toMatch(/--card-h-cap\s*:/);
    expect(css).toMatch(/--bcard-w\s*:\s*min\(/);
    expect(css).toMatch(/--slot-w\s*:\s*min\(/);
    // The height ceiling must reference a viewport-height unit so it
    // actually responds to height (dvh/vh).
    expect(css).toMatch(/--card-h-cap\s*:\s*[\d.]+\s*d?vh/);
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

describe("Action controls never overlap boards (bottom safe-zone)", () => {
  const cards = readFileSync("public/js/00-cards.js", "utf8");
  it("Kit.Controls reserves a measured bottom band on #gameScreen", () => {
    // Controls + status bar height is reserved as --gs-bottom-reserve so boards
    // (and Kit.Fit's available height) stop ABOVE the floating buttons.
    expect(cards).toMatch(/--gs-bottom-reserve/);
    expect(cards).toMatch(/function\s+syncBottomReserve/);
  });
  it("#mainBoardsContainer reserves that band via padding-bottom", () => {
    expect(css).toMatch(/--gs-bottom-reserve/);
    expect(css).toMatch(/padding-bottom:\s*calc\(var\(--gs-bottom-reserve/);
  });
});

describe("Group picker is styled (was unstyled → giant button / unreadable input)", () => {
  it("has .group-picker popover + sized input/join CSS", () => {
    expect(css).toMatch(/\.group-picker\s*\{[\s\S]*?position:\s*fixed/);
    expect(css).toMatch(/\.group-picker-input\s*\{/);
    expect(css).toMatch(/\.group-picker-join-btn\s*\{/);
    // the join button must be auto-width (not the full-width default .btn that
    // overflowed off-screen)
    expect(css).toMatch(/\.group-picker-join-btn\s*\{[\s\S]*?width:\s*auto/);
  });
});

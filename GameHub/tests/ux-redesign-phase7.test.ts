// ux-redesign-phase7.test.ts — pins the Phase 7 contract:
//   1. The W1 Kit.MiniBoard tier system is the SOLE source of
//      mini-board responsive sizing — legacy !important overrides
//      from main.css that fought it are gone.
//   2. Specifically: no rule hides .board-mini's header anymore on
//      mobile (the user complaint that "you couldn't see the
//      miniature player board of the bot"). The Kit.MiniBoard
//      tier system swaps full name → initials at xs/sm tiers,
//      but never hides the header outright.
//   3. The mini-board container has a clear, single max-height
//      budget per viewport (not multiple competing rules).
//   4. Inspect popup (#investigateBox) overrides container defaults
//      cleanly via specificity — no `.mini-boards-container:not(...)`
//      cascade soup.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("public/styles/main.css", "utf8");

describe("UX redesign Phase 7 — legacy mini-board overrides removed", () => {
  it("no rule sets `.board-mini .board-header{display:none}` on mobile (user complaint)", () => {
    // The original offender:
    //   @media(max-width:430px){ .board-mini .board-header{display:none} }
    // Any rule that hides .board-mini's header outright is a regression.
    expect(css).not.toMatch(/\.board-mini\s+\.board-header\s*\{\s*display\s*:\s*none/);
  });

  it("no rule sets `.kc-zone-skyjo{--kc-w:8px!important}` (the user's 'too small' case)", () => {
    expect(css).not.toMatch(/--kc-w\s*:\s*8px\s*!important/);
  });

  it("contradictory grid-template-columns are gone (1fr vs 16px battling each other)", () => {
    // The pre-Phase-7 file had BOTH on .board-mini .board-grid. Only
    // the new clean rule (using --mini-skyjo-w custom prop) should
    // survive.
    const hits = (css.match(/\.board-mini\s+\.board-grid\s*\{[^}]*grid-template-columns/g) || []).length;
    // Hits from the inspect popup (#investigateBox) are scoped + fine —
    // count only the bare .board-mini rules.
    const bareHits = (css.match(/(?<!#investigateBox\s)(?<!:not\([^)]*\)\s)\.board-mini\s+\.board-grid\s*\{[^}]*grid-template-columns/g) || []).length;
    // We expect exactly ONE bare rule (the new one inside
    // .mini-boards-container .board-mini .board-grid).
    expect(bareHits).toBe(1);
  });
});

describe("UX redesign Phase 7 — single source of truth for container budget", () => {
  it("max-height progression is sensible (28dvh → 24dvh → 20dvh → 16dvh)", () => {
    // Default
    expect(css).toMatch(/\.mini-boards-container\s*\{[\s\S]*?max-height:\s*28dvh/);
    // 760px breakpoint
    expect(css).toMatch(/@media\(max-width:760px\)\s*\{\s*\.mini-boards-container\s*\{[\s\S]*?max-height:\s*24dvh/);
    // 430px breakpoint
    expect(css).toMatch(/@media\(max-width:430px\)\s*\{\s*\.mini-boards-container\s*\{[\s\S]*?max-height:\s*20dvh/);
    // short height
    expect(css).toMatch(/@media\(max-height:640px\)\s*\{\s*\.mini-boards-container\s*\{[\s\S]*?max-height:\s*16dvh/);
  });

  it("uses a CSS custom property (--mini-skyjo-w) so card width is one knob, not 12 !important rules", () => {
    expect(css).toMatch(/--mini-skyjo-w/);
    expect(css).toMatch(/\.kc-zone-skyjo\s*\{[\s\S]*?--kc-w\s*:\s*var\(--mini-skyjo-w/);
  });
});

describe("UX redesign Phase 7 — inspect popup overrides cleanly via specificity", () => {
  it("uses #investigateBox prefix instead of the .mini-boards-container:not(.f7-mini-strip) cascade", () => {
    // The old code used .mini-boards-container:not(.f7-mini-strip)
    // selector chains specifically tuned for the popup — wildly
    // confusing. New code: #investigateBox .board-mini { ... }
    expect(css).toMatch(/#investigateBox\s+\.board-mini/);
    // The :not() variant should be gone entirely (not just outside
    // the popup block).
    expect(css).not.toMatch(/\.mini-boards-container:not\(\.f7-mini-strip\)/);
  });
});

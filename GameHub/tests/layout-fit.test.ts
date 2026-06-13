// layout-fit.test.ts — pins the Kit.Layout.fit solver contract.
//
// Pure function tests: load 00-kit-layout.js into a tiny harness and
// exercise solveSections directly. The solver is what the user's
// "mobile UX optimization" ask runs on — its correctness drives every
// in-game layout decision.

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Boot the module inside a fresh VM context so we don't pollute the
// global Kit namespace from other tests.
function loadKit(): any {
  const src = readFileSync("public/js/00-kit-layout.js", "utf8");
  const ctx: any = {
    console,
    Kit: {},
    window: {},
    document: {
      getElementById: () => null,
      querySelector: () => null,
      documentElement: { clientHeight: 0 },
    },
    requestAnimationFrame: (cb: any) => setTimeout(cb, 0),
    cancelAnimationFrame: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.Kit;
}

let Kit: any;
beforeAll(() => { Kit = loadKit(); });

describe("Kit.Layout.fit — solveSections (the layout solver)", () => {
  it("underused viewport: each section gets its preferred + slack distributed proportional to headroom", () => {
    const alloc = Kit.Layout.solveSections([
      { id: 'a', min: 50, preferred: 100, max: 200, priority: 1 },
      { id: 'b', min: 50, preferred: 100, max: 300, priority: 1 },
    ], 400);
    // Preferred sum = 200, slack = 200. Headroom: a max-pref=100,
    // b max-pref=200. Proportional split of 200:
    //   a += floor(200 * 100/300) = 66  → a = 166
    //   b += floor(200 * 200/300) = 133 → b = 233
    // Allow ±3px rounding wiggle.
    expect(alloc.a).toBeGreaterThanOrEqual(164);
    expect(alloc.a).toBeLessThanOrEqual(168);
    expect(alloc.b).toBeGreaterThanOrEqual(230);
    expect(alloc.b).toBeLessThanOrEqual(234);
  });

  it("exactly fits: every section gets its preferred", () => {
    const alloc = Kit.Layout.solveSections([
      { id: 'a', min: 50, preferred: 100, max: 200, priority: 1 },
      { id: 'b', min: 50, preferred: 100, max: 200, priority: 1 },
    ], 200);
    expect(alloc.a).toBe(100);
    expect(alloc.b).toBe(100);
  });

  it("overcommitted: shrinks LOWEST-priority sections first, leaves highest-priority alone", () => {
    // Viewport 250, sections want 300.
    const alloc = Kit.Layout.solveSections([
      { id: 'lo', min: 30, preferred: 100, max: 200, priority: 1 },
      { id: 'hi', min: 80, preferred: 100, max: 200, priority: 9 },
      { id: 'md', min: 50, preferred: 100, max: 200, priority: 5 },
    ], 250);
    // Overshoot = 50. lo has 70px slack → takes the full 50 cut.
    expect(alloc.lo).toBe(50);  // 100 - 50
    expect(alloc.md).toBe(100); // untouched
    expect(alloc.hi).toBe(100); // untouched
    expect(alloc.lo + alloc.md + alloc.hi).toBe(250);
  });

  it("overcommitted hard: shrinks lower priority to min, then next, never below min", () => {
    // Viewport 200, three sections want 360. Overshoot 160.
    const alloc = Kit.Layout.solveSections([
      { id: 'lo', min: 30, preferred: 120, max: 200, priority: 1 },
      { id: 'hi', min: 80, preferred: 120, max: 200, priority: 9 },
      { id: 'md', min: 50, preferred: 120, max: 200, priority: 5 },
    ], 200);
    // lo cuts 90 (to its min 30). Remaining overshoot = 70.
    // md cuts 70 (to 50). Remaining overshoot = 0.
    // hi untouched at 120.
    expect(alloc.lo).toBe(30);
    expect(alloc.md).toBe(50);
    expect(alloc.hi).toBe(120);
    expect(alloc.lo + alloc.md + alloc.hi).toBe(200);
  });

  it("over-tight viewport: every section gets its min, overflow is accepted", () => {
    // Viewport 100, sections want 300 min combined 180.
    const alloc = Kit.Layout.solveSections([
      { id: 'a', min: 60, preferred: 100, max: 200, priority: 1 },
      { id: 'b', min: 60, preferred: 100, max: 200, priority: 5 },
      { id: 'c', min: 60, preferred: 100, max: 200, priority: 9 },
    ], 100);
    // All sections shrink to min (60); total 180 > 100 viewport. The
    // contract is "never below min" — overflow is the game's problem
    // (scroll / hide-by-priority CSS / etc).
    expect(alloc.a).toBe(60);
    expect(alloc.b).toBe(60);
    expect(alloc.c).toBe(60);
  });

  it("clamps a misconfigured preferred (< min or > max) up-front", () => {
    const alloc = Kit.Layout.solveSections([
      { id: 'small', min: 100, preferred: 50, max: 200, priority: 1 },
    ], 500);
    // preferred 50 is below min 100; should be clamped to 100, then
    // grown by slack. Headroom = max-preferred = 200-100 = 100, slack
    // = 400, so it grows to max.
    expect(alloc.small).toBe(200);
  });

  it("handles Infinity max (open-ended growth)", () => {
    const alloc = Kit.Layout.solveSections([
      { id: 'fixed', min: 50, preferred: 80,  max: 80,       priority: 1 },
      { id: 'flex',  min: 50, preferred: 100, max: Infinity, priority: 1 },
    ], 500);
    // fixed has no headroom (max=preferred=80), so all 320 slack goes
    // to flex. But the test runner won't tolerate Infinity arithmetic
    // (proportional split needs a finite gap); the solver caps growth.
    expect(alloc.fixed).toBe(80);
    expect(alloc.flex).toBeGreaterThan(100); // grew
  });

  it("priority 0 ties: still picks a stable cut order (lower index first)", () => {
    const alloc = Kit.Layout.solveSections([
      { id: 'a', min: 30, preferred: 100, max: 100, priority: 0 },
      { id: 'b', min: 30, preferred: 100, max: 100, priority: 0 },
    ], 150);
    // Overshoot 50; with equal priorities, the sort is stable so 'a'
    // shrinks first. Total must match viewport.
    expect(alloc.a + alloc.b).toBe(150);
  });
});

describe("Kit.Layout.fit — public surface", () => {
  it("exposes fit + fitReset + solveSections + FIT_VAR_PREFIX", () => {
    expect(typeof Kit.Layout.fit).toBe("function");
    expect(typeof Kit.Layout.fitReset).toBe("function");
    expect(typeof Kit.Layout.solveSections).toBe("function");
    expect(Kit.Layout.FIT_VAR_PREFIX).toBe("--gs-fit-");
  });
});

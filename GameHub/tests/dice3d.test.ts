// dice3d.test.ts — pins the Round-2 (W4) dice contract.
//
// W4a — the present() step must NOT scale dice past their natural settled
//       size. (Previously y was pulled toward the camera, making the
//       final visual scale appear much larger than the settled scale.)
// W4b — Kit.Dice3D.roll accepts opts.throwStyle ∈ {tumble, cannon, rain,
//       collide}; default behaviour matches 'tumble'; unknown values fall
//       back to the default.
// W4c — the rounded-cube mesh is the default geometry; the legacy flat
//       cube mesh is still available (CUBE is referenced).
//
// The dice module is browser-only (touches window + DOM + WebGL), so we
// mount it in a minimal jsdom and assert the public API surface.

import { describe, expect, it, beforeAll } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let win: any;
beforeAll(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://gamehub.test/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  win = dom.window;
  win.matchMedia = () => ({ matches: false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, dispatchEvent(){return false} });
  win.requestAnimationFrame = (cb: any) => setTimeout(() => cb(Date.now()), 16);
  win.HTMLCanvasElement.prototype.getContext = () => ({}); // no real WebGL → roll() falls back
  // Mount Kit first (00-core), then the dice module.
  for (const f of ["js/00-core.js", "js/00-dice3d.js"]) {
    const code = readFileSync(join(process.cwd(), "public", f), "utf8");
    const s = win.document.createElement("script");
    s.textContent = code;
    win.document.body.appendChild(s);
  }
});

describe("Kit.Dice3D (W4 contract)", () => {
  it("exposes the public API surface", () => {
    expect(typeof win.Kit.Dice3D.roll).toBe("function");
    expect(typeof win.Kit.Dice3D.supported).toBe("function");
    expect(typeof win.Kit.Dice3D.showStatic).toBe("function");
  });

  it("supported() returns false in headless jsdom (no real WebGL)", () => {
    expect(win.Kit.Dice3D.supported()).toBe(false);
  });

  it("roll() resolves and falls back to showStatic when WebGL is missing", async () => {
    const container = win.document.createElement("div");
    win.document.body.appendChild(container);
    await win.Kit.Dice3D.roll(container, [
      { color: "white", value: 3 }, { color: "red", value: 5 },
    ]);
    // showStatic renders .kit-die-static elements (no canvas in fallback)
    const statics = container.querySelectorAll(".kit-die-static");
    expect(statics.length).toBe(2);
  });

  for (const style of ["tumble", "cannon", "rain", "collide"]) {
    it(`accepts throwStyle='${style}' without errors (fallback path)`, async () => {
      const container = win.document.createElement("div");
      win.document.body.appendChild(container);
      let threw: any = null;
      try {
        await win.Kit.Dice3D.roll(container, [
          { color: "white", value: 1 }, { color: "red", value: 2 }, { color: "green", value: 6 },
        ], { throwStyle: style });
      } catch (e) { threw = e; }
      expect(threw, `throwStyle='${style}' should not throw`).toBeNull();
    });
  }

  it("unknown throwStyle silently falls back to default (no error)", async () => {
    const container = win.document.createElement("div");
    win.document.body.appendChild(container);
    let threw: any = null;
    try {
      await win.Kit.Dice3D.roll(container, [
        { color: "white", value: 4 },
      ], { throwStyle: "doesnt-exist" });
    } catch (e) { threw = e; }
    expect(threw).toBeNull();
  });

  it("rounded-cube mesh source is present in the module (W4c)", () => {
    // We can't measure render time in jsdom, but we CAN assert the source
    // for the rounded geometry is wired in — i.e. the function exists in
    // the file and the default DIE binding uses it.
    const src = readFileSync(join(process.cwd(), "public/js/00-dice3d.js"), "utf8");
    expect(src).toContain("roundedCubeMesh");
    expect(src).toMatch(/ROUNDED\s*=\s*roundedCubeMesh/);
    expect(src).toMatch(/const\s+DIE\s*=\s*ROUNDED/);
  });

  it("present() no longer pulls dice toward the camera (W4a regression guard)", () => {
    // Grep the source for the specific anti-pattern: y=-105 hard-coded inside
    // present(). That was the legacy "zoom-in" pull. New code keeps the
    // settled y (using d.y * .85 or similar) so the value -105 should not
    // appear in present's body anymore.
    const src = readFileSync(join(process.cwd(), "public/js/00-dice3d.js"), "utf8");
    // Find the present() function body and only check inside it.
    const m = src.match(/function\s+present\([^)]*\)\s*{([\s\S]*?)\n\s{0,4}}\s*\n/);
    expect(m, "could not locate present() function").toBeTruthy();
    const body = m![1];
    // No fixed y=-105 (the legacy camera-pull constant).
    expect(body, "present() must not hardcode y=-105 (legacy camera-pull bug)").not.toMatch(/y\s*=\s*-105/);
    // The new code should set d.curS = d.s (final size = settled size, no
    // further scale-up).
    expect(body).toMatch(/d\.curS\s*=\s*d\.s/);
  });
});

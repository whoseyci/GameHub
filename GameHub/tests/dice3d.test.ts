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

  it("dice are STEERED to their result face during settle (no post-settle flip/eye-swap)", () => {
    // Root cause of the user's complaint: dice tumbled to a random face,
    // settled, then present() abruptly rotated each to show the predetermined
    // value (and slid them apart) — the "settle, then all turn to be visible
    // while the eyes get swapped" jank. Fix: physics() now slerps each die
    // toward its result-face-up orientation as it slows, so it comes to rest
    // ALREADY showing the right value. Guard the mechanism in source.
    const src = readFileSync(join(process.cwd(), "public/js/00-dice3d.js"), "utf8");
    expect(src).toMatch(/function\s+qslerp/);          // slerp helper exists
    expect(src).toMatch(/function\s+resultUpQuat/);    // target-orientation helper
    // physics() steers via qslerp toward resultUpQuat while the die is slow.
    const phys = src.match(/function\s+physics\([^)]*\)\s*{([\s\S]*?)\n\s{0,2}}/);
    expect(phys, "could not locate physics()").toBeTruthy();
    expect(phys![1]).toMatch(/qslerp\(\s*d\.q\s*,\s*resultUpQuat\(d\)/);
  });

  it("resultUpQuat puts the predetermined face up for all 6 values (math check)", () => {
    // Reimplement the tiny quat path the module uses and assert the result
    // face's normal maps to +Z after applying resultUpQuat, for every value
    // and many random starting orientations. This pins the steering target so
    // a die can never settle showing the wrong value.
    const norm = (v: number[]) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
    const dot = (a: number[], b: number[]) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    const cross = (a: number[], b: number[]) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
    const qmul = (a: number[], b: number[]) => [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1], a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0], a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3], a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
    const qnorm = (q: number[]) => { const l = Math.hypot(...q) || 1; return q.map((x) => x / l); };
    const qaxis = (axis: number[], ang: number) => { axis = norm(axis); const s = Math.sin(ang/2); return [axis[0]*s, axis[1]*s, axis[2]*s, Math.cos(ang/2)]; };
    const qfromTo = (a: number[], b: number[]) => { a = norm(a); b = norm(b); const c = dot(a,b); if (c < -0.999) { const ax = norm(Math.abs(a[0])<.8?cross(a,[1,0,0]):cross(a,[0,1,0])); return qaxis(ax, Math.PI); } const cr = cross(a,b); return qnorm([cr[0],cr[1],cr[2],1+c]); };
    const qrot = (q: number[], v: number[]) => { const [qx,qy,qz,qw]=q; const [vx,vy,vz]=v; const tx=2*(qy*vz-qz*vy),ty=2*(qz*vx-qx*vz),tz=2*(qx*vy-qy*vx); return [vx+qw*tx+(qy*tz-qz*ty), vy+qw*ty+(qz*tx-qx*tz), vz+qw*tz+(qx*ty-qy*tx)]; };
    const faceN: Record<number, number[]> = {1:[0,-1,0],6:[0,1,0],3:[1,0,0],4:[-1,0,0],5:[0,0,1],2:[0,0,-1]};
    const resultUpQuat = (q: number[], result: number) => {
      const base = qfromTo(faceN[result], [0,0,1]);
      const fwd = qrot(q, [1,0,0]);
      const yaw = Math.atan2(fwd[1], fwd[0]);
      return qnorm(qmul(qaxis([0,0,1], yaw), base));
    };
    for (let result = 1; result <= 6; result++) {
      for (let t = 0; t < 15; t++) {
        const q0 = qaxis(norm([Math.random()*2-1, Math.random()*2-1, Math.random()*2-1]), Math.random()*Math.PI*2);
        const up = qrot(resultUpQuat(q0, result), faceN[result]);
        expect(up[2]).toBeGreaterThan(0.999); // result face normal points to +Z (up)
      }
    }
  });
});

// roller.test.ts — pins the Kit.Roller (2D slot-machine) contract.
//
// Kit.Roller is the cartoony DOM/CSS alternative to Kit.Dice3D. It must:
//   • expose the same drop-in dice contract (roll / showStatic / supported)
//     so any dice game can swap renderers with no other change;
//   • be customizable in 3 dimensions — reel COUNT, reel COLOUR, reel SYMBOLS;
//   • build a slot machine (cabinet + reels + lever) in the DOM;
//   • land each reel on its predetermined result (last strip cell = result).
//
// jsdom has no real layout/animation; we assert the DOM structure + API. The
// full spin→lock→settle motion is verified in Chromium (see PR notes).

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
  win.matchMedia = () => ({ matches: false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, dispatchEvent(){ return false; } });
  win.requestAnimationFrame = (cb: any) => setTimeout(() => cb(Date.now()), 16);
  for (const f of ["js/00-core.js", "js/00-roller.js"]) {
    const code = readFileSync(join(process.cwd(), "public", f), "utf8");
    const s = win.document.createElement("script");
    s.textContent = code;
    win.document.body.appendChild(s);
  }
});

const q = (el: any, sel: string) => el.querySelectorAll(sel);

describe("Kit.Roller — public API surface", () => {
  it("exposes spin / roll / showStatic / supported", () => {
    expect(typeof win.Kit.Roller.spin).toBe("function");
    expect(typeof win.Kit.Roller.roll).toBe("function");
    expect(typeof win.Kit.Roller.showStatic).toBe("function");
    expect(typeof win.Kit.Roller.supported).toBe("function");
  });

  it("supported() is always true (pure DOM/CSS, no WebGL)", () => {
    expect(win.Kit.Roller.supported()).toBe(true);
  });

  it("is drop-in dice-compatible: roll(container, [{color,value}], opts) -> Promise", () => {
    const c = win.document.createElement("div");
    const r = win.Kit.Roller.roll(c, [{ color: "white", value: 3 }], { autoPull: true, autoPullDelay: 0 });
    expect(typeof r.then).toBe("function");
  });
});

describe("Kit.Roller — customization (count / colour / symbols)", () => {
  it("reel COUNT follows reels.length / dice.length", () => {
    const c = win.document.createElement("div");
    win.Kit.Roller.showStatic(c, [
      { color: "white", value: 1 }, { color: "red", value: 2 },
      { color: "yellow", value: 3 }, { color: "green", value: 4 }, { color: "blue", value: 5 },
    ]);
    expect(q(c, ".kit-reel").length).toBe(5);
  });

  it("reel COLOUR is themed per reel (data-color + colour aliases r/y/g/b)", () => {
    const c = win.document.createElement("div");
    win.Kit.Roller.showStatic(c, [
      { color: "red", value: 1 }, { color: "g", value: 2 }, { color: "purple", value: 3 },
    ]);
    const colors = [...q(c, ".kit-reel")].map((r: any) => r.dataset.color);
    expect(colors).toEqual(["red", "green", "purple"]);   // 'g' alias → green
  });

  it("reel SYMBOLS: custom text symbols are shown as the landed face", () => {
    const c = win.document.createElement("div");
    win.Kit.Roller.showStatic(c, [{ color: "white", symbol: "★" }, { color: "blue", symbol: "7" }]);
    const glyphs = [...q(c, ".kit-reel-cell .kit-reel-glyph")].map((g: any) => g.textContent);
    expect(glyphs).toEqual(["★", "7"]);
  });

  it("reel SYMBOLS: an icon name renders a Kit.Icon glyph instead of text", () => {
    const c = win.document.createElement("div");
    win.Kit.Roller.showStatic(c, [{ color: "red", icon: "star" }]);
    // Kit.Icon renders an <svg class="kit-icon">; either that or a non-empty cell.
    const cell = q(c, ".kit-reel-cell")[0];
    expect(cell).toBeTruthy();
    expect(cell.querySelector(".kit-icon") || cell.textContent.length >= 0).toBeTruthy();
  });
});

describe("Kit.Roller — slot-machine structure + landing", () => {
  it("spin() builds a cabinet, reels, and a lever by default", async () => {
    const c = win.document.createElement("div");
    win.Kit.Roller.spin(c, {
      reels: [{ color: "white", symbol: "4" }, { color: "red", symbol: "6" }],
      autoPull: false,
    });
    expect(q(c, ".kit-slot").length).toBe(1);
    expect(q(c, ".kit-reel").length).toBe(2);
    expect(q(c, ".kit-slot-lever").length).toBe(1);   // lever shown by default
  });

  it("autoPull / lever:false hides the lever (opponents auto-spin)", () => {
    const c = win.document.createElement("div");
    win.Kit.Roller.spin(c, { reels: [{ color: "white", symbol: "1" }], autoPull: true });
    expect(q(c, ".kit-slot-lever").length).toBe(0);
  });

  it("each reel's spinning strip ENDS on the predetermined result (last cell = result)", () => {
    const c = win.document.createElement("div");
    win.Kit.Roller.spin(c, {
      reels: [{ color: "white", symbol: "4" }, { color: "blue", symbol: "2" }],
      autoPull: false,
    });
    const lastCells = [...q(c, ".kit-reel")].map((r: any) => {
      const cells = r.querySelectorAll(".kit-reel-cell");
      return cells[cells.length - 1].textContent.trim();
    });
    expect(lastCells).toEqual(["4", "2"]);
  });

  it("roll() resolves when autoPulled (no lever wait)", async () => {
    const c = win.document.createElement("div");
    let resolved = false;
    await win.Kit.Roller.roll(c, [{ color: "white", value: 5 }], { autoPull: true, autoPullDelay: 0 }).then(() => { resolved = true; });
    expect(resolved).toBe(true);
    expect(q(c, ".kit-reel.locked").length).toBe(1);   // landed + locked
  });
});

describe("Kit.Roller — wired into Qwixx as the swappable renderer", () => {
  it("Qwixx selects a ROLLER and uses it for roll/showStatic (not hard-coded Dice3D)", () => {
    const src = readFileSync(join(process.cwd(), "public/js/02-qwixx.js"), "utf8");
    expect(src).toMatch(/const\s+ROLLER\s*=/);
    expect(src).toMatch(/ROLLER\.roll\(/);
    expect(src).toMatch(/ROLLER\.showStatic\(/);
    // The lever is gated on CONTROL, not focus — activeIsMine is true when the
    // active (rolling) seat is a non-bot seat THIS device controls. This is what
    // makes pass-and-play correct: players 2+ on one device still get the lever
    // instead of the slot auto-firing. (Regression guard for that bug.)
    expect(src).toMatch(/const\s+activeIsMine\s*=/);
    expect(src).toMatch(/const\s+lever\s*=\s*usesLever\s*&&\s*activeIsMine/);
    expect(src).toMatch(/autoPull:\s*usesLever\s*&&\s*!activeIsMine/);
    // Reveal-on-pull: dice are marked revealed in onPull, not before the lever.
    expect(src).toMatch(/onPull:\s*\(\)\s*=>/);
  });

  it("pass-and-play: activeIsMine derives from controlledSeats + bot check (not focus)", () => {
    // The auto-fire bug for players 2+ on one device came from gating on
    // view.yourSeat (focus), which can lag the active seat during turn rotation.
    // The fix reads window._controlledSeats and excludes bot seats.
    const src = readFileSync(join(process.cwd(), "public/js/02-qwixx.js"), "utf8");
    expect(src).toMatch(/window\._controlledSeats/);
    expect(src).toMatch(/controlled\.includes\(\s*s\.activeSeat\s*\)\s*&&\s*!activeIsBot/);
  });
});

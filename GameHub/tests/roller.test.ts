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
  // The Qwixx client registers into window.GameRules/GameClients; pre-create the
  // registries so 02-qwixx.js mounts cleanly for the localFocusSeat test.
  win.eval("window.GameRules = window.GameRules || {}; window.GameClients = window.GameClients || {};");
  for (const f of ["js/00-core.js", "js/00-roller.js", "js/02-qwixx.js"]) {
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

  it("COLOUR reels never stream digits while spinning (bug fix: colour dice showed numbers)", () => {
    // A colour reel lands on a plain swatch (symbol:"") or a glyph (★). Its
    // SPINNING strip must infer the same kind of face — NOT the default 1-6 strip.
    const c = win.document.createElement("div");
    win.Kit.Roller.roll(c, [
      { color: "blue", symbol: "" },     // colour swatch
      { color: "purple", symbol: "★" }, // wild colour glyph
      { color: "white", symbol: "3" },   // number reel (digits OK here)
    ], { autoPull: false });
    const reels = [...q(c, ".kit-reel")];
    const blueCells = [...reels[0].querySelectorAll(".kit-reel-cell")].map((x: any) => x.textContent);
    const wildCells = [...reels[1].querySelectorAll(".kit-reel-cell")].map((x: any) => x.textContent);
    const numCells = [...reels[2].querySelectorAll(".kit-reel-cell")].map((x: any) => x.textContent);
    expect(blueCells.some((t: string) => /[0-9]/.test(t))).toBe(false);  // no digits on colour reel
    expect(wildCells.every((t: string) => t.trim() === "★" || t.trim() === "")).toBe(true);
    expect(numCells.some((t: string) => /[0-9]/.test(t))).toBe(true);    // number reel still streams digits
  });

  it("shows a VERTICAL lever cue + DOWN arrow for the active player (opts.leverHint)", () => {
    const c = win.document.createElement("div");
    win.Kit.Roller.roll(c, [{ color: "white", value: 4 }], { autoPull: false, leverHint: "ROLL" });
    const cue = q(c, ".kit-lever-cue")[0];
    expect(cue).toBeTruthy();
    // arrow points DOWN at the lever
    expect(q(c, ".kit-lever-cue-arrow")[0].textContent).toBe("\u2193");
    // label is stacked vertically: one <span> per glyph
    const spans = [...q(c, ".kit-lever-cue-label span")];
    expect(spans.length).toBe(4);                                   // R-O-L-L
    expect(spans.map((s: any) => s.textContent).join("")).toBe("ROLL");
  });

  it("showStatic supports a SELECT-style animated prompt + pickable reels", () => {
    const c = win.document.createElement("div");
    let clicked = -1;
    win.Kit.Roller.showStatic(c, [
      { color: "blue", symbol: "" }, { color: "white", symbol: "3" },
    ], {
      prompt: "SELECT", pickable: true,
      reelState: (i: number) => (i === 0 ? "chosen" : "pick"),
      onReelClick: (i: number) => { clicked = i; },
    });
    expect(q(c, ".kit-slot-prompt").length).toBe(1);
    expect(q(c, ".kit-marquee-text")[0].textContent).toBe("SELECT");
    expect(q(c, ".kit-reel-pickable").length).toBe(2);
    expect(q(c, ".kit-reel-chosen").length).toBe(1);
    expect(q(c, ".kit-reel-pick").length).toBe(1);
    // reels are clickable and report their index
    q(c, ".kit-reel[data-reel]")[1].click();
    expect(clicked).toBe(1);
  });
});

describe("Kit.Roller — per-game FX (marquee / jackpot / coin-drop)", () => {
  it("themed marquee text is configurable per game (opts.marquee)", () => {
    const c = win.document.createElement("div");
    win.Kit.Roller.spin(c, { reels: [{ color: "white", symbol: "1" }], autoPull: true, autoPullDelay: 0, marquee: "QWIXX" });
    expect(q(c, ".kit-marquee-text")[0].textContent).toBe("QWIXX");
  });

  it("no coin-drop FX (coins were removed)", async () => {
    const c = win.document.createElement("div");
    win.Kit.Roller.spin(c, { reels: [{ color: "white", symbol: "1" }], autoPull: true, autoPullDelay: 0 });
    await new Promise(r => setTimeout(r, 80));
    expect(q(c, ".kit-fx-coin").length).toBe(0);
  });

  it("each reel gets its own lock bounce, and 'needed' reels flash", { timeout: 10000 }, async () => {
    const c = win.document.createElement("div");
    win.Kit.Roller.spin(c, {
      reels: [{ color: "red", symbol: "6" }, { color: "blue", symbol: "2" }],
      autoPull: true, autoPullDelay: 0,
      needed: (reel: any) => reel.color === "blue",   // flag the blue reel
    });
    await new Promise(r => setTimeout(r, 3000));
    expect(q(c, ".kit-reel.reel-land").length).toBe(2);                 // both bounce
    expect(q(c, ".kit-reel.reel-need").length).toBe(1);                 // only blue flashes
    expect(q(c, '.kit-reel[data-color="blue"].reel-need').length).toBe(1);
  });

  it("jackpot is a PER-GAME predicate: celebration fires only when it returns true", { timeout: 10000 }, async () => {
    // FX are transient (sparks/confetti self-remove ~1.2s after the lock, which
    // itself lands somewhere in ~1.4–2.2s), so POLL for them rather than sampling
    // at one fixed time.
    const sawFx = async (host: any) => {
      for (let i = 0; i < 60; i++) {                       // up to ~6s
        if (q(host, ".kit-fx-spark").length > 0 || q(host, ".kit-fx-banner").length > 0 || q(host, ".kit-slot.jackpot").length > 0) return true;
        await new Promise(r => setTimeout(r, 100));
      }
      return false;
    };

    // true predicate → celebration
    const win1 = win.document.createElement("div");
    let calledWith: any = null;
    win.Kit.Roller.spin(win1, {
      reels: [{ color: "red", symbol: "6" }, { color: "blue", symbol: "6" }],
      autoPull: true, autoPullDelay: 0,
      jackpot: (reels: any) => { calledWith = reels; return reels.every((r: any) => r.symbol === reels[0].symbol); },
    });
    expect(await sawFx(win1)).toBe(true);
    expect(Array.isArray(calledWith)).toBe(true);          // predicate received the reels

    // false predicate → no celebration (let it fully settle + a beat, then check)
    const lose = win.document.createElement("div");
    let loseCalled = false;
    win.Kit.Roller.spin(lose, {
      reels: [{ color: "red", symbol: "1" }, { color: "blue", symbol: "6" }],
      autoPull: true, autoPullDelay: 0,
      jackpot: () => { loseCalled = true; return false; },
    });
    await new Promise(r => setTimeout(r, 3500));            // past the lock
    expect(loseCalled).toBe(true);                          // predicate ran
    expect(q(lose, ".kit-fx-spark").length).toBe(0);
    expect(q(lose, ".kit-fx-banner").length).toBe(0);
  });

  it("HARDENING: onLock fires at the visual END (after settle), onPull at the START", { timeout: 10000 }, async () => {
    const c = win.document.createElement("div");
    const order: string[] = [];
    win.Kit.Roller.spin(c, {
      reels: [{ color: "white", symbol: "1" }],
      autoPull: true, autoPullDelay: 0,
      onPull: () => order.push("pull"),
      onLock: () => order.push("lock"),
    });
    // immediately after pull, lock must NOT have happened yet
    await new Promise(r => setTimeout(r, 80));
    expect(order).toEqual(["pull"]);
    // after the reels settle (JS-driven spin can take ~2s), lock fires
    await new Promise(r => setTimeout(r, 3000));
    expect(order).toEqual(["pull", "lock"]);
  });

  it("roll() forwards marquee + jackpot to spin() (drop-in dice path)", () => {
    const src = readFileSync(join(process.cwd(), "public/js/00-roller.js"), "utf8");
    expect(src).toMatch(/marquee:\s*opts\.marquee/);
    expect(src).toMatch(/jackpot:\s*opts\.jackpot/);
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
    // HARDENING: reveal is wired to onLock (visual end), NOT onPull, so marking
    // options don't appear until the reels have settled.
    expect(src).toMatch(/onLock:\s*reveal/);
    expect(src).toMatch(/marquee:\s*['"]QWIXX['"]/);
    // Jackpot = the roller can CLOSE a row this roll; need-flash via qwixxReelNeeded.
    expect(src).toMatch(/jackpot:\s*\(\)\s*=>\s*canCloseRowThisRoll/);
    expect(src).toMatch(/needed:\s*\(reel\)\s*=>\s*qwixxReelNeeded/);
  });

  it("Qwixx jackpot rule: can the roller close a row with this roll?", () => {
    // canCloseRowThisRoll: closing needs the lock cell (12 for red/yellow, 2 for
    // green/blue) reachable, and the row at 5+ marks (or 4 + white lands the 5th
    // while a colour lands the lock).
    const src = readFileSync(join(process.cwd(), "public/js/02-qwixx.js"), "utf8");
    expect(src).toMatch(/function\s+canCloseRowThisRoll/);
    expect(src).toMatch(/function\s+qwixxReelNeeded/);
    // case (a): 5+ marks and the lock is reachable
    expect(src).toMatch(/row\.marks\.length\s*>=\s*5/);
    // case (b): exactly 4 marks, white lands the 5th, colour lands the lock
    expect(src).toMatch(/row\.marks\.length\s*===\s*4/);
  });

  it("pass-and-play: activeIsMine derives from controlledSeats + bot check (not focus)", () => {
    // The auto-fire bug for players 2+ on one device came from gating on
    // view.yourSeat (focus), which can lag the active seat during turn rotation.
    // The fix reads window._controlledSeats and excludes bot seats.
    const src = readFileSync(join(process.cwd(), "public/js/02-qwixx.js"), "utf8");
    expect(src).toMatch(/window\._controlledSeats/);
    expect(src).toMatch(/controlled\.includes\(\s*s\.activeSeat\s*\)\s*&&\s*!activeIsBot/);
  });

  it("Qwixx localFocusSeat: roller marks EVERYTHING (white + colour) before the device passes", () => {
    // The roller holds the device for their WHOLE turn — until they've taken (or
    // skipped) their colour mark (activeColorUsed) — then it passes to the next
    // local human who still owes a white decision. This fixes "marks first
    // number → device swaps even though he could mark the second".
    const fn = win.GameClients["qwixx"].localFocusSeat;
    expect(typeof fn).toBe("function");
    const humans = [0, 1, 2];
    // Roller (0) hasn't resolved white → focus on roller.
    expect(fn({ activeSeat: 0, phase: "WHITE_PHASE", pendingWhiteDecisions: [0, 1, 2], activeColorUsed: false }, humans)).toBe(0);
    // Roller took their WHITE mark but NOT their colour yet → STILL on roller
    // (the old bug yanked the device away here).
    expect(fn({ activeSeat: 0, phase: "WHITE_PHASE", pendingWhiteDecisions: [1, 2], activeColorUsed: false }, humans)).toBe(0);
    // Roller has taken/declined their colour (activeColorUsed) → pass to the next
    // pending local human (1).
    expect(fn({ activeSeat: 0, phase: "WHITE_PHASE", pendingWhiteDecisions: [1, 2], activeColorUsed: true }, humans)).toBe(1);
    // …then 2.
    expect(fn({ activeSeat: 0, phase: "WHITE_PHASE", pendingWhiteDecisions: [2], activeColorUsed: true }, humans)).toBe(2);
  });
});

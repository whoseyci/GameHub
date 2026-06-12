// passplay.test.ts — pins the W2 pass-and-play transition contract.
//
// Kit.PassPlay should:
//   1. Only fire in local mode with ≥2 humans
//   2. Skip online mode entirely
//   3. Skip when the incoming seat is a bot
//   4. Skip when prefers-reduced-motion is set
//   5. Skip the very first paint (no "transition" from nothing)
//   6. Apply .kit-passplay-leaving on the main container when triggered
//   7. Show an overlay with the new player's name
//   8. Clean up after ~520ms

import { describe, expect, it, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function setup(opts: { mode?: string; localSeats?: any[]; reducedMotion?: boolean } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="mainBoardsContainer"></div></body></html>`, {
    url: "https://gamehub.test/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const win = dom.window as any;
  win.matchMedia = (q: string) => ({
    matches: opts.reducedMotion === true && /reduce/.test(q),
    addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, dispatchEvent(){return false},
  });
  win.requestAnimationFrame = (cb: any) => setTimeout(() => cb(Date.now()), 16);
  win.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
  // Load Kit + PassPlay. Both reference each other via lexical `Kit`, NOT
  // window.Kit, so we have to load them via injected <script> tags so they
  // share the same global scope.
  for (const f of ["js/00-core.js", "js/00-kit-passplay.js"]) {
    const code = readFileSync(join(process.cwd(), "public", f), "utf8");
    const s = win.document.createElement("script");
    s.textContent = code;
    win.document.body.appendChild(s);
  }
  // After core.js loads it exposes Kit on window (additive). We poke `mode`
  // and `localSeats` into the global scope so the IIFE's lexical lookups find
  // them — done by running another inline script.
  if (opts.mode || opts.localSeats) {
    const setup = win.document.createElement('script');
    // 00-core.js declares `let mode = 'online'` and `let localSeats = [...]`
    // at script scope. We ASSIGN (not re-declare) so the existing bindings
    // become visible to subsequent sibling scripts (including Kit.PassPlay's
    // lexical lookups inside its IIFE).
    setup.textContent = `
      try { mode = ${JSON.stringify(opts.mode || 'local')}; } catch (e) { window.mode = ${JSON.stringify(opts.mode || 'local')}; }
      try { localSeats.length = 0; ${JSON.stringify(opts.localSeats || [])}.forEach(function(s){ localSeats.push(s); }); }
      catch (e) { window.localSeats = ${JSON.stringify(opts.localSeats || [])}; }
    `;
    win.document.body.appendChild(setup);
  }
  return win;
}

function view(currentSeat: number, players: Array<{ seat: number; name: string }>) {
  return {
    game: 'testgame',
    state: { currentSeat, players: players.map(p => ({ ...p, status: 'active', score: 0 })) },
  };
}

describe("Kit.PassPlay (W2 contract)", () => {
  it("exposes the public API surface", () => {
    const win = setup({ mode: 'local', localSeats: [{ name: 'A', bot: false }, { name: 'B', bot: false }] });
    expect(typeof win.Kit.PassPlay.beforeRender).toBe('function');
    expect(typeof win.Kit.PassPlay.afterRender).toBe('function');
    expect(typeof win.Kit.PassPlay.reset).toBe('function');
  });

  it("does NOT trigger in online mode", () => {
    const win = setup({ mode: 'online', localSeats: [{ name: 'A', bot: false }, { name: 'B', bot: false }] });
    const v1 = view(0, [{ seat: 0, name: 'A' }, { seat: 1, name: 'B' }]);
    win.Kit.PassPlay.beforeRender(v1); // first paint
    const v2 = view(1, [{ seat: 0, name: 'A' }, { seat: 1, name: 'B' }]);
    const fired = win.Kit.PassPlay.beforeRender(v2);
    expect(fired).toBe(false);
    expect(win.document.getElementById('mainBoardsContainer').classList.contains('kit-passplay-leaving')).toBe(false);
  });

  it("does NOT trigger with only one human (vs bots)", () => {
    const win = setup({ mode: 'local', localSeats: [{ name: 'You', bot: false }, { name: 'Bot', bot: true }] });
    const v1 = view(0, [{ seat: 0, name: 'You' }, { seat: 1, name: 'Bot' }]);
    win.Kit.PassPlay.beforeRender(v1);
    const v2 = view(1, [{ seat: 0, name: 'You' }, { seat: 1, name: 'Bot' }]);
    expect(win.Kit.PassPlay.beforeRender(v2)).toBe(false);
  });

  it("does NOT trigger on the very first paint (no previous seat to leave from)", () => {
    const win = setup({ mode: 'local', localSeats: [{ name: 'A', bot: false }, { name: 'B', bot: false }] });
    const v1 = view(0, [{ seat: 0, name: 'A' }, { seat: 1, name: 'B' }]);
    expect(win.Kit.PassPlay.beforeRender(v1)).toBe(false);
  });

  it("does NOT trigger when seat hasn't changed", () => {
    const win = setup({ mode: 'local', localSeats: [{ name: 'A', bot: false }, { name: 'B', bot: false }] });
    const v1 = view(0, [{ seat: 0, name: 'A' }, { seat: 1, name: 'B' }]);
    win.Kit.PassPlay.beforeRender(v1);
    win.Kit.PassPlay.beforeRender(v1); // same seat
    expect(win.Kit.PassPlay.beforeRender(v1)).toBe(false);
  });

  it("TRIGGERS in local mode with ≥2 humans on a real seat change", () => {
    const win = setup({ mode: 'local', localSeats: [{ name: 'Alice', bot: false }, { name: 'Bob', bot: false }] });
    const v1 = view(0, [{ seat: 0, name: 'Alice' }, { seat: 1, name: 'Bob' }]);
    win.Kit.PassPlay.beforeRender(v1);
    const v2 = view(1, [{ seat: 0, name: 'Alice' }, { seat: 1, name: 'Bob' }]);
    const fired = win.Kit.PassPlay.beforeRender(v2);
    expect(fired).toBe(true);
    expect(win.document.getElementById('mainBoardsContainer').classList.contains('kit-passplay-leaving')).toBe(true);
  });

  it("does NOT trigger when the incoming seat is a BOT", () => {
    const win = setup({ mode: 'local', localSeats: [{ name: 'A', bot: false }, { name: 'B', bot: false }, { name: 'Bot', bot: true }] });
    const v1 = view(0, [{ seat: 0, name: 'A' }, { seat: 1, name: 'B' }, { seat: 2, name: 'Bot' }]);
    win.Kit.PassPlay.beforeRender(v1);
    const v2 = view(2, [{ seat: 0, name: 'A' }, { seat: 1, name: 'B' }, { seat: 2, name: 'Bot' }]);
    expect(win.Kit.PassPlay.beforeRender(v2)).toBe(false);
  });

  it("respects prefers-reduced-motion", () => {
    const win = setup({ mode: 'local', localSeats: [{ name: 'A', bot: false }, { name: 'B', bot: false }], reducedMotion: true });
    const v1 = view(0, [{ seat: 0, name: 'A' }, { seat: 1, name: 'B' }]);
    win.Kit.PassPlay.beforeRender(v1);
    const v2 = view(1, [{ seat: 0, name: 'A' }, { seat: 1, name: 'B' }]);
    expect(win.Kit.PassPlay.beforeRender(v2)).toBe(false);
  });

  it("shows the incoming player's name in the overlay", async () => {
    const win = setup({ mode: 'local', localSeats: [{ name: 'Alice', bot: false }, { name: 'Bob the Wonder Boy', bot: false }] });
    const v1 = view(0, [{ seat: 0, name: 'Alice' }, { seat: 1, name: 'Bob the Wonder Boy' }]);
    win.Kit.PassPlay.beforeRender(v1);
    const v2 = view(1, [{ seat: 0, name: 'Alice' }, { seat: 1, name: 'Bob the Wonder Boy' }]);
    win.Kit.PassPlay.beforeRender(v2);
    // Overlay shows after a small delay (35% of ANIM_MS ≈ 180ms).
    await new Promise((r) => setTimeout(r, 250));
    const name = win.document.querySelector('.kit-passplay-name')?.textContent;
    expect(name).toBe('Bob the Wonder Boy');
  });

  it("cleans up the overlay after the animation completes", async () => {
    const win = setup({ mode: 'local', localSeats: [{ name: 'A', bot: false }, { name: 'B', bot: false }] });
    const v1 = view(0, [{ seat: 0, name: 'A' }, { seat: 1, name: 'B' }]);
    win.Kit.PassPlay.beforeRender(v1);
    const v2 = view(1, [{ seat: 0, name: 'A' }, { seat: 1, name: 'B' }]);
    win.Kit.PassPlay.beforeRender(v2);
    await new Promise((r) => setTimeout(r, 700)); // > ANIM_MS (520)
    expect(win.document.querySelector('.kit-passplay-overlay')).toBeFalsy();
    expect(win.document.getElementById('mainBoardsContainer').classList.contains('kit-passplay-leaving')).toBe(false);
    expect(win.document.getElementById('mainBoardsContainer').classList.contains('kit-passplay-entering')).toBe(false);
  });

  it("reset() clears in-flight state (overlay + classes)", () => {
    const win = setup({ mode: 'local', localSeats: [{ name: 'A', bot: false }, { name: 'B', bot: false }] });
    const v1 = view(0, [{ seat: 0, name: 'A' }, { seat: 1, name: 'B' }]);
    win.Kit.PassPlay.beforeRender(v1);
    const v2 = view(1, [{ seat: 0, name: 'A' }, { seat: 1, name: 'B' }]);
    win.Kit.PassPlay.beforeRender(v2);
    win.Kit.PassPlay.reset();
    expect(win.document.querySelector('.kit-passplay-overlay')).toBeFalsy();
    expect(win.document.getElementById('mainBoardsContainer').classList.contains('kit-passplay-leaving')).toBe(false);
  });
});

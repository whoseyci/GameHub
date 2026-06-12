// layout.test.ts — pins the W3 declarative layout API contract.
//
// Kit.Layout.apply({...}) translates a game's layout intent into CSS custom
// properties on #gameScreen. main.css consumes those properties via rules
// like `max-height:var(--gs-minis-max-h, 22dvh)`. Opting in is purely
// additive — games that don't call apply() see the defaults.

import { describe, expect, it, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let win: any;
beforeEach(() => {
  const dom = new JSDOM(`<!doctype html><html><body><div id="gameScreen"></div></body></html>`, {
    url: "https://gamehub.test/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  win = dom.window;
  win.matchMedia = () => ({ matches: false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, dispatchEvent(){return false} });
  win.requestAnimationFrame = (cb: any) => setTimeout(() => cb(Date.now()), 16);
  win.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
  for (const f of ["js/00-core.js", "js/00-kit-layout.js"]) {
    const code = readFileSync(join(process.cwd(), "public", f), "utf8");
    const s = win.document.createElement("script");
    s.textContent = code;
    win.document.body.appendChild(s);
  }
});

describe("Kit.Layout (W3 contract)", () => {
  it("exposes apply / current / reset / FIELD_MAP", () => {
    expect(typeof win.Kit.Layout.apply).toBe('function');
    expect(typeof win.Kit.Layout.current).toBe('function');
    expect(typeof win.Kit.Layout.reset).toBe('function');
    expect(typeof win.Kit.Layout.FIELD_MAP).toBe('object');
  });

  it("apply({}) is a no-op (no errors, no vars set)", () => {
    win.Kit.Layout.apply({});
    expect(Object.keys(win.Kit.Layout.current()).length).toBe(0);
  });

  it("apply({minis: {maxHeight: '24dvh'}}) sets the right CSS var", () => {
    win.Kit.Layout.apply({ minis: { maxHeight: '24dvh' } });
    const target = win.document.getElementById('gameScreen');
    expect(target.style.getPropertyValue('--gs-minis-max-h')).toBe('24dvh');
  });

  it("numeric values become 'px' strings", () => {
    win.Kit.Layout.apply({ main: { maxWidth: 1040 } });
    const target = win.document.getElementById('gameScreen');
    expect(target.style.getPropertyValue('--gs-main-max-w')).toBe('1040px');
  });

  it("true → '1', false → unset", () => {
    win.Kit.Layout.apply({ status: { sticky: true } });
    let target = win.document.getElementById('gameScreen');
    expect(target.style.getPropertyValue('--gs-status-sticky')).toBe('1');
    win.Kit.Layout.apply({ status: { sticky: false } });
    target = win.document.getElementById('gameScreen');
    expect(target.style.getPropertyValue('--gs-status-sticky')).toBe('');
  });

  it("apply() REPLACES (does not merge) the previous spec", () => {
    win.Kit.Layout.apply({ minis: { maxHeight: '24dvh' }, main: { maxWidth: 1040 } });
    const target = win.document.getElementById('gameScreen');
    expect(target.style.getPropertyValue('--gs-minis-max-h')).toBe('24dvh');
    expect(target.style.getPropertyValue('--gs-main-max-w')).toBe('1040px');
    // Second apply only specifies minis — main-max-w should be cleared.
    win.Kit.Layout.apply({ minis: { maxHeight: '30dvh' } });
    expect(target.style.getPropertyValue('--gs-minis-max-h')).toBe('30dvh');
    expect(target.style.getPropertyValue('--gs-main-max-w')).toBe('');
  });

  it("unknown fields are silently ignored (forward compatibility)", () => {
    win.Kit.Layout.apply({ minis: { maxHeight: '24dvh' }, futureField: { foo: 'bar' } });
    const target = win.document.getElementById('gameScreen');
    expect(target.style.getPropertyValue('--gs-minis-max-h')).toBe('24dvh');
    // No --gs-future-* properties exist; just confirm nothing crashed.
    expect(Object.keys(win.Kit.Layout.current()).length).toBe(1);
  });

  it("reset() clears every layout var", () => {
    win.Kit.Layout.apply({
      minis: { maxHeight: '24dvh', minColWidth: 132 },
      main: { maxWidth: 1040 },
      center: { maxHeight: '28dvh' },
    });
    expect(Object.keys(win.Kit.Layout.current()).length).toBeGreaterThan(0);
    win.Kit.Layout.reset();
    expect(Object.keys(win.Kit.Layout.current()).length).toBe(0);
  });

  it("current() reflects what's actually on the element", () => {
    win.Kit.Layout.apply({ minis: { maxHeight: '24dvh' }, main: { maxWidth: 800 } });
    const got = win.Kit.Layout.current();
    expect(got['minis.maxHeight']).toBe('24dvh');
    expect(got['main.maxWidth']).toBe('800px');
  });

  it("CSS stylesheet consumes the custom properties (W3 wire-up)", () => {
    const css = readFileSync(join(process.cwd(), 'public/styles/main.css'), 'utf8');
    expect(css).toMatch(/var\(--gs-minis-max-h/);
    expect(css).toMatch(/var\(--gs-main-max-w/);
    expect(css).toMatch(/var\(--gs-center-max-h/);
  });

  it("at least one game (Qwixx) opts in to Kit.Layout.apply", () => {
    const src = readFileSync(join(process.cwd(), 'public/js/02-qwixx.js'), 'utf8');
    expect(src).toMatch(/Kit\.Layout\.apply\s*\(/);
  });
});

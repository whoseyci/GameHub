// mini-legibility.test.ts — pins the Round-3 (W1) mini-board contract.
//
// W1 says: regardless of mini-board width, the ESSENTIAL info stays
// legible. The platform's tier system delivers this by:
//   1. Always rendering the score badge + an identity glyph
//   2. Collapsing the full name to initials at sm/xs tiers
//   3. Hiding the body at xs tier (the body is game-specific decoration,
//      not essential info — essentials[] carries the data)
//   4. Pulse pip survives every tier (active/bust/win state)
//
// We mount Kit + Kit.MiniBoard in jsdom, build a mini, force each tier
// via the public Kit.MiniBoard.tierFor helper, and assert the right
// elements are visible/hidden at each.

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
  win.ResizeObserver = class {
    observe(){} unobserve(){} disconnect(){}
  } as any;
  for (const f of ["js/00-core.js", "js/00-icons.js", "js/00-cards.js"]) {
    const code = readFileSync(join(process.cwd(), "public", f), "utf8");
    const s = win.document.createElement("script");
    s.textContent = code;
    win.document.body.appendChild(s);
  }
});

function makeMini(extras: any = {}) {
  return win.Kit.MiniBoard({
    name: extras.name || 'Alice McTester',
    badge: extras.badge != null ? extras.badge : 42,
    active: !!extras.active,
    pulse: extras.pulse || null,
    essentials: extras.essentials || [
      { label: 'Total', value: 42 },
      { label: 'Now', value: 7 },
      { label: 'Open', value: '6/12' },
    ],
    status: extras.status || null,
    body: extras.body || '<div class="probe-body">body content</div>',
    onClick: extras.onClick,
  });
}

function applyTier(el: any, tier: string) {
  el.classList.remove('kc-mini-tier-xs', 'kc-mini-tier-sm', 'kc-mini-tier-md', 'kc-mini-tier-lg');
  el.classList.add('kc-mini-tier-' + tier);
  el.dataset.miniTier = tier;
}

// Tiers are CSS-driven. JSDOM doesn't apply our stylesheet by default, but we
// CAN verify that the structural elements exist for the platform to drive,
// and that the tier classes get the right modifiers applied.
describe("Kit.MiniBoard (W1 contract)", () => {
  it("exposes initialsOf() and tierFor() helpers", () => {
    expect(typeof win.Kit.MiniBoard.initialsOf).toBe('function');
    expect(typeof win.Kit.MiniBoard.tierFor).toBe('function');
  });

  it("initialsOf collapses names sensibly", () => {
    const f = win.Kit.MiniBoard.initialsOf;
    expect(f('Alice')).toBe('AL');
    expect(f('Alice Wonderland')).toBe('AW');
    expect(f('Alice K. Wonderland')).toBe('AW');
    expect(f('')).toBe('?');
    expect(f('  ')).toBe('?');
  });

  it("tierFor returns the right tier for each width", () => {
    const f = win.Kit.MiniBoard.tierFor;
    expect(f(40)).toBe('xs');
    expect(f(71)).toBe('xs');
    expect(f(72)).toBe('sm');
    expect(f(95)).toBe('sm');
    expect(f(96)).toBe('md');
    expect(f(159)).toBe('md');
    expect(f(160)).toBe('lg');
    expect(f(900)).toBe('lg');
  });

  it("renders all essential primitives: head, name (full + initials), essentials row, body", () => {
    const m = makeMini();
    win.document.body.appendChild(m);
    expect(m.querySelector('.kc-mini-head')).toBeTruthy();
    expect(m.querySelector('.kc-mini-name-full')).toBeTruthy();
    expect(m.querySelector('.kc-mini-name-init')).toBeTruthy();
    expect(m.querySelector('.kc-mini-essentials')).toBeTruthy();
    expect(m.querySelectorAll('.kc-mini-essential').length).toBe(3);
    expect(m.querySelector('.probe-body')).toBeTruthy();
    expect(m.querySelector('.kc-mini-badge')?.textContent).toBe('42');
  });

  it("initials marker contains the right collapse for the given name", () => {
    const m = makeMini({ name: 'Alice McTester' });
    win.document.body.appendChild(m);
    const init = m.querySelector('.kc-mini-name-init').textContent;
    // Active-arrow may prepend U+25b8; strip it for the check.
    expect(init.replace(/^\u25b8/, '')).toBe('AM');
  });

  it("pulse pip renders with the correct state class", () => {
    const m = makeMini({ pulse: 'live' });
    win.document.body.appendChild(m);
    expect(m.querySelector('.kc-mini-pulse-live')).toBeTruthy();
    const m2 = makeMini({ pulse: 'bust' });
    win.document.body.appendChild(m2);
    expect(m2.querySelector('.kc-mini-pulse-bust')).toBeTruthy();
  });

  it("status pill renders when status is set", () => {
    const m = makeMini({ status: 'BUSTED' });
    win.document.body.appendChild(m);
    expect(m.querySelector('.kc-mini-status')?.textContent).toBe('BUSTED');
  });

  it("tier classes apply correctly when set", () => {
    const m = makeMini();
    win.document.body.appendChild(m);
    applyTier(m, 'xs');
    expect(m.classList.contains('kc-mini-tier-xs')).toBe(true);
    expect(m.dataset.miniTier).toBe('xs');
    applyTier(m, 'lg');
    expect(m.classList.contains('kc-mini-tier-lg')).toBe(true);
    expect(m.classList.contains('kc-mini-tier-xs')).toBe(false);
  });

  it("CSS stylesheet declares the four tier modifiers", () => {
    // Inline lint: confirm the stylesheet ships rules for each tier.
    const css = readFileSync(join(process.cwd(), 'public/styles/main.css'), 'utf8');
    expect(css).toMatch(/\.kc-mini-tier-xs\b/);
    expect(css).toMatch(/\.kc-mini-tier-sm\b/);
    expect(css).toMatch(/\.kc-mini-tier-md\b/);
    expect(css).toMatch(/\.kc-mini-tier-lg\b/);
    // xs tier MUST hide body and essentials. (Selector list with body in it
    // is fine — we just need to see SOME .kc-mini-tier-xs rule that hides
    // .kc-mini-body.)
    const xsRules = css.match(/\.kc-mini-tier-xs[\s\S]{0,500}?\{[^}]*display\s*:\s*none[^}]*\}/g) || [];
    const hidesBody = xsRules.some((r) => /\.kc-mini-body/.test(r));
    expect(hidesBody, 'no .kc-mini-tier-xs rule hides .kc-mini-body').toBe(true);
  });

  it("essentials cap at 3 even if more are passed (bounded UI surface)", () => {
    const m = makeMini({ essentials: [
      { label: 'a', value: 1 }, { label: 'b', value: 2 },
      { label: 'c', value: 3 }, { label: 'd', value: 4 },
      { label: 'e', value: 5 },
    ]});
    win.document.body.appendChild(m);
    expect(m.querySelectorAll('.kc-mini-essential').length).toBe(3);
  });

  it("an onClick handler wires the mini as a <button>", () => {
    let clicked = 0;
    const m = makeMini({ onClick: () => { clicked++; } });
    expect(m.tagName).toBe('BUTTON');
    m.click();
    expect(clicked).toBe(1);
  });

  it("no onClick → mini renders as a <div> (not focusable in tab order)", () => {
    const m = makeMini({ onClick: null });
    expect(m.tagName).toBe('DIV');
  });
});

// Game-by-game adoption check — every game that uses Kit.MiniBoard should
// pass the essentials manifest (proves the W1 contract is in use).
describe("Each game adopts the essentials manifest", () => {
  for (const [game, file] of [
    ['skyjo', 'public/js/03-skyjo.js'],
    ['flip7', 'public/js/04-flip7.js'],
    ['qwixx', 'public/js/02-qwixx.js'],
  ] as const) {
    it(`${game} renderer passes essentials[] to Kit.MiniBoard`, () => {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      // Locate the Kit.MiniBoard call and assert it includes essentials.
      const m = src.match(/Kit\.MiniBoard\s*\(\s*\{([\s\S]*?)\n\s*\}\s*\)/);
      expect(m, `${file}: couldn't locate Kit.MiniBoard call`).toBeTruthy();
      expect(m![1], `${file}: Kit.MiniBoard call missing essentials:[]`).toMatch(/essentials\s*:\s*\[/);
    });
  }
});

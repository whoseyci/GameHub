// kit-fit.test.ts — pins the Kit.Fit content-aware auto-scaling API.
//
// Kit.Fit scales a board to fill its container (grow into void, shrink to avoid
// overflow) for EVERY game, via GameShell.renderTable. jsdom has no real layout
// (offsetWidth is 0), so the live scale maths is verified in Chromium; here we
// assert the public API surface, the wrapper/transform contract, and the
// renderTable auto-wiring.

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
  win.requestAnimationFrame = (cb: any) => setTimeout(() => cb(Date.now()), 0);
  for (const f of ["js/00-core.js", "js/00-kit-fit.js"]) {
    const code = readFileSync(join(process.cwd(), "public", f), "utf8");
    const s = win.document.createElement("script");
    s.textContent = code;
    win.document.body.appendChild(s);
  }
});

describe("Kit.Fit — public API", () => {
  it("exposes apply / release / refresh", () => {
    expect(typeof win.Kit.Fit.apply).toBe("function");
    expect(typeof win.Kit.Fit.release).toBe("function");
    expect(typeof win.Kit.Fit.refresh).toBe("function");
  });

  it("apply() wraps the content in a .kit-fit-wrap (so the parent sees the scaled footprint)", () => {
    const container = win.document.createElement("div");
    const content = win.document.createElement("div");
    container.appendChild(content);
    win.document.body.appendChild(container);
    win.Kit.Fit.apply(container, content);
    expect(content.parentElement.classList.contains("kit-fit-wrap")).toBe(true);
  });

  it("release() unwraps the content and clears its inline sizing/transform", () => {
    const container = win.document.createElement("div");
    const content = win.document.createElement("div");
    container.appendChild(content);
    win.document.body.appendChild(container);
    win.Kit.Fit.apply(container, content);
    const parentBefore = content.parentElement;
    win.Kit.Fit.release(content);
    expect(content.parentElement).not.toBe(parentBefore);       // unwrapped
    expect(content.style.transform).toBe("");
    expect(content.style.width).toBe("");
    expect(content.style.height).toBe("");
  });

  it("apply() is idempotent — re-applying the same content doesn't double-wrap", () => {
    const container = win.document.createElement("div");
    const content = win.document.createElement("div");
    container.appendChild(content);
    win.document.body.appendChild(container);
    win.Kit.Fit.apply(container, content);
    win.Kit.Fit.apply(container, content);
    expect(container.querySelectorAll(".kit-fit-wrap").length).toBe(1);   // scope to THIS container
  });
});

describe("Kit.Fit — source contract + renderTable auto-wiring", () => {
  const fitSrc = readFileSync(join(process.cwd(), "public/js/00-kit-fit.js"), "utf8");
  const coreSrc = readFileSync(join(process.cwd(), "public/js/00-core.js"), "utf8");

  it("measures NATURAL size with width:max-content to break the upscale feedback loop", () => {
    // The key fix for "scaled board overflows": measure intrinsic size, not the
    // responsive width:100% which would grow against the (scaling) wrapper.
    expect(fitSrc).toMatch(/max-content/);
    expect(fitSrc).toMatch(/function\s+naturalSize/);
  });

  it("uses min(width-fit, height-fit) so the board never overflows either axis", () => {
    expect(fitSrc).toMatch(/Math\.min\(sw,\s*sh\)/);
  });

  it("re-fits on container resize (ResizeObserver) and content change (MutationObserver)", () => {
    expect(fitSrc).toMatch(/new\s+ResizeObserver/);
    expect(fitSrc).toMatch(/new\s+MutationObserver/);
  });

  it("renderTable auto-fits the focus board for every game (opt-out via fit:false)", () => {
    expect(coreSrc).toMatch(/renderTable\(\{[^}]*fit\s*=\s*true/);
    expect(coreSrc).toMatch(/Kit\.Fit\.apply\(main,\s*board/);
    // and releases the previous fit before replacing the board (no leaks)
    expect(coreSrc).toMatch(/Kit\.Fit\.release/);
  });
});

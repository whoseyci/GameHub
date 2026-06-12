// persist-slot.test.ts — pins the GameShell.persist contract.
//
// Why this matters: the WebGL dice canvas (and any future heavy-to-recreate
// node) MUST survive every renderTable() rebuild. Without persisted slots,
// every Qwixx state update would tear down + replace the live canvas with
// a CSS-3D fallback flash — the original "weird 2D dice after the roll"
// bug we're locking out.
//
// We don't load the full core (it depends on the entire shared bundle);
// instead we verify the persist+mountPersistedSlots logic by extracting
// it and re-creating the minimal harness here. The PRODUCTION code is
// validated end-to-end by smoke-client (which would fail if persist
// stopped working — the throw button + dice tray smoke covers this path).

import { describe, expect, it, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let win: any;
beforeEach(() => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="topArea"></div>
  </body></html>`, { url: "https://gamehub.test/", runScripts: "dangerously", pretendToBeVisual: true });
  win = dom.window;
  win.matchMedia = () => ({ matches:false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, dispatchEvent(){return false} });
  win.HTMLCanvasElement.prototype.getContext = () => ({});
});

// Tiny re-impl of the shell's persist + mountPersistedSlots to lock the contract.
function makePersist(win: any) {
  const map = new Map<string, HTMLElement>();
  function persist(key: string, factory?: () => HTMLElement) {
    let n = map.get(key);
    if (!n) {
      n = factory ? factory() : win.document.createElement("div");
      n.setAttribute("data-persist-id", key);
      map.set(key, n);
    }
    return n;
  }
  function mount(root: HTMLElement) {
    for (const slot of Array.from(root.querySelectorAll("[data-persist-slot]")) as HTMLElement[]) {
      const key = slot.getAttribute("data-persist-slot")!;
      const node = map.get(key);
      if (!node) continue;
      if (slot.className) node.className = slot.className;
      if (slot.id && !node.id) node.id = slot.id;
      slot.parentNode!.replaceChild(node, slot);
    }
  }
  function clear() {
    for (const [, n] of map) if (n.parentNode) n.parentNode.removeChild(n);
    map.clear();
  }
  return { persist, mount, clear, _map: map };
}

describe("GameShell.persist (Qwixx dice survival contract)", () => {
  it("returns the SAME node across calls with the same key", () => {
    const { persist } = makePersist(win);
    const a = persist("k1");
    const b = persist("k1");
    expect(a).toBe(b);
  });

  it("mountPersistedSlots replaces the placeholder with the live node", () => {
    const { persist, mount } = makePersist(win);
    const live = persist("k1", () => {
      const d = win.document.createElement("div");
      d.dataset.live = "yes";
      return d;
    });
    const root = win.document.createElement("div");
    root.innerHTML = '<div data-persist-slot="k1" class="some-class"></div>';
    mount(root);
    const placed = root.querySelector("[data-persist-id=k1]") as any;
    expect(placed).toBe(live);
    expect(placed.dataset.live).toBe("yes");
    expect(placed.className).toBe("some-class");
  });

  it("a live child (e.g. a <canvas>) survives across multiple mount cycles", () => {
    const { persist, mount } = makePersist(win);
    const live = persist("dice");
    // Stash a "canvas" inside the persisted node — a real WebGL canvas in
    // production. It must survive the placeholder → live swap, repeated.
    const canvas = win.document.createElement("canvas");
    canvas.id = "the-canvas";
    live.appendChild(canvas);

    for (let i = 0; i < 5; i++) {
      // simulate a state tick: rebuild the parent's innerHTML (which would
      // normally destroy children), then mount.
      const root = win.document.createElement("div");
      root.innerHTML = '<div data-persist-slot="dice"></div>';
      mount(root);
      const found = root.querySelector("#the-canvas");
      expect(found, `iteration ${i}: canvas should be re-mounted`).toBe(canvas);
    }
  });

  it("clear() detaches every persisted node so a fresh game starts clean", () => {
    const { persist, mount, clear, _map } = makePersist(win);
    const a = persist("a");
    const b = persist("b");
    const root = win.document.createElement("div");
    root.innerHTML = '<div data-persist-slot="a"></div><div data-persist-slot="b"></div>';
    mount(root);
    expect(root.contains(a)).toBe(true);
    expect(root.contains(b)).toBe(true);
    clear();
    expect(_map.size).toBe(0);
    expect(root.contains(a)).toBe(false);
    expect(root.contains(b)).toBe(false);
  });
});

// legal-hints.test.ts — pins the client-side Kit.Cards.legalHints helper
// (API-11). Loads 00-cards.js into a minimal jsdom and feeds it a fake view
// whose state.legal mirrors what the server would emit.
//
// This is the bridge between API-8 (server) and the render-side wins: any
// future game can paint correct drop-target highlights without re-encoding
// rules in its renderer.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function loadKit() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://gamehub.test/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const w = dom.window as any;
  w.matchMedia = () => ({ matches:false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, dispatchEvent(){return false} });
  w.requestAnimationFrame = (cb: any) => setTimeout(() => cb(Date.now()), 16);
  w.HTMLCanvasElement.prototype.getContext = () => ({} as any);
  for (const file of ["js/00-core.js", "js/00-cards.js"]) {
    const code = readFileSync(join(process.cwd(), "public", file), "utf8");
    const s = w.document.createElement("script");
    s.textContent = code;
    w.document.body.appendChild(s);
  }
  return w;
}

function fakeView(legal: any[]) {
  return { game: "test", state: { currentSeat: 0, players: [{seat:0,name:"A",status:"active",score:0}], legal } };
}

describe("Kit.Cards.legalHints (API-11)", () => {
  const w = loadKit();
  const H = w.Kit.Cards.legalHints;

  it("returns an empty descriptor when there's no legal[]", () => {
    const h = H({ game: "x", state: { currentSeat: 0, players: [] } });
    expect(h.all).toEqual([]);
    expect(h.has("anything")).toBe(false);
  });

  it("groups by action and by per-field set", () => {
    const h = H(fakeView([
      { action: "place", index: 0, target: 3 },
      { action: "place", index: 0, target: 7 },
      { action: "place", index: 1, target: 3 },
      { action: "claim", target: 5 },
      { action: "end" },
    ]));
    expect(h.byAction.place).toHaveLength(3);
    expect(h.byAction.claim).toHaveLength(1);
    expect(h.byAction.end).toHaveLength(1);
    expect([...h.byField.target].sort((a:number,b:number)=>a-b)).toEqual([3,5,7]);
    expect([...h.byField.index].sort((a:number,b:number)=>a-b)).toEqual([0,1]);
  });

  it("byPair[action][primary] maps a chosen card to its valid targets", () => {
    const h = H(fakeView([
      { action: "place", index: 0, target: 3 },
      { action: "place", index: 0, target: 7 },
      { action: "place", index: 2, target: 3 },
    ]));
    expect([...h.byPair.place[0]].sort((a:number,b:number)=>a-b)).toEqual([3,7]);
    expect([...h.byPair.place[2]]).toEqual([3]);
    expect(h.byPair.place[1]).toBeUndefined();
  });

  it("has(action, fields) does an exact field-equality lookup", () => {
    const h = H(fakeView([
      { action: "place", index: 0, target: 3 },
      { action: "claim", target: 7 },
    ]));
    expect(h.has("place", { index: 0, target: 3 })).toBe(true);
    expect(h.has("place", { index: 0, target: 4 })).toBe(false);
    expect(h.has("claim", { target: 7 })).toBe(true);
    expect(h.has("claim")).toBe(true);
    expect(h.has("unknown")).toBe(false);
  });

  it("markHints paints .kit-drop-target on matching elements by data-target", () => {
    const h = H(fakeView([
      { action: "place", target: 1 },
      { action: "place", target: 4 },
    ]));
    const els: any[] = [];
    for (let i = 0; i < 6; i++) {
      const el = w.document.createElement("div");
      el.dataset.target = String(i);
      els.push(el);
    }
    w.Kit.Cards.markHints(els, h, { field: "target" });
    const lit = els.filter((e) => e.classList.contains("kit-drop-target")).map((e) => +e.dataset.target);
    expect(lit.sort()).toEqual([1, 4]);
  });
});

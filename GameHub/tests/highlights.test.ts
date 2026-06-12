// highlights.test.ts — pins Kit.Highlights.analyze contract.
// Loads the highlights module into jsdom, builds a fake replay bundle
// with a known score arc, and asserts the analyser surfaces the right
// frames in the right order.

import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadHighlightsWith(fakeModule: any) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://gamehub.test/",
    runScripts: "dangerously",
  });
  const w = dom.window as any;
  w.GameModules = { fakegame: fakeModule };
  const code = readFileSync(join(process.cwd(), "public/js/replay-highlights.js"), "utf8");
  const s = w.document.createElement("script");
  s.textContent = code;
  w.document.body.appendChild(s);
  return w.Kit.Highlights;
}

// A simple test module: state is just per-seat scores. Each action is
// { seat, msg:{ action:"add", delta:N } } which adds N to that seat.
function makeFakeModule() {
  return {
    meta: { id: "fakegame", scoring: "higher-is-better" },
    create: (names: string[]) => ({ scores: names.map(() => 0), over: false }),
    applyAction: (state: any, seat: number, msg: any) => {
      if (msg.action === "add") state.scores[seat] = (state.scores[seat] || 0) + (msg.delta | 0);
      if (msg.action === "end") state.over = true;
    },
    viewFor: (state: any, _seat: number) => ({
      game: "fakegame", phase: "PLAY", over: !!state.over, yourSeat: 0,
      state: {
        currentSeat: 0,
        players: state.scores.map((s: number, i: number) => ({ seat: i, name: `P${i+1}`, status: "active", score: s })),
      },
    }),
    isOver: (state: any) => !!state.over,
  };
}

function bundleFor(actions: any[], names = ["P1", "P2"]) {
  const mod = makeFakeModule();
  return {
    v: 1, id: "x", roomCode: "X", gameId: "fakegame",
    names, bots: names.map(() => false),
    initialState: mod.create(names),
    actions: actions.map((a, i) => ({ ...a, seq: i + 1 })),
    createdAt: 0, endedAt: 1, finalSummary: { winners: [actions.filter(a=>a.msg.action==="end").length?0:0], rows: [] },
  };
}

describe("Kit.Highlights.analyze", () => {
  it("surfaces big score swings", () => {
    const H = loadHighlightsWith(makeFakeModule());
    const b = bundleFor([
      { seat: 0, msg: { action: "add", delta: 1 } },
      { seat: 0, msg: { action: "add", delta: 25 } }, // big swing on frame 2
      { seat: 1, msg: { action: "add", delta: 1 } },
    ]);
    const h = H.analyze(b);
    expect(h.some((x: any) => x.frame === 2 && x.kind === "gain" && x.seat === 0)).toBe(true);
  });

  it("flags lead changes (higher-is-better)", () => {
    const H = loadHighlightsWith(makeFakeModule());
    const b = bundleFor([
      { seat: 0, msg: { action: "add", delta: 10 } }, // P1 leads
      { seat: 1, msg: { action: "add", delta: 30 } }, // P2 takes lead
    ]);
    const h = H.analyze(b);
    const leadChange = h.find((x: any) => x.kind === "lead");
    expect(leadChange?.seat).toBe(1);
  });

  it("marks the final game-ending move as a 'win' highlight (score 1)", () => {
    const H = loadHighlightsWith(makeFakeModule());
    const b = bundleFor([
      { seat: 0, msg: { action: "add", delta: 5 } },
      { seat: 0, msg: { action: "end" } },
    ]);
    const h = H.analyze(b);
    const win = h.find((x: any) => x.kind === "win");
    expect(win).toBeDefined();
    expect(win!.score).toBe(1);
    expect(win!.frame).toBe(2);
  });

  it("returns [] when bundle has no actions or unknown game", () => {
    const H = loadHighlightsWith(makeFakeModule());
    expect(H.analyze(null)).toEqual([]);
    expect(H.analyze({ gameId: "missing", actions: [] })).toEqual([]);
    expect(H.analyze(bundleFor([]))).toEqual([]);
  });

  it("caps result count to opts.max", () => {
    const H = loadHighlightsWith(makeFakeModule());
    const actions = [];
    for (let i = 0; i < 20; i++) actions.push({ seat: i % 2, msg: { action: "add", delta: 10 + i } });
    const b = bundleFor(actions);
    const h = H.analyze(b, { max: 3 });
    expect(h.length).toBeLessThanOrEqual(3);
  });

  it("output is sorted by frame for timeline display", () => {
    const H = loadHighlightsWith(makeFakeModule());
    const actions = [];
    for (let i = 0; i < 8; i++) actions.push({ seat: i % 2, msg: { action: "add", delta: 10 + i * 3 } });
    actions.push({ seat: 0, msg: { action: "end" } });
    const b = bundleFor(actions);
    const h = H.analyze(b);
    for (let i = 1; i < h.length; i++) expect(h[i].frame).toBeGreaterThanOrEqual(h[i-1].frame);
  });
});

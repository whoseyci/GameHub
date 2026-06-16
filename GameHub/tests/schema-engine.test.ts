// schema-engine.test.ts — proves a DATA-ONLY GameSpec runs as a correct
// GameModule through the interpreter (the foundation for the visual creator).
import { describe, expect, it } from "vitest";
import { makeSchemaGame } from "../src/games/schema/engine";
import { validateSpec, type GameSpec } from "../src/games/schema/spec";
import { Septet } from "../src/games/schema/specs/septet";
import { GAMES, getGame } from "../src/games/registry";

describe("GameSpec validation", () => {
  it("accepts the Septet sample", () => {
    expect(validateSpec(Septet)).toEqual([]);
  });
  it("rejects malformed specs with reasons", () => {
    expect(validateSpec({} as any).length).toBeGreaterThan(0);
    const bad = { ...Septet, win: { target: 0 } } as GameSpec;
    expect(validateSpec(bad)).toContain("win.target must be > 0");
    const tiny = { ...Septet, deck: [{ value: 1, count: 1 }] } as GameSpec;
    expect(validateSpec(tiny)).toContain("deck must have at least 8 cards total");
  });
  it("makeSchemaGame throws on an invalid spec (never ships a broken game)", () => {
    expect(() => makeSchemaGame({ kind: "pressYourLuck", meta: { id: "x" } } as any)).toThrow();
  });
});

describe("Septet is registered as a normal GameModule", () => {
  it("appears in the registry + getGame", () => {
    expect(GAMES["septet"]).toBeDefined();
    expect(getGame("septet")?.meta.name).toBe("Septet");
  });
  it("exposes the standard contract", () => {
    const g = getGame("septet")!;
    for (const k of ["create", "applyAction", "viewFor", "isOver", "legalActions"] as const) {
      expect(typeof (g as any)[k]).toBe("function");
    }
  });
});

describe("Septet gameplay (engine interprets the data)", () => {
  const g = makeSchemaGame(Septet);

  it("create() yields a JSON-serializable starting state with both players active", () => {
    const s = g.create(["Ada", "Bo"]);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);   // serializable
    expect(s.players.map((p: any) => p.status)).toEqual(["active", "active"]);
    expect(s.deck.length).toBe(Septet.deck.reduce((a, d) => a + d.count, 0));
    expect(s.phase).toBe("PLAY");
  });

  it("legalActions: only the current seat may draw/stay; others get nothing", () => {
    const s = g.create(["Ada", "Bo"]);
    const cur = s.current;
    expect(g.legalActions!(s, cur).map((a) => a.action).sort()).toEqual(["hit", "stay"]);
    expect(g.legalActions!(s, (cur + 1) % 2)).toEqual([]);
  });

  it("stay banks the kept sum and passes the turn", () => {
    const s = g.create(["Ada", "Bo"]);
    const me = s.current;
    // force a known kept hand
    s.players[me].kept = [3, 5];
    g.applyAction(s, me, { action: "stay" });
    expect(s.players[me].banked).toBe(8);
    expect(s.players[me].status).toBe("stayed");
    expect(s.current).not.toBe(me);                     // turn advanced
  });

  it("drawing a duplicate BUSTS (kept cleared, score 0, turn passes)", () => {
    const s = g.create(["Ada", "Bo"]);
    const me = s.current;
    s.players[me].kept = [4];
    // rig the deck so the next pop() is a duplicate 4
    s.deck.push(4);
    g.applyAction(s, me, { action: "hit" });
    expect(s.players[me].status).toBe("busted");
    expect(s.players[me].kept).toEqual([]);
    expect(s.players[me].banked).toBe(0);
  });

  it("collecting the bonus count of DISTINCT cards awards the bonus + ends turn", () => {
    const s = g.create(["Ada", "Bo"]);
    const me = s.current;
    s.players[me].kept = [1, 2, 3, 4, 5, 6];            // 6 distinct
    s.deck.push(7);                                     // 7th distinct → Septet!
    g.applyAction(s, me, { action: "hit" });
    // sum(1..7)=28 + 15 bonus
    expect(s.players[me].banked).toBe(28 + 15);
    expect(s.players[me].status).toBe("stayed");
  });

  it("plays a FULL game to a winner deterministically (bots-style random-legal)", () => {
    const s = g.create(["Ada", "Bo", "Cy"]);
    let guard = 0;
    while (!g.isOver(s) && guard++ < 5000) {
      if (s.phase === "ROUND_END") { g.applyAction(s, 0, { action: "next_round" }); continue; }
      const seat = s.current;
      const legal = g.legalActions!(s, seat);
      if (!legal.length) break;
      // simple policy: stay if holding a decent hand, else draw
      const live = s.players[seat].kept.reduce((a: number, b: number) => a + b, 0);
      const act = live >= 12 ? { action: "stay" } : legal[0];
      g.applyAction(s, seat, act);
    }
    expect(g.isOver(s)).toBe(true);
    const view = g.viewFor(s, 0);
    expect(view.over).toBe(true);
    expect(view.summary).toBeTruthy();
    expect(view.summary!.winners.length).toBeGreaterThan(0);
    // winner actually has the top banked score
    const top = Math.max(...s.players.map((p: any) => p.banked));
    expect(top).toBeGreaterThanOrEqual(Septet.win.target);
    for (const w of view.summary!.winners) expect(s.players[w].banked).toBe(top);
  });

  it("viewFor hides nothing it shouldn't + carries the generic schema payload for the client", () => {
    const s = g.create(["Ada", "Bo"]);
    const v: any = g.viewFor(s, 0);
    expect(v.game).toBe("septet");
    // private payload is namespaced under the game's own id (hub contract).
    expect(v.septet.kind).toBe("pressYourLuck");
    expect(v.septet.players.length).toBe(2);
    expect(typeof v.septet.deckCount).toBe("number");
    expect(v.septet.target).toBe(200);
  });
});

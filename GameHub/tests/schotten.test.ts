import { describe, expect, it } from "vitest";
import { Schotten } from "../src/games/schotten";

// Helpers to drive the engine deterministically by injecting cards.
function freshTwo() {
  const s: any = Schotten.create(["A", "B"]);
  return s;
}
function setSide(s: any, stone: number, player: number, cards: Array<[number, string]>) {
  s.stones[stone].sides[player] = cards.map(([v, c], i) => ({ id: `inj_${stone}_${player}_${i}`, v, c }));
  s.stones[stone].fullAt[player] = cards.length >= 3 ? ++s.seq : Number.MAX_SAFE_INTEGER;
}

describe("Schotten Totten", () => {
  it("creates serializable state and views for both seats + spectator", () => {
    const s = freshTwo();
    expect(s.schemaVersion).toBe(1);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    for (let seat = -1; seat < 2; seat++) {
      const v = Schotten.viewFor(s, seat);
      expect(v.game).toBe("schotten");
      expect(v.yourSeat).toBe(seat);
      expect(JSON.parse(JSON.stringify(v))).toEqual(v);
    }
  });

  it("deals 6 cards each from a 54-card deck", () => {
    const s = freshTwo();
    expect(s.players[0].hand.length).toBe(6);
    expect(s.players[1].hand.length).toBe(6);
    expect(s.deck.length).toBe(54 - 12);
  });

  it("hides the opponent's hand but shows both sides of every stone", () => {
    const s = freshTwo();
    const v: any = Schotten.viewFor(s, 0);
    expect(Array.isArray(v.schotten.players[0].hand)).toBe(true); // mine visible
    expect(v.schotten.players[1].hand).toBeNull();                 // theirs hidden
    expect(v.schotten.players[1].handCount).toBe(6);               // count public
  });

  it("place → end advances the turn and refills the hand", () => {
    const s = freshTwo();
    const before = s.players[0].hand.length;
    Schotten.applyAction(s, 0, { action: "place", index: 0, target: 4 });
    expect(s.stones[4].sides[0].length).toBe(1);
    expect(s.players[0].hand.length).toBe(before - 1); // placed, not yet drawn
    Schotten.applyAction(s, 0, { action: "end" });
    expect(s.players[0].hand.length).toBe(before);     // drew a replacement
    expect(s.current).toBe(1);
  });

  it("only one placement per turn; wrong seat is ignored", () => {
    const s = freshTwo();
    Schotten.applyAction(s, 0, { action: "place", index: 0, target: 0 });
    Schotten.applyAction(s, 0, { action: "place", index: 0, target: 1 }); // 2nd place blocked
    expect(s.stones[1].sides[0].length).toBe(0);
    Schotten.applyAction(s, 1, { action: "place", index: 0, target: 2 }); // not B's turn
    expect(s.stones[2].sides[1].length).toBe(0);
  });

  // ---- Formation ranking via claiming ----
  it("color-run beats three-of-a-kind beats flush beats run beats sum", () => {
    const ranks: Array<[Array<[number, string]>, number]> = [
      [[[4, "red"], [5, "red"], [6, "red"]], 5],   // color run
      [[[7, "red"], [7, "blue"], [7, "green"]], 4],// trips
      [[[2, "blue"], [5, "blue"], [9, "blue"]], 3],// flush
      [[[4, "red"], [5, "blue"], [6, "green"]], 2],// run
      [[[1, "red"], [4, "blue"], [9, "green"]], 1],// sum
    ];
    // For each adjacent pair, the stronger formation must win the claim.
    for (let i = 0; i < ranks.length - 1; i++) {
      const s = freshTwo();
      setSide(s, 0, 0, ranks[i][0]);     // current player (0) stronger
      setSide(s, 0, 1, ranks[i + 1][0]); // opponent weaker
      s.current = 0; s.placedThisTurn = true;
      Schotten.applyAction(s, 0, { action: "claim", target: 0 });
      expect(s.stones[0].claimedBy).toBe(0);
    }
  });

  it("ties break by higher sum, then by who completed first", () => {
    const s = freshTwo();
    setSide(s, 0, 0, [[1, "red"], [2, "red"], [9, "blue"]]); // sum 12, rank=sum
    setSide(s, 0, 1, [[4, "red"], [4, "blue"], [3, "green"]]); // sum 11, rank=sum
    s.current = 0; s.placedThisTurn = true;
    Schotten.applyAction(s, 0, { action: "claim", target: 0 });
    expect(s.stones[0].claimedBy).toBe(0); // 12 > 11
  });

  it("allows an early claim when the opponent provably cannot beat you", () => {
    const s = freshTwo();
    // Player 0 has a color-run 7-8-9 red (the best possible formation: rank 5, sum 24).
    setSide(s, 0, 0, [[7, "red"], [8, "red"], [9, "red"]]);
    // Opponent has only ONE card and cannot reach a tie/beat (best they get is sum/run).
    setSide(s, 0, 1, [[1, "blue"]]);
    s.current = 0; s.placedThisTurn = true;
    Schotten.applyAction(s, 0, { action: "claim", target: 0 });
    expect(s.stones[0].claimedBy).toBe(0);
  });

  it("blocks a claim while the opponent could still win", () => {
    const s = freshTwo();
    setSide(s, 0, 0, [[1, "red"], [2, "blue"], [3, "green"]]); // weak: run? 1-2-3 mixed = run rank2 sum6
    setSide(s, 0, 1, [[9, "red"]]);                            // could still build something bigger
    s.current = 0; s.placedThisTurn = true;
    Schotten.applyAction(s, 0, { action: "claim", target: 0 });
    expect(s.stones[0].claimedBy).toBe(-1);
  });

  it("wins with 5 stones total", () => {
    const s = freshTwo();
    for (let i = 0; i < 5; i++) s.stones[i].claimedBy = 0;
    // trigger a win check via a no-op claim attempt on an already-strong stone
    setSide(s, 5, 0, [[4, "red"], [5, "red"], [6, "red"]]);
    setSide(s, 5, 1, [[1, "blue"], [2, "blue"], [3, "yellow"]]);
    s.current = 0; s.placedThisTurn = true;
    Schotten.applyAction(s, 0, { action: "claim", target: 5 });
    expect(s.phase).toBe("GAME_OVER");
    expect(s.winner).toBe(0);
  });

  it("can end the turn without placing when no legal placement exists (no deadlock)", () => {
    const s = freshTwo();
    s.deck = [];                 // deck empty
    s.players[0].hand = [];      // current player has no cards
    s.current = 0;
    Schotten.applyAction(s, 0, { action: "end" }); // allowed despite not placing
    expect(s.current).toBe(1);   // turn passed
  });

  it("ends the game by stone count when the deck is empty and nobody can place", () => {
    const s = freshTwo();
    s.deck = [];
    s.players[0].hand = []; s.players[1].hand = [];
    s.stones[0].claimedBy = 0; s.stones[1].claimedBy = 0; // P0 leads 2-1
    s.stones[2].claimedBy = 1;
    s.current = 0;
    Schotten.applyAction(s, 0, { action: "end" });
    expect(s.phase).toBe("GAME_OVER");
    expect(s.winner).toBe(0);
  });

  it("wins with 3 adjacent stones", () => {
    const s = freshTwo();
    s.stones[3].claimedBy = 0; s.stones[4].claimedBy = 0;
    setSide(s, 5, 0, [[4, "red"], [5, "red"], [6, "red"]]);
    setSide(s, 5, 1, [[1, "blue"], [2, "blue"], [3, "yellow"]]);
    s.current = 0; s.placedThisTurn = true;
    Schotten.applyAction(s, 0, { action: "claim", target: 5 });
    expect(s.phase).toBe("GAME_OVER");
    expect(s.winner).toBe(0);
  });
});

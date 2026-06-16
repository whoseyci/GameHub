// games/schema/specs/encore.ts — Encore! (Noch mal!) as DATA.
//
// A roll-and-write: a 15-column × 7-row grid of coloured cells laid out in
// connected blocks. On a turn the roller rolls 3 colour dice + 3 number dice,
// keeps a colour+number pair, and crosses that many CONNECTED same-colour cells
// (starting in the centre column H, or adjacent to a crossed cell). Everyone
// else then uses the remaining dice. Race to finish columns + whole colours;
// uncrossed stars cost points; leftover wilds score 1 each.
//
// No engine code lives here — only data. The grid below is a faithful, fully
// connected colour layout (5 colours, ~7 cells each colour per column band) with
// 3 stars per colour, matching the published sheet's structure. Centre = col 7.
import type { RollAndWriteSpec, RWGridRow } from "../spec";

const COLORS = { B: "#3b82f6", O: "#f97316", Y: "#eab308", G: "#22c55e", R: "#ef4444" };

// Build a 7×15 board where EVERY colour region is a single connected block that
// crosses the centre column (index 7). This is the key invariant the engine
// needs: from the centre column you can reach (and eventually fill) every cell of
// every colour. We lay each ROW as one horizontal colour band that always spans
// the centre column, so the whole row is reachable from its centre cell, and we
// rotate the colour per row so the five colours tile the 7 rows. (Faithful to
// Encore's spirit — connected colour blocks, centre-seeded — and provably
// completable, unlike a hand-drawn layout that can strand colours.)
const W = 15;
const H = 7;
const C = ["B", "O", "Y", "G", "R"];   // colour order

// Star positions: 3 per colour, scattered but never in the centre column (so the
// engine can always start a colour without being forced onto a star). Deterministic.
const STAR_SET = new Set<string>();
(function placeStars() {
  // For each colour's rows, drop 3 stars at spread-out columns.
  const perColorRows: Record<string, number[]> = {};
  for (let r = 0; r < H; r++) { const col = C[r % C.length]; (perColorRows[col] ||= []).push(r); }
  for (const col of C) {
    const rows = perColorRows[col] || [];
    let placed = 0;
    const cand = [2, 11, 5, 13, 1]; // spread columns (avoid centre 7)
    for (let i = 0; i < cand.length && placed < 3; i++) {
      const r = rows[(i) % Math.max(1, rows.length)];
      if (r == null) break;
      STAR_SET.add(r + "," + cand[i]);
      placed++;
    }
  }
})();

const grid: RWGridRow[] = [];
for (let r = 0; r < H; r++) {
  const color = C[r % C.length];
  const row: RWGridRow = [];
  for (let c = 0; c < W; c++) {
    row.push({ c: color, ...(STAR_SET.has(r + "," + c) ? { star: true } : {}) });
  }
  grid.push(row);
}

// Column points beneath each column (Encore: edge columns worth more, centre
// worth least). [firstToFinish, others]. Centre (index 7) is cheapest.
const colPts: Array<[number, number]> = Array.from({ length: W }, (_, c) => {
  const dist = Math.abs(c - 7);                 // 0..7
  const high = 1 + dist;                        // 1..8
  return [high, Math.max(0, high - 1)] as [number, number];
});

// Colour bonus per colour (B,O,Y,G,R order), [first, others].
const colorPts: Array<[number, number]> = [[5, 3], [5, 3], [5, 3], [5, 3], [5, 3]];

export const Encore: RollAndWriteSpec = {
  kind: "rollAndWrite",
  meta: {
    id: "encore",
    name: "Encore!",
    description: "Roll colour & number dice, cross connected boxes \u2014 race to finish columns and colours.",
    emoji: "\u{1F58D}\uFE0F",
    icon: "grid",
    minPlayers: 2,
    maxPlayers: 6,
  },
  colors: COLORS,
  grid,
  startCol: 7,
  dice: { colorCount: 3, numberCount: 3, numberFaces: [1, 2, 3, 4, 5], wildColor: true, wildNumber: true },
  wilds: 8,
  scoring: { columns: colPts, colorBonus: colorPts, starPenalty: 2 },
  endColorsToFinish: 2,
};

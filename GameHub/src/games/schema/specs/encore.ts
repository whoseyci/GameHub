// games/schema/specs/encore.ts — Encore! (Noch mal!) as DATA.
//
// A spatial roll-and-write: a 15-column × 7-row grid of coloured cells laid out
// in IRREGULAR connected jigsaw blocks (5 colours). On a turn the roller rolls 3
// colour dice + 3 number dice, drafts a colour+number pair (exclusive), and
// crosses exactly that many CONNECTED same-colour cells — starting in the centre
// column H (index 7) or orthogonally adjacent to a crossed cell of ANY colour.
// Everyone else uses the remaining dice. Race to finish columns + whole colours;
// uncrossed stars cost points; leftover wilds (!) score 1 each. Ends when a
// player completes their 2nd whole colour.
//
// No engine code lives here — only data. The grid is a hand-authored irregular
// layout (validated: balanced colour counts, few connected blocks per colour,
// fully reachable cross-colour from the centre) — a faithful Encore-style sheet,
// not coloured lines.
import type { RollAndWriteSpec, RWGridRow, RWCell } from "../spec";

const COLORS = { B: "#2f6df0", O: "#f97316", Y: "#eab308", G: "#22c55e", R: "#ef4444" };

// 7 rows × 15 columns. Centre column is index 7 ("H"). Letters = colour ids;
// a trailing "*" marks a star (penalty if left uncrossed). Stars: 3 per colour,
// spread out, never in the centre column.
const ROWS: string[] = [
  "B  B  B*  O  O  O  Y  Y  Y  Y  G  G  G*  R  R",
  "B  B  O*  O  Y*  Y  Y  G  G  G  G  R  R*  R  R",
  "O  O  O  O  Y  Y  G  G  B  B  G  R  R  B  B",
  "O  Y  Y  Y*  Y  G*  G  B  B*  B  O*  O  R  B  B",
  "O  O  Y  G  G  G  R  R  B  O  O  O*  R  R*  B",
  "R  O  O  G  G*  R  R  R  B*  B  O  Y  Y  R  R",
  "R  R  R*  R  G  G  R  B  B  Y  Y*  Y  Y  Y  R",
];

function parse(rows: string[]): RWGridRow[] {
  return rows.map((line) =>
    line.trim().split(/\s+/).map((tok): RWCell | null => {
      const star = tok.endsWith("*");
      const c = star ? tok.slice(0, -1) : tok;
      return { c, ...(star ? { star: true } : {}) };
    })
  );
}

const grid = parse(ROWS);
const W = grid[0].length; // 15

// Column point ladder: edge columns are worth the most, the centre (H) the least
// — [firstToFinish, others]. Mirrors the real sheet's "outer = harder = more".
const colPts: Array<[number, number]> = Array.from({ length: W }, (_, c) => {
  const dist = Math.abs(c - 7);                 // 0 (centre) .. 7 (edge)
  const high = 1 + dist;                        // 1..8
  return [high, Math.max(1, high - 1)] as [number, number];
});

// Colour bonus per colour (B,O,Y,G,R order), [first, others]. Real sheet uses a
// 5/3-style spread; first-to-finish a colour is a big swing.
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

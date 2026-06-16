// games/schema/specs/encore.ts — Encore! (Noch mal!) as DATA.
//
// A spatial roll-and-write: a 15-column × 7-row grid of coloured cells laid out
// in IRREGULAR connected jigsaw blocks (5 colours). On a turn the roller rolls 3
// colour dice + 3 number dice, drafts a colour+number pair (exclusive — that pair
// is then UNAVAILABLE to everyone else), and crosses exactly that many CONNECTED
// same-colour cells — starting in the centre column H (index 7) or orthogonally
// adjacent to a crossed cell of ANY colour. Everyone else uses the REMAINING dice.
// Race to finish columns + whole colours; uncrossed stars cost 2pts each; leftover
// wilds (!) score 1 each. Ends when a player completes their 2nd whole colour.
//
// No engine code lives here — only data. The grid below is transcribed CELL-BY-CELL
// from the real Noch mal! base-game scoring sheet (every colour + star position
// copied from the reference board). Validated: exactly 21 cells of each of the 5
// colours (105 total), exactly 3 stars per colour (15 total), and 100% reachable
// cross-colour from the centre column H. Column + colour-bonus points are the exact
// official values (see colPts / colorPts below).
import type { RollAndWriteSpec, RWGridRow, RWCell } from "../spec";

const COLORS = { B: "#2f6df0", O: "#f97316", Y: "#eab308", G: "#22c55e", R: "#ef4444" };

// 7 rows × 15 columns (A–O). Centre column is index 7 ("H"). Letters = colour ids;
// a trailing "*" marks a star (penalty if left uncrossed). This is an EXACT
// transcription of the official base-game sheet (21 per colour, 3 stars per colour).
const ROWS: string[] = [
  "G   G   G   Y   Y   Y   Y   G*  B   B   B   O*  Y   Y   Y",
  "O   G   Y*  G   Y*  Y   O   O   R   B*  B   O   O   G   G",
  "B*  G   R   G   G   G   G*  R   R   R   Y   Y   O   G   G",
  "B   R   R   G   O   O*  B   B   G   G   Y   Y   O   R*  B",
  "R   O   O   O   O   R   B   B   O   O   O   R   R   R   R",
  "R   B*  B   R*  R   R   R   Y   Y*  O   R*  B   B   B   O*",
  "Y   Y   B   B   B   B   R   Y   Y   Y   G   G   G*  O   O",
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
const W = grid[0].length; // 15 (kept here so colPts length can be asserted below)

// Column point ladder, [firstToFinish, others] — the EXACT official values printed
// on the base-game sheet (A..O). Symmetric: edges 5/3, then 3/2, 2/1, centre H 1/0.
//   A   B   C   D   E   F   G   H   I   J   K   L   M   N   O
//  5/3 3/2 3/2 3/2 2/1 2/1 2/1 1/0 2/1 2/1 2/1 3/2 3/2 3/2 5/3
const colPts: Array<[number, number]> = [
  [5, 3], [3, 2], [3, 2], [3, 2], [2, 1], [2, 1], [2, 1], [1, 0],
  [2, 1], [2, 1], [2, 1], [3, 2], [3, 2], [3, 2], [5, 3],
];
if (colPts.length !== W) throw new Error("encore: colPts length must equal grid width");

// Colour bonus per colour (B,O,Y,G,R order to match COLORS), [first, others].
// Official sheet: every colour is worth 5 (first) / 3 (later).
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

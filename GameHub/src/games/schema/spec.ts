// games/schema/spec.ts — declarative GameSpecs for schema-defined games.
//
// A GameSpec is DATA (no code). The engines in ./engine-*.ts interpret it into a
// normal GameModule. Two kinds today:
//   • "pressYourLuck" — generalised Flip 7 / can't-stop (draw/bust/bank).
//   • "rollAndWrite"  — Encore!/Noch mal!-style spatial grid (roll colour+number
//     dice, fill connected boxes, race to finish columns/colours).
// See docs/GAME_SCHEMA.md. Keep these JSON-serializable (the visual editor must
// be able to emit + store them): no functions, no class instances.

// ─────────────────────────── shared meta ───────────────────────────
export interface SpecMeta {
  id: string;            // stable, [a-z0-9_-]{2,32}
  name: string;
  description: string;
  emoji: string;
  icon?: string;         // Phosphor icon name (preferred in UI)
  minPlayers: number;    // >= 2
  maxPlayers: number;    // <= 8
}

function metaErrors(m: SpecMeta, out: string[]) {
  if (!m || !/^[a-z0-9_-]{2,32}$/.test(m.id || "")) out.push("meta.id must be 2-32 [a-z0-9_-]");
  if (!m?.name) out.push("meta.name required");
  if (!(m && m.minPlayers >= 2 && m.maxPlayers <= 8 && m.minPlayers <= m.maxPlayers))
    out.push("meta player counts must satisfy 2 <= min <= max <= 8");
}

// ───────────────────────── pressYourLuck ─────────────────────────
export interface DeckEntry { value: number; count: number; }

export interface PressYourLuckSpec {
  kind: "pressYourLuck";
  meta: SpecMeta;
  deck: DeckEntry[];
  bust: "duplicate";
  bonus?: { uniqueCount: number; points: number };
  scoring: "sum";
  win: { target: number };
}

// ───────────────────────── rollAndWrite ─────────────────────────
// A spatial roll-and-write (Encore!/Noch mal!). The board is a grid of coloured
// cells laid out as DATA: `grid` is an array of rows; each row is an array of
// cells. A cell is `null` (gap) or `{ c, star? }` where `c` is a colour id.
// Players cross off CONNECTED runs of one colour using a colour die + number die.
export interface RWCell { c: string; star?: boolean; }
export type RWGridRow = (RWCell | null)[];

export interface RollAndWriteSpec {
  kind: "rollAndWrite";
  meta: SpecMeta;
  /** Colour ids → display hex. The wild colour die face matches any of these. */
  colors: Record<string, string>;
  /** The board: rows of cells (null = gap). All players share an identical board. */
  grid: RWGridRow[];
  /** Which column index (0-based) is the mandatory START column (must begin here
   *  or adjacent to an already-marked cell). Encore's centre column = "H". */
  startCol: number;
  /** Dice: how many colour dice + number dice are rolled. The roller keeps ONE of
   *  each (a pair); everyone else may use the REMAINING dice. */
  dice: { colorCount: number; numberCount: number; numberFaces: number[]; wildColor: boolean; wildNumber: boolean };
  /** Wild budget: each player may use up to this many wilds total (Encore = 8). */
  wilds: number;
  /** Scoring. Per-column points are [firstToFinish, others]; per-colour bonus the
   *  same. Stars left uncrossed cost `starPenalty` each. Leftover wilds: 1pt each. */
  scoring: {
    columns: Array<[number, number]>;     // index by column → [high, low]
    colorBonus: Array<[number, number]>;  // index by colour (in `colors` order) → [high, low]
    starPenalty: number;                  // positive number subtracted per uncrossed star
  };
  /** Game ends when a player has completed `endColorsToFinish` whole colours. */
  endColorsToFinish: number;
}

export type GameSpec = PressYourLuckSpec | RollAndWriteSpec;

// ───────────────────────────── validation ─────────────────────────────
export function validatePressYourLuck(spec: PressYourLuckSpec): string[] {
  const errs: string[] = [];
  if (!spec || spec.kind !== "pressYourLuck") return ["not a pressYourLuck spec"];
  metaErrors(spec.meta, errs);
  if (!Array.isArray(spec.deck) || !spec.deck.length) errs.push("deck must be a non-empty array");
  else {
    let total = 0;
    for (const d of spec.deck) {
      if (!Number.isFinite(d.value) || !Number.isInteger(d.count) || d.count < 1 || d.count > 200) { errs.push(`bad deck entry ${JSON.stringify(d)}`); break; }
      total += d.count;
    }
    if (total < 8) errs.push("deck must have at least 8 cards total");
    if (total > 1000) errs.push("deck too large (max 1000 cards)");
  }
  if (spec.bust !== "duplicate") errs.push(`unsupported bust: ${spec.bust}`);
  if (spec.scoring !== "sum") errs.push(`unsupported scoring: ${spec.scoring}`);
  if (spec.bonus && !(spec.bonus.uniqueCount >= 2 && Number.isFinite(spec.bonus.points))) errs.push("bad bonus");
  if (!spec.win || !(spec.win.target > 0)) errs.push("win.target must be > 0");
  return errs;
}

export function validateRollAndWrite(spec: RollAndWriteSpec): string[] {
  const errs: string[] = [];
  if (!spec || spec.kind !== "rollAndWrite") return ["not a rollAndWrite spec"];
  metaErrors(spec.meta, errs);
  const colorIds = spec.colors ? Object.keys(spec.colors) : [];
  if (colorIds.length < 2 || colorIds.length > 8) errs.push("colors must have 2-8 entries");
  if (!Array.isArray(spec.grid) || !spec.grid.length) errs.push("grid must be a non-empty array of rows");
  else {
    const w = spec.grid[0].length;
    if (!(w > 0 && w <= 30)) errs.push("grid width must be 1-30");
    let cells = 0;
    for (const row of spec.grid) {
      if (!Array.isArray(row) || row.length !== w) { errs.push("all grid rows must be the same width"); break; }
      for (const cell of row) {
        if (cell === null) continue;
        cells++;
        if (!cell.c || !colorIds.includes(cell.c)) { errs.push(`grid cell colour "${cell?.c}" not in colors`); break; }
      }
    }
    if (cells < 4) errs.push("grid must have at least 4 cells");
    if (cells > 600) errs.push("grid too large (max 600 cells)");
    if (!(spec.startCol >= 0 && spec.startCol < w)) errs.push("startCol out of range");
  }
  const d = spec.dice;
  if (!d || !(d.colorCount >= 1 && d.colorCount <= 6) || !(d.numberCount >= 1 && d.numberCount <= 6)) errs.push("bad dice counts");
  if (!Array.isArray(d?.numberFaces) || !d.numberFaces.length || d.numberFaces.some((n) => !Number.isInteger(n) || n < 1 || n > 9)) errs.push("numberFaces must be ints 1-9");
  if (!(spec.wilds >= 0 && spec.wilds <= 50)) errs.push("wilds 0-50");
  const sc = spec.scoring;
  if (!sc || !Array.isArray(sc.columns) || !Array.isArray(sc.colorBonus)) errs.push("scoring.columns / colorBonus required");
  if (sc && !(sc.starPenalty >= 0)) errs.push("starPenalty must be >= 0");
  if (!(spec.endColorsToFinish >= 1)) errs.push("endColorsToFinish must be >= 1");
  return errs;
}

/** Dispatching validator used by the public makeSchemaGame. */
export function validateSpec(spec: GameSpec): string[] {
  if (!spec || typeof spec !== "object") return ["spec is not an object"];
  if (spec.kind === "pressYourLuck") return validatePressYourLuck(spec);
  if (spec.kind === "rollAndWrite") return validateRollAndWrite(spec);
  return [`unsupported kind: ${(spec as any).kind}`];
}

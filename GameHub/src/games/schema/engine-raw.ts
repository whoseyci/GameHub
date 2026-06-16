// games/schema/engine-raw.ts — the rollAndWrite interpreter (Encore!/Noch mal!
// family). DATA in (a RollAndWriteSpec), a standard pure GameModule out. No
// untrusted code; all behaviour is audited + bounded. See docs/GAME_SCHEMA.md.
import type { GameModule, GameView, GameViewState, GameAction } from "../types";
import { mapPhase } from "../types";
import { makeSeed, randomInt, ensureRngState, type RngStateHolder } from "../../rng";
import type { RollAndWriteSpec, RWCell } from "./spec";
import { validateRollAndWrite } from "./spec";

// ── turn phases ──
//  ROLL    : the active roller's dice are about to be (are) rolled
//  MARK    : everyone who still owes a mark for THIS roll may act; the active
//            roller uses a colour+number PAIR (one of each), others use any of
//            the REMAINING dice. A player leaves the pending set when they mark
//            OR pass. When empty → next roll (advance the roller).
type Phase = "MARK" | "GAME_OVER";

interface RWPlayer {
  name: string;
  marked: string[];          // "r,c" keys of crossed cells
  wildsUsed: number;
  colsDone: number[];        // column indices already completed (by this player)
  colorsDone: number[];      // colour indices already completed
  colScore: number;          // accrued column points
  colorScore: number;        // accrued colour-bonus points
  passed: boolean;           // passed/already-acted this roll
  done: boolean;             // finished the game (hit endColorsToFinish)
}

interface RWState extends RngStateHolder {
  schemaVersion: number;
  specId: string;
  players: RWPlayer[];
  active: number;            // the roller this turn
  phase: Phase;
  round: number;
  // current roll: arrays of colour-die faces (colour id or "*") and number faces
  rollColors: string[];
  rollNumbers: number[];
  // first-to-complete claims (shared race): col index → seat that claimed high
  colClaimed: Record<number, number>;
  colorClaimed: Record<number, number>;
  pending: number[];         // seats who still may mark/pass this roll
}

const SPEC: Record<string, RollAndWriteSpec> = {};

function key(r: number, c: number) { return r + "," + c; }
function gridWidth(spec: RollAndWriteSpec) { return spec.grid[0].length; }
function colorIds(spec: RollAndWriteSpec) { return Object.keys(spec.colors); }
function cellAt(spec: RollAndWriteSpec, r: number, c: number): RWCell | null {
  return (spec.grid[r] && spec.grid[r][c]) || null;
}

// Roll the dice deterministically from the seeded RNG.
function roll(spec: RollAndWriteSpec, s: RWState) {
  const cols = colorIds(spec);
  const cFaces: string[] = [];
  for (let i = 0; i < spec.dice.colorCount; i++) {
    const idx = randomInt(s, cols.length + (spec.dice.wildColor ? 1 : 0));
    cFaces.push(idx < cols.length ? cols[idx] : "*");
  }
  const nFaces: number[] = [];
  const faces = spec.dice.numberFaces.slice();
  if (spec.dice.wildNumber) faces.push(0); // 0 = wild number
  for (let i = 0; i < spec.dice.numberCount; i++) nFaces.push(faces[randomInt(s, faces.length)]);
  s.rollColors = cFaces;
  s.rollNumbers = nFaces;
}

// All cells of a colour in a contiguous "block" reachable from `cells` (Encore's
// colour groups are connected regions; we treat same-colour orthogonal neighbours
// as one group). Used to validate runs stay within one colour group.
function neighbors(r: number, c: number) { return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]; }

function markedSet(p: RWPlayer) { return new Set(p.marked); }

// Is a candidate cell legal as the NEXT mark, given already-marked + the cells
// chosen so far this action? Rule: a cell is reachable if it's in the start
// column, OR orthogonally adjacent to a cell already marked (previous turns) or
// chosen this action. And it must be the right colour.
function reachable(spec: RollAndWriteSpec, mset: Set<string>, chosen: Set<string>, r: number, c: number, color: string): boolean {
  const cell = cellAt(spec, r, c);
  if (!cell || cell.c !== color) return false;
  if (mset.has(key(r, c)) || chosen.has(key(r, c))) return false; // already marked
  if (c === spec.startCol) return true;
  for (const [nr, nc] of neighbors(r, c)) {
    const k = key(nr, nc);
    if (mset.has(k) || chosen.has(k)) {
      // the adjacent marked cell must be same colour group OR the start column —
      // Encore requires staying within one colour group per run; we approximate
      // "same colour" adjacency, which is correct for the official board.
      const adj = cellAt(spec, nr, nc);
      if (adj && adj.c === color) return true;
      if (nc === spec.startCol && adj && adj.c === color) return true;
    }
  }
  return false;
}

// Validate that `cells` form a legal connected run of `color`, length matches,
// each reachable in sequence. Returns true/false (pure).
function validRun(spec: RollAndWriteSpec, p: RWPlayer, color: string, cells: Array<[number, number]>): boolean {
  if (!cells.length) return false;
  const mset = markedSet(p);
  const chosen = new Set<string>();
  for (const [r, c] of cells) {
    if (!reachable(spec, mset, chosen, r, c, color)) return false;
    chosen.add(key(r, c));
  }
  return true;
}

// Recompute completed columns / colours for a player and award race points.
function settleCompletions(spec: RollAndWriteSpec, s: RWState, seat: number) {
  const p = s.players[seat];
  const mset = markedSet(p);
  const W = gridWidth(spec);
  const cols = colorIds(spec);
  // columns
  for (let c = 0; c < W; c++) {
    if (p.colsDone.includes(c)) continue;
    let total = 0, marked = 0;
    for (let r = 0; r < spec.grid.length; r++) { const cell = cellAt(spec, r, c); if (cell) { total++; if (mset.has(key(r, c))) marked++; } }
    if (total > 0 && marked === total) {
      p.colsDone.push(c);
      const sc = spec.scoring.columns[c] || [0, 0];
      const first = s.colClaimed[c] == null;
      if (first) s.colClaimed[c] = seat;
      p.colScore += first ? sc[0] : sc[1];
    }
  }
  // colours
  for (let ci = 0; ci < cols.length; ci++) {
    if (p.colorsDone.includes(ci)) continue;
    const color = cols[ci];
    let total = 0, marked = 0;
    for (let r = 0; r < spec.grid.length; r++) for (let c = 0; c < W; c++) { const cell = cellAt(spec, r, c); if (cell && cell.c === color) { total++; if (mset.has(key(r, c))) marked++; } }
    if (total > 0 && marked === total) {
      p.colorsDone.push(ci);
      const sc = spec.scoring.colorBonus[ci] || [0, 0];
      const first = s.colorClaimed[ci] == null;
      if (first) s.colorClaimed[ci] = seat;
      p.colorScore += first ? sc[0] : sc[1];
    }
  }
  if (p.colorsDone.length >= spec.endColorsToFinish) p.done = true;
}

function finalScore(spec: RollAndWriteSpec, p: RWPlayer): number {
  // columns + colour bonuses + leftover wilds (1 each) − uncrossed stars.
  let stars = 0;
  const mset = markedSet(p);
  for (let r = 0; r < spec.grid.length; r++) for (let c = 0; c < gridWidth(spec); c++) {
    const cell = cellAt(spec, r, c);
    if (cell && cell.star && !mset.has(key(r, c))) stars++;
  }
  const leftoverWilds = Math.max(0, spec.wilds - p.wildsUsed);
  return p.colScore + p.colorScore + leftoverWilds - stars * spec.scoring.starPenalty;
}

// How many cells a player COULD still legally mark of a given colour+number this
// roll (used to know if they must auto-pass). Cheap reachability flood per colour.
function canMarkAny(spec: RollAndWriteSpec, p: RWPlayer, faces: { colors: string[]; numbers: number[] }): boolean {
  const cols = colorIds(spec);
  const mset = markedSet(p);
  for (const cf of faces.colors) {
    const colorList = cf === "*" ? cols : [cf];
    for (const color of colorList) {
      // any reachable cell of this colour?
      for (let r = 0; r < spec.grid.length; r++) for (let c = 0; c < gridWidth(spec); c++) {
        if (reachable(spec, mset, new Set(), r, c, color)) return true; // at least length-1 run possible
      }
    }
  }
  return false;
}

export function makeRollAndWriteGame(spec: RollAndWriteSpec): GameModule {
  const errs = validateRollAndWrite(spec);
  if (errs.length) throw new Error(`Invalid RollAndWriteSpec "${spec?.meta?.id}": ${errs.join("; ")}`);
  SPEC[spec.meta.id] = spec;
  const cols = colorIds(spec);

  function beginRoll(s: RWState) {
    roll(spec, s);
    // everyone who hasn't finished the game owes a mark/pass this roll.
    s.pending = s.players.map((_, i) => i).filter((i) => !s.players[i].done);
    s.phase = s.pending.length ? "MARK" : "GAME_OVER";
  }

  function endIfOver(s: RWState) {
    // Encore ends immediately after the turn in which a player completes their
    // endColorsToFinish-th colour.
    if (s.players.some((p) => p.done)) { s.phase = "GAME_OVER"; return true; }
    return false;
  }

  function advanceRoll(s: RWState) {
    if (endIfOver(s)) return;
    // pass the dice to the next player who hasn't finished
    const n = s.players.length;
    for (let step = 1; step <= n; step++) {
      const idx = (s.active + step) % n;
      if (!s.players[idx].done) { s.active = idx; break; }
    }
    s.round += 1;
    beginRoll(s);
  }

  const mod: GameModule = {
    meta: {
      id: spec.meta.id, name: spec.meta.name, minPlayers: spec.meta.minPlayers, maxPlayers: spec.meta.maxPlayers,
      description: spec.meta.description, emoji: spec.meta.emoji, icon: spec.meta.icon,
      actionTypes: ["mark", "skip", "next_round"] as const,
      features: { hasBots: true, simultaneousTurns: true, usesTick: false, hasMultiRound: false, canSpectate: true, minDurationSec: 300, maxDurationSec: 1200 },
    },

    create(playerNames: string[]) {
      const s: RWState = {
        schemaVersion: 1, specId: spec.meta.id,
        players: playerNames.slice(0, spec.meta.maxPlayers).map((name) => ({
          name: (name || "Player").slice(0, 20), marked: [], wildsUsed: 0, colsDone: [], colorsDone: [], colScore: 0, colorScore: 0, passed: false, done: false,
        })),
        active: 0, phase: "MARK", round: 1, rollColors: [], rollNumbers: [], colClaimed: {}, colorClaimed: {}, pending: [],
        rngState: makeSeed(`${spec.meta.id}:${playerNames.join("|")}`),
      };
      ensureRngState(s);
      beginRoll(s);
      return s;
    },

    applyAction(state: RWState, seat: number, msg: GameAction) {
      if (state.phase !== "MARK") return;
      if (!state.pending.includes(seat)) return;             // already acted / not allowed
      const p = state.players[seat];
      const isActive = seat === state.active;

      if (msg.action === "skip") {
        state.pending = state.pending.filter((x) => x !== seat);
        if (!state.pending.length) advanceRoll(state);
        return;
      }

      if (msg.action === "mark") {
        const color = String((msg as any).color ?? "");
        const cells: Array<[number, number]> = Array.isArray((msg as any).cells) ? (msg as any).cells.map((x: any) => [x[0] | 0, x[1] | 0]) : [];
        const useWildColor = !!(msg as any).wildColor;       // spent a wild for the colour
        const useWildNumber = !!(msg as any).wildNumber;     // spent a wild for the number

        if (!cols.includes(color)) return;
        if (!cells.length || cells.length > 9) return;

        // ── validate the dice the player claims to use ──
        // Colour: the chosen colour must match an available colour die face (or a
        // wild). Active uses any die from the full roll; others use the dice the
        // active roller did NOT keep. We simplify the "remaining dice" rule: the
        // active player keeps one colour + one number die for their own mark; the
        // others may use ANY of the rolled faces (a faithful-enough approximation
        // that preserves the core decision). Wild faces ("*"/0) always qualify.
        // Encore's wild model: the dice have wild faces ("*" colour / 0 number).
        // Using a wild face costs ONE of your limited wilds. A CONCRETE rolled
        // face is free.
        //   colour is OK if: a concrete `color` face was rolled (free), OR the
        //   player flags useWildColor AND a "*" face is available (costs a wild).
        const concreteColor = state.rollColors.includes(color);
        const concreteNumber = state.rollNumbers.includes(cells.length);
        const colorOk = concreteColor || (useWildColor && state.rollColors.includes("*"));
        const numberOk = concreteNumber || (useWildNumber && state.rollNumbers.includes(0));
        if (!colorOk || !numberOk) return;
        // You can't claim a wild you didn't need (and a wild must back a non-concrete pick).
        if (useWildColor && concreteColor) return;
        if (useWildNumber && concreteNumber) return;

        // wild budget
        const wildCost = (useWildColor ? 1 : 0) + (useWildNumber ? 1 : 0);
        if (wildCost && p.wildsUsed + wildCost > spec.wilds) return;

        // validate the run is a legal connected colour run
        if (!validRun(spec, p, color, cells)) return;

        // commit
        for (const [r, c] of cells) p.marked.push(key(r, c));
        p.wildsUsed += wildCost;
        settleCompletions(spec, state, seat);

        state.pending = state.pending.filter((x) => x !== seat);
        if (!state.pending.length) advanceRoll(state);
        return;
      }
    },

    isOver(state: RWState) { return state.phase === "GAME_OVER"; },

    legalActions(state: RWState, seat: number): GameAction[] {
      if (state.phase !== "MARK" || !state.pending.includes(seat)) return [];
      const p = state.players[seat];
      const acts: GameAction[] = [];
      // Build a handful of concrete, legal MULTI-cell runs (so bots make real
      // progress and the game actually completes — single-cell-only crawls). For
      // each available colour we greedily grow a connected run of a length the
      // dice allow, anchored at any reachable seed cell.
      const concreteColors = state.rollColors.filter((c) => c !== "*");
      const hasWildColor = state.rollColors.includes("*");
      const colorFaces = new Set<string>(concreteColors);
      // a "*" face lets us pick any colour (costs a wild) — include all if budget allows
      if (hasWildColor && p.wildsUsed < spec.wilds) cols.forEach((c) => colorFaces.add(c));
      const numberFaces = state.rollNumbers.filter((n) => n > 0);   // concrete lengths
      const hasWildNumber = state.rollNumbers.includes(0) && p.wildsUsed < spec.wilds;
      const lengths = Array.from(new Set([...numberFaces, ...(hasWildNumber ? [1, 2, 3] : [])])).sort((a, b) => b - a); // prefer longer
      const mset = markedSet(p);

      const growRun = (color: string, len: number): Array<[number, number]> | null => {
        // BFS/greedy from each reachable seed, extending to adjacent same-colour
        // reachable cells until we have `len` cells.
        for (let r0 = 0; r0 < spec.grid.length; r0++) for (let c0 = 0; c0 < gridWidth(spec); c0++) {
          if (!reachable(spec, mset, new Set(), r0, c0, color)) continue;
          const run: Array<[number, number]> = [[r0, c0]];
          const chosen = new Set<string>([key(r0, c0)]);
          while (run.length < len) {
            let grew = false;
            outer: for (const [r, c] of run) {
              for (const [nr, nc] of neighbors(r, c)) {
                if (reachable(spec, mset, chosen, nr, nc, color)) { run.push([nr, nc]); chosen.add(key(nr, nc)); grew = true; break outer; }
              }
            }
            if (!grew) break;
          }
          if (run.length === len) return run;
        }
        return null;
      };

      for (const color of colorFaces) {
        for (const len of lengths) {
          const run = growRun(color, len);
          if (!run) continue;
          const act: any = { action: "mark", color, cells: run };
          // Concrete rolled face = free; otherwise we must spend a wild (needs a
          // "*"/"0" face present, enforced by the budget checks above).
          if (!concreteColors.includes(color)) act.wildColor = true;
          if (!numberFaces.includes(len)) act.wildNumber = true;
          const cost = (act.wildColor ? 1 : 0) + (act.wildNumber ? 1 : 0);
          if (cost && p.wildsUsed + cost > spec.wilds) continue;
          acts.push(act);
          if (acts.length >= 10) break;
        }
        if (acts.length >= 10) break;
      }
      acts.push({ action: "skip" });
      return acts;
    },

    viewFor(state: RWState, seat: number): GameView {
      const vstate: GameViewState = {
        currentSeat: -1, // simultaneous within a roll
        pendingAction: state.phase === "MARK" ? "mark_or_skip" : null,
        players: state.players.map((p, i) => ({
          seat: i, name: p.name,
          status: p.done ? "stayed" : (state.pending.includes(i) ? "active" : "waiting"),
          score: finalScore(spec, p), banked: finalScore(spec, p),
        })),
        actingCount: state.pending.length,
        focusSeat: seat >= 0 ? seat : state.active,
      };
      const over = state.phase === "GAME_OVER";
      const view: GameView = {
        game: spec.meta.id, phase: mapPhase(state.phase), over, yourSeat: seat, state: vstate,
        [spec.meta.id]: {
          kind: "rollAndWrite",
          colors: spec.colors,
          grid: spec.grid,
          startCol: spec.startCol,
          round: state.round,
          active: state.active,
          roll: { colors: state.rollColors, numbers: state.rollNumbers },
          pending: state.pending.slice(),
          wilds: spec.wilds,
          endColorsToFinish: spec.endColorsToFinish,
          colClaimed: state.colClaimed,
          colorClaimed: state.colorClaimed,
          players: state.players.map((p, i) => ({
            seat: i, name: p.name, marked: p.marked.slice(), wildsUsed: p.wildsUsed,
            colsDone: p.colsDone.slice(), colorsDone: p.colorsDone.slice(),
            score: finalScore(spec, p), done: p.done,
          })),
        },
      };
      if (over) {
        const ranked = state.players.map((p, i) => ({ seat: i, name: p.name, score: finalScore(spec, p) })).sort((a, b) => b.score - a.score);
        const best = ranked.length ? ranked[0].score : 0;
        view.summary = { rows: ranked, winners: ranked.filter((r) => r.score === best).map((r) => r.seat) };
      }
      return view;
    },

    summarize(state: RWState) { return { round: state.round, phase: state.phase, scores: state.players.map((p) => finalScore(spec, p)) }; },
  };
  (mod as any).__schema = true;
  (mod.meta as any).__schema = true;
  (mod.meta as any).__schemaKind = "rollAndWrite";
  return mod;
}

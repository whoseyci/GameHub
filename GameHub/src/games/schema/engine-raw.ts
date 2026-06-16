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
type Phase = "DRAFT" | "MARK" | "GAME_OVER";

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
  turnNo: number;            // 1-based turns played (for the "first 3 turns" rule)
  // current roll: arrays of colour-die faces (colour id or "*") and number faces
  rollColors: string[];
  rollNumbers: number[];
  // ── dice DRAFT (Encore's core mechanic) ──
  //  The active roller reserves ONE colour die + ONE number die for their own
  //  exclusive use; everyone else may use any combo of the REMAINING dice. For
  //  the first 3 turns there is no draft — all 6 dice are shared by everyone.
  draftColorIdx: number;     // index into rollColors the roller took (-1 = none yet)
  draftNumberIdx: number;    // index into rollNumbers the roller took (-1 = none yet)
  noDraft: boolean;          // true during the first 3 turns (everyone uses all 6)
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
  if (!cell || cell.c !== color) return false;            // run must be ONE colour
  if (mset.has(key(r, c)) || chosen.has(key(r, c))) return false; // already crossed
  if (c === spec.startCol) return true;                   // start column always reachable
  // Encore connectivity: a new box must be orthogonally adjacent to ANY already
  // crossed box (any colour) OR a box chosen earlier in THIS clump. The chosen
  // colour only constrains the cell itself — not the neighbour's colour.
  for (const [nr, nc] of neighbors(r, c)) {
    const k = key(nr, nc);
    if (mset.has(k) || chosen.has(k)) return true;
  }
  return false;
}

// Validate that `cells` form a legal connected run of `color`, length matches,
// each reachable in sequence. Returns true/false (pure).
function validRun(spec: RollAndWriteSpec, p: RWPlayer, color: string, cells: Array<[number, number]>): boolean {
  // Order-INDEPENDENT validation of an Encore clump:
  //  1) at least 1 cell, no duplicates, none already crossed;
  //  2) every cell is the chosen colour;
  //  3) the cells form ONE orthogonally-connected clump;
  //  4) the clump connects to the rest of the board: at least one cell is in the
  //     start column OR orthogonally adjacent to an already-crossed box (any
  //     colour). [exact count vs the die is checked by the caller.]
  if (!cells.length) return false;
  const mset = markedSet(p);
  const want = new Set<string>();
  for (const [r, c] of cells) {
    const k = key(r, c);
    if (want.has(k) || mset.has(k)) return false;          // dup / already crossed
    const cell = cellAt(spec, r, c);
    if (!cell || cell.c !== color) return false;           // one colour only
    want.add(k);
  }
  // (3) internal connectivity — flood within the chosen set from cells[0].
  const seen = new Set<string>([key(cells[0][0], cells[0][1])]);
  const stack = [cells[0]];
  while (stack.length) {
    const [r, c] = stack.pop()!;
    for (const [nr, nc] of neighbors(r, c)) {
      const k = key(nr, nc);
      if (want.has(k) && !seen.has(k)) { seen.add(k); stack.push([nr, nc]); }
    }
  }
  if (seen.size !== want.size) return false;
  // (4) anchored to the board.
  for (const [r, c] of cells) {
    if (c === spec.startCol) return true;
    for (const [nr, nc] of neighbors(r, c)) if (mset.has(key(nr, nc))) return true;
  }
  return false;
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
    s.draftColorIdx = -1; s.draftNumberIdx = -1;
    // For the first 3 turns of the game everyone uses all 6 dice (no draft).
    s.noDraft = s.turnNo <= 3;
    if (s.noDraft) {
      s.pending = s.players.map((_, i) => i).filter((i) => !s.players[i].done);
      s.phase = s.pending.length ? "MARK" : "GAME_OVER";
    } else {
      // The active roller drafts first; if they can't act they may pass the draft.
      s.phase = s.players[s.active] && !s.players[s.active].done ? "DRAFT" : "MARK";
      if (s.phase === "MARK") { s.pending = s.players.map((_, i) => i).filter((i) => !s.players[i].done); }
      else { s.pending = []; }
    }
    if (!s.players.some((p, i) => !p.done)) s.phase = "GAME_OVER";
  }

  // The colour + number die faces a seat may use right now, given the draft.
  function allowedFaces(s: RWState, seat: number): { colors: string[]; numbers: number[] } {
    if (s.noDraft) return { colors: s.rollColors.slice(), numbers: s.rollNumbers.slice() };
    if (seat === s.active) {
      // exactly the two dice the roller drafted
      return {
        colors: s.draftColorIdx >= 0 ? [s.rollColors[s.draftColorIdx]] : [],
        numbers: s.draftNumberIdx >= 0 ? [s.rollNumbers[s.draftNumberIdx]] : [],
      };
    }
    // everyone else: the REMAINING dice (all except the roller's drafted pair)
    return {
      colors: s.rollColors.filter((_, i) => i !== s.draftColorIdx),
      numbers: s.rollNumbers.filter((_, i) => i !== s.draftNumberIdx),
    };
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
    s.round += 1; s.turnNo += 1;
    beginRoll(s);
  }

  // After the roller drafts (or passes), open the MARK phase for everyone.
  function openMark(s: RWState) {
    s.pending = s.players.map((_, i) => i).filter((i) => !s.players[i].done);
    s.phase = s.pending.length ? "MARK" : "GAME_OVER";
  }

  const mod: GameModule = {
    meta: {
      id: spec.meta.id, name: spec.meta.name, minPlayers: spec.meta.minPlayers, maxPlayers: spec.meta.maxPlayers,
      description: spec.meta.description, emoji: spec.meta.emoji, icon: spec.meta.icon,
      actionTypes: ["draft", "mark", "skip", "next_round"] as const,
      features: { hasBots: true, simultaneousTurns: true, usesTick: false, hasMultiRound: false, canSpectate: true, minDurationSec: 300, maxDurationSec: 1200 },
    },

    create(playerNames: string[]) {
      const s: RWState = {
        schemaVersion: 1, specId: spec.meta.id,
        players: playerNames.slice(0, spec.meta.maxPlayers).map((name) => ({
          name: (name || "Player").slice(0, 20), marked: [], wildsUsed: 0, colsDone: [], colorsDone: [], colScore: 0, colorScore: 0, passed: false, done: false,
        })),
        active: 0, phase: "MARK", round: 1, turnNo: 1, rollColors: [], rollNumbers: [],
        draftColorIdx: -1, draftNumberIdx: -1, noDraft: true,
        colClaimed: {}, colorClaimed: {}, pending: [],
        rngState: makeSeed(`${spec.meta.id}:${playerNames.join("|")}`),
      };
      ensureRngState(s);
      beginRoll(s);
      return s;
    },

    applyAction(state: RWState, seat: number, msg: GameAction) {
      // ── DRAFT phase: only the active roller acts, reserving 1 colour + 1
      //    number die (by index) for their exclusive use, then everyone marks. ──
      if (state.phase === "DRAFT") {
        if (seat !== state.active) return;
        if (msg.action === "draft") {
          const ci = (msg as any).colorIdx | 0;
          const ni = (msg as any).numberIdx | 0;
          if (ci < 0 || ci >= state.rollColors.length || ni < 0 || ni >= state.rollNumbers.length) return;
          state.draftColorIdx = ci; state.draftNumberIdx = ni;
          openMark(state);
          return;
        }
        if (msg.action === "skip") {
          // Roller declines to draft → they take nothing; others use all 6 dice.
          state.draftColorIdx = -1; state.draftNumberIdx = -1;
          openMark(state);
          return;
        }
        return;
      }

      if (state.phase !== "MARK") return;
      if (!state.pending.includes(seat)) return;             // already acted / not allowed
      const p = state.players[seat];

      if (msg.action === "skip") {
        state.pending = state.pending.filter((x) => x !== seat);
        if (!state.pending.length) advanceRoll(state);
        return;
      }

      if (msg.action === "mark") {
        const color = String((msg as any).color ?? "");
        const cells: Array<[number, number]> = Array.isArray((msg as any).cells) ? (msg as any).cells.map((x: any) => [x[0] | 0, x[1] | 0]) : [];
        const useWildColor = !!(msg as any).wildColor;
        const useWildNumber = !!(msg as any).wildNumber;

        if (!cols.includes(color)) return;
        if (!cells.length || cells.length > 5) return;        // Encore: never more than 5

        // The faces THIS seat may use depend on the draft (active uses the drafted
        // pair; others use the remaining dice; first 3 turns: all 6).
        const faces = allowedFaces(state, seat);
        // Encore wild model: a CONCRETE rolled face is free; using a wild face
        // ("*" colour / 0 number) costs one of your limited wilds.
        const concreteColor = faces.colors.includes(color);
        const concreteNumber = faces.numbers.includes(cells.length);
        const colorOk = concreteColor || (useWildColor && faces.colors.includes("*"));
        const numberOk = concreteNumber || (useWildNumber && faces.numbers.includes(0));
        if (!colorOk || !numberOk) return;
        if (useWildColor && concreteColor) return;
        if (useWildNumber && concreteNumber) return;

        const wildCost = (useWildColor ? 1 : 0) + (useWildNumber ? 1 : 0);
        if (wildCost && p.wildsUsed + wildCost > spec.wilds) return;

        // legal connected one-colour clump of EXACTLY this many cells
        if (!validRun(spec, p, color, cells)) return;

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
      // DRAFT: the active roller picks a colour-die index + a number-die index
      // (or skips). Offer a bounded set of index pairs.
      if (state.phase === "DRAFT") {
        if (seat !== state.active) return [];
        const out: GameAction[] = [];
        for (let ci = 0; ci < state.rollColors.length; ci++)
          for (let ni = 0; ni < state.rollNumbers.length; ni++) {
            out.push({ action: "draft", colorIdx: ci, numberIdx: ni } as any);
            if (out.length >= 9) break;
          }
        out.push({ action: "skip" });
        return out;
      }
      if (state.phase !== "MARK" || !state.pending.includes(seat)) return [];
      const p = state.players[seat];
      const acts: GameAction[] = [];
      // Build a handful of concrete, legal MULTI-cell runs (so bots make real
      // progress and the game actually completes). Uses only the faces THIS seat
      // may use (drafted pair / remaining dice / all-6 in the first 3 turns).
      const faces = allowedFaces(state, seat);
      const concreteColors = faces.colors.filter((c) => c !== "*");
      const hasWildColor = faces.colors.includes("*");
      const colorFaces = new Set<string>(concreteColors);
      // a "*" face lets us pick any colour (costs a wild) — include all if budget allows
      if (hasWildColor && p.wildsUsed < spec.wilds) cols.forEach((c) => colorFaces.add(c));
      const numberFaces = faces.numbers.filter((n) => n > 0);   // concrete lengths
      const hasWildNumber = faces.numbers.includes(0) && p.wildsUsed < spec.wilds;
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
      const inDraft = state.phase === "DRAFT";
      const vstate: GameViewState = {
        currentSeat: inDraft ? state.active : -1, // draft is the roller's solo decision
        pendingAction: inDraft ? "draft" : (state.phase === "MARK" ? "mark_or_skip" : null),
        players: state.players.map((p, i) => ({
          seat: i, name: p.name,
          status: p.done ? "stayed" : (inDraft ? (i === state.active ? "active" : "waiting") : (state.pending.includes(i) ? "active" : "waiting")),
          score: finalScore(spec, p), banked: finalScore(spec, p),
        })),
        actingCount: inDraft ? 1 : state.pending.length,
        focusSeat: seat >= 0 ? seat : state.active,
      };
      // the faces THIS viewer may use right now (post-draft); drives the client.
      const myFaces = seat >= 0 ? allowedFaces(state, seat) : { colors: state.rollColors.slice(), numbers: state.rollNumbers.slice() };
      const over = state.phase === "GAME_OVER";
      const view: GameView = {
        game: spec.meta.id, phase: mapPhase(state.phase), over, yourSeat: seat, state: vstate,
        [spec.meta.id]: {
          kind: "rollAndWrite",
          colors: spec.colors,
          grid: spec.grid,
          columns: spec.scoring.columns,        // [high,low] per column (indicators)
          colorBonus: spec.scoring.colorBonus,  // [high,low] per colour (sidebar)
          starPenalty: spec.scoring.starPenalty,
          startCol: spec.startCol,
          round: state.round,
          active: state.active,
          phase: state.phase,                 // "DRAFT" | "MARK" | "GAME_OVER"
          roll: { colors: state.rollColors, numbers: state.rollNumbers },
          draft: { colorIdx: state.draftColorIdx, numberIdx: state.draftNumberIdx, noDraft: state.noDraft },
          myFaces,                            // the colours/numbers the viewer may use now
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

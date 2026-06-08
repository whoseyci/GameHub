import type { GameModule, GameView } from "./types";
import { makeSeed, randomInt, type RngStateHolder } from "../rng";

export interface QwixxRow {
  nums: number[];
  cellColors: string[];
  doubles: number[];
  marks: number[];
}

export interface QwixxPlayer {
  name: string;
  rows: Record<string, QwixxRow>;
  penalties: number;
}

export interface QwixxState extends RngStateHolder {
  schemaVersion: number;
  players: QwixxPlayer[];
  dice: { w: number[]; r: number; y: number; g: number; b: number } | null;
  activeSeat: number;
  phase: "WHITE_PHASE" | "COLOR_PHASE" | "GAME_OVER";
  expansion: string;
  locked: string[];
  pendingLocks: string[];
  pendingWhiteDecisions: number[];
  activeMarkedThisTurn: boolean;
  round: number;
}

type Color = "red" | "yellow" | "green" | "blue";
const COLORS = ["red", "yellow", "green", "blue"] as const;
const COLOR_KEY: Record<Color, "r" | "y" | "g" | "b"> = { red: "r", yellow: "y", green: "g", blue: "b" };
const SCORE_BY_MARKS = [0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78];

function makeRow(color: Color): QwixxRow {
  const nums: number[] = [];
  if (color === "red" || color === "yellow") for (let i = 2; i <= 12; i++) nums.push(i);
  else for (let i = 12; i >= 2; i--) nums.push(i);
  return { nums, cellColors: nums.map(() => color), doubles: [], marks: [] };
}

function getDice(rng: RngStateHolder, locked: string[] = []) {
  const rnd = () => randomInt(rng, 6) + 1;
  const dice = { w: [rnd(), rnd()], r: rnd(), y: rnd(), g: rnd(), b: rnd() };
  for (const c of locked as Color[]) dice[COLOR_KEY[c]] = 0;
  return dice;
}

function lastMark(row: QwixxRow) { return row.marks.length ? Math.max(...row.marks) : -1; }
function canMarkIndex(s: QwixxState, color: Color, row: QwixxRow, i: number): boolean {
  if (s.locked.includes(color)) return false;
  if (!Number.isInteger(i) || i < 0 || i >= row.nums.length) return false;
  if (row.marks.includes(i)) return false;
  if (i <= lastMark(row)) return false;
  // The last number locks a row and is legal only after five prior marks.
  if (i === row.nums.length - 1 && row.marks.length < 5) return false;
  return true;
}
function markIndex(s: QwixxState, color: Color, row: QwixxRow, i: number) {
  row.marks.push(i);
  row.marks.sort((a, b) => a - b);
  if (i === row.nums.length - 1 && !s.locked.includes(color) && !s.pendingLocks.includes(color)) {
    s.pendingLocks.push(color);
  }
}
function applyPendingLocks(s: QwixxState) {
  for (const c of s.pendingLocks) if (!s.locked.includes(c)) s.locked.push(c);
  s.pendingLocks = [];
  if (s.dice) for (const c of s.locked as Color[]) s.dice[COLOR_KEY[c]] = 0;
}
function scorePlayer(p: QwixxPlayer) {
  let total = 0;
  COLORS.forEach((c) => {
    let m = p.rows[c].marks.length;
    // Marking the right-most number also marks the lock symbol, worth one extra mark.
    if (p.rows[c].marks.includes(p.rows[c].nums.length - 1)) m++;
    total += SCORE_BY_MARKS[Math.min(m, SCORE_BY_MARKS.length - 1)];
  });
  return total - p.penalties * 5;
}
function maybeEndOrNextTurn(s: QwixxState) {
  applyPendingLocks(s);
  if (s.locked.length >= 2 || s.players.some((p) => p.penalties >= 4)) {
    s.phase = "GAME_OVER";
    return;
  }
  s.activeSeat = (s.activeSeat + 1) % s.players.length;
  s.phase = "WHITE_PHASE";
  s.dice = getDice(s, s.locked);
  s.pendingWhiteDecisions = s.players.map((_, i) => i).filter((i) => s.players[i].penalties < 4);
  s.activeMarkedThisTurn = false;
  s.round++;
}

export const Qwixx: GameModule = {
  meta: {
    id: "qwixx",
    name: "Qwixx",
    minPlayers: 2,
    maxPlayers: 8,
    description: "Cross numbers left-to-right using dice sums.",
    emoji: "🎲"
  },

  create(names: string[]) {
    const rng = { rngState: makeSeed() };
    const players: QwixxPlayer[] = names.map((name) => ({ name: name || "Player", rows: {} as Record<string, QwixxRow>, penalties: 0 }));
    players.forEach((p) => COLORS.forEach((c) => { p.rows[c] = makeRow(c); }));
    const dice = getDice(rng);
    return {
      schemaVersion: 1,
      rngState: rng.rngState,
      players,
      dice,
      activeSeat: 0,
      phase: "WHITE_PHASE",
      expansion: "standard",
      locked: [],
      pendingLocks: [],
      pendingWhiteDecisions: players.map((_, i) => i),
      activeMarkedThisTurn: false,
      round: 1,
    } as QwixxState;
  },

  applyAction(state: any, seat: number, msg: any) {
    const s = state as QwixxState;
    if (s.phase === "GAME_OVER" || !s.dice) return;

    if (msg.action === "mark") {
      const color = msg.c as Color;
      const i = msg.i;
      if (!COLORS.includes(color) || !Number.isInteger(i)) return;
      const p = s.players[seat];
      const row = p?.rows[color];
      if (!p || !row || !canMarkIndex(s, color, row, i)) return;
      const isActive = seat === s.activeSeat;

      if (s.phase === "WHITE_PHASE") {
        if (!s.pendingWhiteDecisions.includes(seat)) return;
        const whiteSum = s.dice.w[0] + s.dice.w[1];
        if (row.nums[i] !== whiteSum) return;
        markIndex(s, color, row, i);
        s.pendingWhiteDecisions = s.pendingWhiteDecisions.filter((x) => x !== seat);
        if (isActive) s.activeMarkedThisTurn = true;
        if (s.pendingWhiteDecisions.length === 0) {
          applyPendingLocks(s); // after every player had the same white-action opportunity
          s.phase = "COLOR_PHASE";
        }
        return;
      }

      if (s.phase === "COLOR_PHASE") {
        if (!isActive) return;
        const dieKey = COLOR_KEY[color];
        if (s.dice[dieKey] <= 0) return;
        const sum1 = s.dice.w[0] + s.dice[dieKey];
        const sum2 = s.dice.w[1] + s.dice[dieKey];
        if (row.nums[i] !== sum1 && row.nums[i] !== sum2) return;
        markIndex(s, color, row, i);
        s.activeMarkedThisTurn = true;
        maybeEndOrNextTurn(s);
        return;
      }
    }

    if (msg.action === "skip") {
      if (s.phase === "WHITE_PHASE") {
        s.pendingWhiteDecisions = s.pendingWhiteDecisions.filter((x) => x !== seat);
        if (s.pendingWhiteDecisions.length === 0) {
          applyPendingLocks(s);
          s.phase = "COLOR_PHASE";
        }
      }
      return;
    }

    if (msg.action === "finishTurn") {
      if (s.phase !== "COLOR_PHASE" || seat !== s.activeSeat) return;
      if (!s.activeMarkedThisTurn) s.players[s.activeSeat].penalties++;
      maybeEndOrNextTurn(s);
    }
  },

  viewFor(state: any, seat: number): GameView {
    const s = state as QwixxState;
    let summary;
    if (s.phase === "GAME_OVER") {
      const scores = s.players.map((pl, i) => ({ seat: i, name: pl.name, score: scorePlayer(pl), delta: 0 }));
      const max = Math.max(...scores.map((x) => x.score));
      summary = { rows: scores, winners: scores.filter((x) => x.score === max).map((x) => x.seat) };
    }

    return {
      game: "qwixx",
      phase: s.phase,
      over: s.phase === "GAME_OVER",
      yourSeat: seat,
      summary,
      state: {
        dice: s.dice,
        activeSeat: s.activeSeat,
        expansion: s.expansion,
        locked: s.locked,
        pendingLocks: s.pendingLocks,
        yourRows: s.players[seat]?.rows ?? {},
        yourPenalties: s.players[seat]?.penalties ?? 0,
        allPlayers: s.players.map((pl, i) => ({
          seat: i,
          name: pl.name,
          penalties: pl.penalties,
          score: scorePlayer(pl),
          rows: pl.rows,
          waiting: s.phase === "WHITE_PHASE" ? s.pendingWhiteDecisions.includes(i) : false,
          active: i === s.activeSeat,
        })),
        phase: s.phase,
        round: s.round,
        pendingWhiteDecisions: s.pendingWhiteDecisions,
        activeMarkedThisTurn: s.activeMarkedThisTurn
      },
    };
  },

  isOver(state: any) { return state.phase === "GAME_OVER"; }
};

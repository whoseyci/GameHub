// games/qwixx.ts — Qwixx dice game implementation
import type { GameModule, GameView, SummaryRow } from "./types";

export interface QwixxState {
  players: Array<{
    name: string;
    rows: { [color: string]: number[] }; // indices crossed in each row
    penalties: number;
    locked: { [color: string]: boolean };
  }>;
  dice: { white1: number; white2: number; red: number; yellow: number; green: number; blue: number } | null;
  activeSeat: number;
  phase: "PLAY" | "GAME_OVER";
  lockedRows: number;
  removedDice: string[];
}

const COLORS = ["red", "yellow", "green", "blue"] as const;
type Color = typeof COLORS[number];

const ROW_RANGES: { [c in Color]: { start: number; end: number; step: number; lock: number } } = {
  red: { start: 2, end: 12, step: 1, lock: 12 },
  yellow: { start: 2, end: 12, step: 1, lock: 12 },
  green: { start: 12, end: 2, step: -1, lock: 2 },
  blue: { start: 12, end: 2, step: -1, lock: 2 },
};

function createEmptyRows() {
  return {
    red: [] as number[],
    yellow: [] as number[],
    green: [] as number[],
    blue: [] as number[],
  };
}

function isValidCross(row: number[], num: number, color: Color): boolean {
  const r = ROW_RANGES[color];
  if (row.includes(num)) return false;
  if (num < r.start || num > r.end) return false; // though dice sums are 2-12
  // must be to the "right" of all crossed (higher index in direction)
  if (row.length === 0) return true;
  const last = row[row.length - 1];
  if (r.step > 0) return num > last;
  return num < last;
}

function canLock(row: number[], color: Color): boolean {
  return row.length >= 5;
}

export const Qwixx: GameModule = {
  meta: {
    id: "qwixx",
    name: "Qwixx",
    minPlayers: 2,
    maxPlayers: 5,
    description: "Cross numbers left-to-right in colored rows using dice sums.",
    emoji: "🎲",
  },

  create(names) {
    const state: QwixxState = {
      players: names.map((name) => ({
        name: name || "",
        rows: createEmptyRows(),
        penalties: 0,
        locked: { red: false, yellow: false, green: false, blue: false },
      })),
      dice: null,
      activeSeat: 0,
      phase: "PLAY",
      lockedRows: 0,
      removedDice: [],
    };
    return state;
  },

  applyAction(state: QwixxState, seat: number, msg: any) {
    if (state.phase !== "PLAY") return;

    const p = state.players[seat];
    if (!p) return;

    if (msg.action === "roll") {
      if (seat !== state.activeSeat) return;
      // roll dice
      const roll = () => Math.floor(Math.random() * 6) + 1;
      state.dice = {
        white1: roll(),
        white2: roll(),
        red: roll(),
        yellow: roll(),
        green: roll(),
        blue: roll(),
      };
      return;
    }

    if (msg.action === "cross_white") {
      if (!state.dice) return;
      const sum = state.dice.white1 + state.dice.white2;
      const color = msg.color as Color;
      if (!COLORS.includes(color)) return;
      const row = p.rows[color];
      if (isValidCross(row, sum, color)) {
        row.push(sum);
        row.sort((a, b) => ROW_RANGES[color].step > 0 ? a - b : b - a);
      }
      // non-active can choose not to
      return;
    }

    if (msg.action === "cross_colored") {
      if (seat !== state.activeSeat || !state.dice) return;
      const white = msg.white as 1 | 2;
      const color = msg.color as Color;
      if (!COLORS.includes(color)) return;
      const wval = white === 1 ? state.dice.white1 : state.dice.white2;
      const cval = state.dice[color];
      const sum = wval + cval;
      const row = p.rows[color];
      if (isValidCross(row, sum, color)) {
        row.push(sum);
        row.sort((a, b) => ROW_RANGES[color].step > 0 ? a - b : b - a);
      }
      // after active player's second action, advance turn
      advanceTurn(state);
      return;
    }

    if (msg.action === "pass") {
      if (seat !== state.activeSeat) return;
      p.penalties = Math.min(4, p.penalties + 1);
      advanceTurn(state);
      return;
    }

    if (msg.action === "lock") {
      // optional explicit lock if possible
      const color = msg.color as Color;
      if (!COLORS.includes(color) || p.locked[color]) return;
      const row = p.rows[color];
      const r = ROW_RANGES[color];
      if (row.length >= 5 && row.includes(r.lock)) {
        p.locked[color] = true;
        state.lockedRows++;
        if (!state.removedDice.includes(color)) state.removedDice.push(color);
        if (state.lockedRows >= 2) state.phase = "GAME_OVER";
      }
      return;
    }
  },

  viewFor(state: QwixxState, seat: number): GameView {
    const your = state.players[seat] || { rows: createEmptyRows(), penalties: 0, locked: {} };
    const viewState = {
      activeSeat: state.activeSeat,
      dice: state.dice,
      yourRows: your.rows,
      yourPenalties: your.penalties,
      yourLocked: your.locked,
      removedDice: state.removedDice,
      allPlayers: state.players.map((p, i) => ({
        seat: i,
        name: p.name || `P${i + 1}`,
        penalties: p.penalties,
        lockedCount: Object.values(p.locked).filter(Boolean).length,
      })),
    };

    let summary;
    if (state.phase === "GAME_OVER") {
      const scores = state.players.map((p, i) => {
        let total = 0;
        for (const c of COLORS) {
          const n = p.rows[c].length;
          total += (n * (n + 1)) / 2;
        }
        total -= p.penalties * 5;
        return { seat: i, name: p.name || `P${i+1}`, score: total, delta: 0 };
      });
      const max = Math.max(...scores.map(s => s.score));
      summary = {
        rows: scores,
        winners: scores.filter(s => s.score === max).map(s => s.seat),
      };
    }

    return {
      game: "qwixx",
      phase: state.phase,
      over: state.phase === "GAME_OVER",
      yourSeat: seat,
      summary,
      qwixx: viewState,
    };
  },

  isOver(state) {
    return state.phase === "GAME_OVER";
  },
};

function advanceTurn(state: QwixxState) {
  // check for locks that happened
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    for (const c of COLORS) {
      if (!p.locked[c] && canLock(p.rows[c], c) && p.rows[c].includes(ROW_RANGES[c].lock)) {
        p.locked[c] = true;
        state.lockedRows++;
        if (!state.removedDice.includes(c)) state.removedDice.push(c);
      }
    }
  }
  if (state.lockedRows >= 2) {
    state.phase = "GAME_OVER";
    return;
  }
  // check penalties end
  for (const p of state.players) {
    if (p.penalties >= 4) {
      state.phase = "GAME_OVER";
      return;
    }
  }
  state.activeSeat = (state.activeSeat + 1) % state.players.length;
  state.dice = null;
}
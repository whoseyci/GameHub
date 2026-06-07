// games/qwixx.ts — Qwixx dice game implementation
import type { GameModule, GameView, SummaryRow } from "./types";

export interface QwixxRow {
  nums: number[];
  cellColors: string[];
  doubles: number[];
  marks: number[]; // indices of crossed numbers
}

export interface QwixxPlayer {
  name: string;
  rows: { [color: string]: QwixxRow };
  penalties: number;
}

export interface QwixxState {
  players: QwixxPlayer[];
  dice: { w: number[]; r: number; y: number; g: number; b: number } | null;
  activeSeat: number;
  phase: "ACTIVE" | "OTHERS_WHITE" | "GAME_OVER";
  expansion: string;
  locked: string[];
  pendingLocks: string[];
  activeMarks: { c: string; i: number; n: number; reqColor: string }[];
  playerTurnMarks: { [seat: number]: { c: string; i: number; n: number }[] };
  round: number;
  mc: number;
}

const COLORS = ["red", "yellow", "green", "blue"] as const;
type Color = typeof COLORS[number];

const EXPANSIONS = {
  standard: { rowMax: 12, dieMax: 6 },
  longo: { rowMax: 16, dieMax: 8 },
  num_mixx: { rowMax: 12, dieMax: 6 },
  col_mixx: { rowMax: 12, dieMax: 6 },
  double: { rowMax: 12, dieMax: 6 },
};

function makeRow(color: Color, expansion: string) {
  const isAsc = color === "red" || color === "yellow";
  const rowMax = EXPANSIONS[expansion as keyof typeof EXPANSIONS]?.rowMax || 12;
  
  let nums: number[] = [];
  if (isAsc) {
    for (let i = 2; i <= rowMax; i++) nums.push(i);
  } else {
    for (let i = rowMax; i >= 2; i--) nums.push(i);
  }
  
  if (expansion === "num_mixx") {
    nums.sort(() => Math.random() - 0.5);
  }
  
  let cellColors = nums.map(() => color);
  if (expansion === "col_mixx") {
    cellColors = nums.map(() => COLORS[Math.floor(Math.random() * COLORS.length)]);
  }
  
  let doubles: number[] = [];
  if (expansion === "double") {
    while (doubles.length < 2) {
      let r = Math.floor(Math.random() * nums.length);
      if (!doubles.includes(r)) doubles.push(r);
    }
  }
  
  return { nums, cellColors, doubles, marks: [] };
}

function isValidActivePlayerMarks(marks: { c: string; i: number; n: number; reqColor: string }[], dice: { w: number[]; r: number; y: number; g: number; b: number }) {
  if (marks.length === 0) return true;
  if (marks.length > 2) return false;
  
  const wSum = dice.w[0] + dice.w[1];
  const isW = (m: any) => m.n === wSum;
  const isC = (m: any) => m.n === dice.w[0] + dice[m.reqColor as keyof typeof dice] || m.n === dice.w[1] + dice[m.reqColor as keyof typeof dice];
  
  if (marks.length === 1) return isW(marks[0]) || isC(marks[0]);
  
  if (marks.length === 2) {
    let m1 = marks[0], m2 = marks[1];
    if (m1.c === m2.c) {
      let left = m1.i < m2.i ? m1 : m2;
      let right = m1.i < m2.i ? m2 : m1;
      return isW(left) && isC(right);
    } else {
      return (isW(m1) && isC(m2)) || (isC(m1) && isW(m2));
    }
  }
  return false;
}

export const Qwixx: GameModule = {
  meta: {
    id: "qwixx",
    name: "Qwixx",
    minPlayers: 2,
    maxPlayers: 8,
    description: "Cross numbers left-to-right in colored rows using dice sums. Support for Longo, Number Mixx, etc.",
    emoji: "🎲",
  },

  create(names) {
    const expansion = "standard";
    const players = names.map((name) => ({
      name: name || "Player",
      rows: {} as { [color: string]: QwixxRow },
      penalties: 0,
    }));

    players.forEach(p => {
      COLORS.forEach(c => { p.rows[c] = makeRow(c, expansion); });
    });

    return {
      players,
      dice: null,
      activeSeat: 0,
      phase: "ACTIVE",
      expansion,
      locked: [],
      pendingLocks: [],
      activeMarks: [],
      playerTurnMarks: {},
      round: 1,
      mc: 0,
    } as QwixxState;
  },

  applyAction(state: QwixxState, seat: number, msg: any) {
    if (state.phase === "GAME_OVER") return;

    if (msg.action === "setExpansion") {
      const exp = msg.expansion as string;
      if (!EXPANSIONS[exp as keyof typeof EXPANSIONS]) return;
      state.expansion = exp;
      state.players.forEach(p => {
        COLORS.forEach(c => { p.rows[c] = makeRow(c, exp); });
      });
      return;
    }

    if (msg.action === "roll") {
      if (seat !== state.activeSeat) return;
      const dieMax = EXPANSIONS[state.expansion as keyof typeof EXPANSIONS].dieMax;
      const rnd = () => Math.floor(Math.random() * dieMax) + 1;
      state.dice = {
        w: [rnd(), rnd()],
        r: rnd(),
        y: rnd(),
        g: rnd(),
        b: rnd(),
      };
      state.activeMarks = [];
      state.playerTurnMarks = {};
      state.phase = "ACTIVE";
      return;
    }

    if (msg.action === "mark") {
      const { c, i } = msg;
      const p = state.players[seat];
      if (!p) return;
      const row = p.rows[c];
      if (!row || row.marks.includes(i)) return;
      
      const last = row.marks.length > 0 ? row.marks[row.marks.length - 1] : -1;
      if (i <= last) return;
      
      const endIdx = row.nums.length - 1;
      if (i === endIdx && row.marks.length < 5) return;
      
      const isAct = seat === state.activeSeat;
      
      if (state.phase === "ACTIVE") {
        if (!isAct) {
          // Non-active: only white sum
          const wSum = state.dice!.w[0] + state.dice!.w[1];
          if (row.nums[i] !== wSum) return;
          if (p.turnMarks[seat] && p.turnMarks[seat].length >= 1) return;
          
          if (!state.playerTurnMarks[seat]) state.playerTurnMarks[seat] = [];
          state.playerTurnMarks[seat].push({ c, i, n: row.nums[i] });
          row.marks.push(i);
          row.marks.sort((a,b)=>a-b);
          state.mc++;
        } else {
          // Active: White or Color sum
          const reqColor = row.cellColors[i];
          const newMark = { c, i, n: row.nums[i], reqColor };
          const proposed = [...state.activeMarks, newMark];
          if (proposed.length > 2) return;
          if (!isValidActivePlayerMarks(proposed, state.dice!)) return;
          
          state.activeMarks = proposed;
          row.marks.push(i);
          row.marks.sort((a,b)=>a-b);
          state.mc++;
        }
      } else if (state.phase === "OTHERS_WHITE") {
        if (isAct) return;
        const wSum = state.dice!.w[0] + state.dice!.w[1];
        if (row.nums[i] !== wSum) return;
        if (!state.playerTurnMarks[seat]) state.playerTurnMarks[seat] = [];
        if (state.playerTurnMarks[seat].length >= 1) return;
        
        state.playerTurnMarks[seat].push({ c, i, n: row.nums[i] });
        row.marks.push(i);
        row.marks.sort((a,b)=>a-b);
        state.mc++;
      }

      // Handle Lock
      if (i === endIdx && row.marks.length >= 5 && !state.locked.includes(c)) {
        state.pendingLocks.push(c);
      }
    }

    if (msg.action === "finishActiveTurn") {
      if (seat !== state.activeSeat) return;
      if (state.activeMarks.length === 0) {
        state.players[state.activeSeat].penalties++;
      }
      
      // Finalize locks
      state.pendingLocks.forEach(c => {
        if (!state.locked.includes(c)) state.locked.push(c);
      });
      state.pendingLocks = [];
      
      // End check
      if (state.locked.length >= 2 || state.players.some(p => p.penalties >= 4)) {
        state.phase = "GAME_OVER";
      } else {
        state.phase = "OTHERS_WHITE";
      }
      return;
    }

    if (msg.action === "advanceTurn") {
      // Only called by hub or through specific logic to move to next active player
      state.activeSeat = (state.activeSeat + 1) % state.players.length;
      state.phase = "ACTIVE";
      state.dice = null;
      state.round++;
      return;
    }
  },

  viewFor(state: QwixxState, seat: number): GameView {
    const p = state.players[seat];
    let summary;
    if (state.phase === "GAME_OVER") {
      const scores = state.players.map((pl, i) => {
        let total = 0;
        COLORS.forEach(c => {
          const m = pl.rows[c].marks.length;
          total += (m * (m + 1)) / 2;
        });
        total -= pl.penalties * 5;
        return { seat: i, name: pl.name, score: total, delta: 0 };
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
      state: {
        dice: state.dice,
        activeSeat: state.activeSeat,
        expansion: state.expansion,
        locked: state.locked,
        yourRows: p ? p.rows : {},
        yourPenalties: p ? p.penalties : 0,
        allPlayers: state.players.map((pl, i) => ({
          seat: i,
          name: pl.name,
          penalties: pl.penalties,
        })),
        phase: state.phase,
        round: state.round,
      },
    };
  },

  isOver(state) {
    return state.phase === "GAME_OVER";
  },
};

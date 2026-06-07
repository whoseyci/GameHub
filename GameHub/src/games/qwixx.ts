// src/games/qwixx.ts
import type { GameModule, GameView } from "./types";

export interface QwixxRow {
  nums: number[];
  cellColors: string[];
  doubles: number[];
  marks: number[]; // indices of crossed numbers
}

export interface QwixxPlayer {
  name: string;
  rows: Record<string, QwixxRow>;
  penalties: number;
  turnMarks: { c: string; i: number; n: number }[];
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
  playerTurnMarks: Record<number, { c: string; i: number; n: number }[]>;
  round: number;
  mc: number;
}

const COLORS = ["red", "yellow", "green", "blue"] as const;
const EXPANSIONS = {
  standard: { rowMax: 12, dieMax: 6 },
  longo: { rowMax: 16, dieMax: 8 },
  num_mixx: { rowMax: 12, dieMax: 6 },
  col_mixx: { rowMax: 12, dieMax: 6 },
  double: { rowMax: 12, dieMax: 6 },
};

function makeRow(color: string, expansion: string): QwixxRow {
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

function isValidActivePlayerMarks(marks: { c: string; i: number; n: number; reqColor: string }[], dice: any) {
  if (marks.length === 0) return true;
  if (marks.length > 2) return false;
  const wSum = dice.w[0] + dice.w[1];
  const isW = (m: any) => m.n === wSum;
  const isC = (m: any) => m.n === dice.w[0] + dice[m.reqColor] || m.n === dice.w[1] + dice[m.reqColor];
  
  if (marks.length === 1) return isW(marks[0]) || isC(marks[0]);
  
  if (marks.length === 2) {
    let m1 = marks[0], m2 = marks[1];
    if (m1.c === m2.c) {
      // White sum must strictly precede Color sum chronologically
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
    description: "Cross numbers left-to-right using dice sums.",
    emoji: "🎲"
  },

  create(names: string[]) {
    const expansion = "standard";
    const players: QwixxPlayer[] = names.map((name) => ({
      name: name || "Player",
      rows: {},
      penalties: 0,
      turnMarks: [],
    }));
    
    players.forEach(p => {
      COLORS.forEach(c => { p.rows[c] = makeRow(c, expansion); });
    });
    
    const dieMax = 6;
    const rnd = () => Math.floor(Math.random() * dieMax) + 1;

    return {
      players,
      dice: { w: [rnd(), rnd()], r: rnd(), y: rnd(), g: rnd(), b: rnd() },
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

  applyAction(state: any, seat: number, msg: any) {
    const s = state as QwixxState;
    if (s.phase === "GAME_OVER") return;

    if (msg.action === "setExpansion") {
      const exp = msg.expansion as string;
      if (!EXPANSIONS[exp as keyof typeof EXPANSIONS]) return;
      s.expansion = exp;
      s.players.forEach(p => {
        COLORS.forEach(c => { p.rows[c] = makeRow(c, exp); });
      });
      return;
    }

    if (msg.action === "roll") {
      if (seat !== s.activeSeat) return;
      const dieMax = EXPANSIONS[s.expansion as keyof typeof EXPANSIONS]?.dieMax || 6;
      const rnd = () => Math.floor(Math.random() * dieMax) + 1;
      s.dice = {
        w: [rnd(), rnd()],
        r: s.locked.includes('red') ? 0 : rnd(),
        y: s.locked.includes('yellow') ? 0 : rnd(),
        g: s.locked.includes('green') ? 0 : rnd(),
        b: s.locked.includes('blue') ? 0 : rnd(),
      };
      s.activeMarks = [];
      s.playerTurnMarks = {};
      s.phase = "ACTIVE";
      return;
    }

    if (msg.action === "mark") {
      const { c, i } = msg;
      const p = s.players[seat];
      if (!p) return;
      const row = p.rows[c];
      if (!row || row.marks.includes(i)) return;
      
      const last = row.marks.length > 0 ? row.marks[row.marks.length - 1] : -1;
      if (i <= last) return;
      
      const endIdx = row.nums.length - 1;
      if (i === endIdx && row.marks.length < 5) return;
      
      const isAct = seat === s.activeSeat;
      
      if (s.phase === "ACTIVE") {
        if (!isAct) {
          // Off-turn: Only allowed to mark the white sum
          const wSum = s.dice!.w[0] + s.dice!.w[1];
          if (row.nums[i] !== wSum) return;
          if (!s.playerTurnMarks[seat]) s.playerTurnMarks[seat] = [];
          if (s.playerTurnMarks[seat].length >= 1) return;
          
          s.playerTurnMarks[seat].push({ c, i, n: row.nums[i] });
          row.marks.push(i);
          row.marks.sort((a,b)=>a-b);
          s.mc++;
        } else {
          // Active Turn: Can mark White or Color
          const reqColor = row.cellColors[i];
          const newMark = { c, i, n: row.nums[i], reqColor };
          const proposed = [...s.activeMarks, newMark];
          if (proposed.length > 2) return;
          if (!isValidActivePlayerMarks(proposed, s.dice!)) return;
          
          s.activeMarks = proposed;
          row.marks.push(i);
          row.marks.sort((a,b)=>a-b);
          s.mc++;
        }
      } else if (s.phase === "OTHERS_WHITE") {
        if (isAct) return;
        const wSum = s.dice!.w[0] + s.dice!.w[1];
        if (row.nums[i] !== wSum) return;
        if (!s.playerTurnMarks[seat]) s.playerTurnMarks[seat] = [];
        if (s.playerTurnMarks[seat].length >= 1) return;
        
        s.playerTurnMarks[seat].push({ c, i, n: row.nums[i] });
        row.marks.push(i);
        row.marks.sort((a,b)=>a-b);
        s.mc++;
      }
      
      // Determine lock status
      if (i === endIdx && row.marks.length >= 5 && !s.locked.includes(c)) {
        s.pendingLocks.push(c);
      }
    }

    if (msg.action === "finishActiveTurn") {
      if (seat !== s.activeSeat) return;
      if (s.activeMarks.length === 0) {
        s.players[s.activeSeat].penalties++;
      }
      
      // Enforce Locks
      s.pendingLocks.forEach(c => {
        if (!s.locked.includes(c)) s.locked.push(c);
      });
      s.pendingLocks = [];
      
      if (s.locked.length >= 2 || s.players.some(p => p.penalties >= 4)) {
        s.phase = "GAME_OVER";
      } else {
        s.phase = "OTHERS_WHITE";
      }
      return;
    }

    if (msg.action === "advanceTurn") {
      s.activeSeat = (s.activeSeat + 1) % s.players.length;
      let tries = 0;
      // Skip over players who are eliminated (4+ penalties)
      while (s.players[s.activeSeat].penalties >= 4 && tries < s.players.length) {
        s.activeSeat = (s.activeSeat + 1) % s.players.length;
        tries++;
      }
      
      s.phase = "ACTIVE";
      
      // Automatically roll next dice
      const dieMax = EXPANSIONS[s.expansion as keyof typeof EXPANSIONS]?.dieMax || 6;
      const rnd = () => Math.floor(Math.random() * dieMax) + 1;
      s.dice = {
        w: [rnd(), rnd()],
        r: s.locked.includes('red') ? 0 : rnd(),
        y: s.locked.includes('yellow') ? 0 : rnd(),
        g: s.locked.includes('green') ? 0 : rnd(),
        b: s.locked.includes('blue') ? 0 : rnd(),
      };
      s.activeMarks = [];
      s.playerTurnMarks = {};
      s.round++;
      return;
    }
  },

  viewFor(state: any, seat: number): GameView {
    const s = state as QwixxState;
    const p = s.players[seat];
    let summary;
    
    // Hub automatically detects game end and handles summary overlays
    if (s.phase === "GAME_OVER") {
      const scores = s.players.map((pl, i) => {
        let total = 0;
        COLORS.forEach(c => {
          let m = pl.rows[c].marks.length;
          // Count padlock as a mark if the end number is crossed
          if (pl.rows[c].marks.includes(pl.rows[c].nums.length - 1)) m++;
          total += (m * (m + 1)) / 2;
        });
        total -= pl.penalties * 5;
        return { seat: i, name: pl.name, score: total, delta: 0 };
      });
      const max = Math.max(...scores.map(x => x.score));
      summary = {
        rows: scores,
        winners: scores.filter(x => x.score === max).map(x => x.seat),
      };
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
        yourRows: p ? p.rows : {},
        yourPenalties: p ? p.penalties : 0,
        allPlayers: s.players.map((pl, i) => ({
          seat: i,
          name: pl.name,
          penalties: pl.penalties,
        })),
        phase: s.phase,
        round: s.round,
      },
    };
  },

  isOver(state: any) {
    return state.phase === "GAME_OVER";
  }
};

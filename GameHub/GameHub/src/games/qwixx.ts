import type { GameModule, GameView } from "./types";

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

export interface QwixxState {
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

function getDice() {
  const rnd = () => Math.floor(Math.random() * 6) + 1;
  return { w: [rnd(), rnd()], r: rnd(), y: rnd(), g: rnd(), b: rnd() };
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
    }));
    
    players.forEach(p => {
      COLORS.forEach(c => { p.rows[c] = makeRow(c, expansion); });
    });
    
    return {
      players,
      dice: getDice(),
      activeSeat: 0,
      phase: "WHITE_PHASE",
      expansion,
      locked: [],
      pendingLocks: [],
      pendingWhiteDecisions: players.map((_, i) => i),
      activeMarkedThisTurn: false,
      round: 1,
    } as QwixxState;
  },

  applyAction(state: any, seat: number, msg: any) {
    const s = state as QwixxState;
    if (s.phase === "GAME_OVER") return;

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
      
      if (s.phase === "WHITE_PHASE") {
        if (!s.pendingWhiteDecisions.includes(seat)) return;
        const wSum = s.dice!.w[0] + s.dice!.w[1];
        if (row.nums[i] !== wSum) return;

        row.marks.push(i);
        row.marks.sort((a,b)=>a-b);
        s.pendingWhiteDecisions = s.pendingWhiteDecisions.filter(x => x !== seat);
        if (isAct) s.activeMarkedThisTurn = true;
        
        if (i === endIdx && row.marks.length >= 5 && !s.locked.includes(c) && !s.pendingLocks.includes(c)) {
          s.pendingLocks.push(c);
        }

        if (s.pendingWhiteDecisions.length === 0) {
          s.phase = "COLOR_PHASE";
        }
      } else if (s.phase === "COLOR_PHASE") {
        if (!isAct) return;
        
        const reqColor = row.cellColors[i];
        const cKey = reqColor[0] as keyof typeof s.dice;
        const sum1 = s.dice!.w[0] + (s.dice![cKey] as number);
        const sum2 = s.dice!.w[1] + (s.dice![cKey] as number);
        
        if (row.nums[i] !== sum1 && row.nums[i] !== sum2) return;
        
        row.marks.push(i);
        row.marks.sort((a,b)=>a-b);
        s.activeMarkedThisTurn = true;
        
        if (i === endIdx && row.marks.length >= 5 && !s.locked.includes(c) && !s.pendingLocks.includes(c)) {
          s.pendingLocks.push(c);
        }
        
        Qwixx.applyAction(s, seat, { action: "finishTurn" });
      }
    }

    if (msg.action === "skip") {
      if (s.phase === "WHITE_PHASE") {
        s.pendingWhiteDecisions = s.pendingWhiteDecisions.filter(x => x !== seat);
        if (s.pendingWhiteDecisions.length === 0) {
          s.phase = "COLOR_PHASE";
        }
      }
    }

    if (msg.action === "finishTurn") {
      if (s.phase !== "COLOR_PHASE" || seat !== s.activeSeat) return;
      
      if (!s.activeMarkedThisTurn) {
        s.players[s.activeSeat].penalties++;
      }
      
      s.pendingLocks.forEach(c => {
        if (!s.locked.includes(c)) s.locked.push(c);
      });
      s.pendingLocks = [];
      
      if (s.locked.length >= 2 || s.players.some(p => p.penalties >= 4)) {
        s.phase = "GAME_OVER";
      } else {
        s.activeSeat = (s.activeSeat + 1) % s.players.length;
        let tries = 0;
        while (s.players[s.activeSeat].penalties >= 4 && tries < s.players.length) {
          s.activeSeat = (s.activeSeat + 1) % s.players.length;
          tries++;
        }
        s.phase = "WHITE_PHASE";
        s.dice = getDice();
        s.locked.forEach(c => {
          s.dice![c[0] as keyof typeof s.dice] = 0 as any;
        });
        s.pendingWhiteDecisions = s.players.map((_, i) => i).filter(i => s.players[i].penalties < 4);
        s.activeMarkedThisTurn = false;
        s.round++;
      }
    }
  },

  viewFor(state: any, seat: number): GameView {
    const s = state as QwixxState;
    const p = s.players[seat];
    let summary;
    
    if (s.phase === "GAME_OVER") {
      const scores = s.players.map((pl, i) => {
        let total = 0;
        COLORS.forEach(c => {
          let m = pl.rows[c].marks.length;
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
          rows: pl.rows,
          waiting: s.phase === "WHITE_PHASE" ? s.pendingWhiteDecisions.includes(i) : false
        })),
        phase: s.phase,
        round: s.round,
        pendingWhiteDecisions: s.pendingWhiteDecisions,
        activeMarkedThisTurn: s.activeMarkedThisTurn
      },
    };
  },

  isOver(state: any) {
    return state.phase === "GAME_OVER";
  }
};

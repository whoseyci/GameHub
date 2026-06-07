import { GameDef } from './types';

export type Color = 'red' | 'yellow' | 'green' | 'blue';

export interface QwixxPlayerState {
  id: string;
  name: string;
  marks: Record<Color, number[]>; // Stores the indices (0-11) of marked cells
  penalties: number;
  score: number;
}

export interface DiceState {
  w1: number; w2: number;
  red: number; yellow: number;
  green: number; blue: number;
}

export interface QwixxState {
  players: QwixxPlayerState[];
  activePlayerIndex: number;
  viewingPlayerIndex: number; // Who is currently acting in the 'others_white' cycle
  phase: 'active_turn' | 'others_cycle' | 'game_over';
  dice: DiceState;
  lockedRows: Color[];
  pendingLocks: Color[];
}

export type QwixxMove = 
  | { type: 'ACTIVE_PLAY'; marks: { color: Color; index: number }[] } // 0-2 marks
  | { type: 'CYCLE_PLAY'; mark: { color: Color; index: number } | null }; // 1 mark or null for skip

// --- UTILS ---
export const getFaceValue = (color: Color, index: number): number => {
  if (index === 11) return 0; // Padlock has no face value
  return (color === 'red' || color === 'yellow') ? index + 2 : 12 - index;
};

const rollD6 = () => Math.floor(Math.random() * 6) + 1;

const calculateScore = (marksCount: number) => {
  return marksCount === 0 ? 0 : (marksCount * (marksCount + 1)) / 2;
};

const rollDice = (state: QwixxState) => {
  state.dice = {
    w1: rollD6(), w2: rollD6(),
    red: state.lockedRows.includes('red') ? 0 : rollD6(),
    yellow: state.lockedRows.includes('yellow') ? 0 : rollD6(),
    green: state.lockedRows.includes('green') ? 0 : rollD6(),
    blue: state.lockedRows.includes('blue') ? 0 : rollD6(),
  };
};

const applyMark = (state: QwixxState, player: QwixxPlayerState, color: Color, index: number) => {
  const row = player.marks[color];
  const lastMark = row.length > 0 ? row[row.length - 1] : -1;
  
  if (index <= lastMark) throw new Error("Must mark strictly to the right");
  if (index === 10 && row.length < 5) throw new Error("Need 5 marks to hit the end number");
  if (state.lockedRows.includes(color)) throw new Error("Row is locked");

  row.push(index);

  // Lock row handling (index 10 is the 12/2 space)
  if (index === 10 && row.length >= 5) {
    row.push(11); // Add the Padlock (acts as +1 score mark)
    if (!state.pendingLocks.includes(color)) state.pendingLocks.push(color);
  }
};

const advanceRound = (state: QwixxState) => {
  // Commit pending locks
  state.pendingLocks.forEach(c => {
    if (!state.lockedRows.includes(c)) state.lockedRows.push(c);
  });
  state.pendingLocks = [];

  // Next player
  let nextIdx = (state.activePlayerIndex + 1) % state.players.length;
  // Skip eliminated players
  while (state.players[nextIdx].penalties >= 4 && nextIdx !== state.activePlayerIndex) {
    nextIdx = (nextIdx + 1) % state.players.length;
  }

  state.activePlayerIndex = nextIdx;
  state.viewingPlayerIndex = nextIdx;
  state.phase = 'active_turn';
  rollDice(state);
};

const updateScores = (state: QwixxState) => {
  state.players.forEach(p => {
    let total = 0;
    (['red', 'yellow', 'green', 'blue'] as Color[]).forEach(c => {
      total += calculateScore(p.marks[c].length);
    });
    total -= (p.penalties * 5);
    p.score = total;
  });
};

const checkGameOver = (state: QwixxState) => {
  if (state.lockedRows.length >= 2 || state.players.some(p => p.penalties >= 4)) {
    state.phase = 'game_over';
  }
};

// --- GAME DEFINITION EXPORT ---
export const qwixxDef: GameDef<QwixxState, QwixxMove> = {
  name: 'Qwixx',
  minPlayers: 2,
  maxPlayers: 5,
  
  init: (numPlayers: number): QwixxState => {
    // Generate placeholder IDs matching the engine's expectation.
    // Your core GameHub engine likely overwrites these or handles player mapping.
    const playerIds = Array.from({ length: numPlayers }, (_, i) => `p${i}`);
    const playerNames = Array.from({ length: numPlayers }, (_, i) => `Player ${i + 1}`);
    
    const state: QwixxState = {
      players: playerIds.map((id, i) => ({
        id,
        name: playerNames[i],
        marks: { red: [], yellow: [], green: [], blue: [] },
        penalties: 0,
        score: 0
      })),
      activePlayerIndex: 0,
      viewingPlayerIndex: 0,
      phase: 'active_turn',
      dice: { w1: 1, w2: 1, red: 1, yellow: 1, green: 1, blue: 1 },
      lockedRows: [],
      pendingLocks: [],
    };
    rollDice(state);
    return state;
  },

  processMove: (state: QwixxState, move: QwixxMove, playerId: string): void => {
    const pIndex = state.players.findIndex(p => p.id === playerId);
    if (pIndex === -1) throw new Error("Player not found");

    if (state.phase === 'active_turn') {
      if (pIndex !== state.activePlayerIndex || move.type !== 'ACTIVE_PLAY') {
        throw new Error("Invalid active turn");
      }
      
      const player = state.players[state.activePlayerIndex];
      const proposedMarks = move.marks;

      // 1. Validate Penalty
      if (proposedMarks.length === 0) {
        player.penalties += 1;
      } else {
        // 2. Validate move legality (left-to-right, dice sums, white-before-color rule)
        const wSum = state.dice.w1 + state.dice.w2;

        proposedMarks.forEach((m, i) => {
          const faceVal = getFaceValue(m.color, m.index);
          const isW = faceVal === wSum;
          const isC = faceVal === state.dice.w1 + state.dice[m.color] || faceVal === state.dice.w2 + state.dice[m.color];
          
          if (proposedMarks.length === 2) {
            // Strict mapping: first item must be white sum, second must be color sum
            if (i === 0 && !isW) throw new Error("First mark must be White Sum");
            if (i === 1 && !isC) throw new Error("Second mark must be Color Sum");
            if (proposedMarks[0].color === proposedMarks[1].color && proposedMarks[0].index >= proposedMarks[1].index) {
               throw new Error("White sum must be to the left of Color sum in the same row");
            }
          } else if (proposedMarks.length === 1) {
            if (!isW && !isC) throw new Error("Mark must match either White Sum or Color Sum");
          }
          
          applyMark(state, player, m.color, m.index);
        });
      }

      // Advance phase
      if (state.players.length > 1) {
        state.phase = 'others_cycle';
        state.viewingPlayerIndex = (state.activePlayerIndex + 1) % state.players.length;
      } else {
        advanceRound(state); // Solo mode skips cycle
      }

    } else if (state.phase === 'others_cycle') {
      if (pIndex !== state.viewingPlayerIndex || move.type !== 'CYCLE_PLAY') {
        throw new Error("Invalid cycle turn");
      }
      
      const player = state.players[state.viewingPlayerIndex];
      
      if (move.mark) {
        const wSum = state.dice.w1 + state.dice.w2;
        if (getFaceValue(move.mark.color, move.mark.index) !== wSum) {
          throw new Error("Must be white sum");
        }
        applyMark(state, player, move.mark.color, move.mark.index);
      }

      // Advance cycle
      state.viewingPlayerIndex = (state.viewingPlayerIndex + 1) % state.players.length;
      if (state.viewingPlayerIndex === state.activePlayerIndex) {
        advanceRound(state);
      }
    }

    updateScores(state);
    checkGameOver(state);
  },

  isGameOver: (state: QwixxState): boolean => {
    return state.phase === 'game_over';
  }
};

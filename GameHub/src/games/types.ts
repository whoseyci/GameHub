// games/types.ts — The contract every game in the hub implements.
//
// A GameModule is a pure, serializable state machine:
//   • create(playerNames)            -> initial game state (plain object)
//   • applyAction(state, seat, msg)  -> mutate state for a validated player action
//   • viewFor(state, seat)           -> personalized snapshot sent to ONE client
//   • tick(state)                    -> optional server-driven advance (timers etc.)
//   • isOver(state) / canStart(n)    -> lifecycle helpers
//
// Rules for authors (so games never break each other or the hub):
//   1. State MUST be JSON-serializable (no class instances, functions, Dates).
//      Store everything as plain objects/arrays/numbers/strings/booleans.
//   2. NEVER read wall-clock or random outside create()/applyAction()/tick().
//   3. viewFor() must hide other players' hidden info (deal personalized views).
//   4. Keep state small — it is persisted to DO storage on every change.
//
// The hub handles networking, seats, hosting, spectators, lobby, hibernation.

export interface GameMeta {
  id: string;            // stable id, e.g. "skyjo"
  name: string;          // display name
  minPlayers: number;
  maxPlayers: number;
  description: string;
  emoji: string;         // shown in the hub picker
}

// A personalized snapshot for one viewer. `phase` drives shared hub UI:
//   "LOBBY" is handled by the hub itself (before a game starts).
//   Games use their own phases but MUST set `over:true` when finished and
//   expose `summary` (scoreboard) so the hub can show results to everyone.
export interface GameView {
  game: string;                 // module id
  phase: string;                // game-defined phase string
  over: boolean;                // true when the game has ended
  yourSeat: number;             // -1 for spectators
  // Optional shared extras the hub understands:
  summary?: { rows: SummaryRow[]; winners: number[] }; // shown at game end
  // Everything else is game-specific and rendered by the game's client module.
  [k: string]: unknown;
}

export interface SummaryRow { seat: number; name: string; score: number; }

// `nextScores` lets the hub seat late-joiners fairly when a new game/round
// starts (e.g. average of current totals). Optional.
export interface GameModule {
  meta: GameMeta;
  create(playerNames: string[]): any;
  applyAction(state: any, seat: number, msg: any): void;
  viewFor(state: any, seat: number): GameView;
  isOver(state: any): boolean;
  // Optional server-driven advance. Return ms until next tick, or null for none.
  tick?(state: any): number | null;
  // Optional: starting score for a late joiner given current state.
  joinScore?(state: any): number;
  // Optional: add a player between games/rounds.
  addPlayer?(state: any, name: string, startScore: number): void;
}

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
//      Include `schemaVersion: 1` so future migrations are explicit.
//   2. NEVER read wall-clock or random outside create()/applyAction()/tick().
//   3. viewFor() must hide other players' hidden info (deal personalized views).
//   4. Keep state small — it is persisted to DO storage on every change.
//
// The hub handles networking, seats, hosting, spectators, lobby, hibernation.

// Standardized lifecycle phase for hub-level game management.
export type GameLifecyclePhase =
  | "SETUP"        // Room lobby, choosing game
  | "DRAFT"        // Initial setup (reveals, dealing, etc.)
  | "PLAYING"      // Normal gameplay — players take turns or act simultaneously
  | "RESOLVING"    // Short delay for animations/computation before next turn
  | "ROUND_END"    // Between rounds — showing scores, option for next round
  | "GAME_OVER"    // Final results displayed
  | "SPECTATING";  // Late joiner watching current round

// Feature manifest that tells the hub what capabilities a game supports.
export interface GameFeatures {
  hasBots: boolean;           // can add AI players
  simultaneousTurns: boolean; // all players act at once (e.g., Qwixx white phase)
  usesTick: boolean;          // needs server-driven advance
  hasMultiRound: boolean;     // supports next_round
  canSpectate: boolean;       // late joiners allowed mid-game
  minDurationSec: number;     // estimated minimum game duration
  maxDurationSec: number;     // estimated maximum game duration
}

export interface GameMeta {
  id: string;            // stable id, e.g. "skyjo"
  name: string;          // display name
  minPlayers: number;
  maxPlayers: number;
  description: string;
  emoji: string;         // shown in the hub picker
  features?: GameFeatures; // optional capability manifest
}

/**
 * Standardized game state view that the hub uses for:
 * - Bot driver: determines whose turn it is and what actions are pending
 * - Tick scheduler: auto-advances games that need a delayed resolution
 * - Focus manager: decides which player's board to show prominently
 *
 * Games populate this in viewFor() alongside their game-specific data.
 * The hub reads ONLY this interface — game-specific fields live under
 * the namespaced key (view.skyjo, view.flip7, view.qwixx, etc.).
 */
export interface GameViewState {
  /** Seat index of the player whose turn it is, or -1 for simultaneous turns */
  currentSeat: number;
  /** Current action the active player must take, or null if any action is valid. */
  pendingAction: string | null;
  /** Per-player snapshot for the hub to drive bots and display status */
  players: Array<{
    seat: number;
    name: string;
    /** "active" | "stayed" | "busted" | "out" | "waiting" | "spectating" */
    status: string;
    /** Current round score (or cumulative for single-round games) */
    score: number;
    /** Banked/cumulative score across rounds */
    banked?: number;
  }>;
  /** Number of players who can currently act (for simultaneous-turn games) */
  actingCount?: number;
  /** Estimated ms before the game auto-advances (for RESOLVING phases) */
  autoAdvanceMs?: number;
}

// A personalized snapshot for one viewer. `phase` drives shared hub UI:
export interface GameView {
  game: string;                 // module id
  phase: string;                // game-defined phase string
  over: boolean;                // true when the game has ended
  yourSeat: number;             // -1 for spectators
  // Standardized game state for hub-level operations (bot driving, focus, ticks).
  state?: GameViewState;
  // Optional shared extras the hub understands:
  summary?: { rows: SummaryRow[]; winners: number[] }; // shown at game end
  // Everything else is game-specific and rendered by the game's client module.
  [k: string]: unknown;
}

// `score` = cumulative total. `delta` (optional) = points gained this round.
export interface SummaryRow { seat: number; name: string; score: number; delta?: number; }

export interface GameModule {
  meta: GameMeta;
  create(playerNames: string[]): any;
  applyAction(state: any, seat: number, msg: any): void;
  viewFor(state: any, seat: number): GameView;
  isOver(state: any): boolean;
  // Optional server-driven advance. Return ms until the next tick, or null for none.
  // The hub schedules an alarm after the returned delay and then calls completeTick().
  tick?(state: any): number | null;
  // Optional: run the deferred step a previous tick() scheduled (mutates state).
  // Lives with the game so the hub stays game-agnostic (no per-game registry).
  completeTick?(state: any): void;
  // Optional: compact, game-agnostic summary for replay/debug snapshots.
  // Defaults to viewFor(state, -1).state when omitted.
  summarize?(state: any): Record<string, unknown>;
  // Optional: starting score for a late joiner given current state.
  joinScore?(state: any): number;
  // Optional: add a player between games/rounds.
  addPlayer?(state: any, name: string, startScore: number): void;
}

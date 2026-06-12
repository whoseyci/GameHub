// replay-capture.ts — capture a full, deterministic replay bundle for each game
// played in a room.
//
// We rely on the project's existing determinism contract (RNG state lives inside
// state, no wall-clock reads in applyAction; verified by tests/replay-determinism).
// Each bundle is the minimum that lets a fresh client perfectly reproduce the
// game frame-by-frame:
//
//   { gameId, names, seats, initialState, actions[], finalSummary?, createdAt, endedAt? }
//
// The client `replay.html` rehydrates by deep-cloning `initialState` and calling
// `module.applyAction(state, seat, action)` for action[0..N], rendering `viewFor`.
//
// Persistence: bundles are written to DO storage under `replay:<id>`. Each room
// keeps the last N replays (REPLAY_KEEP) — older ones are evicted to bound the
// 32MB-ish DO storage budget. Bundles are also evicted when the room is GC'd.

import type { GameAction } from "./games/types";

export interface ReplayAction {
  /** Seat that acted (always >= 0; bot moves are attributed to their seat). */
  seat: number;
  /** Validated action payload — verbatim what was passed to applyAction(). */
  msg: GameAction;
  /** Server-side action sequence number (monotonic within the room). */
  seq: number;
}

export interface ReplayBundle {
  /** Globally-unique replay id (room code + monotonic counter). */
  id: string;
  /** Room code this replay was captured in. */
  roomCode: string;
  /** Module id (e.g. "skyjo", "qwixx"). */
  gameId: string;
  /** Player names by seat, captured at game start. */
  names: string[];
  /** Whether each seat was a bot at start (display hint only). */
  bots: boolean[];
  /** Deep-cloned initial state right after create() — the determinism anchor. */
  initialState: any;
  /** Ordered list of every action applied to the game. */
  actions: ReplayAction[];
  /** Unix ms the game started. */
  createdAt: number;
  /** Unix ms the game ended (set when isOver becomes true), undefined while live. */
  endedAt?: number;
  /** Final summary (winners, scores) once the game ends. */
  finalSummary?: { winners: number[]; rows: Array<{ seat: number; name: string; score: number; delta?: number }> };
  /** Replay schema — bump if the bundle shape changes incompatibly. */
  v: 1;
}

export const REPLAY_KEEP = 12;           // last N replays retained per room
export const REPLAY_MAX_ACTIONS = 4000;  // hard ceiling per bundle (safety belt)

export function newReplayBundle(args: {
  roomCode: string; gameId: string; names: string[]; bots: boolean[]; initialState: any; counter: number;
}): ReplayBundle {
  return {
    id: `${args.roomCode}-${args.counter.toString(36)}-${Date.now().toString(36).slice(-4)}`,
    roomCode: args.roomCode,
    gameId: args.gameId,
    names: args.names.slice(),
    bots: args.bots.slice(),
    initialState: JSON.parse(JSON.stringify(args.initialState)),
    actions: [],
    createdAt: Date.now(),
    v: 1,
  };
}

export function pushAction(bundle: ReplayBundle, seat: number, msg: GameAction, seq: number): void {
  if (bundle.actions.length >= REPLAY_MAX_ACTIONS) return; // safety belt
  // Deep-clone the msg so later mutations of msg (rare, but possible) can't
  // corrupt the captured replay.
  bundle.actions.push({ seat, msg: JSON.parse(JSON.stringify(msg)), seq });
}

export function freezeReplay(bundle: ReplayBundle, summary?: ReplayBundle["finalSummary"]): void {
  bundle.endedAt = Date.now();
  if (summary) bundle.finalSummary = summary;
}

/** Storage key conventions for DO. */
export const replayKey = (id: string) => `replay:${id}`;
export const REPLAY_INDEX_KEY = "replayIndex";

/** A tiny index of replay ids kept in DO meta (no need to scan storage). */
export interface ReplayIndexEntry {
  id: string;
  gameId: string;
  names: string[];
  createdAt: number;
  endedAt?: number;
  actionCount: number;
  winners?: number[];
}

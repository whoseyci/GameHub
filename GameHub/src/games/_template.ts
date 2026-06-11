// _template.ts — copy/paste starter for a new GameModule.
// Do not register this file directly; copy it to <game-id>.ts, rename the symbols,
// then add the real module to registry.ts and a matching client renderer.

import type { GameModule, GameView, GameViewState, GameLifecyclePhase, GameFeatures } from "./types";
import { makeSeed, type RngStateHolder } from "../rng";

interface TemplatePlayer {
  name: string;
  score: number;
}

interface TemplateState extends RngStateHolder {
  schemaVersion: number;
  players: TemplatePlayer[];
  phase: "PLAY" | "GAME_OVER";
  current: number;
  log: unknown[];
}

/** Map internal phase to the canonical GameLifecyclePhase. */
function lifecyclePhase(internalPhase: string): GameLifecyclePhase {
  switch (internalPhase) {
    case "PLAY":       return "PLAYING";
    case "GAME_OVER":  return "GAME_OVER";
    default:           return "PLAYING";
  }
}

/** Build a standardized GameViewState so the hub stays game-agnostic. */
function buildViewState(state: TemplateState): GameViewState {
  return {
    currentSeat: state.phase === "PLAY" ? state.current : -1,
    pendingAction: state.phase === "PLAY" ? "choose_action" : null,
    players: state.players.map((p, i) => ({
      seat: i,
      name: p.name,
      status: state.phase === "PLAY"
        ? (i === state.current ? "active" : "waiting")
        : "out",
      score: p.score,
    })),
    actingCount: state.phase === "PLAY" ? 1 : 0,
  };
}

export const TemplateGame: GameModule = {
  meta: {
    id: "template",
    name: "Template",
    minPlayers: 2,
    maxPlayers: 8,
    description: "Copy this file to start a new game module.",
    emoji: "🧩",
    features: {
      hasBots: false,
      simultaneousTurns: false,
      usesTick: false,
      hasMultiRound: false,
      canSpectate: false,
      minDurationSec: 60,
      maxDurationSec: 300,
    },
    actionTypes: [
      "example",
    ] as const,
  },

  create(names: string[]): TemplateState {
    return {
      schemaVersion: 1,
      rngState: makeSeed(),
      players: names.map((name) => ({ name, score: 0 })),
      phase: "PLAY",
      current: 0,
      log: [],
    };
  },

  applyAction(state: TemplateState, seat: number, msg: any): void {
    if (state.phase !== "PLAY") return;
    if (seat !== state.current) return;
    if (msg.action !== "example") return;

    // Mutate only this game's state. Validate all indices/choices before mutating.
    state.log.push({ seat, action: msg.action });
    state.current = (state.current + 1) % state.players.length;
  },

  viewFor(state: TemplateState, seat: number): GameView {
    return {
      game: "template",
      phase: lifecyclePhase(state.phase),
      over: state.phase === "GAME_OVER",
      yourSeat: seat,
      state: buildViewState(state),
      template: {
        current: state.current,
        players: state.players.map((p, i) => ({ seat: i, name: p.name, score: p.score })),
      },
    };
  },

  isOver(state: TemplateState): boolean {
    return state.phase === "GAME_OVER";
  },

  // PROPOSAL 3: State migration — backfill new fields when schema evolves.
  migrate(state: any) {
    // Example for a future schema bump:
    // if (!state.schemaVersion || state.schemaVersion < 2) {
    //   state.newField = [];
    //   state.schemaVersion = 2;
    // }
  },

  // PROPOSAL 6: Server-side bot (optional — games may keep client-side bots)
  // runBot(state: TemplateState, seat: number, difficulty: string): GameAction | null {
  //   return { action: "example" };
  // },
};

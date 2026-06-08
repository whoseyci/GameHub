// _template.ts — copy/paste starter for a new GameModule.
// Do not register this file directly; copy it to <game-id>.ts, rename the symbols,
// then add the real module to registry.ts and a matching client renderer.

import type { GameModule, GameView } from "./types";
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

export const TemplateGame: GameModule = {
  meta: {
    id: "template",
    name: "Template",
    minPlayers: 2,
    maxPlayers: 8,
    description: "Copy this file to start a new game module.",
    emoji: "🧩",
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
      phase: state.phase,
      over: state.phase === "GAME_OVER",
      yourSeat: seat,
      template: {
        current: state.current,
        players: state.players.map((p, i) => ({ seat: i, name: p.name, score: p.score })),
      },
    };
  },

  isOver(state: TemplateState): boolean {
    return state.phase === "GAME_OVER";
  },
};

// games/registry.ts — central list of games in the hub.
// To add a game: implement a GameModule, import it here, add it to GAMES.
// Existing games are untouched, so a new game can't break them.
import type { GameModule } from "./types";
import { Skyjo, skyjoCompleteTurnEnd } from "./skyjo";
import { Flip7 } from "./flip7";

export const GAMES: Record<string, GameModule> = {
  [Skyjo.meta.id]: Skyjo,
  [Flip7.meta.id]: Flip7,
};

// Public catalogue for the hub UI (no logic, just metadata).
export const GAME_CATALOGUE = Object.values(GAMES).map((g) => g.meta);

export function getGame(id: string): GameModule | null {
  return GAMES[id] ?? null;
}

// Per-game "deferred tick" runners. The hub stays game-agnostic; each game that
// uses tick() registers how to complete its deferred step here.
export const TICK_RUNNERS: Record<string, (state: any) => void> = {
  skyjo: skyjoCompleteTurnEnd,
};

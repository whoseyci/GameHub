// games/registry.ts — central list of games in the hub.
// To add a game: implement a GameModule, import it here, add it to GAMES.
// Existing games are untouched, so a new game can't break them.
import type { GameModule, GameFeatures } from "./types";
import { Skyjo } from "./skyjo/server";
import { Flip7 } from "./flip7/server";
import { Qwixx } from "./qwixx/server";
import { Schotten } from "./schotten/server";

export const GAMES: Record<string, GameModule> = {
  [Skyjo.meta.id]: Skyjo,
  [Flip7.meta.id]: Flip7,
  [Qwixx.meta.id]: Qwixx,
  [Schotten.meta.id]: Schotten,
};

// Public catalogue for the hub UI (no logic, just metadata + features).
export const GAME_CATALOGUE = Object.values(GAMES).map((g) => ({
  id: g.meta.id,
  name: g.meta.name,
  minPlayers: g.meta.minPlayers,
  maxPlayers: g.meta.maxPlayers,
  description: g.meta.description,
  emoji: g.meta.emoji,
  icon: g.meta.icon, // Phosphor icon name; the hub UI prefers it over emoji.
  features: g.meta.features,
}));

// Feature lookup for server-side decisions (bot controls, timeouts, etc.)
export function getGameFeatures(id: string): GameFeatures | undefined {
  return GAMES[id]?.meta.features;
}

export function getGame(id: string): GameModule | null {
  return GAMES[id] ?? null;
}

// games/registry.ts — central list of games in the hub.
// To add a game: implement a GameModule, import it here, add it to GAMES.
// Existing games are untouched, so a new game can't break them.
import type { GameModule, GameFeatures } from "./types";
import { Skyjo } from "./skyjo/server";
import { Flip7 } from "./flip7/server";
import { Qwixx } from "./qwixx/server";
import { Schotten } from "./schotten/server";
// Schema-defined games (data → GameModule via the interpreter). The foundation
// for the visual game creator: a brand-new game with NO custom code.
import { makeSchemaGame } from "./schema/engine";
import { Septet } from "./schema/specs/septet";
import { Encore } from "./schema/specs/encore";

const SeptetGame = makeSchemaGame(Septet);
const EncoreGame = makeSchemaGame(Encore);

export const GAMES: Record<string, GameModule> = {
  [Skyjo.meta.id]: Skyjo,
  [Flip7.meta.id]: Flip7,
  [Qwixx.meta.id]: Qwixx,
  [Schotten.meta.id]: Schotten,
  [SeptetGame.meta.id]: SeptetGame,
  [EncoreGame.meta.id]: EncoreGame,
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
  schemaSpec: g.meta.schemaSpec,
  // Schema-defined games carry this so the bundled client attaches the generic
  // renderer (no hand-written client module). Hand-written games omit it.
  ...((g.meta as any).__schema ? { __schema: true, __schemaKind: (g.meta as any).__schemaKind } : {}),
}));

// Feature lookup for server-side decisions (bot controls, timeouts, etc.)
export function getGameFeatures(id: string): GameFeatures | undefined {
  return GAMES[id]?.meta.features;
}

export function getGame(id: string): GameModule | null {
  return GAMES[id] ?? null;
}

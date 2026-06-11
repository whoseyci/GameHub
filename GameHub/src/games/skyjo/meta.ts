import type { GameFeatures, GameMeta } from "../types";

export const SkyjoFeatures: GameFeatures = {
  hasBots: true,
  simultaneousTurns: false,
  usesTick: true,
  hasMultiRound: true,
  canSpectate: true,
  minDurationSec: 120,
  maxDurationSec: 600,
};

export const SkyjoMeta: GameMeta = {
  id: "skyjo",
  name: "Skyjo",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Flip, swap and dump cards to get the lowest score.",
  emoji: "🃏",
  features: SkyjoFeatures,
  actionTypes: ["draw_deck","take_discard","discard_drawn","swap","reveal","reveal_after_discard","tiebreaker","next_round"] as const,
};

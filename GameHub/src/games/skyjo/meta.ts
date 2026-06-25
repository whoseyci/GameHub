import type { GameFeatures, GameMeta } from "../types";

export const SkyjoFeatures: GameFeatures = {
  hasBots: true,
  simultaneousTurns: false,
  usesTick: true,
  hasMultiRound: true,
  canSpectate: true,
  minDurationSec: 120,
  maxDurationSec: 600,
  variants: [
    { id: "standard", name: "Standard", description: "Classic Skyjo to 100 points." },
    { id: "action", name: "Skyjo Action", description: "Adds star cards, row clears, and a separate action-card deck." },
  ],
};

export const SkyjoMeta: GameMeta = {
  id: "skyjo",
  name: "Skyjo",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Flip, swap and dump cards to get the lowest score.",
  emoji: "🃏",
  features: SkyjoFeatures,
  variants: [...(SkyjoFeatures.variants ?? [])],
  actionTypes: ["draw_deck","take_discard","discard_drawn","swap","reveal","reveal_after_discard","tiebreaker","take_action","play_action","discard_action","action_cell","clear_group","skip_clear_group","next_round"] as const,
};

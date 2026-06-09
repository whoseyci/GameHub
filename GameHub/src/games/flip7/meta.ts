import type { GameMeta } from "../types";

export const Flip7Meta: GameMeta = {
  id: "flip7",
  name: "Flip 7",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Push your luck — flip cards, don't repeat a number, race to 200.",
  emoji: "🎴",
  features: {
    hasBots: true,
    simultaneousTurns: false,
    usesTick: false,
    hasMultiRound: true,
    canSpectate: true,
    minDurationSec: 180,
    maxDurationSec: 900,
  },
};

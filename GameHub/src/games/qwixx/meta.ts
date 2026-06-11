import type { GameMeta } from "../types";

export const QwixxMeta: GameMeta = {
  id: "qwixx",
  name: "Qwixx",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Cross numbers left-to-right using dice sums.",
  emoji: "🎲",
  features: {
    hasBots: true,
    simultaneousTurns: true,
    usesTick: false,
    hasMultiRound: false,
    canSpectate: false,
    minDurationSec: 90,
    maxDurationSec: 300,
  },
  actionTypes: ["mark","skip","finishTurn","next_round"] as const,
};

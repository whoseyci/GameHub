import type { GameMeta } from "../types";

export const SchottenMeta: GameMeta = {
  id: "schotten",
  name: "Schotten Totten",
  minPlayers: 2,
  maxPlayers: 2,
  description: "Win border stones with the best 3-card formations.",
  emoji: "🪨",
  features: {
    hasBots: true,
    simultaneousTurns: false,
    usesTick: false,
    hasMultiRound: false,
    canSpectate: true,
    minDurationSec: 300,
    maxDurationSec: 900,
  },
  actionTypes: ["place","claim","end","next_round"] as const,
};

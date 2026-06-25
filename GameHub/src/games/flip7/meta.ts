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
  actionTypes: ["hit","stay","target","give_second","next_round"] as const,
  variants: [
    { id: "standard", name: "Standard", description: "Race to 200 points." },
    { id: "vengeance", name: "Flip 7 with a vengeance", description: "High stakes aggressive targeting (Freeze -10pts) and Flip 4 action cards." }
  ],
};

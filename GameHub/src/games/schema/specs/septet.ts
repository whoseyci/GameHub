// games/schema/specs/septet.ts — a DATA-ONLY sample game proving the schema
// pipeline end-to-end. A clean Flip-7-style press-your-luck:
//   • Draw number cards 0..12 (more copies of higher numbers = riskier).
//   • Draw a duplicate of a number you already hold this turn → BUST (score 0).
//   • Collect 7 DISTINCT numbers → "Septet!" +15 bonus and your turn ends.
//   • Stay to bank your kept cards' sum. First to 200 wins.
// No engine code lives here — only the spec. The visual editor will eventually
// emit exactly this kind of object.
import type { GameSpec } from "../spec";

export const Septet: GameSpec = {
  kind: "pressYourLuck",
  meta: {
    id: "septet",
    name: "Septet",
    description: "Push your luck — flip number cards, don't repeat, race to 200.",
    emoji: "\u{1F3B4}",
    icon: "cards",
    minPlayers: 2,
    maxPlayers: 8,
  },
  // One 0, two 1s, three 2s, … thirteen 12s (higher = more copies = riskier).
  deck: Array.from({ length: 13 }, (_, v) => ({ value: v, count: v + 1 })),
  bust: "duplicate",
  bonus: { uniqueCount: 7, points: 15 },
  scoring: "sum",
  win: { target: 200 },
};

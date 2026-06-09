// games/skyjo.ts — Skyjo implemented against the GameModule contract.
// Wraps the existing GameEngine (rehydrated from plain state each call so the
// stored game state stays a plain JSON object, per the contract).
import type {
  GameModule,
  GameView,
  GameViewState,
  GameLifecyclePhase,
  GameFeatures,
} from "../types";
import { GameEngine } from "../../engine";

function load(state: any): GameEngine {
  return GameEngine.fromJSON(state);
}
function dump(g: GameEngine): any {
  return JSON.parse(JSON.stringify(g));
}

/** Map internal Skyjo phase to the canonical GameLifecyclePhase. */
function lifecyclePhase(phase: string): GameLifecyclePhase {
  switch (phase) {
    case "REVEAL":
      return "DRAFT";
    case "PLAY":
    case "FINAL_TURNS":
      return "PLAYING";
    case "ROUND_END":
      return "ROUND_END";
    case "GAME_OVER":
      return "GAME_OVER";
    default:
      return "PLAYING";
  }
}

/** Build a standardized GameViewState so the hub stays game-agnostic. */
function buildViewState(g: GameEngine, seat: number): GameViewState {
  const isReveal = g.phase === "REVEAL";
  return {
    currentSeat:
      isReveal && g.tiebreakerPlayers.length
        ? g.tiebreakerPlayers[0]
        : g.currentPlayer,
    pendingAction: g.turnAction,
    players: g.players.map((p, i) => ({
      seat: i,
      name: p.name,
      status: isReveal
        ? p.revealCount >= 2
          ? "waiting"
          : "active"
        : i === g.currentPlayer
          ? "active"
          : "waiting",
      score: p.roundScore,
      banked: p.totalScore,
    })),
    actingCount: isReveal
      ? g.players.filter((p) => p.revealCount < 2).length
      : 1,
    autoAdvanceMs:
      g.turnAction === "turn_end_delay" ? 1200 : undefined,
  };
}

const SkyjoFeatures: GameFeatures = {
  hasBots: true,
  simultaneousTurns: false,
  usesTick: true,
  hasMultiRound: true,
  canSpectate: true,
  minDurationSec: 120,
  maxDurationSec: 600,
};

export const Skyjo: GameModule = {
  meta: {
    id: "skyjo",
    name: "Skyjo",
    minPlayers: 2,
    maxPlayers: 8,
    description: "Flip, swap and dump cards to get the lowest score.",
    emoji: "🃏",
    features: SkyjoFeatures,
  },

  create(names) {
    const g = new GameEngine(names);
    g.start();
    return dump(g);
  },

  applyAction(state, seat, msg) {
    const g = load(state);
    switch (msg.action) {
      case "reveal":
        g.revealInitial(seat, msg.index);
        break;
      case "tiebreaker":
        g.revealTiebreaker(seat, msg.index);
        break;
      case "draw_deck":
        g.drawDeck(seat);
        break;
      case "take_discard":
        g.takeDiscard(seat);
        break;
      case "swap":
        g.swap(seat, msg.index);
        break;
      case "discard_drawn":
        g.discardDrawnCard(seat);
        break;
      case "reveal_after_discard":
        g.revealAfterDiscard(seat, msg.index);
        break;
      case "next_round": // host-only; hub gates this
        if (g.phase === "GAME_OVER") g.newGame();
        else if (g.phase === "ROUND_END") g.nextRound();
        break;
    }
    // Copy mutated fields back onto the plain state object in place.
    Object.assign(state, dump(g));
  },

  // Server-driven advance: Skyjo uses a short "turn_end_delay" so animations land,
  // then auto-completes. The hub calls tick() when this returns a delay.
  tick(state) {
    if (state.turnAction === "turn_end_delay") return 1200; // ms until completeTurnEnd
    return null;
  },

  // Called by the hub after the tick delay elapses.
  // (Exposed as a normal action so the hub stays game-agnostic.)
  // We piggyback on applyAction via a synthetic "complete_turn_end".
  isOver(state) {
    return state.phase === "GAME_OVER";
  },

  joinScore(state) {
    const g = load(state);
    return Math.round(g.averageTotal());
  },
  addPlayer(state, name, startScore) {
    const g = load(state);
    g.addPlayer(name, startScore);
    Object.assign(state, dump(g));
  },

  viewFor(state, seat): GameView {
    const g = load(state);
    const s: any = g.getStateFor(seat);
    const over = g.phase === "GAME_OVER";
    let summary;
    if (g.phase === "ROUND_END" || g.phase === "GAME_OVER") {
      const min = Math.min(
        ...g.players.map((p) => p.totalScore)
      );
      summary = {
        rows: g.players.map((p, i) => ({
          seat: i,
          name: p.name,
          score: p.totalScore,
          delta: p.roundScore,
        })),
        winners: g.players
          .map((p, i) => (p.totalScore === min ? i : -1))
          .filter((i) => i >= 0),
      };
    }
    return {
      game: "skyjo",
      phase: lifecyclePhase(g.phase),
      over,
      yourSeat: seat,
      summary,
      state: buildViewState(g, seat),
      skyjo: s,
    };
  },
};

// The hub calls this generic helper to run the deferred turn-end. Kept here so
// the timing logic lives with the game, not the hub.
export function skyjoCompleteTurnEnd(state: any) {
  const g = load(state);
  g.completeTurnEnd();
  Object.assign(state, dump(g));
}

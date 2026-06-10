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
import { mapPhase } from "../types";
import { GameEngine } from "../../engine";

// Rehydrate the engine from plain stored state. This is cheap (an Object.assign);
// the previous hot-path cost came from JSON.parse(JSON.stringify(...)) on write
// and from re-rehydrating per viewer. We now load once per call and write state
// back in place via engine.writeInto(), with no JSON round-trip.
function load(state: any): GameEngine {
  return GameEngine.fromJSON(state);
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
    return g.toState();
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
    // Write mutated fields back onto the plain state object in place (no JSON clone).
    g.writeInto(state);
  },

  // Server-driven advance: Skyjo uses a short "turn_end_delay" so animations land,
  // then auto-completes. The hub calls tick() when this returns a delay, then
  // completeTick() after the delay elapses.
  tick(state) {
    if (state.turnAction === "turn_end_delay") return 1200; // ms until completeTick
    return null;
  },

  // Run the deferred turn-end the previous tick() scheduled.
  completeTick(state) {
    const g = load(state);
    g.completeTurnEnd();
    g.writeInto(state);
  },

  isOver(state) {
    return state.phase === "GAME_OVER";
  },

  // Compact, game-agnostic summary for replay/debug snapshots.
  summarize(state) {
    return {
      round: state.round,
      currentPlayer: state.currentPlayer,
      turnAction: state.turnAction,
    };
  },

  joinScore(state) {
    const g = load(state);
    return Math.round(g.averageTotal());
  },
  addPlayer(state, name, startScore) {
    const g = load(state);
    g.addPlayer(name, startScore);
    g.writeInto(state);
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
      phase: mapPhase(g.phase),
      over,
      yourSeat: seat,
      summary,
      state: buildViewState(g, seat),
      skyjo: s,
    };
  },
};

// Backward-compatible alias for the deferred turn-end runner. New code should use
// the GameModule.completeTick() contract method instead of this named export.
export function skyjoCompleteTurnEnd(state: any) {
  Skyjo.completeTick!(state);
}

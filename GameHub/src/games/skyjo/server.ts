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
import { GameEngine } from "./engine";

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
  const isTb = isReveal && g.tiebreakerPlayers.length > 0;
  return {
    currentSeat: g.skyjoAction ? g.skyjoAction.player : (isTb ? -1 : g.currentPlayer),
    pendingAction: g.skyjoAction ? g.skyjoAction.kind : g.turnAction,
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
  variants: [
    { id: "standard", name: "Standard", description: "Classic Skyjo to 100 points." },
    { id: "action", name: "Skyjo Action", description: "Adds star cards, row clears, and a separate action-card deck." },
  ],
};

export const Skyjo: GameModule = {
  meta: {
    id: "skyjo",
    name: "Skyjo",
    minPlayers: 2,
    maxPlayers: 8,
    description: "Flip, swap and dump cards to get the lowest score.",
    emoji: "🃏",
    icon: "cards",
    features: SkyjoFeatures,
    variants: [...(SkyjoFeatures.variants ?? [])],
    actionTypes: ["draw_deck","take_discard","discard_drawn","swap","take_free_action","reveal_after_discard","tiebreaker","take_action","play_action","discard_action","action_cell","clear_group","skip_clear_group","reveal","skip_free_action","next_round"] as const,
    schemaSpec: { kind: "imperative", paradigm: "reducers", version: 1 },
  },

  parseAction(raw: any) {
    if (!raw || typeof raw !== "object" || typeof raw.action !== "string") return null;
    if (Skyjo.meta.actionTypes && !(Skyjo.meta.actionTypes as readonly string[]).includes(raw.action)) return null;
    return raw;
  },

  create(names, variant) {
    const g = new GameEngine(names);
    if (variant) g.variant = variant;
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
      case "take_action":
        g.takeActionCard(seat, msg.source === "market" ? "market" : "deck", msg.index | 0);
        break;
      case "play_action":
        g.playActionCard(seat, msg.hand | 0);
        break;
      case "discard_action":
        g.discardActionCard(seat, msg.hand | 0);
        break;
      case "action_cell":
        g.actionCell(seat, msg.index | 0);
        break;
      case "clear_group":
        g.clearStarGroup(seat, msg.group | 0, !!msg.starOnTop);
        break;
      case "skip_clear_group":
        g.skipStarClear(seat);
        break;
      case "take_free_action":
        g.takeFreeActionCard(seat);
        break;
      case "skip_free_action":
        g.skipFreeActionCard(seat);
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

  // State migration (Proposal 3): schema is current — no-op. Future schema bumps
  // (e.g. adding a field) would back-fill it here so in-progress rooms survive a deploy.
  migrate(_state: any) { /* schemaVersion 1 — current */ },
  isOver(state) {
    return state.phase === "GAME_OVER";
  },

  // API-8: enumerate legal actions for `seat` given current state. Drives client
  // hint highlights (which cells are revealable, which piles are tap-targets)
  // and gives the BotDriver a "random legal move" fallback. Pure read.
  legalActions(state, seat) {
    // BUG FIX (Skyjo unplayable in pass-and-play): this function used to read
    // p.cards / me.cards everywhere, but the engine state stores the 4x3 grid
    // as p.board (see create() above + every applyAction handler). That made
    // legalActions return an empty array in every phase — masked online
    // because the SERVER is authoritative and accepts actions anyway, but
    // FATAL in local pass-and-play where 03-skyjo.js's canClick() relies on
    // these hints to enable card-click handlers. Result: no card on any
    // human's board was ever clickable. Switched all reads to p.board.
    const out: any[] = [];
    const meAny: any = state.players?.[seat];
    if (state.skyjoAction?.player === seat) {
      if (state.skyjoAction.kind === "star_action") {
        out.push({ action: "take_free_action" }, { action: "skip_free_action" });
        return out;
      }
      if (state.skyjoAction.kind === "star_clear") {
        if ((state.skyjoAction.groups || []).length) {
          out.push({ action: "clear_group", group: 0, starOnTop: false }, { action: "clear_group", group: 0, starOnTop: true });
        }
        out.push({ action: "skip_clear_group" });
        return out;
      }
      (meAny?.board || []).forEach((c: any, idx: number) => {
        if (!c.cleared) out.push({ action: "action_cell", index: idx });
      });
      return out;
    }
    if (state.phase === "REVEAL") {
      // Each player flips 2 face-down cards to start; both seats may act in
      // parallel until they've each revealed 2. Returning hints only for
      // unrevealed cells lets the client paint them as drop targets.
      const p = state.players?.[seat]; if (!p) return out;
      if ((p.revealCount ?? 0) >= 2) return out;
      const isTb = Array.isArray(state.tiebreakerPlayers) && state.tiebreakerPlayers.length > 0;
      const actionName = isTb ? "tiebreaker" : "reveal";
      (p.board || []).forEach((c: any, idx: number) => {
        if (!c.revealed) out.push({ action: actionName, index: idx });
      });
      return out;
    }
    if (state.phase === "PLAY" || state.phase === "FINAL_TURNS") {
      if (state.currentPlayer !== seat) return out;
      const me: any = state.players?.[seat]; if (!me) return out;
      const ta = state.turnAction;
      if (ta === null) {
        out.push({ action: "draw_deck" });
        // BUG FIX (Skyjo: 'can't pick cards from discard' in pass-and-play):
        // state.discardTop is a VIEW-ONLY field built by getStateFor (the
        // engine state stores state.discard as an array). Reading
        // state.discardTop on the raw engine state always returned
        // undefined, so take_discard was never offered as a legal action.
        // Same shape as the earlier p.cards → p.board bug. Server-side
        // play wasn't affected because applyAction accepts take_discard
        // unconditionally — but the client gates on legalActions, so
        // pass-and-play players couldn't tap the discard pile.
        if (Array.isArray(state.discard) && state.discard.length > 0) {
          out.push({ action: "take_discard" });
        }
        if (state.variant === "action" && state.phase === "PLAY") {
          (state.actionMarket || []).forEach((_: any, index: number) => out.push({ action: "take_action", source: "market", index }));
          out.push({ action: "take_action", source: "deck", index: -1 });
          (me.actionHand || []).forEach((a: any, hand: number) => {
            if (!a.fresh) out.push({ action: "play_action", hand }, { action: "discard_action", hand });
          });
        }
      } else if (ta === "deck") {
        out.push({ action: "discard_drawn" });
        (me.board || []).forEach((_: any, idx: number) => out.push({ action: "swap", index: idx }));
      } else if (ta === "discard") {
        // Took from discard — must swap onto a board cell.
        (me.board || []).forEach((_: any, idx: number) => out.push({ action: "swap", index: idx }));
      } else if (ta === "must_reveal") {
        (me.board || []).forEach((c: any, idx: number) => {
          if (!c.revealed && !c.cleared) out.push({ action: "reveal_after_discard", index: idx });
        });
      }
      return out;
    }
    // Tiebreaker phase, ROUND_END, GAME_OVER — no per-seat actions exposed
    // here (next_round is host-only and the hub gates it separately).
    return out;
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

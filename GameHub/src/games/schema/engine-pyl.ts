// games/schema/engine.ts — interpret a GameSpec (data) into a GameModule (the
// hub's standard pure state machine). No untrusted code is ever run: this is our
// audited interpreter; a spec can only pick among built-in, bounded behaviours.
// See docs/GAME_SCHEMA.md.
import type { GameModule, GameView, GameViewState, GameAction } from "../types";
import { mapPhase } from "../types";
import { makeSeed, shuffleInPlace, ensureRngState, type RngStateHolder } from "../../rng";
import type { PressYourLuckSpec } from "./spec";
import { validatePressYourLuck } from "./spec";

type Phase = "PLAY" | "ROUND_END" | "GAME_OVER";

interface SPlayer {
  name: string;
  kept: number[];        // values drawn+kept this turn (cleared on bank/bust)
  banked: number;        // cumulative across rounds
  status: "active" | "stayed" | "busted";
  lastRoundDelta: number;
}

interface SState extends RngStateHolder {
  schemaVersion: number;
  specId: string;
  players: SPlayer[];
  deck: number[];        // remaining draw pile (values)
  discard: number[];
  current: number;       // active seat
  round: number;
  phase: Phase;
}

function buildDeck(spec: PressYourLuckSpec, st: RngStateHolder): number[] {
  const cards: number[] = [];
  for (const d of spec.deck) for (let i = 0; i < d.count; i++) cards.push(d.value);
  shuffleInPlace(cards, st);
  return cards;
}

function roundActive(p: SPlayer) { return p.status === "active"; }
function handScore(p: SPlayer) { return p.kept.reduce((a, b) => a + b, 0); }

/** Advance `current` to the next still-active player, or end the round. */
function advanceTurn(s: SState) {
  const n = s.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (s.current + step) % n;
    if (roundActive(s.players[idx])) { s.current = idx; return; }
  }
  endRound(s);
}

function endRound(s: SState, spec?: PressYourLuckSpec) {
  // Anyone still active at round end banks what they're holding (they didn't bust).
  for (const p of s.players) {
    if (p.status === "active") { p.banked += handScore(p); p.lastRoundDelta = handScore(p); }
  }
  // Win check.
  const sp = spec || SPEC_BY_ID[s.specId];
  const target = sp ? sp.win.target : Infinity;
  const top = Math.max(...s.players.map((p) => p.banked));
  if (top >= target) { s.phase = "GAME_OVER"; return; }
  s.phase = "ROUND_END";
}

// We need the spec at runtime in pure functions; the registry wraps each spec
// and stashes it here so endRound() can read win.target without a closure on
// state (state must stay JSON-serializable). Keyed by spec id.
const SPEC_BY_ID: Record<string, PressYourLuckSpec> = {};

export function makePressYourLuckGame(spec: PressYourLuckSpec): GameModule {
  const errs = validatePressYourLuck(spec);
  if (errs.length) throw new Error(`Invalid GameSpec "${spec?.meta?.id}": ${errs.join("; ")}`);
  SPEC_BY_ID[spec.meta.id] = spec;
  const deckTotal = spec.deck.reduce((a, d) => a + d.count, 0);

  function startRound(s: SState) {
    s.deck = buildDeck(spec, s);
    s.discard = [];
    for (const p of s.players) { p.kept = []; p.status = "active"; p.lastRoundDelta = 0; }
    // Active player = round number rotates the starter for fairness.
    s.current = (s.round - 1) % s.players.length;
    s.phase = "PLAY";
  }

  const mod: GameModule = {
    meta: {
      id: spec.meta.id,
      name: spec.meta.name,
      minPlayers: spec.meta.minPlayers,
      maxPlayers: spec.meta.maxPlayers,
      description: spec.meta.description,
      emoji: spec.meta.emoji,
      icon: spec.meta.icon,
      // Reuse the shared press-your-luck verbs (Flip 7 uses hit/stay) so the
      // hub's bot driver + cross-game self-play harness already understand them.
      // "draw" is accepted as an alias for "hit".
      actionTypes: ["hit", "stay", "next_round"] as const,
      features: {
        hasBots: true,
        simultaneousTurns: false,
        usesTick: false,
        hasMultiRound: true,
        canSpectate: true,
      minDurationSec: 120,
      maxDurationSec: 900,
    },
    schemaSpec: spec,
  },

  parseAction(raw: any) {
    if (!raw || typeof raw !== "object" || typeof raw.action !== "string") return null;
    if (["hit", "stay", "next_round"].includes(raw.action)) return raw;
    return null;
  },

  create(playerNames: string[]) {
      const s: SState = {
        schemaVersion: 1,
        specId: spec.meta.id,
        players: playerNames.slice(0, spec.meta.maxPlayers).map((name) => ({
          name: (name || "Player").slice(0, 20), kept: [], banked: 0, status: "active", lastRoundDelta: 0,
        })),
        deck: [], discard: [], current: 0, round: 1, phase: "PLAY",
        rngState: makeSeed(`${spec.meta.id}:${playerNames.join("|")}`),
      };
      ensureRngState(s);
      startRound(s);
      return s;
    },

    applyAction(state: SState, seat: number, msg: GameAction) {
      const action = msg.action;
      if (state.phase === "ROUND_END" && action === "next_round") {
        state.round += 1; startRound(state); return;
      }
      if (state.phase !== "PLAY") return;
      if (seat !== state.current) return;             // not your turn
      const p = state.players[seat];
      if (!roundActive(p)) return;

      if (action === "stay") {
        p.banked += handScore(p); p.lastRoundDelta = handScore(p); p.status = "stayed";
        advanceTurn(state);
        return;
      }
      if (action === "hit" || action === "draw") {
        if (!state.deck.length) {
          // Exhausted deck → reshuffle the discard back in (keeps long games going).
          if (state.discard.length) { state.deck = state.discard; state.discard = []; shuffleInPlace(state.deck, state); }
          else { endRound(state, spec); return; }
        }
        const card = state.deck.pop() as number;
        // BUST: duplicate of a value already kept this turn.
        if (spec.bust === "duplicate" && p.kept.includes(card)) {
          state.discard.push(card);
          p.kept = []; p.status = "busted"; p.lastRoundDelta = 0;
          advanceTurn(state);
          return;
        }
        p.kept.push(card);
        // BONUS: enough distinct cards → instant points + end your turn.
        if (spec.bonus) {
          const distinct = new Set(p.kept).size;
          if (distinct >= spec.bonus.uniqueCount) {
            p.banked += handScore(p) + spec.bonus.points;
            p.lastRoundDelta = handScore(p) + spec.bonus.points;
            p.status = "stayed";
            advanceTurn(state);
          }
        }
        return;
      }
    },

    isOver(state: SState) { return state.phase === "GAME_OVER"; },

    legalActions(state: SState, seat: number): GameAction[] {
      if (state.phase === "ROUND_END") return seat === 0 ? [{ action: "next_round" }] : [];
      if (state.phase !== "PLAY" || seat !== state.current) return [];
      if (!roundActive(state.players[seat])) return [];
      return [{ action: "hit" }, { action: "stay" }];
    },

    viewFor(state: SState, seat: number): GameView {
      const vstate: GameViewState = {
        currentSeat: state.phase === "PLAY" ? state.current : -1,
        pendingAction: state.phase === "PLAY" ? "draw_or_stay" : null,
        players: state.players.map((p, i) => ({
          seat: i, name: p.name, status: p.status,
          score: handScore(p), banked: p.banked,
        })),
        actingCount: state.phase === "PLAY" ? 1 : 0,
        focusSeat: state.phase === "PLAY" ? state.current : seat,
      };
      const over = state.phase === "GAME_OVER";
      const view: GameView = {
        game: spec.meta.id,
        phase: mapPhase(state.phase),
        over,
        yourSeat: seat,
        state: vstate,
        // generic schema payload the schema client renders — namespaced under
        // the game's own id (the hub contract: view[meta.id] is the private bag).
        [spec.meta.id]: {
          kind: spec.kind,
          deckCount: state.deck.length,
          discardCount: state.discard.length,
          round: state.round,
          target: spec.win.target,
          bonus: spec.bonus || null,
          players: state.players.map((p, i) => ({
            seat: i, name: p.name, kept: p.kept.slice(), live: handScore(p),
            banked: p.banked, status: p.status,
          })),
        },
      };
      if (over) {
        const ranked = state.players
          .map((p, i) => ({ seat: i, name: p.name, score: p.banked, delta: p.lastRoundDelta }))
          .sort((a, b) => b.score - a.score);
        const best = ranked.length ? ranked[0].score : 0;
        view.summary = { rows: ranked, winners: ranked.filter((r) => r.score === best).map((r) => r.seat) };
      }
      return view;
    },

    summarize(state: SState) {
      return { round: state.round, phase: state.phase, banked: state.players.map((p) => p.banked) };
    },
  };
  // Tag so the bundled client + catalogue can detect schema-defined games and
  // attach the generic renderer (no hand-written client needed).
  (mod as any).__schema = true;
  (mod.meta as any).__schema = true;
  (mod.meta as any).__schemaKind = "pressYourLuck";
  return mod;
}

export const __pylInternals = { buildDeck, deckTotalOf: (s: PressYourLuckSpec) => s.deck.reduce((a, d) => a + d.count, 0) };

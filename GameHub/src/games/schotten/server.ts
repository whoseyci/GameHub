// games/schotten/server.ts — Schotten Totten (Reiner Knizia), base game.
// 2 players fight over 9 border stones. Each turn: place 1 clan card on your side
// of an unclaimed, non-full stone, then draw. Claim a stone when your 3-card
// formation beats the opponent's (or can be proven unbeatable). Win with 5 stones
// total or 3 adjacent stones.
import type { GameModule, GameView, GameViewState, GameLifecyclePhase } from "../types";
import { makeSeed, shuffleInPlace, type RngStateHolder } from "../../rng";
import { mapPhase } from "../types";
import { SchottenMeta } from "./meta";

const COLORS = ["red", "orange", "yellow", "green", "blue", "purple"] as const;
type Color = typeof COLORS[number];
interface Card { id: string; v: number; c: Color; }

interface SchottenPlayer {
  name: string;
  hand: Card[];
}
// Each stone has two sides (one per player) + a claim owner (-1 unclaimed).
interface Stone {
  sides: [Card[], Card[]];      // sides[playerIndex]
  claimedBy: number;            // -1, 0, or 1
  fullAt: [number, number];     // seq# when each side reached 3 cards (tie-break)
}

interface SchottenState extends RngStateHolder {
  schemaVersion: number;
  players: SchottenPlayer[];
  deck: Card[];
  stones: Stone[];
  current: number;
  phase: "PLAY" | "GAME_OVER";
  placedThisTurn: boolean;      // must place before claiming/ending; one place per turn
  seq: number;                  // monotonic counter for "who completed first" tie-break
  winner: number;               // -1 until someone wins
  lastAction: any;              // for the client animation (placed/claimed)
  log: unknown[];
}

const HAND_SIZE = 6;
const STONES = 9;
// "Not yet completed" sentinel for fullAt[]. Must be a finite, JSON-serializable
// number (Infinity serializes to null and breaks the state-roundtrip contract).
const NOT_FULL = Number.MAX_SAFE_INTEGER;

function buildDeck(rng: RngStateHolder): Card[] {
  const d: Card[] = [];
  for (const c of COLORS) for (let v = 1; v <= 9; v++) d.push({ id: `st_${c}_${v}`, v, c });
  shuffleInPlace(d, rng);
  return d;
}

function draw(s: SchottenState): Card | null {
  return s.deck.length ? s.deck.pop()! : null; // deck can run dry; then no refill
}

/* ---------- Formation evaluation (poker-like) ---------- */
// Rank: 5 color-run > 4 three-of-a-kind > 3 color(flush) > 2 run > 1 sum.
// A formation score is [rank, sum] compared lexicographically.
function formationScore(cards: Card[]): [number, number] {
  const sum = cards.reduce((a, c) => a + c.v, 0);
  if (cards.length < 3) return [1, sum]; // incomplete → treated as sum for partial compare
  const vals = cards.map((c) => c.v).sort((a, b) => a - b);
  const sameColor = cards.every((c) => c.c === cards[0].c);
  const run = vals[0] + 1 === vals[1] && vals[1] + 1 === vals[2];
  const trips = vals[0] === vals[1] && vals[1] === vals[2];
  let rank = 1;
  if (run && sameColor) rank = 5;
  else if (trips) rank = 4;
  else if (sameColor) rank = 3;
  else if (run) rank = 2;
  return [rank, sum];
}
function cmpScore(a: [number, number], b: [number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  return a[1] - b[1];
}

// Best score the side COULD still reach given current cards + the cards still
// available in the deck/opponent hands (i.e. not visible on the table). Used to
// prove an opponent cannot beat a completed formation (early claim).
function bestPossible(side: Card[], availableByColor: Map<Color, Set<number>>): [number, number] {
  if (side.length >= 3) return formationScore(side);
  // brute force: try filling remaining slots with available cards to maximize score.
  const need = 3 - side.length;
  // Candidate pool = all available (color,value) still in play.
  const pool: Card[] = [];
  for (const c of COLORS) for (const v of availableByColor.get(c) ?? []) pool.push({ id: "x", v, c });
  let best: [number, number] = [0, 0];
  const choose = (start: number, picked: Card[]) => {
    if (picked.length === need) {
      const sc = formationScore([...side, ...picked]);
      if (cmpScore(sc, best) > 0) best = sc;
      return;
    }
    for (let i = start; i < pool.length; i++) choose(i + 1, [...picked, pool[i]]);
  };
  if (pool.length) choose(0, []); else best = formationScore(side);
  return best;
}

// All (color,value) cards NOT visible on the table (so still potentially drawable
// by either side). Used for the early-claim proof.
function unseenByColor(s: SchottenState): Map<Color, Set<number>> {
  const m = new Map<Color, Set<number>>();
  for (const c of COLORS) m.set(c, new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]));
  for (const st of s.stones) for (const side of st.sides) for (const card of side) m.get(card.c)!.delete(card.v);
  return m;
}

function canClaim(s: SchottenState, stoneIdx: number, claimer: number): boolean {
  const st = s.stones[stoneIdx];
  if (st.claimedBy >= 0) return false;
  const mine = st.sides[claimer];
  const theirs = st.sides[1 - claimer];
  if (mine.length < 3) return false; // you must have a complete formation to claim
  const myScore = formationScore(mine);
  if (theirs.length >= 3) {
    const ts = formationScore(theirs);
    if (cmpScore(myScore, ts) > 0) return true;
    if (cmpScore(myScore, ts) < 0) return false;
    // tie → whoever completed 3rd card first
    return st.fullAt[claimer] < st.fullAt[1 - claimer];
  }
  // Opponent incomplete: claim only if they CANNOT beat or tie me with any fill.
  const unseen = unseenByColor(s);
  const best = bestPossible(theirs, unseen);
  // I claim if their best possible is strictly worse than mine (ties go to first-full,
  // which they can't satisfy since they're incomplete → they'd need to strictly beat).
  return cmpScore(myScore, best) > 0 || (cmpScore(myScore, best) === 0);
}

// Can `seat` legally place any hand card on any unclaimed, non-full stone?
function canPlaceAny(s: SchottenState, seat: number): boolean {
  if (s.players[seat].hand.length === 0) return false;
  return s.stones.some((st) => st.claimedBy < 0 && st.sides[seat].length < 3);
}
// Terminal stall: the deck is empty and NEITHER player can place anymore. The
// game ends; whoever controls more stones wins (ties → no winner / draw).
function checkStall(s: SchottenState): void {
  if (s.phase !== "PLAY") return;
  if (s.deck.length > 0) return;
  if (canPlaceAny(s, 0) || canPlaceAny(s, 1)) return;
  s.phase = "GAME_OVER";
  const c0 = s.stones.filter((st) => st.claimedBy === 0).length;
  const c1 = s.stones.filter((st) => st.claimedBy === 1).length;
  s.winner = c0 === c1 ? -1 : (c0 > c1 ? 0 : 1);
}

function checkWin(s: SchottenState): void {
  for (let p = 0; p < 2; p++) {
    const claimed = s.stones.map((st, i) => (st.claimedBy === p ? i : -1)).filter((i) => i >= 0);
    if (claimed.length >= 5) { s.phase = "GAME_OVER"; s.winner = p; return; }
    // 3 adjacent
    for (let i = 0; i + 2 < STONES; i++) {
      if (s.stones[i].claimedBy === p && s.stones[i + 1].claimedBy === p && s.stones[i + 2].claimedBy === p) {
        s.phase = "GAME_OVER"; s.winner = p; return;
      }
    }
  }
}

// Personalize lastAction for one viewer: the freshly drawn card on an "end" action
// is hidden info, so non-drawers receive `drew: null` (they still get the seq/type
// so their client can react). The drawer keeps the real card to fly deck→hand.
function redactLastAction(la: any, seat: number): any {
  if (!la) return la;
  if (la.type === "end" && la.player !== seat) {
    const { drew, ...rest } = la;
    return { ...rest, drew: null };
  }
  return la;
}

export const Schotten: GameModule = {
  meta: SchottenMeta,

  create(names: string[]): SchottenState {
    const rng = { rngState: makeSeed() };
    const deck = buildDeck(rng);
    const players: SchottenPlayer[] = names.slice(0, 2).map((name) => ({ name, hand: [] }));
    for (const p of players) for (let i = 0; i < HAND_SIZE; i++) { const c = deck.pop(); if (c) p.hand.push(c); }
    return {
      schemaVersion: 1,
      rngState: rng.rngState,
      players,
      deck,
      stones: Array.from({ length: STONES }, () => ({ sides: [[], []] as [Card[], Card[]], claimedBy: -1, fullAt: [NOT_FULL, NOT_FULL] as [number, number] })),
      current: 0,
      phase: "PLAY",
      placedThisTurn: false,
      seq: 0,
      winner: -1,
      lastAction: null,
      log: [],
    };
  },

  applyAction(state: SchottenState, seat: number, msg: any): void {
    // "Play again": Schotten Totten is single-game (no rounds), so a fresh game is
    // dealt in place using the same players. The hub gates next_round to the host;
    // offline play routes it through the shared local-engine adapter.
    if (msg.action === "next_round") {
      if (state.phase !== "GAME_OVER") return;
      const fresh = Schotten.create(state.players.map((p) => p.name)) as SchottenState;
      Object.assign(state, fresh);
      return;
    }
    if (state.phase !== "PLAY") return;
    if (seat !== state.current) return;

    // PLACE a hand card (index) onto a stone (target), on your side.
    if (msg.action === "place" && !state.placedThisTurn) {
      const handIdx = msg.index | 0;
      const stoneIdx = msg.target | 0;
      const p = state.players[seat];
      if (handIdx < 0 || handIdx >= p.hand.length) return;
      const st = state.stones[stoneIdx];
      if (!st || st.claimedBy >= 0) return;
      if (st.sides[seat].length >= 3) return;
      const [card] = p.hand.splice(handIdx, 1);
      st.sides[seat].push(card);
      if (st.sides[seat].length === 3) st.fullAt[seat] = ++state.seq; else state.seq++;
      state.placedThisTurn = true;
      state.lastAction = { type: "place", player: seat, stone: stoneIdx, card, seq: state.seq };
      return;
    }

    // CLAIM a stone (target) — allowed after placing (or anytime in your turn).
    if (msg.action === "claim") {
      const stoneIdx = msg.target | 0;
      if (!state.stones[stoneIdx]) return;
      if (!canClaim(state, stoneIdx, seat)) return;
      state.stones[stoneIdx].claimedBy = seat;
      state.lastAction = { type: "claim", player: seat, stone: stoneIdx, seq: ++state.seq };
      checkWin(state);
      return;
    }

    // END turn (draw + pass). Normally you must place first; but if you have NO
    // legal placement (deck empty / all your sides full on unclaimed stones), you
    // may end without placing so the game can't deadlock.
    if (msg.action === "end" && (state.placedThisTurn || !canPlaceAny(state, seat))) {
      const c = draw(state);
      if (c) state.players[seat].hand.push(c);
      state.placedThisTurn = false;
      state.current = (state.current + 1) % 2;
      // Expose the drawn card so the client can fly it deck→hand for the player who
      // drew it (only that player's view should reveal its face — see viewFor).
      state.lastAction = { type: "end", player: seat, drew: c ?? null, seq: ++state.seq };
      checkStall(state); // deck empty + nobody can place → end by stone count
      return;
    }

    // host-only between-rounds / restart handled by hub (no rounds in base game).
  },

  viewFor(state: SchottenState, seat: number): GameView {
    const over = state.phase === "GAME_OVER";
    let summary;
    if (over) {
      summary = {
        rows: state.players.map((p, i) => ({
          seat: i, name: p.name,
          score: state.stones.filter((st) => st.claimedBy === i).length,
        })),
        winners: state.winner >= 0 ? [state.winner] : [],
      };
    }
    return {
      game: "schotten",
      phase: mapPhase(state.phase),
      over,
      yourSeat: seat,
      summary,
      state: buildViewState(state),
      schotten: {
        current: state.current,
        placedThisTurn: state.placedThisTurn,
        deckCount: state.deck.length,
        winner: state.winner,
        viewerSeat: seat,
        // Per-seat lastAction: the drawn card (`drew`) is private — only the player
        // who drew it sees its face; everyone else just learns that a draw happened.
        lastAction: redactLastAction(state.lastAction, seat),
        // Stones: both sides' cards are public (face-up on the table).
        stones: state.stones.map((st) => ({
          claimedBy: st.claimedBy,
          sides: [st.sides[0].map(pub), st.sides[1].map(pub)],
        })),
        players: state.players.map((p, i) => ({
          seat: i,
          name: p.name,
          handCount: p.hand.length,
          stonesWon: state.stones.filter((st) => st.claimedBy === i).length,
          // Only the viewer sees their own hand.
          hand: i === seat ? p.hand.map(pub) : null,
        })),
      },
    };
  },

  // State migration (Proposal 3): schema is current — no-op. Future schema bumps
  // (e.g. adding a field) would back-fill it here so in-progress rooms survive a deploy.
  migrate(_state: any) { /* schemaVersion 1 — current */ },
  isOver(state: SchottenState): boolean { return state.phase === "GAME_OVER"; },

  // API-8: enumerate every legal action `seat` could take now. Drives the
  // client's "valid drop-target" highlights and the BotDriver's random-legal
  // fallback. Pure read; never mutates. Returns [] when it isn't `seat`'s turn.
  legalActions(state: SchottenState, seat: number) {
    if (state.phase !== "PLAY") return [];
    if (seat !== state.current) return [];
    const out: any[] = [];
    const p = state.players[seat];
    if (!p) return out;
    if (!state.placedThisTurn) {
      // Every (handCard × valid stone) pair.
      for (let h = 0; h < p.hand.length; h++) {
        for (let s = 0; s < state.stones.length; s++) {
          const st = state.stones[s];
          if (st.claimedBy >= 0) continue;
          if (st.sides[seat].length >= 3) continue;
          out.push({ action: "place", index: h, target: s });
        }
      }
    }
    // Claim — only stones we can prove won.
    for (let s = 0; s < state.stones.length; s++) {
      if (canClaim(state, s, seat)) out.push({ action: "claim", target: s });
    }
    // End the turn (legal once placed, or when no placement is possible).
    if (state.placedThisTurn || !canPlaceAny(state, seat)) {
      out.push({ action: "end" });
    }
    return out;
  },

  summarize(state: SchottenState) {
    return { current: state.current, winner: state.winner,
      claimed: state.stones.map((st) => st.claimedBy) };
  },
};

function pub(c: Card) { return { id: c.id, v: c.v, c: c.c }; }


/** Build a standardized GameViewState so the hub stays game-agnostic. */
function buildViewState(state: SchottenState): GameViewState {
  return {
    currentSeat: state.phase === "PLAY" ? state.current : -1,
    pendingAction: state.phase === "PLAY" ? (state.placedThisTurn ? "claim_or_end" : "place") : null,
    players: state.players.map((p, i) => ({
      seat: i,
      name: p.name,
      status: state.phase === "PLAY" ? (i === state.current ? "active" : "waiting") : "out",
      score: state.stones.filter((st) => st.claimedBy === i).length,
    })),
    actingCount: state.phase === "PLAY" ? 1 : 0,
  };
}

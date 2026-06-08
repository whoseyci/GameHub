// games/flip7.ts — Flip 7 with an EVENT-SEQUENCE model so the client can play a
// dramatic, card-by-card animation timeline (wiggle-by-bust-probability, slow
// Flip-Three reveals that abandon on bust, cards flying between players, etc.).
//
// Each action produces `state.events` — an ordered list the client replays. The
// final `state` is authoritative; `events` describe how we got there.
import type { GameModule, GameView } from "./types";
import { makeSeed, shuffleInPlace, type RngStateHolder } from "../rng";

type CardKind = "num" | "mod" | "act";
interface Card { kind: CardKind; v: number | string; }

interface Player {
  name: string; nums: number[]; mods: string[];
  secondChance: boolean;
  status: "active" | "stayed" | "busted";
  bustCard: number | null;
  banked: number;
  roundScore: number;
}
// pendingAction kinds:
//   freeze/flip3  -> choose a target to apply to
//   give_second   -> choose an active opponent to hand a duplicate Second Chance
interface State extends RngStateHolder {
  schemaVersion: number;
  players: Player[];
  deck: Card[]; discard: Card[];
  current: number;
  phase: "PLAY" | "ROUND_END" | "GAME_OVER";
  round: number;
  pendingAction: null | { kind: "freeze" | "flip3" | "give_second"; from: number };
  flip3Left: number; flip3Target: number;
  events: any[];       // replay timeline for the client (cleared each applyAction)
  seq: number;         // monotonically increasing so the client can dedupe
  log: any;            // last event (back-compat / quick checks)
}

function buildDeck(rng: RngStateHolder): Card[] {
  const d: Card[] = [];
  d.push({ kind: "num", v: 0 });
  for (let n = 1; n <= 12; n++) for (let i = 0; i < n; i++) d.push({ kind: "num", v: n });
  for (const m of ["+2", "+4", "+6", "+8", "+10", "x2"]) d.push({ kind: "mod", v: m });
  for (const a of ["freeze", "flip3", "second"]) for (let i = 0; i < 3; i++) d.push({ kind: "act", v: a });
  shuffleInPlace(d, rng);
  return d;
}
function newPlayer(name: string, banked = 0): Player {
  return { name, nums: [], mods: [], secondChance: false, status: "active", bustCard: null, banked, roundScore: 0 };
}

function emit(s: State, e: any) { e.seq = ++s.seq; s.events.push(e); s.log = e; }

function fresh(names: string[], banked: number[], rngState = makeSeed()): State {
  const rng = { rngState };
  const deck = buildDeck(rng);
  const players = names.map((n, i) => newPlayer(n, banked[i] ?? 0));
  const s: State = {
    schemaVersion: 1,
    rngState: rng.rngState,
    players, deck, discard: [], current: 0, phase: "PLAY", round: 1,
    pendingAction: null, flip3Left: 0, flip3Target: -1, events: [], seq: 0, log: null,
  };
  // Opening deal: one NUMBER/MOD card each (action cards reshuffled so nobody
  // starts frozen). No drama events for the opening deal.
  for (let i = 0; i < players.length; i++) {
    let c = draw(s); let guard = 0;
    while (c.kind === "act" && guard++ < 200) { s.deck.unshift(c); shuffleInPlace(s.deck, s); c = draw(s); }
    placeCard(s, i, c);
  }
  s.current = firstActive(s, 0);
  return s;
}

// Discard only reshuffles when the deck is fully empty (card-counting friendly).
function draw(s: State): Card {
  if (s.deck.length === 0) { s.deck = s.discard; s.discard = []; shuffleInPlace(s.deck, s); emit(s, { type: "reshuffle" }); }
  return s.deck.pop()!;
}
function firstActive(s: State, from: number): number {
  for (let k = 0; k < s.players.length; k++) { const i = (from + k) % s.players.length; if (s.players[i].status === "active") return i; }
  return from;
}
function activeCount(s: State) { return s.players.filter((p) => p.status === "active").length; }
function activeOthers(s: State, exclude: number) { return s.players.map((p, i) => i).filter((i) => i !== exclude && s.players[i].status === "active"); }
function uniqueCount(p: Player) { return new Set(p.nums).size; }

// Bust probability for player `pi` BEFORE drawing the next card, given remaining
// deck composition. = (count of number cards in the deck whose value the player
// already holds) / (deck size). Used by the client to scale the wiggle/suspense.
function bustProbability(s: State, pi: number): number {
  const p = s.players[pi];
  const total = s.deck.length || 1;
  let dupes = 0;
  for (const c of s.deck) if (c.kind === "num" && p.nums.includes(c.v as number)) dupes++;
  return dupes / total;
}

// Place a card WITHOUT drama (used for opening deal & internal updates).
function placeCard(s: State, pi: number, card: Card) {
  const p = s.players[pi];
  if (card.kind === "num") { if (!p.nums.includes(card.v as number)) { p.nums.push(card.v as number); p.nums.sort((a, b) => a - b); } }
  else if (card.kind === "mod") p.mods.push(card.v as string);
  else if (card.v === "second") p.secondChance = true;
}

// Resolve a single drawn card WITH events. Returns "ok"|"bust"|"flip7"|"action".
function applyDrawnCard(s: State, pi: number, card: Card, opts: { flip3?: boolean } = {}): string {
  const p = s.players[pi];
  if (card.kind === "num") {
    const n = card.v as number;
    if (p.nums.includes(n)) {
      if (p.secondChance) {
        p.secondChance = false; s.discard.push(card);
        emit(s, { type: "second_used", player: pi, value: n, flip3: !!opts.flip3 });
        return "ok";
      }
      p.status = "busted"; p.bustCard = n;
      emit(s, { type: "bust", player: pi, value: n, flip3: !!opts.flip3 });
      return "bust";
    }
    p.nums.push(n); p.nums.sort((a, b) => a - b);
    emit(s, { type: "card", player: pi, card, flip3: !!opts.flip3 });
    if (uniqueCount(p) >= 7) { p.status = "stayed"; emit(s, { type: "flip7", player: pi }); return "flip7"; }
    return "ok";
  }
  if (card.kind === "mod") { p.mods.push(card.v as string); emit(s, { type: "card", player: pi, card, flip3: !!opts.flip3 }); return "ok"; }
  // action card
  const a = card.v as string;
  if (a === "second") {
    if (!p.secondChance) { p.secondChance = true; emit(s, { type: "card", player: pi, card }); return "ok"; }
    // already holding one: must give to an active opponent.
    const others = activeOthers(s, pi).filter((i) => !s.players[i].secondChance);
    if (others.length === 0) { s.discard.push(card); emit(s, { type: "second_discard", player: pi }); return "ok"; }
    if (others.length === 1) { s.players[others[0]].secondChance = true; emit(s, { type: "second_pass", from: pi, to: others[0], auto: true }); return "ok"; }
    s.pendingAction = { kind: "give_second", from: pi };
    emit(s, { type: "await_target", kind: "give_second", from: pi });
    return "action";
  }
  // freeze / flip3
  emit(s, { type: "action_card", player: pi, kind: a }); // the action card appears on the drawer
  // If the drawer is the ONLY active player, it must target themselves — auto after a beat.
  const others = activeOthers(s, pi);
  if (others.length === 0) {
    resolveAction(s, pi, a as any, pi, true);
    return "ok";
  }
  s.pendingAction = { kind: a as any, from: pi };
  emit(s, { type: "await_target", kind: a, from: pi });
  return "action";
}

function resolveAction(s: State, from: number, kind: "freeze" | "flip3", target: number, auto = false): string {
  s.pendingAction = null;
  const tp = s.players[target];
  if (kind === "freeze") {
    emit(s, { type: "play_action", kind: "freeze", from, target, auto });
    if (tp.status === "active") { tp.status = "stayed"; emit(s, { type: "freeze_done", target }); }
    return "ok";
  }
  emit(s, { type: "play_action", kind: "flip3", from, target, auto });
  s.flip3Left = 3; s.flip3Target = target;
  runFlip3(s);
  return "ok";
}

// Flip Three: reveal up to 3, ABANDON immediately on bust/flip7. Each draw is its
// own event so the client can reveal them one slow card at a time.
function runFlip3(s: State) {
  while (s.flip3Left > 0) {
    const t = s.flip3Target; const tp = s.players[t];
    if (!tp || tp.status !== "active") break;
    s.flip3Left--;
    const r = applyDrawnCard(s, t, draw(s), { flip3: true });
    if (r === "bust" || r === "flip7") { emit(s, { type: "flip3_abandon", target: t }); break; }
    if (r === "action") {
      // nested freeze/flip3/second drawn during the flip-three:
      const pa = s.pendingAction;
      if (pa) {
        if (pa.kind === "give_second") {
          // can't pause a flip3 for a choice — auto-give or discard.
          const others = activeOthers(s, pa.from).filter((i) => !s.players[i].secondChance);
          s.pendingAction = null;
          if (others.length) { s.players[others[0]].secondChance = true; emit(s, { type: "second_pass", from: pa.from, to: others[0], auto: true }); }
          else emit(s, { type: "second_discard", player: pa.from });
        } else {
          // freeze/flip3 drawn within flip3 -> apply to self (rules: resolve in order)
          resolveAction(s, pa.from, pa.kind, pa.from, true);
        }
      }
    }
  }
  s.flip3Left = 0; s.flip3Target = -1;
}

function endTurnAdvance(s: State) {
  if (activeCount(s) === 0) { scoreRound(s); return; }
  s.current = firstActive(s, (s.current + 1) % s.players.length);
}

function scoreRound(s: State) {
  let flip7Bonus = -1;
  for (let i = 0; i < s.players.length; i++) {
    const p = s.players[i];
    if (p.status === "busted") { p.roundScore = 0; continue; }
    const u = uniqueCount(p);
    let base = p.nums.reduce((a, b) => a + b, 0);
    if (p.mods.includes("x2")) base *= 2;
    for (const m of p.mods) if (m.startsWith("+")) base += parseInt(m.slice(1));
    if (u >= 7) { base += 15; flip7Bonus = i; }
    p.roundScore = base; p.banked += base;
  }
  s.pendingAction = null; s.flip3Left = 0; s.flip3Target = -1;
  s.phase = s.players.some((p) => p.banked >= 200) ? "GAME_OVER" : "ROUND_END";
  const max = Math.max(...s.players.map((p) => p.banked));
  emit(s, { type: s.phase === "GAME_OVER" ? "game_over" : "round_end",
    winners: s.players.map((p, i) => (p.banked === max ? i : -1)).filter((i) => i >= 0), flip7: flip7Bonus });
}

export const Flip7: GameModule = {
  meta: { id: "flip7", name: "Flip 7", minPlayers: 2, maxPlayers: 8,
    description: "Push your luck — flip cards, don't repeat a number, race to 200.", emoji: "🎴" },

  create(names) { return fresh(names, names.map(() => 0)); },

  applyAction(state: State, seat, msg) {
    state.events = []; // fresh timeline for this action
    if (state.phase !== "PLAY") {
      if (msg.action === "next_round") {
        const over = state.phase === "GAME_OVER";
        const banked = state.players.map((p) => p.banked);
        const ns = fresh(state.players.map((p) => p.name), over ? state.players.map(() => 0) : banked, state.rngState);
        ns.seq = state.seq + 1;
        if (!over) ns.round = state.round + 1;
        Object.assign(state, ns);
      }
      return;
    }
    if (state.pendingAction) {
      const pa = state.pendingAction;
      if (msg.action === "target" && pa.from === seat) {
        const t = Math.max(0, Math.min(state.players.length - 1, msg.target | 0));
        if (state.players[t].status !== "active") return; // only active targets
        if (pa.kind === "give_second") {
          if (t === seat) return;
          state.pendingAction = null;
          state.players[t].secondChance = true;
          emit(state, { type: "second_pass", from: seat, to: t, auto: false });
          // giving a second chance does NOT end your turn — you keep playing
        } else {
          resolveAction(state, seat, pa.kind, t);
          endTurnAdvance(state);
        }
      }
      return;
    }
    if (seat !== state.current || state.players[seat].status !== "active") return;
    if (msg.action === "stay") {
      state.players[seat].status = "stayed";
      emit(state, { type: "stay", player: seat });
      endTurnAdvance(state);
    } else if (msg.action === "hit") {
      const prob = bustProbability(state, seat);
      const card = draw(state);
      // emit the draw intent FIRST (client wiggles based on prob, then reveals)
      emit(state, { type: "draw_start", player: seat, prob });
      const r = applyDrawnCard(state, seat, card);
      if (r === "action") return;       // wait for target / give choice
      endTurnAdvance(state);
    }
  },

  isOver(state: State) { return state.phase === "GAME_OVER"; },
  joinScore(state: State) { return Math.round(state.players.reduce((a, p) => a + p.banked, 0) / Math.max(1, state.players.length)); },
  addPlayer(state: State, name, startScore) {
    const p = newPlayer(name, Math.round(startScore) || 0); p.status = "busted"; state.players.push(p);
  },

  viewFor(state: State, seat): GameView {
    const over = state.phase === "GAME_OVER";
    let summary;
    if (state.phase === "ROUND_END" || state.phase === "GAME_OVER") {
      const max = Math.max(...state.players.map((p) => p.banked));
      summary = {
        rows: state.players.map((p, i) => ({ seat: i, name: p.name, score: p.banked, delta: p.roundScore })),
        winners: state.players.map((p, i) => (p.banked === max ? i : -1)).filter((i) => i >= 0),
      };
    }
    return {
      game: "flip7", phase: state.phase, over, yourSeat: seat, summary,
      flip7: {
        round: state.round, current: state.current, phase: state.phase,
        pendingAction: state.pendingAction, viewerSeat: seat,
        deckCount: state.deck.length, discardCount: state.discard.length,
        seq: state.seq, events: state.events,
        players: state.players.map((p) => ({
          name: p.name, nums: p.nums, mods: p.mods, second: p.secondChance,
          status: p.status, bustCard: p.bustCard, banked: p.banked, unique: uniqueCount(p),
          live: liveScore(p),
        })),
      },
    };
  },
};

function liveScore(p: Player): number {
  if (p.status === "busted") return 0;
  let base = p.nums.reduce((a, b) => a + b, 0);
  if (p.mods.includes("x2")) base *= 2;
  for (const m of p.mods) if (m.startsWith("+")) base += parseInt(m.slice(1));
  if (new Set(p.nums).size >= 7) base += 15;
  return base;
}

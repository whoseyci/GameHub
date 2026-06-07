// games/flip7.ts — Flip 7 implemented against the GameModule contract.
// Push-your-luck: hit or stay; duplicate number = bust; 7 unique numbers = +15
// and the round ends. First to 200 wins. Includes Freeze / Flip Three / Second
// Chance action cards and +/x2 modifiers.
import type { GameModule, GameView } from "./types";

type CardKind = "num" | "mod" | "act";
interface Card { kind: CardKind; v: number | string; } // num:0..12, mod:'+2'..'+10'|'x2', act:'freeze'|'flip3'|'second'

interface Player {
  name: string; nums: number[]; mods: string[];
  secondChance: boolean;     // holds an unused Second Chance
  status: "active" | "stayed" | "busted" | "frozen";
  banked: number;            // cumulative total across rounds
  roundScore: number;
}
interface State {
  players: Player[];
  deck: Card[]; discard: Card[];
  current: number;           // whose turn
  phase: "PLAY" | "ROUND_END" | "GAME_OVER";
  round: number;
  pendingAction: null | { kind: "freeze" | "flip3"; from: number }; // awaiting a target choice
  flip3Left: number; flip3Target: number; // active Flip Three sequence
  log: any;                  // lastAction for client animations
}

function buildDeck(): Card[] {
  const d: Card[] = [];
  d.push({ kind: "num", v: 0 });
  for (let n = 1; n <= 12; n++) for (let i = 0; i < n; i++) d.push({ kind: "num", v: n });
  for (const m of ["+2", "+4", "+6", "+8", "+10", "x2"]) d.push({ kind: "mod", v: m });
  for (const a of ["freeze", "flip3", "second"]) for (let i = 0; i < 3; i++) d.push({ kind: "act", v: a });
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
function fresh(names: string[], banked: number[]): State {
  const deck = buildDeck();
  const players: Player[] = names.map((n, i) => ({
    name: n, nums: [], mods: [], secondChance: false, status: "active",
    banked: banked[i] ?? 0, roundScore: 0,
  }));
  const s: State = {
    players, deck, discard: [], current: 0, phase: "PLAY", round: 1,
    pendingAction: null, flip3Left: 0, flip3Target: -1, log: null,
  };
  // initial face-up card to each (resolve simply: numbers/mods placed; actions go to that player)
  for (let i = 0; i < players.length; i++) giveCard(s, i, draw(s), true);
  s.current = firstActive(s, 0);
  return s;
}
function draw(s: State): Card {
  if (s.deck.length === 0) { s.deck = s.discard; s.discard = []; for (let i = s.deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [s.deck[i], s.deck[j]] = [s.deck[j], s.deck[i]]; } }
  return s.deck.pop()!;
}
function firstActive(s: State, from: number): number {
  for (let k = 0; k < s.players.length; k++) { const i = (from + k) % s.players.length; if (s.players[i].status === "active") return i; }
  return from;
}
function activeCount(s: State) { return s.players.filter((p) => p.status === "active").length; }
function uniqueCount(p: Player) { return new Set(p.nums).size; }

// Place a card on a player. `initialDeal` true skips turn flow.
// Returns "bust" | "flip7" | "ok" | "action" (action awaiting target).
function giveCard(s: State, pi: number, card: Card, initialDeal = false): string {
  const p = s.players[pi];
  if (card.kind === "num") {
    const n = card.v as number;
    if (p.nums.includes(n)) {
      if (p.secondChance) { p.secondChance = false; s.discard.push(card); s.log = { type: "second_used", player: pi }; return "ok"; }
      // bust
      p.status = "busted"; s.discard.push(...p.nums.map((x) => ({ kind: "num", v: x } as Card)), card);
      p.nums = []; p.mods = []; s.log = { type: "bust", player: pi, value: n }; return "bust";
    }
    p.nums.push(n); p.nums.sort((a, b) => a - b);
    s.log = { type: "got", player: pi, card };
    if (uniqueCount(p) >= 7) { p.status = "stayed"; s.log = { type: "flip7", player: pi }; return "flip7"; }
    return "ok";
  }
  if (card.kind === "mod") { p.mods.push(card.v as string); s.log = { type: "got", player: pi, card }; return "ok"; }
  // action
  const a = card.v as string;
  if (a === "second") {
    if (!p.secondChance) { p.secondChance = true; s.log = { type: "got", player: pi, card }; return "ok"; }
    // already has one -> give to another active player without one, else discard
    const t = s.players.findIndex((q, i) => i !== pi && q.status === "active" && !q.secondChance);
    if (t >= 0) { s.players[t].secondChance = true; s.log = { type: "second_pass", from: pi, to: t }; }
    else s.discard.push(card);
    return "ok";
  }
  // freeze / flip3 need a target. On the initial deal, target self.
  if (initialDeal) { return resolveAction(s, pi, a as any, pi); }
  s.pendingAction = { kind: a as any, from: pi };
  s.log = { type: "await_target", kind: a, from: pi };
  return "action";
}

function resolveAction(s: State, from: number, kind: "freeze" | "flip3", target: number): string {
  s.pendingAction = null;
  const tp = s.players[target];
  if (kind === "freeze") {
    if (tp.status === "active") tp.status = "stayed"; // banks current cards at round end
    s.log = { type: "freeze", from, target };
    return "ok";
  }
  // flip3: target draws 3, resolving each; stops early on bust/flip7
  s.flip3Left = 3; s.flip3Target = target;
  s.log = { type: "flip3", from, target };
  runFlip3(s);
  return "ok";
}
function runFlip3(s: State) {
  while (s.flip3Left > 0) {
    const t = s.flip3Target; const tp = s.players[t];
    if (tp.status !== "active") { s.flip3Left = 0; break; }
    s.flip3Left--;
    const r = giveCard(s, t, draw(s));
    if (r === "bust" || r === "flip7") { s.flip3Left = 0; break; }
    if (r === "action") { /* nested action: target self for simplicity per “resolve after” rule */ const pa = s.pendingAction!; resolveAction(s, pa.from, pa.kind, pa.from); }
  }
}

function endTurnAdvance(s: State) {
  // round ends if a flip7 happened or no active players remain
  if (s.players.some((p) => uniqueCount(p) >= 7 && p.status === "stayed") && false) { /* handled inline */ }
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
  s.phase = s.players.some((p) => p.banked >= 200) ? "GAME_OVER" : "ROUND_END";
  const max = Math.max(...s.players.map((p) => p.banked));
  s.log = { type: s.phase === "GAME_OVER" ? "game_over" : "round_end",
    winners: s.players.map((p, i) => (p.banked === max ? i : -1)).filter((i) => i >= 0), flip7: flip7Bonus };
}

export const Flip7: GameModule = {
  meta: { id: "flip7", name: "Flip 7", minPlayers: 2, maxPlayers: 8,
    description: "Push your luck — flip cards, don't repeat a number, race to 200.", emoji: "🎴" },

  create(names) { return fresh(names, names.map(() => 0)); },

  applyAction(state: State, seat, msg) {
    if (state.phase !== "PLAY") {
      if (msg.action === "next_round") {
        const banked = state.players.map((p) => p.banked);
        const over = state.phase === "GAME_OVER";
        const ns = fresh(state.players.map((p) => p.name), over ? state.players.map(() => 0) : banked);
        if (!over) ns.round = state.round + 1;
        Object.assign(state, ns);
      }
      return;
    }
    // resolving an action card target?
    if (state.pendingAction) {
      if (msg.action === "target" && state.pendingAction.from === seat) {
        const t = Math.max(0, Math.min(state.players.length - 1, msg.target | 0));
        if (state.players[t].status === "active" || state.pendingAction.kind === "freeze") {
          resolveAction(state, seat, state.pendingAction.kind, t);
          endTurnAdvance(state);
        }
      }
      return;
    }
    if (seat !== state.current || state.players[seat].status !== "active") return;
    if (msg.action === "stay") {
      state.players[seat].status = "stayed";
      state.log = { type: "stay", player: seat };
      endTurnAdvance(state);
    } else if (msg.action === "hit") {
      const r = giveCard(state, seat, draw(state));
      if (r === "action") return;       // wait for target choice (same player)
      endTurnAdvance(state);
    }
  },

  isOver(state: State) { return state.phase === "GAME_OVER"; },
  joinScore(state: State) { return Math.round(state.players.reduce((a, p) => a + p.banked, 0) / Math.max(1, state.players.length)); },
  addPlayer(state: State, name, startScore) {
    state.players.push({ name, nums: [], mods: [], secondChance: false, status: "busted", banked: Math.round(startScore) || 0, roundScore: 0 });
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
    // Everything here is already public in Flip 7 (all cards are face up), so no hiding.
    return {
      game: "flip7", phase: state.phase, over, yourSeat: seat, summary,
      flip7: {
        round: state.round, current: state.current, phase: state.phase,
        pendingAction: state.pendingAction, viewerSeat: seat, deckCount: state.deck.length,
        players: state.players.map((p) => ({
          name: p.name, nums: p.nums, mods: p.mods, second: p.secondChance,
          status: p.status, banked: p.banked, unique: uniqueCount(p),
          live: liveScore(p),
        })),
        log: state.log,
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

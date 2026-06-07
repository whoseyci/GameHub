// games/flip7.ts — Flip 7 implemented against the GameModule contract.
// Push-your-luck: hit or stay; duplicate number = bust; 7 unique numbers = +15
// and the round ends. First to 200 wins. Includes Freeze / Flip Three / Second
// Chance action cards and +/x2 modifiers.
import type { GameModule, GameView } from "./types";

type CardKind = "num" | "mod" | "act";
interface Card { kind: CardKind; v: number | string; }

interface Player {
  name: string; nums: number[]; mods: string[];
  secondChance: boolean;
  status: "active" | "stayed" | "busted";
  bustCard: number | null;   // which duplicate number caused the bust (kept visible)
  banked: number;
  roundScore: number;
}
interface State {
  players: Player[];
  deck: Card[]; discard: Card[];
  current: number;
  phase: "PLAY" | "ROUND_END" | "GAME_OVER";
  round: number;
  pendingAction: null | { kind: "freeze" | "flip3"; from: number };
  flip3Left: number; flip3Target: number;
  drawing: Card | null;      // card currently being "dealt" (dealer-pile anticipation, client anim)
  log: any;
}

function buildDeck(): Card[] {
  const d: Card[] = [];
  d.push({ kind: "num", v: 0 });
  for (let n = 1; n <= 12; n++) for (let i = 0; i < n; i++) d.push({ kind: "num", v: n });
  for (const m of ["+2", "+4", "+6", "+8", "+10", "x2"]) d.push({ kind: "mod", v: m });
  for (const a of ["freeze", "flip3", "second"]) for (let i = 0; i < 3; i++) d.push({ kind: "act", v: a });
  shuffle(d);
  return d;
}
function shuffle(d: Card[]) {
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
}

function newPlayer(name: string, banked = 0): Player {
  return { name, nums: [], mods: [], secondChance: false, status: "active", bustCard: null, banked, roundScore: 0 };
}

function fresh(names: string[], banked: number[]): State {
  const deck = buildDeck();
  const players = names.map((n, i) => newPlayer(n, banked[i] ?? 0));
  const s: State = {
    players, deck, discard: [], current: 0, phase: "PLAY", round: 1,
    pendingAction: null, flip3Left: 0, flip3Target: -1, drawing: null, log: null,
  };
  // Initial face-up card to each player. NUMBER/MOD cards are placed normally.
  // ACTION cards on the opening deal are NOT auto-resolved (that caused players to
  // be "frozen/stayed" before ever taking a turn) — they are re-shuffled back so
  // everyone starts with a normal card.
  for (let i = 0; i < players.length; i++) {
    let c = draw(s);
    let guard = 0;
    while (c.kind === "act" && guard++ < 200) { s.deck.unshift(c); shuffle(s.deck); c = draw(s); }
    giveCard(s, i, c, true);
  }
  s.current = firstActive(s, 0);
  return s;
}

// IMPORTANT (#4): the discard is ONLY reshuffled into the deck when the deck is
// truly empty — so players can card-count what's already out.
function draw(s: State): Card {
  if (s.deck.length === 0) {
    s.deck = s.discard; s.discard = [];
    shuffle(s.deck);
    s.log = { type: "reshuffle" };
  }
  return s.deck.pop()!;
}
function firstActive(s: State, from: number): number {
  for (let k = 0; k < s.players.length; k++) { const i = (from + k) % s.players.length; if (s.players[i].status === "active") return i; }
  return from;
}
function activeCount(s: State) { return s.players.filter((p) => p.status === "active").length; }
function uniqueCount(p: Player) { return new Set(p.nums).size; }

// Returns "bust" | "flip7" | "ok" | "action".
function giveCard(s: State, pi: number, card: Card, initialDeal = false): string {
  const p = s.players[pi];
  if (card.kind === "num") {
    const n = card.v as number;
    if (p.nums.includes(n)) {
      if (p.secondChance) { p.secondChance = false; s.discard.push(card); s.log = { type: "second_used", player: pi, value: n }; return "ok"; }
      // BUST — keep the cards visible (#1). Mark the offending card; do NOT clear nums/mods.
      p.status = "busted"; p.bustCard = n;
      s.log = { type: "bust", player: pi, value: n };
      return "bust";
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
    const t = s.players.findIndex((q, i) => i !== pi && q.status === "active" && !q.secondChance);
    if (t >= 0) { s.players[t].secondChance = true; s.log = { type: "second_pass", from: pi, to: t }; }
    else s.discard.push(card);
    return "ok";
  }
  // freeze / flip3 need a target.
  if (initialDeal) return "ok"; // (opening deal actions are filtered out in fresh())
  s.pendingAction = { kind: a as any, from: pi };
  s.log = { type: "await_target", kind: a, from: pi };
  return "action";
}

function resolveAction(s: State, from: number, kind: "freeze" | "flip3", target: number): string {
  s.pendingAction = null;
  const tp = s.players[target];
  if (kind === "freeze") {
    // BUGFIX (#5): only an ACTIVE player can be frozen.
    if (tp.status === "active") { tp.status = "stayed"; s.log = { type: "freeze", from, target }; }
    else s.log = { type: "freeze_void", from, target };
    return "ok";
  }
  s.flip3Left = 3; s.flip3Target = target;
  s.log = { type: "flip3", from, target };
  runFlip3(s);
  return "ok";
}
function runFlip3(s: State) {
  while (s.flip3Left > 0) {
    const t = s.flip3Target; const tp = s.players[t];
    if (!tp || tp.status !== "active") { s.flip3Left = 0; s.flip3Target = -1; break; }
    s.flip3Left--;
    const r = giveCard(s, t, draw(s));
    if (r === "bust" || r === "flip7") { s.flip3Left = 0; s.flip3Target = -1; break; }
    if (r === "action") { const pa = s.pendingAction!; resolveAction(s, pa.from, pa.kind, pa.from); }
  }
  // ensure no flip3 state lingers
  if (s.flip3Left <= 0) { s.flip3Left = 0; s.flip3Target = -1; }
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
  // BUGFIX (#5): clear any transient action state so nothing carries into next round.
  s.pendingAction = null; s.flip3Left = 0; s.flip3Target = -1; s.drawing = null;
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
        const over = state.phase === "GAME_OVER";
        const banked = state.players.map((p) => p.banked);
        const ns = fresh(state.players.map((p) => p.name), over ? state.players.map(() => 0) : banked);
        if (!over) ns.round = state.round + 1;
        Object.assign(state, ns);
      }
      return;
    }
    if (state.pendingAction) {
      if (msg.action === "target" && state.pendingAction.from === seat) {
        const t = Math.max(0, Math.min(state.players.length - 1, msg.target | 0));
        const kind = state.pendingAction.kind;
        // valid targets: freeze -> active only; flip3 -> active only.
        if (state.players[t].status === "active") {
          resolveAction(state, seat, kind, t);
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
      if (r === "action") return; // wait for target choice (same player)
      endTurnAdvance(state);
    }
  },

  isOver(state: State) { return state.phase === "GAME_OVER"; },
  joinScore(state: State) { return Math.round(state.players.reduce((a, p) => a + p.banked, 0) / Math.max(1, state.players.length)); },
  addPlayer(state: State, name, startScore) {
    const p = newPlayer(name, Math.round(startScore) || 0); p.status = "busted";
    state.players.push(p);
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
        players: state.players.map((p) => ({
          name: p.name, nums: p.nums, mods: p.mods, second: p.secondChance,
          status: p.status, bustCard: p.bustCard, banked: p.banked, unique: uniqueCount(p),
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

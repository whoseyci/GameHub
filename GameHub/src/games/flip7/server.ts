// games/flip7.ts — Flip 7 with an EVENT-SEQUENCE model so the client can play a
// dramatic, card-by-card animation timeline (wiggle-by-bust-probability, slow
// Flip-Three reveals that abandon on bust, cards flying between players, etc.).
//
// Each action produces `state.events` — an ordered list the client replays. The
// final `state` is authoritative; `events` describe how we got there.
import type { GameModule, GameView, GameViewState } from "../types";
import { mapPhase } from "../types";
import { makeSeed, shuffleInPlace, type RngStateHolder } from "../../rng";


/** Build a standardized GameViewState so the hub stays game-agnostic. */
function buildViewState(s: State): GameViewState {
  const currentPlayer = s.phase === "PLAY" ? s.current : -1;
  return {
    currentSeat: s.pendingAction ? s.pendingAction.from : currentPlayer,
    pendingAction: s.pendingAction
      ? s.pendingAction.kind
      : s.phase === "PLAY" ? "draw_or_stay"
      : null,
    players: s.players.map((p, i) => ({
      seat: i,
      name: p.name,
      status: p.status,
      score: liveScore(p, s.variant),
      banked: p.banked,
    })),
    // Flip 7 is turn-based: exactly one seat acts at a time, or one seat is
    // choosing a pending action target.
    actingCount: (s.phase === "PLAY" && (s.pendingAction || currentPlayer >= 0)) ? 1 : 0,
    autoAdvanceMs: undefined,
  };
}

type CardKind = "num" | "mod" | "act";
type SpecialNumber = "zero" | "unlucky7" | "lucky13";
interface Card { id: string; kind: CardKind; v: number | string; special?: SpecialNumber; }

interface Player {
  name: string; nums: number[]; mods: string[]; tableau: Card[]; spentActions?: Card[];
  secondChance: boolean;
  hasLucky13?: boolean;
  mustHit?: boolean;
  status: "active" | "stayed" | "busted";
  bustCard: number | null;
  banked: number;
  roundScore: number;
}
// pendingAction kinds:
//   freeze/flip3/flip4 -> choose a target to apply to
//   give_second        -> choose an active opponent to hand a duplicate Second Chance
//   steal/discard/just1more -> choose a target
//   modifier           -> choose who receives a Vengeance modifier card
//   swap               -> choose a target to swap with (card-level selection is supported via cardId/cardId2)
type PendingAction = { kind: "freeze" | "flip3" | "flip4" | "give_second" | "steal" | "swap" | "discard" | "just1more" | "modifier"; from: number; card?: Card; target1?: number; cardId?: string };
interface State extends RngStateHolder {
  schemaVersion: number;
  players: Player[];
  deck: Card[]; discard: Card[];
  current: number;
  phase: "PLAY" | "ROUND_END" | "GAME_OVER";
  round: number;
  pendingAction: null | PendingAction;
  deferredActions?: PendingAction[];
  flip3Left: number; flip3Target: number;
  // Stack of suspended Flip-Three / Flip-Four frames so nested action cards can
  // pause for target choices. Vengeance Flip Four defers action/modifier target
  // choices until all four cards are revealed (unless the target busts / flips 7).
  flip3Stack?: Array<{ left: number; target: number; flip4?: boolean; delayed?: PendingAction[] }>;
  events: any[];       // replay timeline for the client (cleared each applyAction)
  seq: number;         // monotonically increasing so the client can dedupe
  log: any;            // last event (back-compat / quick checks)
  variant: string;
}

function buildDeck(rng: RngStateHolder, variant = "standard"): Card[] {
  const d: Card[] = [];
  let seq = 0;
  const safe = (v: number | string, special?: string) => String(special ?? v).replace(/\W/g, "");
  const add = (kind: CardKind, v: number | string, special?: SpecialNumber) =>
    d.push({ id: `f7c_${seq++}_${kind}_${safe(v, special)}`, kind, v, ...(special ? { special } : {}) });

  if (variant === "vengeance") {
    // Ruleset Edition 1: 108 cards total.
    // Number distribution is one 1, two 2s ... thirteen 13s, with the
    // Unlucky 7 replacing one regular 7 and Lucky 13 replacing one regular 13.
    // The 0 is the third Special Number card.
    add("num", 0, "zero");
    for (let n = 1; n <= 13; n++) {
      const copies = n - (n === 7 ? 1 : 0) - (n === 13 ? 1 : 0);
      for (let i = 0; i < copies; i++) add("num", n);
    }
    add("num", 7, "unlucky7");
    add("num", 13, "lucky13");

    // Modifier cards: two each -2/-4/-6/-8/-10, one ÷2.
    for (const m of ["-2", "-4", "-6", "-8", "-10"]) for (let i = 0; i < 2; i++) add("mod", m);
    add("mod", "div2");

    // Action cards: one each. No Freeze, Flip 3, or Second Chance in Vengeance.
    for (const a of ["just1more", "swap", "steal", "discard", "flip4"]) add("act", a);
  } else {
    add("num", 0);
    for (let n = 1; n <= 12; n++) for (let i = 0; i < n; i++) add("num", n);
    for (const m of ["+2", "+4", "+6", "+8", "+10", "x2"]) add("mod", m);
    for (const a of ["freeze", "flip3", "second"]) for (let i = 0; i < 3; i++) add("act", a);
  }
  shuffleInPlace(d, rng);
  return d;
}
function newPlayer(name: string, banked = 0): Player {
  return { name, nums: [], mods: [], tableau: [], spentActions: [], secondChance: false, status: "active", bustCard: null, banked, roundScore: 0 };
}

function normalizeFlip7Event(e: any): any {
  switch (e.type) {
    case "draw_start": return { type: "deck.wiggle", actor: e.player, prob: e.prob, legacy: e.type };
    case "card": return { type: "card.deal", actor: e.player, card: e.card, flip3: !!e.flip3, legacy: e.type };
    case "action_card": return { type: "card.deal", actor: e.player, card: e.card ?? { id: `action_${e.seq ?? "x"}_${e.kind}`, kind: "act", v: e.kind }, actionKind: e.kind, actionCard: true, legacy: e.type };
    case "play_action": return { type: "card.transfer", actor: e.from, target: e.target, card: e.card ?? { id: `action_${e.seq ?? "x"}_${e.kind}`, kind: "act", v: e.kind }, actionKind: e.kind, auto: !!e.auto, legacy: e.type };
    case "second_pass": return { type: "card.transfer", actor: e.from, target: e.to, card: e.card ?? { id: `second_${e.seq ?? "x"}`, kind: "act", v: "second" }, actionKind: "second", secondPass: true, auto: !!e.auto, legacy: e.type };
    case "bust": return { type: "effect.bust", actor: e.player, value: e.value, flip3: !!e.flip3, legacy: e.type };
    case "flip7": return { type: "effect.flip7", actor: e.player, legacy: e.type };
    case "flip3_abandon": return { type: "effect.flip3_abandon", target: e.target, legacy: e.type };
    case "second_used": return { type: "effect.second_used", actor: e.player, value: e.value, card: e.card, flip3: !!e.flip3, legacy: e.type };
    case "second_discard": return { type: "effect.second_discard", actor: e.player, legacy: e.type };
    case "stay": return { type: "effect.stay", actor: e.player, legacy: e.type };
    case "freeze_done": return { type: "effect.freeze_done", target: e.target, legacy: e.type };
    case "reshuffle": return { type: "deck.reshuffle", legacy: e.type };
    case "await_target": return { type: "target.prompt", actor: e.from, actionKind: e.kind, legacy: e.type };
    case "round_end": return { type: "effect.round_end", winners: e.winners, flip7: e.flip7, legacy: e.type };
    case "game_over": return { type: "effect.game_over", winners: e.winners, flip7: e.flip7, legacy: e.type };
    default: return e;
  }
}
function emit(s: State, e: any) { const n = normalizeFlip7Event(e); n.seq = ++s.seq; s.events.push(n); s.log = n; }

// Flip 7 in this hub starts with an empty line for every player: no one begins
// a round with a pre-pulled card. The first visible card comes from that
// player's first Hit. The deck/discard still persist round-to-round.
function dealOpeningHands(s: State) {
  s.current = firstActive(s, 0);
}

// Build a brand-new game (new shuffled deck, empty discard). Used at game
// creation and when restarting after GAME_OVER.
function fresh(names: string[], banked: number[], rngState = makeSeed(), variant = "standard"): State {
  const rng = { rngState };
  const deck = buildDeck(rng, variant);
  const players = names.map((n, i) => newPlayer(n, banked[i] ?? 0));
  const s: State = {
    schemaVersion: 1,
    rngState: rng.rngState,
    players, deck, discard: [], current: 0, phase: "PLAY", round: 1,
    pendingAction: null, deferredActions: [], flip3Left: 0, flip3Target: -1, flip3Stack: [], events: [], seq: 0, log: null,
    variant,
  };
  dealOpeningHands(s);
  return s;
}

// Start the NEXT round of the SAME game: keep the deck + discard pile (the
// discard accumulates round over round and is only shuffled back into the deck
// when the deck runs out — see draw()). Reset per-round player state and deal.
function startNextRound(s: State) {
  for (const p of s.players) {
    p.nums = []; p.mods = []; p.tableau = []; p.spentActions = []; p.secondChance = false;
    p.hasLucky13 = false; p.mustHit = false;
    p.status = "active"; p.bustCard = null; p.roundScore = 0;
  }
  s.current = 0; s.phase = "PLAY"; s.round += 1;
  s.pendingAction = null; s.deferredActions = []; s.flip3Left = 0; s.flip3Target = -1; s.flip3Stack = [];
  dealOpeningHands(s);
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
function targetableSeats(s: State, exclude: number, includeSelf = true) {
  return s.players.map((p, i) => i).filter((i) => (includeSelf || i !== exclude) && pNotBusted(s.players[i]));
}
function pNotBusted(p: Player | undefined) { return !!p && p.status !== "busted"; }
function uniqueCount(p: Player) { return new Set(p.nums).size; }
function removeOne<T>(arr: T[], val: T): boolean { const i = arr.indexOf(val); if (i < 0) return false; arr.splice(i, 1); return true; }
function isVengeance(s: State) { return s.variant === "vengeance"; }
function countNumber(p: Player, n: number) { return p.nums.filter((x) => x === n).length; }
function refreshSpecialFlags(p: Player) {
  p.hasLucky13 = p.tableau.some((c) => c.kind === "num" && c.special === "lucky13");
  p.mustHit = p.status === "active" && p.tableau.some((c) => c.kind === "num" && c.special === "zero");
}
function removeCardFromPlayer(p: Player, card: Card | null): Card | null {
  if (!card) return null;
  const i = p.tableau.findIndex((c) => c.id === card.id);
  if (i >= 0) p.tableau.splice(i, 1);
  if (card.kind === "num") removeOne(p.nums, card.v as number);
  else if (card.kind === "mod") removeOne(p.mods, card.v as string);
  else if (card.v === "second") p.secondChance = false;
  refreshSpecialFlags(p);
  return card;
}
function chooseFaceUpCard(p: Player, cardId?: string): Card | null {
  const cards = p.tableau.filter((c) => c.kind === "num" || c.kind === "mod");
  if (!cards.length) return null;
  if (cardId) return cards.find((c) => c.id === cardId) ?? null;
  return cards[cards.length - 1];
}
function maybeBustFromTransfer(s: State, seat: number, card: Card | null) {
  if (!card || card.kind !== "num") return;
  const p = s.players[seat];
  if (!p || p.status === "busted") return;
  const n = card.v as number;
  if (card.special === "unlucky7") return;
  if (n === 13 && p.hasLucky13 && countNumber(p, 13) <= 2) return;
  if (countNumber(p, n) > 1) {
    p.status = "busted";
    p.bustCard = n;
    emit(s, { type: "bust", player: seat, value: n });
  }
}

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
  if (card.kind === "num") {
    if (card.special === "unlucky7" && isVengeance(s)) {
      for (const c of p.tableau) if (c.kind === "num" || c.kind === "mod") s.discard.push(c);
      p.nums = [7]; p.mods = []; p.tableau = p.tableau.filter((c) => c.kind === "act");
      p.secondChance = false; p.hasLucky13 = false; p.mustHit = false;
      p.tableau.push(card);
    } else {
      p.nums.push(card.v as number); p.nums.sort((a, b) => a - b); p.tableau.push(card);
      refreshSpecialFlags(p);
    }
  }
  else if (card.kind === "mod") { p.mods.push(card.v as string); p.tableau.push(card); }
  else if (card.v === "second") { p.secondChance = true; p.tableau.push(card); }
}

function removeTableauCard(p: Player, pred: (c: Card) => boolean): Card | null {
  const i = p.tableau.findIndex(pred);
  if (i < 0) return null;
  return p.tableau.splice(i, 1)[0];
}
function orderedTableau(p: Player): Card[] {
  return [...p.tableau].sort((a, b) => {
    const rank = (c: Card) => c.kind === "num" ? 0 : c.kind === "mod" ? 1 : 2;
    const r = rank(a) - rank(b); if (r) return r;
    if (a.kind === "num" && b.kind === "num") return (a.v as number) - (b.v as number);
    return String(a.v).localeCompare(String(b.v));
  });
}

// Resolve a single drawn card WITH events. Returns "ok"|"bust"|"flip7"|"action".
function applyDrawnCard(s: State, pi: number, card: Card, opts: { flip3?: boolean } = {}): string {
  const p = s.players[pi];
  if (card.kind === "num") {
    const n = card.v as number;

    if (isVengeance(s) && card.special === "unlucky7") {
      for (const c of p.tableau) if (c.kind === "num" || c.kind === "mod") s.discard.push(c);
      p.nums = [7]; p.mods = []; p.tableau = p.tableau.filter((c) => c.kind === "act");
      p.secondChance = false; p.hasLucky13 = false; p.mustHit = false;
      p.tableau.push(card);
      emit(s, { type: "card", player: pi, card, flip3: !!opts.flip3 });
      emit(s, { type: "unlucky7", player: pi, card });
      return "ok";
    }

    if (isVengeance(s) && card.special === "lucky13") {
      if (countNumber(p, 13) >= 2) {
        p.status = "busted"; p.bustCard = 13;
        emit(s, { type: "bust", player: pi, value: 13, flip3: !!opts.flip3 });
        return "bust";
      }
      p.hasLucky13 = true;
      p.nums.push(13); p.nums.sort((a, b) => a - b); p.tableau.push(card);
      emit(s, { type: "card", player: pi, card, flip3: !!opts.flip3 });
      if (uniqueCount(p) >= 7) { p.status = "stayed"; emit(s, { type: "flip7", player: pi }); return "flip7"; }
      return "ok";
    }

    if (isVengeance(s) && card.special === "zero") {
      p.nums.push(0); p.nums.sort((a, b) => a - b); p.tableau.push(card);
      refreshSpecialFlags(p);
      emit(s, { type: "card", player: pi, card, flip3: !!opts.flip3 });
      if (uniqueCount(p) >= 7) { p.status = "stayed"; p.mustHit = false; emit(s, { type: "flip7", player: pi }); return "flip7"; }
      return "ok";
    }

    if (p.nums.includes(n)) {
      if (isVengeance(s) && n === 13 && p.hasLucky13 && countNumber(p, 13) < 2) {
         // Lucky 13 allows exactly one other 13.
         p.nums.push(n); p.nums.sort((a, b) => a - b); p.tableau.push(card);
         emit(s, { type: "card", player: pi, card, flip3: !!opts.flip3 });
         return "ok";
      }
      if (!isVengeance(s) && p.secondChance) {
        p.secondChance = false; s.discard.push(card);
        const used = removeTableauCard(p, (c) => c.kind === "act" && c.v === "second");
        if (used) s.discard.push(used);
        emit(s, { type: "second_used", player: pi, value: n, card: used, flip3: !!opts.flip3 });
        return "ok";
      }
      p.status = "busted"; p.bustCard = n;
      emit(s, { type: "bust", player: pi, value: n, flip3: !!opts.flip3 });
      return "bust";
    }
    p.nums.push(n); p.nums.sort((a, b) => a - b); p.tableau.push(card);
    refreshSpecialFlags(p);
    emit(s, { type: "card", player: pi, card, flip3: !!opts.flip3 });
    if (uniqueCount(p) >= 7) { 
       p.status = "stayed"; 
       emit(s, { type: "flip7", player: pi }); 
       if (p.mustHit) p.mustHit = false;
       return "flip7"; 
    }
    return "ok";
  }
  if (card.kind === "mod") {
     if (isVengeance(s)) {
       // Vengeance modifiers are played on ANY non-busted player (including stayed players).
       p.mods.push(card.v as string); p.tableau.push(card);
       emit(s, { type: "card", player: pi, card, flip3: !!opts.flip3 });
       const targets = targetableSeats(s, pi, true);
       if (targets.length <= 1) { resolveModifier(s, pi, targets[0] ?? pi, card, true); return "ok"; }
       s.pendingAction = { kind: "modifier", from: pi, card };
       emit(s, { type: "await_target", kind: "modifier", from: pi });
       return "action";
     }
     p.mods.push(card.v as string); p.tableau.push(card); 
     emit(s, { type: "card", player: pi, card, flip3: !!opts.flip3 }); 
     return "ok"; 
  }
  // action card
  const a = card.v as string;
  if (a === "unlucky7" && s.variant === "vengeance") {
     // Wipe board except this card
     for (const c of p.tableau) s.discard.push(c);
     p.nums = [7]; p.mods = []; p.tableau = [card]; p.secondChance = false; p.hasLucky13 = false;
     emit(s, { type: "effect.unlucky7", player: pi, card });
     return "ok";
  }
  if (a === "lucky13" && s.variant === "vengeance") {
     p.hasLucky13 = true; p.nums.push(13); p.nums.sort((x, y) => x - y); p.tableau.push({ ...card, kind: "num", v: 13, special: "lucky13" });
     emit(s, { type: "card", player: pi, card: { ...card, kind: "num", v: 13, special: "lucky13" } });
     return uniqueCount(p) >= 7 ? "flip7" : "ok";
  }
  if (a === "second") {
    if (!p.secondChance) { p.secondChance = true; p.tableau.push(card); emit(s, { type: "card", player: pi, card }); return "ok"; }
    // already holding one: must give to an active opponent.
    const others = activeOthers(s, pi).filter((i) => !s.players[i].secondChance);
    if (others.length === 0) { s.discard.push(card); emit(s, { type: "second_discard", player: pi }); return "ok"; }
    if (others.length === 1) { s.players[others[0]].secondChance = true; s.players[others[0]].tableau.push(card); emit(s, { type: "second_pass", from: pi, to: others[0], card, auto: true }); return "ok"; }
    s.pendingAction = { kind: "give_second", from: pi, card };
    emit(s, { type: "await_target", kind: "give_second", from: pi });
    return "action";
  }
  // freeze / flip3 / flip4 / steal / swap / discard / just1more
  p.tableau.push(card); emit(s, { type: "action_card", player: pi, kind: a, card }); 
  const targets = isVengeance(s) ? targetableSeats(s, pi, true) : activeOthers(s, pi);
  const needsFaceUpCard = a === "steal" || a === "swap" || a === "discard";
  const hasFaceUpTarget = targets.some((t) => s.players[t].tableau.some((c) => c.kind === "num" || c.kind === "mod"));
  if (isVengeance(s) && needsFaceUpCard && !hasFaceUpTarget) {
    removeCardFromPlayer(p, card); s.discard.push(card);
    emit(s, { type: "effect.action_fizzle", player: pi, kind: a, card });
    return "ok";
  }
  if (targets.length === 0 || (targets.length === 1 && targets[0] === pi)) {
    resolveAction(s, pi, a as any, targets[0] ?? pi, true);
    return "ok";
  }
  s.pendingAction = { kind: a as any, from: pi, card };
  emit(s, { type: "await_target", kind: a, from: pi });
  return "action";
}

function resolveModifier(s: State, from: number, target: number, card: Card, auto = false): string {
  const fp = s.players[from];
  const tp = s.players[target];
  if (!fp || !tp || tp.status === "busted") return "ok";
  // The card was temporarily placed on the drawing player's row for the reveal.
  removeCardFromPlayer(fp, card);
  placeCard(s, target, card);
  s.pendingAction = null;
  emit(s, { type: "play_action", kind: "modifier", from, target, card, auto });
  emit(s, { type: "effect.modifier", from, target, card });
  return "ok";
}

function resolveAction(s: State, from: number, kind: "freeze" | "flip3" | "flip4" | "steal" | "swap" | "discard" | "just1more", target: number, auto = false, opts: { cardId?: string; cardId2?: string } = {}): string {
  const actionCard = s.pendingAction?.card ?? removeTableauCard(s.players[from], (c) => c.kind === "act" && c.v === kind) ?? undefined;
  s.pendingAction = null;
  const tp = s.players[target];
  const fp = s.players[from];
  if (!tp || !fp || tp.status === "busted") return "ok";

  if (actionCard) { removeCardFromPlayer(fp, actionCard); s.discard.push(actionCard); }
  if (actionCard && !isVengeance(s)) (tp.spentActions ??= []).push({ ...actionCard, id: `spent_${actionCard.id ?? kind}_${s.seq}` });

  if (kind === "freeze") {
    emit(s, { type: "play_action", kind: "freeze", from, target, card: actionCard, auto });
    if (tp.status === "active") { tp.status = "stayed"; emit(s, { type: "freeze_done", target }); }
    return "ok";
  }
  if (kind === "discard") {
     emit(s, { type: "play_action", kind: "discard", from, target, card: actionCard, auto });
     const c = chooseFaceUpCard(tp, opts.cardId);
     if (c) {
        removeCardFromPlayer(tp, c);
        s.discard.push(c);
        emit(s, { type: "effect.discarded", player: target, card: c });
     }
     return "ok";
  }
  if (kind === "steal") {
     emit(s, { type: "play_action", kind: "steal", from, target, card: actionCard, auto });
     const c = chooseFaceUpCard(tp, opts.cardId);
     if (c) {
        removeCardFromPlayer(tp, c);
        placeCard(s, from, c);
        maybeBustFromTransfer(s, from, c);
        emit(s, { type: "effect.stolen", from: target, to: from, card: c });
     }
     return "ok";
  }
  if (kind === "swap") {
     emit(s, { type: "play_action", kind: "swap", from, target, card: actionCard, auto });
     const tc = chooseFaceUpCard(tp, opts.cardId);
     const fc = chooseFaceUpCard(fp, opts.cardId2);
     if (tc) removeCardFromPlayer(tp, tc);
     if (fc) removeCardFromPlayer(fp, fc);
     if (tc) { placeCard(s, from, tc); maybeBustFromTransfer(s, from, tc); }
     if (fc) { placeCard(s, target, fc); maybeBustFromTransfer(s, target, fc); }
     emit(s, { type: "effect.swapped", p1: from, p2: target, c1: fc, c2: tc });
     return "ok";
  }
  if (kind === "just1more") {
     emit(s, { type: "play_action", kind: "just1more", from, target, card: actionCard, auto });
     applyDrawnCard(s, target, draw(s));
     if (tp.status === "active") { tp.status = "stayed"; emit(s, { type: "stay", player: target, forced: true }); }
     return "ok";
  }

  const isF4 = kind === "flip4";
  emit(s, { type: "play_action", kind, from, target, card: actionCard, auto });
  (s.flip3Stack ??= []).push({ left: isF4 ? 4 : 3, target, flip4: isF4 });
  runFlip3(s);
  return "ok";
}

// Flip Three / Flip Four: reveal cards one at a time, abandoning immediately on
// bust/Flip7. Standard Flip Three pauses as soon as an action asks for a target.
// Vengeance Flip Four is different: any Action/Modifier cards revealed as part
// of the four are queued and resolved only AFTER all four cards are drawn, as
// long as the target did not bust or Flip 7.
function runFlip3(s: State) {
  const stack = (s.flip3Stack ??= []);
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const t = frame.target; const tp = s.players[t];
    if (!tp || tp.status !== "active") { stack.pop(); continue; }
    if (frame.left <= 0) {
      stack.pop();
      if (frame.flip4 && frame.delayed && frame.delayed.length) {
        s.deferredActions = [...frame.delayed, ...(s.deferredActions ?? [])];
        popDeferredAction(s);
        return;
      }
      continue;
    }
    frame.left--;
    const r = applyDrawnCard(s, t, draw(s), { flip3: true });
    if (r === "flip7") {
      emit(s, { type: "flip3_abandon", target: t });
      forceEndRoundOnFlip7(s, t);
      return;
    }
    if (r === "bust") { emit(s, { type: "flip3_abandon", target: t }); stack.pop(); continue; }
    if (r === "action") {
      if (frame.flip4 && s.pendingAction) {
        (frame.delayed ??= []).push(s.pendingAction);
        s.pendingAction = null;
        continue;
      }
      return;
    }
  }
  // Mirror legacy fields for any external readers (kept for compatibility).
  s.flip3Left = 0; s.flip3Target = -1;
}

// Called after a flip3-nested action's target is chosen, to continue the draws.
function resumeFlip3(s: State) {
  if (s.flip3Stack && s.flip3Stack.length) runFlip3(s);
}

function popDeferredAction(s: State): boolean {
  const next = s.deferredActions?.shift();
  if (!next) return false;
  s.pendingAction = next;
  emit(s, { type: "await_target", kind: next.kind, from: next.from });
  return true;
}

function endTurnAdvance(s: State) {
  if (activeCount(s) === 0) { scoreRound(s); return; }
  s.current = firstActive(s, (s.current + 1) % s.players.length);
}

// Flip 7! When a player completes 7 unique numbers, the round ends IMMEDIATELY
// for everyone: all still-active players are force-stayed (they bank their
// current points), then the round is scored. Any pending action / flip3 is
// dropped. Returns true so callers know the round is over (don't advance turn).
function forceEndRoundOnFlip7(s: State, flip7Seat: number): boolean {
  for (let i = 0; i < s.players.length; i++) {
    if (i !== flip7Seat && s.players[i].status === "active") {
      s.players[i].status = "stayed";
      emit(s, { type: "stay", player: i, forced: true });
    }
  }
  s.pendingAction = null; s.deferredActions = []; s.flip3Left = 0; s.flip3Target = -1; s.flip3Stack = [];
  scoreRound(s);
  return true;
}

function scoreRound(s: State) {
  let flip7Bonus = -1;
  for (let i = 0; i < s.players.length; i++) {
    const p = s.players[i];
    if (p.status === "busted") { p.roundScore = 0; continue; }
    const u = uniqueCount(p);
    let base = p.nums.reduce((a, b) => a + b, 0);
    if (isVengeance(s) && p.nums.includes(0) && u < 7) base = 0;
    else {
      if (p.mods.includes("x2")) base *= 2;
      if (p.mods.includes("div2")) base = Math.floor(base / 2);
      for (const m of p.mods) {
        if (m.startsWith("+")) base += parseInt(m.slice(1));
        else if (m.startsWith("-")) base -= parseInt(m.slice(1));
      }
      if (base < 0) base = 0;
    }
    if (u >= 7) { base += 15; flip7Bonus = i; }
    p.roundScore = base; p.banked += base;
  }
  // Round over: sweep every card off the boards into the discard pile. The
  // discard is only shuffled back into the deck when the deck runs dry (draw()).
  for (const p of s.players) {
    if (p.tableau && p.tableau.length) { for (const c of p.tableau) s.discard.push(c); }
    p.tableau = [];
  }
  s.pendingAction = null; s.deferredActions = []; s.flip3Left = 0; s.flip3Target = -1; s.flip3Stack = [];
  s.phase = s.players.some((p) => p.banked >= 200) ? "GAME_OVER" : "ROUND_END";
  const max = Math.max(...s.players.map((p) => p.banked));
  emit(s, { type: s.phase === "GAME_OVER" ? "game_over" : "round_end",
    winners: s.players.map((p, i) => (p.banked === max ? i : -1)).filter((i) => i >= 0), flip7: flip7Bonus });
}

export const Flip7: GameModule = {
  meta: { id: "flip7", name: "Flip 7", minPlayers: 2, maxPlayers: 8,
    description: "Push your luck — flip cards, don't repeat a number, race to 200.", emoji: "🎴", icon: "target",
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
      { id: "vengeance", name: "With a Vengeance", description: "Standalone 108-card ruleset: 13s, negative modifiers, Zero, Lucky 13, Unlucky 7, and take-that action cards." }
    ],
    schemaSpec: { kind: "imperative", paradigm: "reducers", version: 1 },
  },

  parseAction(raw: any) {
    if (!raw || typeof raw !== "object" || typeof raw.action !== "string") return null;
    if (Flip7.meta.actionTypes && !(Flip7.meta.actionTypes as readonly string[]).includes(raw.action)) return null;
    return raw;
  },

  create(names, variant) { return fresh(names, names.map(() => 0), undefined, variant); },

  applyAction(state: State, seat, msg) {
    state.events = []; // fresh timeline for this action
    if (state.phase !== "PLAY") {
      if (msg.action === "next_round") {
        if (state.phase === "GAME_OVER") {
          // New game: fresh deck, empty discard, scores reset.
          const ns = fresh(state.players.map((p) => p.name), state.players.map(() => 0), state.rngState, state.variant);
          ns.seq = state.seq + 1;
          Object.assign(state, ns);
        } else {
          // Next round of the SAME game: KEEP the deck + discard pile. The round
          // just ended already swept board cards into discard (scoreRound), so we
          // simply deal new hands from the continuing deck.
          state.events = [];
          startNextRound(state);
          state.seq += 1;
        }
      }
      return;
    }
    if (state.pendingAction) {
      const pa = state.pendingAction;
      if (msg.action === "target" && pa.from === seat) {
        const t = Math.max(0, Math.min(state.players.length - 1, msg.target | 0));
        if (state.players[t].status === "busted") return; // Vengeance can target stayed players
        // Are we resolving an action that was drawn DURING a flip3? If so, after
        // the choice we resume the remaining flip3 draws instead of ending the turn.
        const midFlip3 = !!(state.flip3Stack && state.flip3Stack.length);
        if (pa.kind === "give_second") {
          if (t === seat) return;
          state.pendingAction = null;
          state.players[t].secondChance = true;
          const passCard = pa.card; if (passCard) state.players[t].tableau.push(passCard);
          emit(state, { type: "second_pass", from: seat, to: t, card: passCard, auto: false });
          if (midFlip3) {
            resumeFlip3(state);
            // If the flip3 fully finished (and isn't paused on another choice),
            // the turn that started it can now advance.
            if (!state.pendingAction && !(state.flip3Stack && state.flip3Stack.length)) endTurnAdvance(state);
          }
          // (outside flip3, giving a second chance does NOT end your turn)
        } else if (pa.kind === "modifier") {
          if (pa.card) resolveModifier(state, seat, t, pa.card);
          if (midFlip3) resumeFlip3(state);
          if (!state.pendingAction && !(state.flip3Stack && state.flip3Stack.length)) {
            if (!popDeferredAction(state)) endTurnAdvance(state);
          }
        } else {
          resolveAction(state, seat, pa.kind, t, false, { cardId: typeof msg.cardId === "string" ? msg.cardId : undefined, cardId2: typeof msg.cardId2 === "string" ? msg.cardId2 : undefined });
          if (midFlip3) resumeFlip3(state);
          // Advance only when the whole flip3/Flip4 chain is done and nothing is pending.
          if (!state.pendingAction && !(state.flip3Stack && state.flip3Stack.length)) {
            if (!popDeferredAction(state)) endTurnAdvance(state);
          }
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
      if (r === "flip7") { forceEndRoundOnFlip7(state, seat); return; } // round ends for all
      endTurnAdvance(state);
    }
  },

  // State migration (Proposal 3): schema is current — no-op. Future schema bumps
  // (e.g. adding a field) would back-fill it here so in-progress rooms survive a deploy.
  migrate(_state: any) { /* schemaVersion 1 — current */ },
  isOver(state: State) { return state.phase === "GAME_OVER"; },

  // API-8: enumerate legal actions for `seat`. Flip 7 has two modes:
  //   1) Normal — the active seat may hit or stay.
  //   2) Pending action — a "freeze"/"flip3"/"second chance" card must pick
  //      a target before the turn can advance.
  legalActions(state: State, seat) {
    if (state.phase !== "PLAY") return [];
    if (state.pendingAction) {
      if (state.pendingAction.from !== seat) return [];
      const out: any[] = [];
      const kind = state.pendingAction.kind;
      const isSecond = kind === "give_second";
      const needsCard = kind === "steal" || kind === "swap" || kind === "discard";
      for (let t = 0; t < state.players.length; t++) {
        if (state.players[t].status === "busted") continue;
        if (isSecond && t === seat) continue;
        if (needsCard) {
          const cards = state.players[t].tableau.filter((c) => c.kind === "num" || c.kind === "mod");
          for (const c of cards) out.push({ action: "target", target: t, cardId: c.id });
          continue;
        }
        out.push({ action: "target", target: t });
      }
      return out;
    }
    const p = state.players[seat];
    if (seat !== state.current) return [];
    if (p?.status !== "active") return [];
    if (p.mustHit || p.tableau.length === 0) return [{ action: "hit" }];
    return [{ action: "hit" }, { action: "stay" }];
  },
  summarize(state: State) { return { round: state.round, current: state.current, pendingAction: state.pendingAction }; },
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
      game: "flip7",
      phase: mapPhase(state.phase),
      over,
      yourSeat: seat,
      summary,
      state: buildViewState(state),
      flip7: {
        round: state.round, current: state.current, phase: state.phase, variant: state.variant,
        pendingAction: state.pendingAction, viewerSeat: seat,
        deckCount: state.deck.length, discardCount: state.discard.length,
        discardTop: state.discard.length ? { kind: state.discard[state.discard.length - 1].kind, v: state.discard[state.discard.length - 1].v, special: state.discard[state.discard.length - 1].special } : null,
        seq: state.seq, events: state.events,
        players: state.players.map((p) => ({
          name: p.name, nums: p.nums, mods: p.mods, second: p.secondChance, cards: orderedTableau(p).map((c) => ({ id: c.id, kind: c.kind, v: c.v, special: c.special })),
          spentActions: (p.spentActions ?? []).map((c) => ({ id: c.id, kind: c.kind, v: c.v, special: c.special })),
          status: p.status, bustCard: p.bustCard, banked: p.banked, unique: uniqueCount(p),
          live: liveScore(p, state.variant),
        })),
      },
    };
  },
};

function liveScore(p: Player, variant = "standard"): number {
  if (p.status === "busted") return 0;
  const u = new Set(p.nums).size;
  let base = p.nums.reduce((a, b) => a + b, 0);
  if (variant === "vengeance" && p.nums.includes(0) && u < 7) return 0;
  if (p.mods.includes("x2")) base *= 2;
  if (p.mods.includes("div2")) base = Math.floor(base / 2);
  for (const m of p.mods) {
    if (m.startsWith("+")) base += parseInt(m.slice(1));
    else if (m.startsWith("-")) base -= parseInt(m.slice(1));
  }
  if (base < 0) base = 0;
  if (u >= 7) base += 15;
  return base;
}

// games/skyjo/engine.ts — Authoritative Skyjo game logic (server-side, framework-free).
// (Formerly src/engine.ts — it was always Skyjo-specific; moved here so the name
//  matches reality. Only Skyjo imports it.)

import { makeSeed, shuffleInPlace, type RngStateHolder } from "../../rng";

export const STAR = 99;
export interface Card { value: number; revealed: boolean; cleared: boolean; }
export interface HeldAction { kind: string; fresh?: boolean; }
export interface Player {
  name: string;
  board: Card[];
  roundScore: number;
  totalScore: number;
  revealCount: number;
  actionHand?: HeldAction[];
}
export type Phase = "REVEAL" | "PLAY" | "FINAL_TURNS" | "ROUND_END" | "GAME_OVER";
export type TurnAction = null | "deck" | "discard" | "must_reveal" | "turn_end_delay";

export function createDeck(rng: RngStateHolder = { rngState: makeSeed() }, variant = "standard"): number[] {
  const d: number[] = [];
  if (variant === "action") {
    for (let i = 0; i < 3; i++) d.push(-2);
    for (let i = 0; i < 11; i++) d.push(0);
    for (const v of [-1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) for (let i = 0; i < 7; i++) d.push(v);
    for (let i = 0; i < 15; i++) d.push(STAR);
  } else {
    for (let i = 0; i < 5; i++) d.push(-2);
    for (let i = 0; i < 10; i++) d.push(-1);
    for (let i = 0; i < 15; i++) d.push(0);
    for (let v = 1; v <= 12; v++) for (let i = 0; i < 10; i++) d.push(v);
  }
  shuffleInPlace(d, rng);
  return d;
}

const ACTION_TYPES = ["swap_own", "double", "draw_three", "enlightenment", "reactivation", "defense", "swap_other", "action_thief", "meteor"] as const;
function createActionDeck(rng: RngStateHolder): string[] {
  const d: string[] = [];
  for (const k of ACTION_TYPES) for (let i = 0; i < 3; i++) d.push(k);
  shuffleInPlace(d, rng);
  return d;
}
function isStar(v: number) { return v === STAR; }
function scoreValue(v: number) { return isStar(v) ? 0 : v; }

export class GameEngine {
  schemaVersion = 1;
  rngState = makeSeed();
  players: Player[];
  deck: number[] = [];
  discard: number[] = [];
  phase: Phase = "REVEAL";
  round = 1;
  currentPlayer = 0;
  roundEnder = -1;
  finalTurnsLeft = 0;
  drawnCard: number | null = null;
  turnAction: TurnAction = null;
  tiebreakerPlayers: number[] = [];
  actionDeck: string[] = [];
  actionDiscard: string[] = [];
  actionMarket: string[] = [];
  skyjoAction: null | { kind: string; player: number; handIndex?: number; first?: number; groups?: Array<{ indices: number[]; value: number }>; resume?: "none" | "endTurn" | "determineStarter" } = null;
  extraTurnSeat = -1;
  actionSeq = 0; // monotonic action counter (deterministic stand-in for wall-clock; makes each lastAction unique for client change-detection)
  lastAction: any = null;
  pendingTransition: any = null;
  variant: string = "standard";

  constructor(names: string[]) {
    this.players = names.map((n) => ({
      name: n,
      board: Array.from({ length: 12 }, () => ({ value: 0, revealed: false, cleared: false })),
      roundScore: 0,
      totalScore: 0,
      revealCount: 0,
    }));
  }

  // The set of serializable state fields. Keeping it explicit lets us copy state
  // in/out without a JSON round-trip (JSON.parse(JSON.stringify(...))) on the hot path.
  static readonly STATE_KEYS = [
    "schemaVersion", "rngState", "players", "deck", "discard", "phase", "round",
    "currentPlayer", "roundEnder", "finalTurnsLeft", "drawnCard", "turnAction",
    "tiebreakerPlayers", "actionDeck", "actionDiscard", "actionMarket", "skyjoAction", "extraTurnSeat",
    "lastAction", "pendingTransition", "actionSeq", "variant",
  ] as const;

  // Rehydrate from a stored plain object.
  static fromJSON(obj: any): GameEngine {
    const g = new GameEngine([]);
    Object.assign(g, obj);
    return g;
  }

  // Return the plain serializable state. All engine fields are already plain
  // objects/arrays/primitives, so no deep clone is required — we simply expose
  // the live references. Callers that persist this must not mutate it afterwards.
  toState(): any {
    const out: any = {};
    for (const k of GameEngine.STATE_KEYS) out[k] = (this as any)[k];
    return out;
  }

  // Write the engine's current state back onto a caller-owned plain object,
  // in place, without a JSON round-trip. Used after applyAction so the stored
  // game state object keeps its identity while reflecting the new state.
  writeInto(target: any): any {
    for (const k of GameEngine.STATE_KEYS) target[k] = (this as any)[k];
    return target;
  }

  private deal() {
    this.deck = createDeck(this, this.variant);
    for (const p of this.players) {
      for (const c of p.board) { c.value = this.deck.pop()!; c.revealed = false; c.cleared = false; }
      p.revealCount = 0; p.roundScore = 0; p.actionHand = [];
    }
    this.discard = [this.deck.pop()!];
    this.actionDeck = this.variant === "action" ? createActionDeck(this) : [];
    this.actionDiscard = [];
    this.actionMarket = [];
    if (this.variant === "action") for (let i = 0; i < 4; i++) this.refillActionMarket();
    this.skyjoAction = null; this.extraTurnSeat = -1;
    this.phase = "REVEAL"; this.roundEnder = -1; this.finalTurnsLeft = 0;
    this.currentPlayer = 0; this.drawnCard = null; this.turnAction = null;
    this.tiebreakerPlayers = []; this.lastAction = null; this.pendingTransition = null;
  }
  start() { this.deal(); }
  nextRound() { this.round++; this.deal(); }
  newGame() { this.round = 1; for (const p of this.players) p.totalScore = 0; this.deal(); }

  // Add a player mid-game (e.g. a late joiner who spectated). They start with the
  // supplied total score (typically the average of active players, rounded).
  // Their board is dealt on the next deal()/nextRound().
  addPlayer(name: string, startingTotal: number) {
    this.players.push({
      name,
      board: Array.from({ length: 12 }, () => ({ value: 0, revealed: false, cleared: false })),
      roundScore: 0,
      totalScore: Math.round(startingTotal) || 0,
      revealCount: 0,
    });
  }
  averageTotal(): number {
    if (!this.players.length) return 0;
    return this.players.reduce((s, p) => s + p.totalScore, 0) / this.players.length;
  }

  private refillActionMarket() {
    if (this.variant !== "action") return;
    if (!this.actionDeck.length && this.actionDiscard.length) {
      this.actionDeck = this.actionDiscard.splice(0);
      shuffleInPlace(this.actionDeck, this);
    }
    while (this.actionMarket.length < 4 && this.actionDeck.length) this.actionMarket.push(this.actionDeck.pop()!);
  }
  private drawActionCard(): string | null {
    this.refillActionMarket();
    return this.actionDeck.pop() ?? null;
  }
  private addActionToHand(pi: number, kind: string) {
    const p = this.players[pi];
    (p.actionHand ??= []).push({ kind, fresh: true });
  }
  private matureActions(pi: number) {
    for (const a of this.players[pi]?.actionHand ?? []) a.fresh = false;
  }
  private revealFirstHidden(pi: number): number {
    const p = this.players[pi];
    const idx = p.board.findIndex((c) => !c.revealed && !c.cleared);
    if (idx >= 0) p.board[idx].revealed = true;
    return idx;
  }
  private consumeDefense(target: number): boolean {
    const hand = this.players[target]?.actionHand ?? [];
    const i = hand.findIndex((a) => a.kind === "defense");
    if (i < 0) return false;
    const [card] = hand.splice(i, 1);
    this.actionDiscard.push(card.kind);
    this.lastAction = { type: "defense", player: target, t: ++this.actionSeq };
    return true;
  }
  private bestVisibleIndex(pi: number, preferStar = false): number {
    const p = this.players[pi];
    let best = -1, bestScore = -1e9;
    p.board.forEach((c, i) => {
      if (c.cleared) return;
      const known = c.revealed ? scoreValue(c.value) : 5;
      const score = preferStar && isStar(c.value) ? 99 : known;
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best;
  }
  private optionalStarGroups(pi: number): Array<{ indices: number[]; value: number }> {
    if (this.variant !== "action") return [];
    const p = this.players[pi];
    const groups: number[][] = [];
    for (let col = 0; col < 4; col++) groups.push([col, col + 4, col + 8]);
    for (let row = 0; row < 3; row++) groups.push([row * 4, row * 4 + 1, row * 4 + 2, row * 4 + 3]);
    const out: Array<{ indices: number[]; value: number }> = [];
    for (const indices of groups) {
      const cards = indices.map((i) => p.board[i]);
      if (!cards.every((c) => c.revealed && !c.cleared)) continue;
      if (!cards.some((c) => isStar(c.value))) continue;
      const nonStars = cards.filter((c) => !isStar(c.value));
      if (!nonStars.length) { out.push({ indices, value: STAR }); continue; }
      if (nonStars.every((c) => c.value === nonStars[0].value)) out.push({ indices, value: nonStars[0].value });
    }
    return out;
  }
  private maybeOfferStarClear(pi: number): boolean {
    const groups = this.optionalStarGroups(pi);
    if (!groups.length) return false;
    this.skyjoAction = { kind: "star_clear", player: pi, groups };
    this.lastAction = { type: "star_clear_prompt", player: pi, groups, t: ++this.actionSeq };
    return true;
  }
  private maybeOfferStarAction(pi: number, resume: "none" | "endTurn" | "determineStarter"): boolean {
    if (this.variant !== "action") return false;
    this.skyjoAction = { kind: "star_action", player: pi, resume };
    this.lastAction = { type: "star_action_prompt", player: pi, resume, t: ++this.actionSeq };
    return true;
  }
  private finishStarActionPrompt(pi: number) {
    const resume = this.skyjoAction?.resume ?? "none";
    this.skyjoAction = null;
    if (resume === "determineStarter") {
      if (this.players.every((pl) => pl.revealCount >= 2)) this.determineStarter();
    } else if (resume === "endTurn") {
      this.endTurn();
    }
  }

  revealInitial(pi: number, ci: number): boolean {
    if (this.phase !== "REVEAL") return false;
    const p = this.players[pi]; if (!p || p.revealCount >= 2) return false;
    const c = p.board[ci]; if (!c || c.revealed || c.cleared) return false;
    c.revealed = true; p.revealCount++;
    this.lastAction = { type: "reveal", player: pi, card: ci, value: c.value, t: ++this.actionSeq };
    const ready = this.players.every((pl) => pl.revealCount >= 2);
    if (isStar(c.value) && this.maybeOfferStarAction(pi, ready ? "determineStarter" : "none")) return true;
    if (ready) this.determineStarter();
    return true;
  }
  private determineStarter() {
    const sums = this.players.map((p, i) => ({
      i, sum: p.board.filter((c) => c.revealed && !c.cleared).reduce((a, c) => a + c.value, 0),
    }));
    const max = Math.max(...sums.map((s) => s.sum));
    const tied = sums.filter((s) => s.sum === max).map((s) => s.i);
    this.turnAction = "turn_end_delay";
    this.pendingTransition = { type: "starter", tied };
  }
  revealTiebreaker(pi: number, ci: number): boolean {
    if (!this.tiebreakerPlayers.includes(pi)) return false;
    const p = this.players[pi]; if (p.revealCount >= 2) return false;
    const c = p.board[ci]; if (!c || c.revealed || c.cleared) return false;
    c.revealed = true; p.revealCount++;
    this.lastAction = { type: "reveal", player: pi, card: ci, value: c.value, t: ++this.actionSeq };
    if (this.tiebreakerPlayers.every((i) => this.players[i].revealCount >= 2)) {
      const sums = this.tiebreakerPlayers.map((i) => ({
        i, sum: this.players[i].board.filter((c) => c.revealed && !c.cleared).reduce((a, c) => a + c.value, 0),
      }));
      const max = Math.max(...sums.map((s) => s.sum));
      const stillTied = sums.filter((s) => s.sum === max).map((s) => s.i);
      this.turnAction = "turn_end_delay";
      this.pendingTransition = { type: "starter", tied: stillTied };
    }
    return true;
  }
  drawDeck(pi: number): number | null {
    if (this.phase !== "PLAY" && this.phase !== "FINAL_TURNS") return null;
    if (this.currentPlayer !== pi || this.turnAction !== null) return null;
    if (this.deck.length === 0) {
      this.deck = this.discard.slice(0, -1);
      this.discard = [this.discard[this.discard.length - 1]];
      shuffleInPlace(this.deck, this);
    }
    this.drawnCard = this.deck.pop()!;
    this.turnAction = "deck";
    this.lastAction = { type: "draw_deck", player: pi, t: ++this.actionSeq };
    return this.drawnCard;
  }
  takeDiscard(pi: number): boolean {
    if (this.phase !== "PLAY" && this.phase !== "FINAL_TURNS") return false;
    if (this.currentPlayer !== pi || this.turnAction !== null) return false;
    if (this.discard.length === 0) return false;
    this.drawnCard = this.discard.pop()!;
    this.turnAction = "discard";
    this.lastAction = { type: "take_discard", player: pi, value: this.drawnCard, t: ++this.actionSeq };
    return true;
  }
  swap(pi: number, bi: number): boolean {
    if (this.phase !== "PLAY" && this.phase !== "FINAL_TURNS") return false;
    if (this.currentPlayer !== pi || this.turnAction === null || this.turnAction === "must_reveal") return false;
    const p = this.players[pi]; const oldCard = p.board[bi];
    if (!oldCard || oldCard.cleared) return false;
    const wasRevealed = oldCard.revealed; const oldVal = oldCard.value;
    this.discard.push(oldCard.value);
    const newVal = this.drawnCard!;
    p.board[bi] = { value: newVal, revealed: true, cleared: false };
    const diff = wasRevealed ? oldVal - newVal : null;
    this.lastAction = {
      type: "swap", player: pi, index: bi,
      good: wasRevealed ? diff! > 0 : null, diff, oldVal, wasRevealed,
      newVal, t: ++this.actionSeq,
    };
    if (isStar(newVal) && this.maybeOfferStarAction(pi, "endTurn")) return true;
    this.endTurn();
    return true;
  }
  discardDrawnCard(pi: number): boolean {
    if (this.phase !== "PLAY" && this.phase !== "FINAL_TURNS") return false;
    if (this.currentPlayer !== pi || this.turnAction !== "deck") return false;
    const val = this.drawnCard!;
    this.discard.push(val);
    this.drawnCard = null;
    this.turnAction = "must_reveal";
    this.lastAction = { type: "discard_drawn", player: pi, value: val, t: ++this.actionSeq };
    return true;
  }
  revealAfterDiscard(pi: number, bi: number): boolean {
    if (this.phase !== "PLAY" && this.phase !== "FINAL_TURNS") return false;
    if (this.currentPlayer !== pi || this.turnAction !== "must_reveal") return false;
    const p = this.players[pi]; const t = p.board[bi];
    if (!t || t.revealed || t.cleared) return false;
    t.revealed = true;
    this.lastAction = { type: "reveal_after_discard", player: pi, index: bi, value: t.value, t: ++this.actionSeq };
    if (isStar(t.value) && this.maybeOfferStarAction(pi, "endTurn")) return true;
    this.endTurn();
    return true;
  }

  takeActionCard(pi: number, source: "market" | "deck" = "deck", index = -1): boolean {
    if (this.variant !== "action") return false;
    if (this.phase !== "PLAY") return false;
    if (this.currentPlayer !== pi || this.turnAction !== null || this.skyjoAction) return false;
    let kind: string | null = null;
    if (source === "market" && index >= 0 && index < this.actionMarket.length) {
      kind = this.actionMarket.splice(index, 1)[0];
      this.refillActionMarket();
    } else {
      kind = this.drawActionCard();
    }
    if (!kind) return false;
    this.addActionToHand(pi, kind);
    this.lastAction = { type: "take_action", player: pi, kind, t: ++this.actionSeq };
    this.endTurn();
    return true;
  }

  takeFreeActionCard(pi: number): boolean {
    if (this.variant !== "action") return false;
    if (!this.skyjoAction || this.skyjoAction.kind !== "star_action" || this.skyjoAction.player !== pi) return false;
    const kind = this.drawActionCard();
    if (kind) this.addActionToHand(pi, kind);
    this.lastAction = { type: "take_free_action", player: pi, kind, t: ++this.actionSeq };
    this.finishStarActionPrompt(pi);
    return true;
  }
  skipFreeActionCard(pi: number): boolean {
    if (this.variant !== "action") return false;
    if (!this.skyjoAction || this.skyjoAction.kind !== "star_action" || this.skyjoAction.player !== pi) return false;
    this.lastAction = { type: "skip_free_action", player: pi, t: ++this.actionSeq };
    this.finishStarActionPrompt(pi);
    return true;
  }

  discardActionCard(pi: number, handIndex: number): boolean {
    if (this.variant !== "action") return false;
    if (this.phase !== "PLAY") return false;
    if (this.currentPlayer !== pi || this.turnAction !== null || this.skyjoAction) return false;
    const hand = this.players[pi].actionHand ?? [];
    const [card] = hand.splice(handIndex, 1);
    if (!card) return false;
    this.actionDiscard.push(card.kind);
    this.lastAction = { type: "discard_action", player: pi, kind: card.kind, t: ++this.actionSeq };
    this.endTurn();
    return true;
  }

  private finishAction(pi: number, kind: string) {
    this.lastAction = { type: "play_action", player: pi, kind, t: ++this.actionSeq };
    this.endTurn();
  }

  private useActionKind(pi: number, kind: string): boolean {
    if (kind === "swap_own") { this.skyjoAction = { kind, player: pi }; return true; }
    if (kind === "double" || kind === "defense") { this.extraTurnSeat = pi; this.finishAction(pi, kind); return true; }
    if (kind === "draw_three") {
      const drawn: number[] = [];
      for (let i = 0; i < 3 && this.deck.length; i++) drawn.push(this.deck.pop()!);
      if (!drawn.length) { this.finishAction(pi, kind); return true; }
      drawn.sort((a, b) => scoreValue(a) - scoreValue(b));
      const keep = drawn.shift()!;
      for (const v of drawn) this.discard.push(v);
      this.drawnCard = keep;
      this.turnAction = "deck";
      this.lastAction = { type: "play_action", player: pi, kind, drawn: [keep, ...drawn], t: ++this.actionSeq };
      return true;
    }
    if (kind === "reveal" || kind === "enlightenment") {
      const idx = this.revealFirstHidden(pi);
      this.finishAction(pi, kind);
      if (this.lastAction) this.lastAction.index = idx;
      return true;
    }
    if (kind === "reactivation") {
      const idx = [...this.actionDiscard].reverse().findIndex((k) => k !== "reactivation");
      if (idx >= 0) {
        const real = this.actionDiscard.length - 1 - idx;
        const [again] = this.actionDiscard.splice(real, 1);
        this.lastAction = { type: "reactivation", player: pi, kind: again, t: ++this.actionSeq };
        return this.useActionKind(pi, again);
      }
      this.finishAction(pi, kind); return true;
    }
    if (kind === "swap_other") {
      const target = this.players.map((_, i) => i).filter((i) => i !== pi && !this.consumeDefense(i)).sort((a,b)=>this.bestVisibleIndex(b)-this.bestVisibleIndex(a))[0];
      if (target == null) { this.finishAction(pi, kind); return true; }
      const own = this.bestVisibleIndex(pi);
      const other = this.bestVisibleIndex(target);
      if (own >= 0 && other >= 0) [this.players[pi].board[own], this.players[target].board[other]] = [this.players[target].board[other], this.players[pi].board[own]];
      this.finishAction(pi, kind); return true;
    }
    if (kind === "action_thief") {
      const target = this.players.map((p, i) => ({ i, n: i === pi ? -1 : (p.actionHand?.length ?? 0) })).sort((a,b)=>b.n-a.n)[0];
      if (target && target.n > 0 && !this.consumeDefense(target.i)) {
        const stolen = this.players[target.i].actionHand!.shift()!;
        stolen.fresh = true;
        (this.players[pi].actionHand ??= []).push(stolen);
        this.extraTurnSeat = pi;
      }
      this.finishAction(pi, kind); return true;
    }
    if (kind === "meteor") {
      for (let i = 0; i < this.players.length; i++) {
        if (i === pi) continue;
        if (this.consumeDefense(i)) continue;
        const idx = this.bestVisibleIndex(i, true);
        if (idx < 0) continue;
        const old = this.players[i].board[idx];
        if (!old.cleared) this.discard.unshift(old.value); // bottom of discard pile
        if (!this.deck.length) break;
        this.players[i].board[idx] = { value: this.deck.pop()!, revealed: true, cleared: false };
      }
      this.finishAction(pi, kind); return true;
    }
    this.finishAction(pi, kind);
    return true;
  }

  playActionCard(pi: number, handIndex: number): boolean {
    if (this.variant !== "action") return false;
    if (this.phase !== "PLAY") return false;
    if (this.currentPlayer !== pi || this.turnAction !== null || this.skyjoAction) return false;
    const hand = this.players[pi].actionHand ?? [];
    const card = hand[handIndex];
    if (!card || card.fresh) return false;
    hand.splice(handIndex, 1);
    this.actionDiscard.push(card.kind);
    return this.useActionKind(pi, card.kind);
  }

  actionCell(pi: number, index: number): boolean {
    const a = this.skyjoAction;
    if (!a || a.player !== pi || this.currentPlayer !== pi) return false;
    if (a.kind === "swap_own") {
      if (a.first == null) { a.first = index; this.lastAction = { type: "action_select", player: pi, kind: a.kind, index, t: ++this.actionSeq }; return true; }
      const p = this.players[pi];
      const j = a.first;
      [p.board[j], p.board[index]] = [p.board[index], p.board[j]];
      this.skyjoAction = null;
      this.lastAction = { type: "play_action", player: pi, kind: a.kind, indices: [j, index], t: ++this.actionSeq };
      this.endTurn();
      return true;
    }
    return false;
  }

  clearStarGroup(pi: number, groupIndex: number, starOnTop = false): boolean {
    const a = this.skyjoAction;
    if (!a || a.kind !== "star_clear" || a.player !== pi) return false;
    const g = a.groups?.[groupIndex] ?? a.groups?.[0];
    if (!g) return false;
    const cards = g.indices.map((i) => this.players[pi].board[i]);
    g.indices.forEach((i) => (this.players[pi].board[i].cleared = true));
    const stars = cards.filter((c) => isStar(c.value)).map((c) => c.value);
    const non = cards.filter((c) => !isStar(c.value)).map((c) => c.value);
    for (const v of (starOnTop ? [...non, ...stars] : [...stars, ...non])) this.discard.push(v);
    this.skyjoAction = null;
    this.lastAction = { type: "star_clear", player: pi, indices: g.indices, starOnTop, t: ++this.actionSeq };
    this.endTurn();
    return true;
  }
  skipStarClear(pi: number): boolean {
    const a = this.skyjoAction;
    if (!a || a.kind !== "star_clear" || a.player !== pi) return false;
    const rest = (a.groups ?? []).slice(1);
    this.lastAction = { type: "star_clear_skip", player: pi, t: ++this.actionSeq };
    if (rest.length) {
      this.skyjoAction = { kind: "star_clear", player: pi, groups: rest };
      return true;
    }
    this.skyjoAction = null;
    this.turnAction = "turn_end_delay";
    return true;
  }

  checkTriplets(pi: number): boolean {
    const p = this.players[pi]; let cleared = false;
    const groups: number[][] = [];
    for (let col = 0; col < 4; col++) groups.push([col, col + 4, col + 8]);
    if (this.variant === "action") for (let row = 0; row < 3; row++) groups.push([row * 4, row * 4 + 1, row * 4 + 2, row * 4 + 3]);
    for (const idxs of groups) {
      const cards = idxs.map((i) => p.board[i]);
      if (!cards.every((c) => c.revealed && !c.cleared)) continue;
      const nonStars = cards.filter((c) => !isStar(c.value));
      if (this.variant === "action" && cards.some((c) => isStar(c.value))) continue;
      if (!nonStars.length) continue;
      if (!nonStars.every((c) => c.value === nonStars[0].value)) continue;
      idxs.forEach((i) => (p.board[i].cleared = true));
      for (const c of cards) this.discard.push(c.value);
      cleared = true;
      if (this.lastAction && this.lastAction.type === "swap") {
        this.lastAction.triplet = { value: nonStars[0].value, indices: idxs };
      } else {
        this.lastAction = { type: "triplet", player: pi, value: nonStars[0].value, indices: idxs, t: ++this.actionSeq };
      }
    }
    return cleared;
  }
  private endTurn() {
    this.checkTriplets(this.currentPlayer);
    this.drawnCard = null;
    this.skyjoAction = null;
    if (this.maybeOfferStarClear(this.currentPlayer)) return;
    this.turnAction = "turn_end_delay";
  }
  completeTurnEnd() {
    if (this.turnAction !== "turn_end_delay") return;
    this.turnAction = null;
    if (this.pendingTransition) {
      const tied = this.pendingTransition.tied;
      if (tied.length === 1) {
        this.currentPlayer = tied[0]; this.phase = "PLAY";
        this.lastAction = { type: "starter", player: tied[0], t: ++this.actionSeq };
        this.tiebreakerPlayers = [];
      } else {
        this.tiebreakerPlayers = this.players.map((_, i) => i);
        for (const p of this.players) p.revealCount = 1;
      }
      this.pendingTransition = null;
      return;
    }
    this.matureActions(this.currentPlayer);
    const p = this.players[this.currentPlayer];
    if (p.board.every((c) => c.cleared || c.revealed) && this.phase === "PLAY") {
      this.phase = "FINAL_TURNS";
      this.roundEnder = this.currentPlayer;
      this.finalTurnsLeft = this.players.length - 1;
    }
    if (this.phase === "FINAL_TURNS") {
      if (this.currentPlayer !== this.roundEnder) this.finalTurnsLeft--;
      if (this.finalTurnsLeft <= 0) { this.calculateScores(); return; }
    }
    if (this.extraTurnSeat === this.currentPlayer) {
      this.extraTurnSeat = -1;
      this.lastAction = { type: "extra_turn", player: this.currentPlayer, t: ++this.actionSeq };
      return;
    }
    this.currentPlayer = (this.currentPlayer + 1) % this.players.length;
  }
  private calculateScores() {
    for (const p of this.players) {
      for (const c of p.board) if (!c.cleared) c.revealed = true;
      this.checkTriplets(this.players.indexOf(p));
      p.roundScore = p.board.filter((c) => !c.cleared).reduce((s, c) => s + scoreValue(c.value), 0);
      if (this.variant === "action") {
        p.roundScore += (p.actionHand?.length ?? 0) * 10;
        for (let col = 0; col < 4; col++) {
          const cards = [p.board[col], p.board[col + 4], p.board[col + 8]];
          if (cards.every((c) => !c.cleared && isStar(c.value))) p.roundScore -= 10;
        }
        for (let row = 0; row < 3; row++) {
          const cards = [p.board[row * 4], p.board[row * 4 + 1], p.board[row * 4 + 2], p.board[row * 4 + 3]];
          const stars = cards.filter((c) => !c.cleared && isStar(c.value)).length;
          if (stars === 4) p.roundScore -= 15;
          else if (stars >= 3) p.roundScore -= 10;
        }
      }
    }
    const ender = this.players[this.roundEnder];
    const minOther = Math.min(
      ...this.players.filter((_, i) => i !== this.roundEnder).map((o) => o.roundScore)
    );
    if (ender.roundScore >= minOther && ender.roundScore > 0) ender.roundScore *= 2;
    for (const p of this.players) p.totalScore += p.roundScore;
    this.phase = this.players.some((p) => p.totalScore >= 100) ? "GAME_OVER" : "ROUND_END";
    const min = Math.min(...this.players.map((p) => p.totalScore));
    this.lastAction = {
      type: this.phase === "GAME_OVER" ? "game_over" : "round_end",
      winners: this.players.map((p, i) => (p.totalScore === min ? i : -1)).filter((i) => i >= 0),
      t: ++this.actionSeq,
    };
  }
  getStateFor(viewerIndex: number) {
    const s: any = {
      phase: this.phase, round: this.round, currentPlayer: this.currentPlayer,
      roundEnder: this.roundEnder, finalTurnsLeft: this.finalTurnsLeft, turnAction: this.turnAction,
      tiebreakerPlayers: [...this.tiebreakerPlayers], lastAction: this.lastAction,
      deckCount: this.deck.length,
      discardTop: this.discard.length ? this.discard[this.discard.length - 1] : null,
      discardCount: this.discard.length,
      variant: this.variant,
      actionDeckCount: this.actionDeck.length,
      actionDiscardCount: this.actionDiscard.length,
      actionMarket: [...this.actionMarket],
      skyjoAction: this.skyjoAction,
      players: this.players.map((p, pi) => ({
        name: p.name, totalScore: p.totalScore, roundScore: p.roundScore, revealCount: p.revealCount,
        actionHand: pi === viewerIndex ? (p.actionHand ?? []).map((a) => ({ kind: a.kind, fresh: !!a.fresh })) : (p.actionHand ?? []).map(() => ({ kind: "hidden" })),
        board: p.board.map((c) => ({
          value: c.revealed || c.cleared ? c.value : null, revealed: c.revealed, cleared: c.cleared,
        })),
      })),
    };
    s.myDrawnCard =
      viewerIndex === this.currentPlayer && (this.turnAction === "deck" || this.turnAction === "discard")
        ? this.drawnCard : null;
    // Everyone sees the card a player pulls from the DECK (it's flipped face-up
    // on top of the deck for the table). Cards taken from discard are already public.
    s.publicDrawn = this.turnAction === "deck" ? this.drawnCard : null;
    s.viewerIndex = viewerIndex;
    return s;
  }
}

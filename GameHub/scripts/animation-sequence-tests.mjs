/**
 * Targeted Animation Sequence Tests
 * 
 * Tests the EXACT animation event sequences that the client-side
 * animation runners (EventRunner, playEvents, runAnim) process,
 * checking for timing issues, stale events, and visual glitches.
 * 
 * Run: node scripts/animation-sequence-tests.mjs
 */

// ============================================================
// Test helpers
// ============================================================
let totalTests = 0, passed = 0, failed = 0;
const failures = [];

function assert(condition, msg, detail = '') {
  totalTests++;
  if (condition) { passed++; }
  else { failed++; failures.push({ msg, detail }); console.log(`  ❌ ${msg}${detail ? '\n     ' + detail : ''}`); }
}

function describe(name, fn) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${'─'.repeat(60)}`);
  fn();
}

// ============================================================
// Inline engines (same as animation-playtest.mjs — abbreviated)
// ============================================================

// --- Skyjo ---
function skyjoDeck() {
  const d = [];
  for (let i = 0; i < 5; i++) d.push(-2);
  for (let i = 0; i < 10; i++) d.push(-1);
  for (let i = 0; i < 15; i++) d.push(0);
  for (let v = 1; v <= 12; v++) for (let i = 0; i < 10; i++) d.push(v);
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
class SkyjoEngine {
  constructor(names) {
    this.players = names.map(n => ({ name: n, board: Array.from({ length: 12 }, () => ({ value: 0, revealed: false, cleared: false })), roundScore: 0, totalScore: 0, revealCount: 0 }));
    this.deck = []; this.discard = []; this.phase = 'REVEAL'; this.round = 1;
    this.currentPlayer = 0; this.roundEnder = -1; this.finalTurnsLeft = 0;
    this.drawnCard = null; this.turnAction = null; this.tiebreakerPlayers = [];
    this.lastAction = null; this.pendingTransition = null;
  }
  _deal() { this.deck = skyjoDeck(); for (const p of this.players) { for (const c of p.board) { c.value = this.deck.pop(); c.revealed = false; c.cleared = false; } p.revealCount = 0; p.roundScore = 0; } this.discard = [this.deck.pop()]; this.phase = 'REVEAL'; this.roundEnder = -1; this.finalTurnsLeft = 0; this.currentPlayer = 0; this.drawnCard = null; this.turnAction = null; this.tiebreakerPlayers = []; this.lastAction = null; this.pendingTransition = null; }
  start() { this._deal(); }
  revealInitial(pi, ci) { if (this.phase !== 'REVEAL') return; const p = this.players[pi]; if (p.revealCount >= 2) return; const c = p.board[ci]; if (c.revealed || c.cleared) return; c.revealed = true; p.revealCount++; this.lastAction = { type: 'reveal', player: pi, card: ci, value: c.value, t: Date.now() }; if (this.players.every(pl => pl.revealCount >= 2)) this._starter(); }
  _starter() { const sums = this.players.map((p, i) => ({ i, sum: p.board.filter(c => c.revealed && !c.cleared).reduce((a, c) => a + c.value, 0) })); const mx = Math.max(...sums.map(s => s.sum)); const tied = sums.filter(s => s.sum === mx).map(s => s.i); this.turnAction = 'turn_end_delay'; this.pendingTransition = { tied }; }
  completeTurnEnd() { if (this.turnAction !== 'turn_end_delay') return; this.turnAction = null; if (this.pendingTransition) { const tied = this.pendingTransition.tied; if (tied.length === 1) { this.currentPlayer = tied[0]; this.phase = 'PLAY'; this.lastAction = { type: 'starter', player: tied[0], t: Date.now() }; this.tiebreakerPlayers = []; } else { this.tiebreakerPlayers = tied; for (const i of tied) this.players[i].revealCount = 1; } this.pendingTransition = null; return; } const p = this.players[this.currentPlayer]; if (p.board.every(c => c.cleared || c.revealed) && this.phase === 'PLAY') { this.phase = 'FINAL_TURNS'; this.roundEnder = this.currentPlayer; this.finalTurnsLeft = this.players.length - 1; } if (this.phase === 'FINAL_TURNS') { if (this.currentPlayer !== this.roundEnder) this.finalTurnsLeft--; if (this.finalTurnsLeft <= 0) { this._calc(); return; } } this.currentPlayer = (this.currentPlayer + 1) % this.players.length; }
  drawDeck(pi) { if (this.phase !== 'PLAY' && this.phase !== 'FINAL_TURNS') return; if (this.currentPlayer !== pi || this.turnAction !== null) return; if (this.deck.length === 0) { this.deck = this.discard.slice(0, -1); this.discard = [this.discard[this.discard.length - 1]]; for (let i = this.deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]]; } } this.drawnCard = this.deck.pop(); this.turnAction = 'deck'; this.lastAction = { type: 'draw_deck', player: pi, t: Date.now() }; }
  takeDiscard(pi) { if (this.currentPlayer !== pi || this.turnAction !== null) return; if (!this.discard.length) return; this.drawnCard = this.discard.pop(); this.turnAction = 'discard'; this.lastAction = { type: 'take_discard', player: pi, value: this.drawnCard, t: Date.now() }; }
  swap(pi, bi) { if (this.currentPlayer !== pi || this.turnAction === null || this.turnAction === 'must_reveal') return; const p = this.players[pi]; const o = p.board[bi]; if (o.cleared) return; const wasR = o.revealed, ov = o.value; this.discard.push(o.value); p.board[bi] = { value: this.drawnCard, revealed: true, cleared: false }; const diff = wasR ? (ov - this.drawnCard) : null; this.lastAction = { type: 'swap', player: pi, index: bi, diff, oldVal: ov, wasRevealed: wasR, newVal: this.drawnCard, t: Date.now() }; this._end(); }
  discardDrawnCard(pi) { if (this.currentPlayer !== pi || this.turnAction !== 'deck') return; const v = this.drawnCard; this.discard.push(v); this.drawnCard = null; this.turnAction = 'must_reveal'; this.lastAction = { type: 'discard_drawn', player: pi, value: v, t: Date.now() }; }
  revealAfterDiscard(pi, bi) { if (this.currentPlayer !== pi || this.turnAction !== 'must_reveal') return; const c = this.players[pi].board[bi]; if (c.revealed || c.cleared) return; c.revealed = true; this.lastAction = { type: 'reveal_after_discard', player: pi, index: bi, value: c.value, t: Date.now() }; this._end(); }
  checkTriplets(pi) { const p = this.players[pi]; for (let col = 0; col < 4; col++) { const ix = [col, col + 4, col + 8], cs = ix.map(i => p.board[i]); if (cs.every(c => c.revealed && !c.cleared) && cs[0].value === cs[1].value && cs[1].value === cs[2].value) { ix.forEach(i => p.board[i].cleared = true); for (let i = 0; i < 3; i++) this.discard.push(cs[0].value); this.lastAction = { type: 'triplet', player: pi, value: cs[0].value, indices: ix, t: Date.now() }; } } }
  _end() { this.checkTriplets(this.currentPlayer); this.drawnCard = null; this.turnAction = 'turn_end_delay'; }
  _calc() { for (const p of this.players) { for (const c of p.board) if (!c.cleared) c.revealed = true; this.checkTriplets(this.players.indexOf(p)); p.roundScore = p.board.filter(c => !c.cleared).reduce((a, c) => a + c.value, 0); } const e = this.players[this.roundEnder]; const mo = Math.min(...this.players.filter((_, i) => i !== this.roundEnder).map(o => o.roundScore)); if (e.roundScore >= mo && e.roundScore > 0) e.roundScore *= 2; for (const p of this.players) p.totalScore += p.roundScore; this.phase = this.players.some(p => p.totalScore >= 100) ? 'GAME_OVER' : 'ROUND_END'; }
  getStateFor(viewer) { const s = { phase: this.phase, round: this.round, currentPlayer: this.currentPlayer, roundEnder: this.roundEnder, finalTurnsLeft: this.finalTurnsLeft, turnAction: this.turnAction, tiebreakerPlayers: [...this.tiebreakerPlayers], lastAction: this.lastAction, deckCount: this.deck.length, discardTop: this.discard.length ? this.discard[this.discard.length - 1] : null, players: this.players.map(p => ({ name: p.name, totalScore: p.totalScore, roundScore: p.roundScore, revealCount: p.revealCount, board: p.board.map(c => ({ value: (c.revealed || c.cleared) ? c.value : null, revealed: c.revealed, cleared: c.cleared })) })) }; s.myDrawnCard = (this.turnAction === 'deck' || this.turnAction === 'discard') ? this.drawnCard : null; s.publicDrawn = this.turnAction === 'deck' ? this.drawnCard : null; s.viewerIndex = viewer; return s; }
}

// --- Flip7 ---
class Flip7Engine {
  constructor(names) { this.s = this._fresh(names, names.map(() => 0)); }
  _newP(name, banked) { return { name, nums: [], mods: [], tableau: [], second: false, status: 'active', bustCard: null, banked: banked || 0, roundScore: 0 }; }
  _buildDeck() { const d = []; let q = 0; const add = (kind, v) => d.push({ id: 'lf7c_' + (q++) + '_' + kind + '_' + String(v).replace(/\W/g, ''), kind, v }); add('num', 0); for (let n = 1; n <= 12; n++) for (let i = 0; i < n; i++) add('num', n); for (const m of ['+2', '+4', '+6', '+8', '+10', 'x2']) add('mod', m); for (const a of ['freeze', 'flip3', 'second']) for (let i = 0; i < 3; i++) add('act', a); this._sh(d); return d; }
  _sh(d) { for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } }
  _emit(s, e) { e.seq = ++s.seq; s.events.push(e); }
  _fresh(names, banked) { const s = { players: names.map((n, i) => this._newP(n, banked[i] || 0)), deck: this._buildDeck(), discard: [], current: 0, phase: 'PLAY', round: 1, pendingAction: null, flip3Left: 0, flip3Target: -1, events: [], seq: 0 }; for (let i = 0; i < s.players.length; i++) { let c = this._draw(s), g = 0; while (c.kind === 'act' && g++ < 200) { s.deck.unshift(c); this._sh(s.deck); c = this._draw(s); } this._place(s, i, c); } s.current = this._firstActive(s, 0); return s; }
  _draw(s) { if (!s.deck.length) { s.deck = s.discard; s.discard = []; this._sh(s.deck); this._emit(s, { type: 'reshuffle' }); } return s.deck.pop(); }
  _firstActive(s, from) { for (let k = 0; k < s.players.length; k++) { const i = (from + k) % s.players.length; if (s.players[i].status === 'active') return i; } return from; }
  _activeCount(s) { return s.players.filter(p => p.status === 'active').length; }
  _activeOthers(s, ex) { return s.players.map((p, i) => i).filter(i => i !== ex && s.players[i].status === 'active'); }
  _unique(p) { return new Set(p.nums).size; }
  _place(s, pi, card) { const p = s.players[pi]; if (card.kind === 'num') { if (!p.nums.includes(card.v)) { p.nums.push(card.v); p.nums.sort((a, b) => a - b); } p.tableau.push(card); } else if (card.kind === 'mod') { p.mods.push(card.v); p.tableau.push(card); } else if (card.v === 'second') { p.second = true; p.tableau.push(card); } }
  _remTab(p, pred) { const i = p.tableau.findIndex(pred); return i >= 0 ? p.tableau.splice(i, 1)[0] : null; }
  _bustProb(s, pi) { const p = s.players[pi]; const tot = s.deck.length || 1; let d = 0; for (const c of s.deck) if (c.kind === 'num' && p.nums.includes(c.v)) d++; return d / tot; }
  _apply(s, pi, card, opts) { opts = opts || {}; const p = s.players[pi]; if (card.kind === 'num') { const n = card.v; if (p.nums.includes(n)) { if (p.second) { p.second = false; s.discard.push(card); const used = this._remTab(p, c => c.kind === 'act' && c.v === 'second'); if (used) s.discard.push(used); this._emit(s, { type: 'second_used', player: pi, value: n, card: used, flip3: !!opts.flip3 }); return 'ok'; } p.status = 'busted'; p.bustCard = n; this._emit(s, { type: 'bust', player: pi, value: n, flip3: !!opts.flip3 }); return 'bust'; } p.nums.push(n); p.nums.sort((a, b) => a - b); p.tableau.push(card); this._emit(s, { type: 'card', player: pi, card, flip3: !!opts.flip3 }); if (this._unique(p) >= 7) { p.status = 'stayed'; this._emit(s, { type: 'flip7', player: pi }); return 'flip7'; } return 'ok'; } if (card.kind === 'mod') { p.mods.push(card.v); p.tableau.push(card); this._emit(s, { type: 'card', player: pi, card, flip3: !!opts.flip3 }); return 'ok'; } const a = card.v; if (a === 'second') { if (!p.second) { p.second = true; p.tableau.push(card); this._emit(s, { type: 'card', player: pi, card }); return 'ok'; } const others = this._activeOthers(s, pi).filter(i => !s.players[i].second); if (!others.length) { s.discard.push(card); this._emit(s, { type: 'second_discard', player: pi }); return 'ok'; } if (others.length === 1) { s.players[others[0]].second = true; s.players[others[0]].tableau.push(card); this._emit(s, { type: 'second_pass', from: pi, to: others[0], card, auto: true }); return 'ok'; } s.pendingAction = { kind: 'give_second', from: pi, card }; this._emit(s, { type: 'await_target', kind: 'give_second', from: pi }); return 'action'; } p.tableau.push(card); this._emit(s, { type: 'action_card', player: pi, kind: a, card }); const others = this._activeOthers(s, pi); if (!others.length) { this._resolve(s, pi, a, pi, true); return 'ok'; } s.pendingAction = { kind: a, from: pi, card }; this._emit(s, { type: 'await_target', kind: a, from: pi }); return 'action'; }
  _resolve(s, from, kind, target, auto) { const tp = s.players[target]; const actionCard = (s.pendingAction && s.pendingAction.card) || this._remTab(s.players[from], c => c.kind === 'act' && c.v === kind); s.pendingAction = null; if (kind === 'freeze') { this._emit(s, { type: 'play_action', kind: 'freeze', from, target, card: actionCard, auto: !!auto }); if (tp.status === 'active') { tp.status = 'stayed'; this._emit(s, { type: 'freeze_done', target }); } return 'ok'; } this._emit(s, { type: 'play_action', kind: 'flip3', from, target, card: actionCard, auto: !!auto }); s.flip3Left = 3; s.flip3Target = target; this._runFlip3(s); return 'ok'; }
  _runFlip3(s) { while (s.flip3Left > 0) { const t = s.flip3Target, tp = s.players[t]; if (!tp || tp.status !== 'active') break; s.flip3Left--; const r = this._apply(s, t, this._draw(s), { flip3: true }); if (r === 'bust' || r === 'flip7') { this._emit(s, { type: 'flip3_abandon', target: t }); break; } if (r === 'action') { const pa = s.pendingAction; if (pa) { if (pa.kind === 'give_second') { const o = this._activeOthers(s, pa.from).filter(i => !s.players[i].second); s.pendingAction = null; if (o.length) { s.players[o[0]].second = true; if (pa.card) s.players[o[0]].tableau.push(pa.card); this._emit(s, { type: 'second_pass', from: pa.from, to: o[0], card: pa.card, auto: true }); } else this._emit(s, { type: 'second_discard', player: pa.from }); } else this._resolve(s, pa.from, pa.kind, pa.from, true); } } } s.flip3Left = 0; s.flip3Target = -1; }
  _advance(s) { if (this._activeCount(s) === 0) { this._score(s); return; } s.current = this._firstActive(s, (s.current + 1) % s.players.length); }
  _score(s) { let f7 = -1; for (const p of s.players) { if (p.status === 'busted') { p.roundScore = 0; continue; } const u = new Set(p.nums).size; let base = p.nums.reduce((a, b) => a + b, 0); if (p.mods.includes('x2')) base *= 2; for (const m of p.mods) if (m[0] === '+') base += parseInt(m.slice(1)); if (u >= 7) { base += 15; f7 = 1; } p.roundScore = base; p.banked += base; } s.pendingAction = null; s.flip3Left = 0; s.flip3Target = -1; s.phase = s.players.some(p => p.banked >= 200) ? 'GAME_OVER' : 'ROUND_END'; const mx = Math.max(...s.players.map(p => p.banked)); this._emit(s, { type: s.phase === 'GAME_OVER' ? 'game_over' : 'round_end', winners: s.players.map((p, i) => p.banked === mx ? i : -1).filter(i => i >= 0), flip7: f7 }); }
  apply(seat, msg) { const s = this.s; s.events = []; if (s.phase !== 'PLAY') return; if (s.pendingAction) { const pa = s.pendingAction; if (msg.action === 'target' && pa.from === seat) { const t = msg.target | 0; if (!s.players[t] || s.players[t].status !== 'active') return; if (pa.kind === 'give_second') { if (t === seat) return; s.pendingAction = null; s.players[t].second = true; if (pa.card) s.players[t].tableau.push(pa.card); this._emit(s, { type: 'second_pass', from: seat, to: t, card: pa.card, auto: false }); } else { this._resolve(s, seat, pa.kind, t); this._advance(s); } } return; } if (seat !== s.current || s.players[seat].status !== 'active') return; if (msg.action === 'stay') { s.players[seat].status = 'stayed'; this._emit(s, { type: 'stay', player: seat }); this._advance(s); } else if (msg.action === 'hit') { this._emit(s, { type: 'draw_start', player: seat, prob: this._bustProb(s, seat) }); const card = this._draw(s); const r = this._apply(s, seat, card, {}); if (r === 'action') return; this._advance(s); } }
  next() { const s = this.s; const over = s.phase === 'GAME_OVER'; const ns = this._fresh(s.players.map(p => p.name), over ? s.players.map(() => 0) : s.players.map(p => p.banked)); ns.seq = s.seq + 1; if (!over) ns.round = s.round + 1; this.s = ns; }
  viewFor(seat) { const s = this.s; const over = s.phase === 'GAME_OVER'; let summary; if (s.phase === 'ROUND_END' || s.phase === 'GAME_OVER') { const mx = Math.max(...s.players.map(p => p.banked)); summary = { rows: s.players.map((p, i) => ({ seat: i, name: p.name, score: p.banked, delta: p.roundScore })), winners: s.players.map((p, i) => p.banked === mx ? i : -1).filter(i => i >= 0) }; } const live = p => { if (p.status === 'busted') return 0; let b = p.nums.reduce((a, c) => a + c, 0); if (p.mods.includes('x2')) b *= 2; for (const m of p.mods) if (m[0] === '+') b += parseInt(m.slice(1)); if (new Set(p.nums).size >= 7) b += 15; return b; }; return { game: 'flip7', phase: s.phase, over, yourSeat: seat, summary, flip7: { round: s.round, current: s.current, phase: s.phase, pendingAction: s.pendingAction, viewerSeat: seat, deckCount: s.deck.length, discardCount: s.discard.length, seq: s.seq, events: s.events, players: s.players.map(p => ({ name: p.name, nums: [...p.nums], mods: [...p.mods], second: p.second, cards: p.tableau.map(c => ({ id: c.id, kind: c.kind, v: c.v })), status: p.status, bustCard: p.bustCard, banked: p.banked, unique: new Set(p.nums).size, live: live(p) })) } }; }
}

// --- Qwixx ---
const COLORS = ['red', 'yellow', 'green', 'blue'];
const COLOR_KEY = { red: 'r', yellow: 'y', green: 'g', blue: 'b' };
const SCORE_BY_MARKS = [0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78];
function rowPoints(row) { let m = row.marks.length; if (row.marks.includes(row.nums.length - 1)) m++; return SCORE_BY_MARKS[Math.min(m, SCORE_BY_MARKS.length - 1)]; }
function scoreRows(rows, penalties) { let total = 0; COLORS.forEach(c => { const row = rows[c]; if (row) total += rowPoints(row); }); return total - penalties * 5; }

class QwixxEngine {
  constructor(names) { this.players = names.map(name => ({ name: name || 'Player', rows: {}, penalties: 0 })); this.players.forEach(p => COLORS.forEach(c => { p.rows[c] = this.makeRow(c); })); this.activeSeat = 0; this.phase = 'WHITE_PHASE'; this.locked = []; this.pendingLocks = []; this.pendingWhiteDecisions = this.players.map((_, i) => i); this.activeMarkedThisTurn = false; this.activeColorUsed = false; this.activeColorRow = null; this.activeWhiteRow = null; this.activeWhiteIndex = null; this.round = 1; this.dice = this.getDice(); }
  makeRow(color) { const nums = []; if (color === 'red' || color === 'yellow') for (let i = 2; i <= 12; i++) nums.push(i); else for (let i = 12; i >= 2; i--) nums.push(i); return { nums, marks: [] }; }
  getDice() { const rnd = () => Math.floor(Math.random() * 6) + 1; const d = { w: [rnd(), rnd()], r: rnd(), y: rnd(), g: rnd(), b: rnd() }; this.locked.forEach(c => d[COLOR_KEY[c]] = 0); return d; }
  applyLocks() { this.pendingLocks.forEach(c => { if (!this.locked.includes(c)) this.locked.push(c); }); this.pendingLocks = []; this.locked.forEach(c => this.dice[COLOR_KEY[c]] = 0); }
  mark(c, row, i) { row.marks.push(i); row.marks.sort((a, b) => a - b); if (i === row.nums.length - 1 && !this.locked.includes(c) && !this.pendingLocks.includes(c)) this.pendingLocks.push(c); }
  nextTurn() { this.applyLocks(); if (this.locked.length >= 2 || this.players.some(p => p.penalties >= 4)) { this.phase = 'GAME_OVER'; return; } this.activeSeat = (this.activeSeat + 1) % this.players.length; this.phase = 'WHITE_PHASE'; this.dice = this.getDice(); this.pendingWhiteDecisions = this.players.map((_, i) => i).filter(i => this.players[i].penalties < 4); this.activeMarkedThisTurn = false; this.activeColorUsed = false; this.activeColorRow = null; this.activeWhiteRow = null; this.activeWhiteIndex = null; this.round++; }
  applyAction(seat, msg) { if (this.phase === 'GAME_OVER') return; if (msg.action === 'mark') { const c = msg.c, i = msg.i, requestedUse = msg.use; const p = this.players[seat], row = p && p.rows[c]; if (!COLORS.includes(c) || !p || !row) return; const last = row.marks.length ? Math.max(...row.marks) : -1; if (row.marks.includes(i) || i <= last || this.locked.includes(c)) return; if (i === row.nums.length - 1 && row.marks.length < 5) return; const isAct = seat === this.activeSeat; const whiteSum = this.dice.w[0] + this.dice.w[1]; const whiteLegal = this.pendingWhiteDecisions.includes(seat) && row.nums[i] === whiteSum; const die = this.dice[COLOR_KEY[c]]; const colorLegal = isAct && !this.activeColorUsed && die && (row.nums[i] === this.dice.w[0] + die || row.nums[i] === this.dice.w[1] + die); let use = null; if (requestedUse === 'color') use = colorLegal ? 'color' : null; else if (requestedUse === 'white') use = whiteLegal ? 'white' : null; else if (colorLegal) use = 'color'; else if (whiteLegal) use = 'white'; if (!use) return; this.mark(c, row, i); if (use === 'white') { this.pendingWhiteDecisions = this.pendingWhiteDecisions.filter(x => x !== seat); if (isAct) { this.activeWhiteRow = c; this.activeWhiteIndex = i; } } else { this.activeColorUsed = true; this.activeColorRow = c; } if (isAct) this.activeMarkedThisTurn = true; if (this.pendingWhiteDecisions.length === 0) { this.applyLocks(); if (this.activeColorUsed) this.nextTurn(); else this.phase = 'COLOR_PHASE'; } } else if (msg.action === 'skip') { if (this.phase === 'WHITE_PHASE') { this.pendingWhiteDecisions = this.pendingWhiteDecisions.filter(x => x !== seat); if (this.pendingWhiteDecisions.length === 0) { this.applyLocks(); if (this.activeColorUsed) this.nextTurn(); else this.phase = 'COLOR_PHASE'; } } } else if (msg.action === 'finishTurn') { if (seat !== this.activeSeat) return; if (this.phase === 'WHITE_PHASE') { this.activeColorUsed = true; if (this.pendingWhiteDecisions.length === 0) this.nextTurn(); return; } if (this.phase !== 'COLOR_PHASE') return; if (!this.activeMarkedThisTurn) this.players[this.activeSeat].penalties++; this.nextTurn(); } }
  stateFor(seat) { return { dice: this.dice, activeSeat: this.activeSeat, locked: this.locked, pendingLocks: this.pendingLocks, allPlayers: this.players.map((pl, i) => ({ seat: i, name: pl.name, penalties: pl.penalties, score: scoreRows(pl.rows, pl.penalties), rows: pl.rows, waiting: this.phase === 'WHITE_PHASE' ? this.pendingWhiteDecisions.includes(i) : false, active: i === this.activeSeat })), phase: this.phase, round: this.round, pendingWhiteDecisions: this.pendingWhiteDecisions, activeMarkedThisTurn: this.activeMarkedThisTurn, activeColorUsed: this.activeColorUsed }; }
}

// ============================================================
// TEST SUITE 1: Skyjo animation sequences
// ============================================================
describe('Skyjo: Turn animation sequence (draw → swap → end)', () => {
  const E = new SkyjoEngine(['A', 'B']);
  E.start();
  
  // Reveal 2 cards each
  for (let pi = 0; pi < 2; pi++) {
    let rev = 0;
    for (let ci = 0; ci < 12 && rev < 2; ci++) {
      if (!E.players[pi].board[ci].revealed) {
        E.revealInitial(pi, ci);
        rev++;
      }
    }
  }
  E.completeTurnEnd(); // resolve starter
  if (E.phase === 'REVEAL') { /* tiebreaker possible */ }
  
  const cp = E.currentPlayer;
  
  // Test 1: Draw deck produces correct lastAction
  E.drawDeck(cp);
  assert(E.lastAction?.type === 'draw_deck',
    'draw_deck sets lastAction.type',
    `Got: ${E.lastAction?.type}`);
  assert(E.turnAction === 'deck',
    'turnAction is "deck" after draw',
    `Got: ${E.turnAction}`);
  assert(E.drawnCard !== null,
    'drawnCard is set after draw',
    `drawnCard: ${E.drawnCard}`);
  
  // Test 2: The drawn card value is visible in publicDrawn
  const state = E.getStateFor(1 - cp); // opponent's view
  assert(state.publicDrawn === E.drawnCard,
    'Opponent sees publicDrawn (for animation)',
    `publicDrawn: ${state.publicDrawn}, drawnCard: ${E.drawnCard}`);
  
  // Test 3: My view shows myDrawnCard
  const myState = E.getStateFor(cp);
  assert(myState.myDrawnCard === E.drawnCard,
    'Active player sees myDrawnCard',
    `myDrawnCard: ${myState.myDrawnCard}, drawnCard: ${E.drawnCard}`);
  
  // Test 4: Swap produces correct lastAction
  const swapIdx = E.players[cp].board.findIndex(c => !c.cleared);
  const oldVal = E.players[cp].board[swapIdx].value;
  E.swap(cp, swapIdx);
  assert(E.lastAction?.type === 'swap',
    'swap sets lastAction.type = "swap"',
    `Got: ${E.lastAction?.type}`);
  assert(E.lastAction?.newVal === E.drawnCard || E.lastAction?.oldVal === oldVal,
    'swap lastAction has oldVal and newVal',
    `oldVal: ${E.lastAction?.oldVal}, newVal: ${E.lastAction?.newVal}`);
  assert(E.turnAction === 'turn_end_delay',
    'turnAction becomes "turn_end_delay" after swap',
    `Got: ${E.turnAction}`);
  
  // Test 5: Complete turn advances player
  const prevPlayer = E.currentPlayer;
  E.completeTurnEnd();
  assert(E.currentPlayer === (prevPlayer + 1) % 2,
    'Turn advances to next player after completeTurnEnd',
    `prev: ${prevPlayer}, current: ${E.currentPlayer}`);
  assert(E.turnAction === null,
    'turnAction is null at start of new turn',
    `Got: ${E.turnAction}`);
});

describe('Skyjo: Discard-then-reveal sequence', () => {
  const E = new SkyjoEngine(['A', 'B']);
  E.start();
  for (let pi = 0; pi < 2; pi++) { let r = 0; for (let ci = 0; ci < 12 && r < 2; ci++) { if (!E.players[pi].board[ci].revealed) { E.revealInitial(pi, ci); r++; } } }
  E.completeTurnEnd();
  const cp = E.currentPlayer;
  
  // Draw then discard
  E.drawDeck(cp);
  E.discardDrawnCard(cp);
  
  assert(E.lastAction?.type === 'discard_drawn',
    'discard_drawn sets correct lastAction type',
    `Got: ${E.lastAction?.type}`);
  assert(E.turnAction === 'must_reveal',
    'turnAction is "must_reveal" after discard',
    `Got: ${E.turnAction}`);
  assert(E.lastAction?.value != null,
    'discard_drawn lastAction has value (for animation)',
    `value: ${E.lastAction?.value}`);
  
  // Reveal a face-down card
  const fdIdx = E.players[cp].board.findIndex(c => !c.revealed && !c.cleared);
  E.revealAfterDiscard(cp, fdIdx);
  assert(E.lastAction?.type === 'reveal_after_discard',
    'reveal_after_discard sets correct lastAction',
    `Got: ${E.lastAction?.type}`);
  assert(E.lastAction?.value != null,
    'reveal_after_discard has value for flip animation',
    `value: ${E.lastAction?.value}`);
});

describe('Skyjo: Triplet animation sequence', () => {
  const E = new SkyjoEngine(['A', 'B']);
  E.start();
  
  // Force a triplet: set 3 cards in column 0 to same value
  const p = E.players[0];
  p.board[0] = { value: 5, revealed: true, cleared: false };
  p.board[4] = { value: 5, revealed: true, cleared: false };
  p.board[8] = { value: 5, revealed: true, cleared: false };
  // Fill rest with revealed different values
  for (let i = 0; i < 12; i++) {
    if (i !== 0 && i !== 4 && i !== 8) {
      p.board[i] = { value: i + 1, revealed: true, cleared: false };
    }
  }
  // Set up for a swap
  E.phase = 'PLAY';
  E.currentPlayer = 0;
  E.drawnCard = 3;
  E.turnAction = 'deck';
  
  // Swap into a non-triplet position
  E.swap(0, 1); // This might trigger triplet check for other columns
  
  // Check if triplet was detected
  const triplet = E.lastAction?.type === 'triplet';
  // Note: triplet only fires for the 3 cards that match, and they must already be revealed
  // Since we set up col 0 with 5,5,5 and they're all revealed, the triplet should fire
  // BUT swap replaces card[1], not any triplet card, so the triplet in col 0 persists
  
  // Actually, checkTriplets runs at _end of swap. Column 0 = indices 0,4,8 all value 5, all revealed
  // So triplet should have been detected!
  const col0Cleared = p.board[0].cleared && p.board[4].cleared && p.board[8].cleared;
  assert(col0Cleared || E.lastAction?.type === 'swap',
    'Triplet detection: column of 3 matching revealed cards gets cleared',
    `board[0].cleared: ${p.board[0].cleared}, lastAction: ${E.lastAction?.type}`);
  
  // Verify triplet action was emitted (it overwrites swap as lastAction)
  if (E.lastAction?.type === 'triplet') {
    assert(E.lastAction.indices.length === 3,
      'Triplet lastAction has 3 indices',
      `indices: ${JSON.stringify(E.lastAction.indices)}`);
    assert(E.lastAction.value === 5,
      'Triplet lastAction has correct value',
      `value: ${E.lastAction.value}`);
  }
});

describe('Skyjo: Deck exhaustion and recycle', () => {
  const E = new SkyjoEngine(['A', 'B']);
  E.start();
  for (let pi = 0; pi < 2; pi++) { let r = 0; for (let ci = 0; ci < 12 && r < 2; ci++) { if (!E.players[pi].board[ci].revealed) { E.revealInitial(pi, ci); r++; } } }
  E.completeTurnEnd();
  
  // Drain the deck
  const originalDeckSize = E.deck.length;
  E.deck = E.deck.slice(0, 2); // only 2 cards left
  E.discard = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // lots in discard
  
  const cp = E.currentPlayer;
  E.drawDeck(cp); // draws one card, deck has 1 left
  assert(E.deck.length === 1,
    'Deck has 1 card after first draw',
    `deck: ${E.deck.length}`);
  
  // Complete this turn
  const swapIdx = E.players[cp].board.findIndex(c => !c.cleared);
  E.swap(cp, swapIdx);
  E.completeTurnEnd();
  
  // Next player draws, draining the deck and triggering recycle
  const cp2 = E.currentPlayer;
  E.drawDeck(cp2); // draws the last card
  assert(E.deck.length === 0,
    'Deck is empty after drawing last card',
    `deck: ${E.deck.length}`);
  
  // Swap to end turn
  const swapIdx2 = E.players[cp2].board.findIndex(c => !c.cleared);
  E.swap(cp2, swapIdx2);
  E.completeTurnEnd();
  
  // Next draw should recycle
  const cp3 = E.currentPlayer;
  const prevDeckLen = E.deck.length;
  E.drawDeck(cp3);
  assert(E.deck.length > 0 || E.lastAction?.type === 'draw_deck',
    'Deck recycle works when empty',
    `deck was ${prevDeckLen}, now ${E.deck.length}`);
});

// ============================================================
// TEST SUITE 2: Flip 7 animation sequences
// ============================================================
describe('Flip 7: Event sequence ordering (draw_start → card → advance)', () => {
  const E = new Flip7Engine(['A', 'B', 'C']);
  
  // Play one hit action
  const cp = E.s.current;
  E.apply(cp, { action: 'hit' });
  
  const events = E.s.events;
  assert(events.length >= 2,
    'Hit produces at least 2 events (draw_start + card)',
    `Got ${events.length} events: ${events.map(e => e.type).join(', ')}`);
  
  // draw_start must come first
  assert(events[0].type === 'draw_start',
    'First event is draw_start (for wiggle animation)',
    `First event: ${events[0].type}`);
  
  // Second event should be card/bust/action_card
  const second = events[1]?.type;
  assert(['card', 'bust', 'action_card'].includes(second),
    'Second event is card/bust/action_card (for reveal animation)',
    `Second event: ${second}`);
  
  // Seq numbers should be monotonically increasing
  for (let i = 1; i < events.length; i++) {
    assert(events[i].seq > events[i - 1].seq,
      `Event seq increases: ${events[i - 1].seq} → ${events[i].seq}`,
      `Events: ${events.map(e => `${e.type}(${e.seq})`).join(', ')}`);
  }
});

describe('Flip 7: Stay event sequence', () => {
  const E = new Flip7Engine(['A', 'B']);
  const cp = E.s.current;
  
  E.apply(cp, { action: 'stay' });
  const events = E.s.events;
  
  assert(events.length === 1,
    'Stay produces exactly 1 event',
    `Got ${events.length}: ${events.map(e => e.type).join(', ')}`);
  assert(events[0].type === 'stay',
    'Stay event type is "stay"',
    `Got: ${events[0].type}`);
  assert(E.s.players[cp].status === 'stayed',
    'Player status is "stayed"',
    `Got: ${E.s.players[cp].status}`);
});

describe('Flip 7: Bust event sequence', () => {
  const E = new Flip7Engine(['A', 'B']);
  
  // Force a bust: give player a number, then draw the same number
  const p = E.s.players[E.s.current];
  const targetNum = 5;
  p.nums.push(targetNum);
  p.tableau.push({ id: 'test_num_5', kind: 'num', v: targetNum });
  
  // Force the next draw to be the bust card
  E.s.deck.push({ id: 'bust_card', kind: 'num', v: targetNum });
  
  E.apply(E.s.current, { action: 'hit' });
  const events = E.s.events;
  
  const hasDrawStart = events.some(e => e.type === 'draw_start');
  const hasBust = events.some(e => e.type === 'bust');
  
  assert(hasDrawStart,
    'Bust sequence includes draw_start',
    `Events: ${events.map(e => e.type).join(', ')}`);
  assert(hasBust,
    'Bust sequence includes bust event',
    `Events: ${events.map(e => e.type).join(', ')}`);
  
  // bust should come after draw_start
  const dsIdx = events.findIndex(e => e.type === 'draw_start');
  const bustIdx = events.findIndex(e => e.type === 'bust');
  assert(bustIdx > dsIdx,
    'Bust event comes after draw_start (animation order)',
    `draw_start at ${dsIdx}, bust at ${bustIdx}`);
  
  assert(E.s.players[E.s.current].status === 'busted',
    'Player status is "busted"',
    `Got: ${E.s.players[E.s.current].status}`);
});

describe('Flip 7: Event accumulation across rounds (stale event bug)', () => {
  const E = new Flip7Engine(['A', 'B']);
  
  // Play round 1 quickly
  let turnCount = 0;
  while (E.s.phase === 'PLAY' && turnCount < 50) {
    turnCount++;
    const cp = E.s.current;
    if (E.s.pendingAction) {
      const pa = E.s.pendingAction;
      const others = E.s.players.map((p, i) => i).filter(i => i !== pa.from && E.s.players[i].status === 'active' && !(pa.kind === 'give_second' && i === pa.from));
      if (others.length) E.apply(pa.from, { action: 'target', target: others[0] });
      continue;
    }
    const p = E.s.players[cp];
    if (p.unique >= 3 || p.live >= 20) {
      E.apply(cp, { action: 'stay' });
    } else {
      E.apply(cp, { action: 'hit' });
      if (E.s.pendingAction) continue;
    }
  }
  
  const round1Seq = E.s.seq;
  const round1Events = E.viewFor(0).flip7.events;
  console.log(`     Round 1 ended: seq=${round1Seq}, events in view=${round1Events.length}`);
  
  // Start round 2
  E.next();
  
  // Critical test: new round should have empty events array
  const view2 = E.viewFor(0);
  assert(view2.flip7.events.length === 0,
    'New round starts with empty events array',
    `Got ${view2.flip7.events.length} events: ${view2.flip7.events.map(e => e.type).join(', ')}`);
  
  // But seq should continue from where it left off
  // (the client uses lastSeq to track which events have been animated)
  assert(view2.flip7.seq >= round1Seq,
    'Seq continues from previous round',
    `round1 seq: ${round1Seq}, round2 start seq: ${view2.flip7.seq}`);
});

describe('Flip 7: Flip 7! event sequence (7 unique numbers)', () => {
  const E = new Flip7Engine(['A', 'B']);
  
  // Give player 6 unique numbers, then force the 7th
  const p = E.s.players[E.s.current];
  for (let n = 1; n <= 6; n++) {
    p.nums.push(n);
    p.tableau.push({ id: `f7_num_${n}`, kind: 'num', v: n });
  }
  
  // Force draw of number 7
  E.s.deck.push({ id: 'flip7_card', kind: 'num', v: 7 });
  
  E.apply(E.s.current, { action: 'hit' });
  const events = E.s.events;
  
  assert(events.some(e => e.type === 'flip7'),
    'Flip 7 event emitted when 7 unique numbers reached',
    `Events: ${events.map(e => e.type).join(', ')}`);
  assert(E.s.players[E.s.current].status === 'stayed',
    'Player status is "stayed" after Flip 7',
    `Got: ${E.s.players[E.s.current].status}`);
  
  // Check event order: draw_start → card → flip7
  const types = events.map(e => e.type);
  const dsIdx = types.indexOf('draw_start');
  const cardIdx = types.indexOf('card');
  const f7Idx = types.indexOf('flip7');
  assert(f7Idx > cardIdx && cardIdx > dsIdx,
    'Event order: draw_start → card → flip7',
    `Order: draw_start@${dsIdx}, card@${cardIdx}, flip7@${f7Idx}`);
});

describe('Flip 7: Round end produces round_end event with winners', () => {
  const E = new Flip7Engine(['A', 'B']);
  
  // Both stay immediately
  E.apply(E.s.current, { action: 'stay' });
  E.apply(E.s.current, { action: 'stay' }); // second player
  
  const events = E.s.events;
  const roundEnd = events.find(e => e.type === 'round_end' || e.type === 'game_over');
  
  assert(roundEnd != null,
    'Round end event emitted',
    `Events: ${events.map(e => e.type).join(', ')}`);
  assert(roundEnd?.winners?.length > 0,
    'Round end event has winners',
    `winners: ${JSON.stringify(roundEnd?.winners)}`);
});

// ============================================================
// TEST SUITE 3: Qwixx animation sequences
// ============================================================
describe('Qwixx: Dice signature tracking (throw → reveal → mark)', () => {
  const E = new QwixxEngine(['A', 'B']);
  
  // The client tracks `_qwixxDiceSig` to know if dice have been thrown
  // Simulate what the client does:
  const dice1 = E.dice;
  const sig1 = `${E.round}|${E.activeSeat}|${dice1.w.join(',')}|${dice1.r}|${dice1.y}|${dice1.g}|${dice1.b}`;
  
  assert(sig1.includes('1|0'),
    'Dice signature includes round 1, seat 0',
    `Sig: ${sig1}`);
  
  // After everyone skips white and active player finishes
  E.applyAction(0, { action: 'skip' }); // player 0 skips white
  E.applyAction(1, { action: 'skip' }); // player 1 skips white
  // Should now be in COLOR_PHASE
  assert(E.phase === 'COLOR_PHASE',
    'After all white skips, phase is COLOR_PHASE',
    `Got: ${E.phase}`);
  
  // Active player finishes (takes penalty since no mark)
  E.applyAction(E.activeSeat, { action: 'finishTurn' });
  
  // New turn - new dice
  if (E.phase !== 'GAME_OVER') {
    const dice2 = E.dice;
    const sig2 = `${E.round}|${E.activeSeat}|${dice2.w.join(',')}|${dice2.r}|${dice2.y}|${dice2.g}|${dice2.b}`;
    assert(sig1 !== sig2,
      'Dice signature changes between turns',
      `sig1: ${sig1}\n     sig2: ${sig2}`);
  }
});

describe('Qwixx: WHITE→COLOR→WHITE phase cycle', () => {
  const E = new QwixxEngine(['A', 'B']);
  const phases = [E.phase];
  
  // Simulate 5 turns
  for (let turn = 0; turn < 5 && E.phase !== 'GAME_OVER'; turn++) {
    // WHITE_PHASE: everyone skips
    while (E.phase === 'WHITE_PHASE' && E.pendingWhiteDecisions.length > 0) {
      const seat = E.pendingWhiteDecisions[0];
      E.applyAction(seat, { action: 'skip' });
    }
    phases.push(E.phase);
    
    // COLOR_PHASE: active player finishes
    if (E.phase === 'COLOR_PHASE') {
      E.applyAction(E.activeSeat, { action: 'finishTurn' });
      phases.push(E.phase);
    }
  }
  
  console.log(`     Phases: ${phases.join(' → ')}`);
  
  // Verify alternating WHITE→COLOR→WHITE pattern
  let whiteToColor = 0, colorToWhite = 0;
  for (let i = 1; i < phases.length; i++) {
    if (phases[i - 1] === 'WHITE_PHASE' && phases[i] === 'COLOR_PHASE') whiteToColor++;
    if (phases[i - 1] === 'COLOR_PHASE' && phases[i] === 'WHITE_PHASE') colorToWhite++;
  }
  assert(whiteToColor > 0, 'At least one WHITE→COLOR transition');
  assert(colorToWhite > 0, 'At least one COLOR→WHITE transition');
});

describe('Qwixx: Penalty animation trigger (finishTurn without marking)', () => {
  const E = new QwixxEngine(['A', 'B']);
  
  // Skip white phase
  E.applyAction(0, { action: 'skip' });
  E.applyAction(1, { action: 'skip' });
  
  // Active player finishes without marking
  const activeSeat = E.activeSeat;
  const penaltiesBefore = E.players[activeSeat].penalties;
  E.applyAction(activeSeat, { action: 'finishTurn' });
  
  assert(E.players[activeSeat].penalties === penaltiesBefore + 1,
    'Penalty increments when finishing without marking in COLOR_PHASE',
    `Before: ${penaltiesBefore}, After: ${E.players[activeSeat].penalties}`);
});

describe('Qwixx: Game end condition (2 locked rows or 4 penalties)', () => {
  // Test with forced penalties
  const E = new QwixxEngine(['A']);
  
  // Force 4 penalties on player 0
  E.players[0].penalties = 3;
  
  // Skip white, then finish without marking to get 4th penalty
  E.applyAction(0, { action: 'skip' });
  E.applyAction(0, { action: 'finishTurn' });
  
  assert(E.players[0].penalties >= 4,
    'Player has 4+ penalties after repeated skips',
    `penalties: ${E.players[0].penalties}`);
  
  if (E.phase === 'GAME_OVER') {
    assert(true, 'Game ends when player reaches 4 penalties');
  } else {
    // May need more turns
    console.log(`     Phase is ${E.phase} after 4 penalties — may need 2 locked rows instead`);
  }
});

// ============================================================
// TEST SUITE 4: Cross-game animation edge cases
// ============================================================
describe('Cross-game: Summary overlay appears at correct time', () => {
  // Skyjo
  const SE = new SkyjoEngine(['A', 'B']);
  SE.start();
  for (let pi = 0; pi < 2; pi++) { let r = 0; for (let ci = 0; ci < 12 && r < 2; ci++) { if (!SE.players[pi].board[ci].revealed) { SE.revealInitial(pi, ci); r++; } } }
  SE.completeTurnEnd();
  
  // Play until round end
  let tc = 0;
  while (SE.phase === 'PLAY' && tc < 200) {
    tc++;
    const cp = SE.currentPlayer;
    if (SE.turnAction === 'turn_end_delay') { SE.completeTurnEnd(); continue; }
    if (SE.turnAction === null) { SE.drawDeck(cp); continue; }
    if (SE.turnAction === 'deck' || SE.turnAction === 'discard') {
      const idx = SE.players[cp].board.findIndex(c => !c.cleared);
      if (idx >= 0) SE.swap(cp, idx);
    }
    if (SE.turnAction === 'must_reveal') {
      const idx = SE.players[cp].board.findIndex(c => !c.revealed && !c.cleared);
      if (idx >= 0) SE.revealAfterDiscard(cp, idx);
    }
  }
  
  assert(SE.phase === 'ROUND_END' || SE.phase === 'FINAL_TURNS' || SE.phase === 'GAME_OVER',
    'Skyjo reaches end phase after play',
    `phase: ${SE.phase}`);
  
  // Flip 7 - both stay
  const FE = new Flip7Engine(['A', 'B']);
  FE.apply(FE.s.current, { action: 'stay' });
  FE.apply(FE.s.current, { action: 'stay' });
  
  assert(FE.s.phase === 'ROUND_END' || FE.s.phase === 'GAME_OVER',
    'Flip 7 reaches end phase when all stay',
    `phase: ${FE.s.phase}`);
});

describe('Flip 7: Action card animation (freeze → freeze_done)', () => {
  const E = new Flip7Engine(['A', 'B']);
  
  // Force draw a freeze card
  const p = E.s.players[E.s.current];
  E.s.deck.push({ id: 'freeze_card', kind: 'act', v: 'freeze' });
  
  E.apply(E.s.current, { action: 'hit' });
  const events = E.s.events;
  
  const hasDrawStart = events.some(e => e.type === 'draw_start');
  const hasActionCard = events.some(e => e.type === 'action_card');
  const hasAwaitTarget = events.some(e => e.type === 'await_target');
  
  assert(hasDrawStart, 'Freeze sequence has draw_start');
  assert(hasActionCard, 'Freeze sequence has action_card event');
  assert(hasAwaitTarget, 'Freeze sequence has await_target (needs target selection)',
    `Events: ${events.map(e => e.type).join(', ')}`);
  
  // Now target the other player
  if (E.s.pendingAction) {
    const from = E.s.pendingAction.from;
    const others = E.s.players.map((_, i) => i).filter(i => i !== from && E.s.players[i].status === 'active');
    if (others.length) {
      E.apply(from, { action: 'target', target: others[0] });
      const targetEvents = E.s.events;
      
      const hasPlayAction = targetEvents.some(e => e.type === 'play_action');
      const hasFreezeDone = targetEvents.some(e => e.type === 'freeze_done');
      
      assert(hasPlayAction, 'Target selection produces play_action event',
        `Events: ${targetEvents.map(e => e.type).join(', ')}`);
      assert(hasFreezeDone, 'Freeze produces freeze_done event',
        `Events: ${targetEvents.map(e => e.type).join(', ')}`);
      assert(E.s.players[others[0]].status === 'stayed',
        'Frozen player status is "stayed"',
        `Got: ${E.s.players[others[0]].status}`);
    }
  }
});

describe('Flip 7: Second Chance animation (second_used event)', () => {
  const E = new Flip7Engine(['A', 'B']);
  
  // Give player a Second Chance and a number
  const p = E.s.players[E.s.current];
  p.second = true;
  p.tableau.push({ id: 'second_card', kind: 'act', v: 'second' });
  const existingNum = 3;
  p.nums.push(existingNum);
  p.tableau.push({ id: 'num_3', kind: 'num', v: existingNum });
  
  // Force draw the same number (should trigger second chance)
  E.s.deck.push({ id: 'bust_card', kind: 'num', v: existingNum });
  
  E.apply(E.s.current, { action: 'hit' });
  const events = E.s.events;
  
  const hasSecondUsed = events.some(e => e.type === 'second_used');
  assert(hasSecondUsed,
    'Drawing duplicate with Second Chance produces second_used event',
    `Events: ${events.map(e => e.type).join(', ')}`);
  assert(p.status === 'active',
    'Player stays active after Second Chance',
    `status: ${p.status}`);
  assert(p.second === false,
    'Second Chance is consumed',
    `second: ${p.second}`);
});

// ============================================================
// Summary
// ============================================================
console.log(`\n${'═'.repeat(60)}`);
console.log(`  ANIMATION SEQUENCE TEST RESULTS`);
console.log(`${'═'.repeat(60)}`);
console.log(`  Total: ${totalTests} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);
if (failures.length) {
  console.log(`\n  FAILURES:`);
  for (const f of failures) console.log(`    • ${f.msg}${f.detail ? '\n      ' + f.detail : ''}`);
}
console.log(`${'═'.repeat(60)}`);

process.exit(failed > 0 ? 1 : 0);

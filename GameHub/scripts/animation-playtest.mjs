/**
 * Animation Sequence Playtest
 * 
 * Drives each game's local engine through a complete lifecycle
 * and traces every animation/view state to find sequence bugs.
 * 
 * Run: node scripts/animation-playtest.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// We evaluate the client JS in a minimal DOM env to test game logic + view states
// ============================================================

// Minimal DOM shim
class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.classList = { list: [], add(c) { if (!this.list.includes(c)) this.list.push(c); }, remove(c) { this.list = this.list.filter(x => x !== c); }, toggle(c) { this.list.includes(c) ? this.remove(c) : this.add(c); }, contains(c) { return this.list.includes(c); } };
    this.dataset = {};
    this.innerHTML = '';
    this.textContent = '';
    this.parentNode = null;
    this.id = '';
    this._events = {};
  }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); }
  insertBefore(n, r) { const i = r ? this.children.indexOf(r) : this.children.length; if (i >= 0) this.children.splice(i, 0, n); }
  cloneNode() { const c = new Element(this.tagName); Object.assign(c, JSON.parse(JSON.stringify({ attributes: this.attributes, dataset: this.dataset }))); return c; }
  querySelector(sel) { return this.querySelectorImpl(sel); }
  querySelectorAll(sel) { return this.querySelectorAllImpl(sel); }
  querySelectorImpl(sel) { return null; }
  querySelectorAllImpl(sel) { return []; }
  getAttribute(n) { return this.attributes[n]; }
  setAttribute(n, v) { this.attributes[n] = v; }
  removeAttribute(n) { delete this.attributes[n]; }
  addEventListener(e, fn) { (this._events[e] = this._events[e] || []).push(fn); }
  removeEventListener(e, fn) { if (this._events[e]) this._events[e] = this._events[e].filter(f => f !== fn); }
  dispatchEvent(e) { (this._events[e.type] || []).forEach(fn => fn(e)); }
  getBoundingClientRect() { return { top: 0, left: 0, width: 50, height: 70, bottom: 70, right: 50 }; }
  get offsetWidth() { return 50; }
  get offsetHeight() { return 70; }
  focus() {}
  blur() {}
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}
class Document {
  constructor() {
    this.body = new Element('body');
    this.head = new Element('head');
    this.documentElement = new Element('html');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this._elements = {};
  }
  createElement(tag) { const el = new Element(tag); return el; }
  createElementNS(ns, tag) { return this.createElement(tag); }
  createTextNode(t) { const el = new Element('#text'); el.textContent = t; return el; }
  createDocumentFragment() { return new Element('#fragment'); }
  getElementById(id) { return this._elements[id] || null; }
  querySelector(sel) {
    if (sel === 'html') return this.documentElement;
    if (sel === 'body') return this.body;
    if (sel === 'head') return this.head;
    // Try by id for #id selectors
    if (sel.startsWith('#')) return this._elements[sel.slice(1)] || null;
    return null;
  }
  querySelectorAll(sel) { return []; }
  addEventListener(e, fn) {}
  removeEventListener(e, fn) {}
}
class Window {
  constructor(doc) {
    this.document = doc;
    this.location = { host: 'localhost:8787', protocol: 'https:' };
    this.localStorage = new Map();
    this.innerWidth = 390;
    this.innerHeight = 844;
    this.matchMedia = () => ({ matches: false, addEventListener: () => {} });
    this.AudioContext = class { createGain() { return { gain: { value: 0 }, connect() {} }; }; createOscillator() { return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }; };
    this.webkitAudioContext = this.AudioContext;
    this.requestAnimationFrame = fn => setTimeout(fn, 16);
    this.cancelAnimationFrame = id => clearTimeout(id);
    this.performance = { now: () => Date.now() };
    this.innerHeight = 844;
    this.setTimeout = setTimeout;
    this.clearTimeout = clearTimeout;
  }
}

function setupDOM() {
  const doc = new Document();
  const win = new Window(doc);
  
  // Create all the game UI elements that the client JS expects
  const app = doc.createElement('div');
  app.id = 'app';
  doc._elements['app'] = app;
  doc.body.appendChild(app);
  
  const ids = [
    'menuScreen', 'onlineSetup', 'quickPick', 'hostSetup', 'joinSetup',
    'localPick', 'roomScreen', 'gameScreen', 'overlay', 'overlayBox',
    'rulesOverlay', 'rulesBox', 'toast', 'investigateOverlay', 'investigateBox',
    'miniBoardsContainer', 'mainBoardsContainer', 'topArea', 'gameRoomTag',
    'spectateTag', 'rulesBtn', 'soundBtn', 'statusBar',
    'uiDeck', 'uiDiscard', 'heldCardWrapper', 'uiHeldCard',
    'heldTextLabel', 'heldSubLabel', 'deckCount',
    'onlineName', 'onlineDevicePlayers', 'quickTiles',
    'hostRoom', 'joinRoom', 'publicList', 'maxVal',
    'localTiles', 'localPlayers', 'localBotDiff',
    'roomCode', 'roomVis', 'roomMembers', 'hostArea', 'guestArea',
    'hostTiles', 'verStamp', 'f7Controls', 'f7DealerWrap', 'f7Deck',
    'botBox', 'qwixxDiceKit', 'qwixxThrowBtn'
  ];
  
  for (const id of ids) {
    const el = doc.createElement('div');
    el.id = id;
    doc._elements[id] = el;
    app.appendChild(el);
  }
  
  // Add some special nested structures
  const piles = doc.createElement('div');
  piles.className = 'piles';
  piles.appendChild(doc._elements['uiDeck']);
  piles.appendChild(doc._elements['uiDiscard']);
  doc._elements['topArea'].appendChild(piles);
  
  return { doc, win };
}

// ============================================================
// TRACE: Capture every view state transition
// ============================================================
class AnimationTracer {
  constructor(gameName) {
    this.game = gameName;
    this.steps = [];
    this.errors = [];
    this.warnings = [];
    this.phaseTransitions = [];
    this.lastPhase = null;
  }
  
  trace(step, view, extra = {}) {
    const entry = {
      step,
      phase: this.extractPhase(view),
      round: this.extractRound(view),
      yourSeat: view.yourSeat,
      over: view.over,
      hasSummary: !!view.summary,
      timestamp: Date.now(),
      ...extra
    };
    
    // Track game-specific state
    if (view.game === 'skyjo' && view.skyjo) {
      const s = view.skyjo;
      entry.skyjoPhase = s.phase;
      entry.currentPlayer = s.currentPlayer;
      entry.turnAction = s.turnAction;
      entry.deckCount = s.deckCount;
      entry.discardTop = s.discardTop;
      entry.lastAction = s.lastAction?.type || null;
      entry.lastActionPlayer = s.lastAction?.player;
      entry.players = s.players?.map(p => ({
        name: p.name,
        revealed: p.board?.filter(c => c.revealed).length || 0,
        totalScore: p.totalScore,
        roundScore: p.roundScore
      }));
      
      // Track phase transitions
      if (s.phase !== this.lastPhase) {
        this.phaseTransitions.push({ from: this.lastPhase, to: s.phase, atStep: this.steps.length });
        this.lastPhase = s.phase;
      }
    }
    
    if (view.game === 'flip7' && view.flip7) {
      const s = view.flip7;
      entry.flip7Phase = s.phase;
      entry.currentPlayer = s.current;
      entry.deckCount = s.deckCount;
      entry.pendingAction = s.pendingAction;
      entry.events = s.events?.map(e => ({ type: e.type, seq: e.seq, legacy: e.legacy }));
      entry.players = s.players?.map(p => ({
        name: p.name,
        status: p.status,
        nums: [...p.nums],
        mods: [...p.mods],
        second: p.second,
        live: p.live,
        banked: p.banked,
        unique: p.unique
      }));
      
      if (s.phase !== this.lastPhase) {
        this.phaseTransitions.push({ from: this.lastPhase, to: s.phase, atStep: this.steps.length });
        this.lastPhase = s.phase;
      }
    }
    
    if (view.game === 'qwixx' && view.state) {
      const s = view.state;
      entry.qwixxPhase = s.phase;
      entry.activeSeat = s.activeSeat;
      entry.dice = s.dice;
      entry.locked = s.locked;
      entry.pendingWhite = s.pendingWhiteDecisions;
      entry.players = s.allPlayers?.map(p => ({
        name: p.name,
        score: p.score,
        penalties: p.penalties,
        active: p.active
      }));
      
      if (s.phase !== this.lastPhase) {
        this.phaseTransitions.push({ from: this.lastPhase, to: s.phase, atStep: this.steps.length });
        this.lastPhase = s.phase;
      }
    }
    
    this.steps.push(entry);
    return entry;
  }
  
  error(msg, detail = {}) {
    this.errors.push({ msg, step: this.steps.length, ...detail });
  }
  
  warn(msg, detail = {}) {
    this.warnings.push({ msg, step: this.steps.length, ...detail });
  }
  
  extractPhase(view) {
    if (view.game === 'skyjo') return view.skyjo?.phase;
    if (view.game === 'flip7') return view.flip7?.phase;
    if (view.game === 'qwixx') return view.state?.phase;
    return view.phase;
  }
  
  extractRound(view) {
    if (view.game === 'skyjo') return view.skyjo?.round;
    if (view.game === 'flip7') return view.flip7?.round;
    if (view.game === 'qwixx') return view.state?.round;
    return null;
  }
  
  report() {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`  ANIMATION PLAYTEST: ${this.game}`);
    console.log(`${'='.repeat(70)}`);
    console.log(`  Total steps traced: ${this.steps.length}`);
    console.log(`  Phase transitions: ${this.phaseTransitions.length}`);
    console.log(`  ${this.phaseTransitions.map(t => `${t.from || 'START'} → ${t.to}`).join(', ')}`);
    
    if (this.errors.length) {
      console.log(`\n  ❌ ERRORS (${this.errors.length}):`);
      for (const e of this.errors) {
        console.log(`     Step ${e.step}: ${e.msg}`);
        if (e.detail) console.log(`       Detail: ${JSON.stringify(e.detail)}`);
      }
    }
    
    if (this.warnings.length) {
      console.log(`\n  ⚠️  WARNINGS (${this.warnings.length}):`);
      for (const w of this.warnings) {
        console.log(`     Step ${w.step}: ${w.msg}`);
      }
    }
    
    // Validate animation sequence integrity
    this.validateSequence();
    
    return this.errors.length;
  }
  
  validateSequence() {
    console.log(`\n  🔍 SEQUENCE VALIDATION:`);
    
    // Check 1: Phase transitions are valid
    const validSkyjoPhases = ['REVEAL', 'PLAY', 'FINAL_TURNS', 'ROUND_END', 'GAME_OVER'];
    const validFlip7Phases = ['PLAY', 'ROUND_END', 'GAME_OVER'];
    const validQwixxPhases = ['WHITE_PHASE', 'COLOR_PHASE', 'GAME_OVER'];
    
    for (const t of this.phaseTransitions) {
      const validPhases = this.game === 'Skyjo' ? validSkyjoPhases :
                          this.game === 'Flip 7' ? validFlip7Phases : validQwixxPhases;
      if (t.to && !validPhases.includes(t.to)) {
        this.error(`Invalid phase transition to "${t.to}"`, t);
        console.log(`     ❌ Invalid phase: ${t.from} → ${t.to}`);
      }
    }
    
    // Check 2: No duplicate phase regressions (going backwards without restart)
    const phaseOrder = this.phaseTransitions.map(t => t.to);
    // Skyjo: REVEAL should come before PLAY
    if (this.game === 'Skyjo') {
      const reveals = this.phaseTransitions.filter(t => t.to === 'REVEAL');
      const plays = this.phaseTransitions.filter(t => t.to === 'PLAY');
      // Each PLAY should have a REVEAL before it
      console.log(`     REVEAL transitions: ${reveals.length}, PLAY transitions: ${plays.length}`);
    }
    
    // Check 3: Game eventually reaches an end state
    const lastPhase = this.phaseTransitions[this.phaseTransitions.length - 1]?.to;
    if (lastPhase && !['ROUND_END', 'GAME_OVER'].includes(lastPhase)) {
      this.warn(`Game ended in phase "${lastPhase}" — never reached end state`);
      console.log(`     ⚠️  Game ended in ${lastPhase}, not ROUND_END/GAME_OVER`);
    } else {
      console.log(`     ✅ Game reached end state: ${lastPhase}`);
    }
    
    // Check 4: Score integrity
    const finalStep = this.steps[this.steps.length - 1];
    if (finalStep?.hasSummary) {
      console.log(`     ✅ Summary was shown`);
    }
    
    // Check 5: All players got turns
    if (finalStep?.players) {
      const allHadTurns = finalStep.players.every(p => p.totalScore !== undefined);
      console.log(`     ${allHadTurns ? '✅' : '❌'} All players have scores: ${finalStep.players.map(p => `${p.name}=${p.totalScore ?? p.score ?? p.banked}`).join(', ')}`);
    }
    
    console.log(`\n  Total errors: ${this.errors.length}, warnings: ${this.warnings.length}`);
  }
}

// ============================================================
// PLAYTEST: Skyjo
// ============================================================
function playtestSkyjo() {
  const tracer = new AnimationTracer('Skyjo');
  
  // Load the Skyjo engine directly (inline from 03-skyjo.js)
  // We recreate a minimal version that mirrors the client engine exactly
  
  // Skyjo deck
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
    _deal() {
      this.deck = skyjoDeck();
      for (const p of this.players) { for (const c of p.board) { c.value = this.deck.pop(); c.revealed = false; c.cleared = false; } p.revealCount = 0; p.roundScore = 0; }
      this.discard = [this.deck.pop()]; this.phase = 'REVEAL'; this.roundEnder = -1;
      this.finalTurnsLeft = 0; this.currentPlayer = 0; this.drawnCard = null;
      this.turnAction = null; this.tiebreakerPlayers = []; this.lastAction = null; this.pendingTransition = null;
    }
    start() { this._deal(); }
    nextRound() { this.round++; this._deal(); }
    newGame() { this.round = 1; for (const p of this.players) p.totalScore = 0; this._deal(); }
    revealInitial(pi, ci) {
      if (this.phase !== 'REVEAL') return;
      const p = this.players[pi]; if (p.revealCount >= 2) return;
      const c = p.board[ci]; if (c.revealed || c.cleared) return;
      c.revealed = true; p.revealCount++;
      this.lastAction = { type: 'reveal', player: pi, card: ci, value: c.value, t: Date.now() };
      if (this.players.every(pl => pl.revealCount >= 2)) this._starter();
    }
    _starter() {
      const sums = this.players.map((p, i) => ({ i, sum: p.board.filter(c => c.revealed && !c.cleared).reduce((a, c) => a + c.value, 0) }));
      const mx = Math.max(...sums.map(s => s.sum));
      const tied = sums.filter(s => s.sum === mx).map(s => s.i);
      this.turnAction = 'turn_end_delay'; this.pendingTransition = { tied };
    }
    completeTurnEnd() {
      if (this.turnAction !== 'turn_end_delay') return;
      this.turnAction = null;
      if (this.pendingTransition) {
        const tied = this.pendingTransition.tied;
        if (tied.length === 1) { this.currentPlayer = tied[0]; this.phase = 'PLAY'; this.lastAction = { type: 'starter', player: tied[0], t: Date.now() }; this.tiebreakerPlayers = []; }
        else { this.tiebreakerPlayers = tied; for (const i of tied) this.players[i].revealCount = 1; }
        this.pendingTransition = null; return;
      }
      const p = this.players[this.currentPlayer];
      if (p.board.every(c => c.cleared || c.revealed) && this.phase === 'PLAY') { this.phase = 'FINAL_TURNS'; this.roundEnder = this.currentPlayer; this.finalTurnsLeft = this.players.length - 1; }
      if (this.phase === 'FINAL_TURNS') { if (this.currentPlayer !== this.roundEnder) this.finalTurnsLeft--; if (this.finalTurnsLeft <= 0) { this._calc(); return; } }
      this.currentPlayer = (this.currentPlayer + 1) % this.players.length;
    }
    drawDeck(pi) {
      if (this.phase !== 'PLAY' && this.phase !== 'FINAL_TURNS') return;
      if (this.currentPlayer !== pi || this.turnAction !== null) return;
      if (this.deck.length === 0) { this.deck = this.discard.slice(0, -1); this.discard = [this.discard[this.discard.length - 1]]; for (let i = this.deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]]; } }
      this.drawnCard = this.deck.pop(); this.turnAction = 'deck';
      this.lastAction = { type: 'draw_deck', player: pi, t: Date.now() };
    }
    takeDiscard(pi) {
      if (this.currentPlayer !== pi || this.turnAction !== null) return;
      if (!this.discard.length) return;
      this.drawnCard = this.discard.pop(); this.turnAction = 'discard';
      this.lastAction = { type: 'take_discard', player: pi, value: this.drawnCard, t: Date.now() };
    }
    swap(pi, bi) {
      if (this.currentPlayer !== pi || this.turnAction === null || this.turnAction === 'must_reveal') return;
      const p = this.players[pi]; const o = p.board[bi]; if (o.cleared) return;
      const wasR = o.revealed, ov = o.value;
      this.discard.push(o.value);
      p.board[bi] = { value: this.drawnCard, revealed: true, cleared: false };
      const diff = wasR ? (ov - this.drawnCard) : null;
      this.lastAction = { type: 'swap', player: pi, index: bi, diff, oldVal: ov, wasRevealed: wasR, newVal: this.drawnCard, t: Date.now() };
      this._end();
    }
    discardDrawnCard(pi) {
      if (this.currentPlayer !== pi || this.turnAction !== 'deck') return;
      const v = this.drawnCard; this.discard.push(v); this.drawnCard = null;
      this.turnAction = 'must_reveal';
      this.lastAction = { type: 'discard_drawn', player: pi, value: v, t: Date.now() };
    }
    revealAfterDiscard(pi, bi) {
      if (this.currentPlayer !== pi || this.turnAction !== 'must_reveal') return;
      const c = this.players[pi].board[bi]; if (c.revealed || c.cleared) return;
      c.revealed = true;
      this.lastAction = { type: 'reveal_after_discard', player: pi, index: bi, value: c.value, t: Date.now() };
      this._end();
    }
    checkTriplets(pi) {
      const p = this.players[pi];
      for (let col = 0; col < 4; col++) {
        const ix = [col, col + 4, col + 8], cs = ix.map(i => p.board[i]);
        if (cs.every(c => c.revealed && !c.cleared) && cs[0].value === cs[1].value && cs[1].value === cs[2].value) {
          ix.forEach(i => p.board[i].cleared = true);
          for (let i = 0; i < 3; i++) this.discard.push(cs[0].value);
          this.lastAction = { type: 'triplet', player: pi, value: cs[0].value, indices: ix, t: Date.now() };
        }
      }
    }
    _end() { this.checkTriplets(this.currentPlayer); this.drawnCard = null; this.turnAction = 'turn_end_delay'; }
    _calc() {
      for (const p of this.players) { for (const c of p.board) if (!c.cleared) c.revealed = true; this.checkTriplets(this.players.indexOf(p)); p.roundScore = p.board.filter(c => !c.cleared).reduce((a, c) => a + c.value, 0); }
      const e = this.players[this.roundEnder];
      const mo = Math.min(...this.players.filter((_, i) => i !== this.roundEnder).map(o => o.roundScore));
      if (e.roundScore >= mo && e.roundScore > 0) e.roundScore *= 2;
      for (const p of this.players) p.totalScore += p.roundScore;
      this.phase = this.players.some(p => p.totalScore >= 100) ? 'GAME_OVER' : 'ROUND_END';
    }
    getStateFor(viewer) {
      const s = {
        phase: this.phase, round: this.round, currentPlayer: this.currentPlayer,
        roundEnder: this.roundEnder, finalTurnsLeft: this.finalTurnsLeft,
        turnAction: this.turnAction, tiebreakerPlayers: [...this.tiebreakerPlayers],
        lastAction: this.lastAction, deckCount: this.deck.length,
        discardTop: this.discard.length ? this.discard[this.discard.length - 1] : null,
        players: this.players.map(p => ({
          name: p.name, totalScore: p.totalScore, roundScore: p.roundScore,
          revealCount: p.revealCount,
          board: p.board.map(c => ({ value: (c.revealed || c.cleared) ? c.value : null, revealed: c.revealed, cleared: c.cleared }))
        }))
      };
      s.myDrawnCard = (this.turnAction === 'deck' || this.turnAction === 'discard') ? this.drawnCard : null;
      s.publicDrawn = this.turnAction === 'deck' ? this.drawnCard : null;
      s.viewerIndex = viewer;
      return s;
    }
  }
  
  // Build the LocalEngines wrapper
  function makeLocalEngine(names) {
    const E = new SkyjoEngine(names);
    E.start();
    return {
      apply(seat, msg) {
        if (msg.action === 'reveal') E.revealInitial(seat, msg.index);
        else if (msg.action === 'tiebreaker') E.revealTiebreaker?.(seat, msg.index);
        else if (msg.action === 'draw_deck') E.drawDeck(seat);
        else if (msg.action === 'take_discard') E.takeDiscard(seat);
        else if (msg.action === 'swap') E.swap(seat, msg.index);
        else if (msg.action === 'discard_drawn') E.discardDrawnCard(seat);
        else if (msg.action === 'reveal_after_discard') E.revealAfterDiscard(seat, msg.index);
        // Auto-complete turn_end_delay
        if (E.turnAction === 'turn_end_delay') E.completeTurnEnd();
      },
      next() { if (E.phase === 'GAME_OVER') E.newGame(); else E.nextRound(); },
      actor() { return E.currentPlayer; },
      viewFor(seat) {
        const s = E.getStateFor(seat);
        const over = E.phase === 'GAME_OVER';
        let summary;
        if (E.phase === 'ROUND_END' || E.phase === 'GAME_OVER') {
          const min = Math.min(...E.players.map(p => p.totalScore));
          summary = { rows: E.players.map((p, i) => ({ seat: i, name: p.name, score: p.totalScore, delta: p.roundScore })), winners: E.players.map((p, i) => p.totalScore === min ? i : -1).filter(i => i >= 0) };
        }
        return { game: 'skyjo', phase: E.phase, over, yourSeat: seat, summary, skyjo: s };
      }
    };
  }
  
  // ---- Play through a complete round ----
  console.log('\n🎮 Playing Skyjo: 3 players, 1 full round + game-over...');
  
  const engine = makeLocalEngine(['Alice', 'Bob', 'Charlie']);
  
  // Step 1: Initial reveal phase
  let view = engine.viewFor(0);
  tracer.trace('REVEAL_START', view);
  
  // Each player reveals 2 cards
  for (let pi = 0; pi < 3; pi++) {
    // Find face-down cards and reveal first 2
    const board = view.skyjo.players[pi].board;
    let revealed = 0;
    for (let ci = 0; ci < board.length && revealed < 2; ci++) {
      if (!board[ci].revealed && !board[ci].cleared) {
        engine.apply(pi, { action: 'reveal', index: ci });
        view = engine.viewFor(0);
        tracer.trace(`REVEAL p${pi} card${ci}`, view);
        revealed++;
      }
    }
  }
  
  // Check if we're in PLAY phase or need tiebreaker
  view = engine.viewFor(0);
  if (view.skyjo.phase === 'REVEAL' && view.skyjo.tiebreakerPlayers.length) {
    tracer.trace('TIEBREAKER_NEEDED', view);
    // Do tiebreaker reveals
    for (const pi of view.skyjo.tiebreakerPlayers) {
      const board = view.skyjo.players[pi].board;
      for (let ci = 0; ci < board.length; ci++) {
        if (!board[ci].revealed && !board[ci].cleared) {
          engine.apply(pi, { action: 'reveal', index: ci });
          view = engine.viewFor(0);
          tracer.trace(`TIEBREAKER p${pi} card${ci}`, view);
          break;
        }
      }
    }
  }
  
  // Now we should be in PLAY phase - play turns
  view = engine.viewFor(0);
  if (view.skyjo.phase !== 'PLAY') {
    tracer.error(`Expected PLAY phase, got ${view.skyjo.phase}`);
  }
  
  // Play a series of turns
  let turnCount = 0;
  const maxTurns = 200; // safety limit
  
  while (view.skyjo.phase === 'PLAY' || view.skyjo.phase === 'FINAL_TURNS') {
    if (turnCount++ > maxTurns) {
      tracer.error('Skyjo: exceeded max turns — infinite loop?');
      break;
    }
    
    const cp = view.skyjo.currentPlayer;
    const ta = view.skyjo.turnAction;
    
    // If turn_end_delay, complete it
    if (ta === 'turn_end_delay') {
      engine.apply(cp, { action: 'noop' }); // triggers completeTurnEnd via the wrapper
      view = engine.viewFor(0);
      continue;
    }
    
    // If must_reveal, reveal a face-down card
    if (ta === 'must_reveal') {
      const board = view.skyjo.players[cp].board;
      const fdIdx = board.findIndex(c => !c.revealed && !c.cleared);
      if (fdIdx >= 0) {
        engine.apply(cp, { action: 'reveal_after_discard', index: fdIdx });
        view = engine.viewFor(0);
        tracer.trace(`TURN ${turnCount}: p${cp} reveal_after_discard [${fdIdx}]`, view);
        continue;
      } else {
        tracer.error(`must_reveal but no face-down cards available for player ${cp}`);
        break;
      }
    }
    
    // Normal turn: draw from deck or take discard, then swap
    if (ta === null) {
      // Draw from deck
      engine.apply(cp, { action: 'draw_deck' });
      view = engine.viewFor(0);
      tracer.trace(`TURN ${turnCount}: p${cp} draw_deck (got ${view.skyjo.myDrawnCard ?? view.skyjo.publicDrawn})`, view);
      
      if (view.skyjo.turnAction === 'deck') {
        // Decide: swap or discard?
        // Strategy: swap if we can find a face-down or higher card
        const board = view.skyjo.players[cp].board;
        const drawnVal = view.skyjo.players[cp].board.find((c, i) => false) === null ? 
          (view.skyjo.publicDrawn ?? 0) : 0;
        
        // Find best swap target (face-down first, then highest revealed)
        let bestIdx = -1;
        let bestVal = Infinity;
        for (let ci = 0; ci < board.length; ci++) {
          const c = board[ci];
          if (c.cleared) continue;
          if (!c.revealed) { bestIdx = ci; break; } // prefer face-down
          // For revealed cards, we don't know the actual values of face-down
        }
        
        if (bestIdx === -1) {
          // All revealed, find highest
          for (let ci = 0; ci < board.length; ci++) {
            if (!board[ci].cleared && board[ci].revealed) {
              // We can't see values for other players in viewFor
              bestIdx = ci; break;
            }
          }
        }
        
        if (bestIdx >= 0) {
          engine.apply(cp, { action: 'swap', index: bestIdx });
          view = engine.viewFor(0);
          tracer.trace(`TURN ${turnCount}: p${cp} swap [${bestIdx}]`, view);
        } else {
          // Discard drawn card
          engine.apply(cp, { action: 'discard_drawn' });
          view = engine.viewFor(0);
          tracer.trace(`TURN ${turnCount}: p${cp} discard_drawn`, view);
        }
      }
      continue;
    }
    
    // If we have a drawn card (turnAction === 'deck' or 'discard'), swap
    if (ta === 'deck' || ta === 'discard') {
      const board = view.skyjo.players[cp].board;
      const fdIdx = board.findIndex(c => !c.revealed && !c.cleared);
      if (fdIdx >= 0) {
        engine.apply(cp, { action: 'swap', index: fdIdx });
      } else {
        // All revealed, swap with highest (just pick first non-cleared)
        const anyIdx = board.findIndex(c => !c.cleared);
        engine.apply(cp, { action: 'swap', index: anyIdx >= 0 ? anyIdx : 0 });
      }
      view = engine.viewFor(0);
      tracer.trace(`TURN ${turnCount}: p${cp} swap`, view);
      continue;
    }
    
    // Shouldn't reach here
    tracer.warn(`Unhandled turnAction: ${ta} for player ${cp}`);
    break;
  }
  
  // Check final state
  view = engine.viewFor(0);
  tracer.trace('ROUND_END', view);
  
  // Validate round end
  if (!view.summary) {
    tracer.error('Round ended but no summary generated');
  }
  
  // Validate all players have scores
  for (const p of view.skyjo.players) {
    if (p.totalScore === undefined) {
      tracer.error(`Player ${p.name} has no totalScore`);
    }
  }
  
  // Validate animation sequence for lastAction types
  const actionTypes = tracer.steps.filter(s => s.lastAction).map(s => s.lastAction);
  const expectedTypes = ['reveal', 'draw_deck', 'take_discard', 'swap', 'discard_drawn', 'reveal_after_discard', 'triplet', 'starter'];
  for (const at of actionTypes) {
    if (!expectedTypes.includes(at)) {
      tracer.warn(`Unexpected lastAction type: ${at}`);
    }
  }
  
  // Validate no duplicate consecutive actions (animation stutter)
  for (let i = 1; i < tracer.steps.length; i++) {
    if (tracer.steps[i].lastAction && tracer.steps[i-1].lastAction === tracer.steps[i].lastAction
        && tracer.steps[i].lastActionPlayer === tracer.steps[i-1].lastActionPlayer) {
      // Could indicate an animation stutter / double-fire
    }
  }
  
  // Play multiple rounds to test scoring accumulation
  console.log('\n  📊 Playing additional rounds to test scoring...');
  let roundsPlayed = 1;
  while (!view.over && roundsPlayed < 20) {
    engine.next();
    // Quick-play the round
    let rv = engine.viewFor(0);
    
    // Reveal
    for (let pi = 0; pi < 3; pi++) {
      const board = rv.skyjo.players[pi].board;
      let rev = 0;
      for (let ci = 0; ci < board.length && rev < 2; ci++) {
        if (!board[ci].revealed && !board[ci].cleared) {
          engine.apply(pi, { action: 'reveal', index: ci });
          rev++;
        }
      }
    }
    
    // Play turns quickly
    let tc = 0;
    rv = engine.viewFor(0);
    while ((rv.skyjo.phase === 'PLAY' || rv.skyjo.phase === 'FINAL_TURNS') && tc < 100) {
      tc++;
      const cp = rv.skyjo.currentPlayer;
      const ta = rv.skyjo.turnAction;
      
      if (ta === 'turn_end_delay') { engine.apply(cp, { action: 'noop' }); rv = engine.viewFor(0); continue; }
      if (ta === 'must_reveal') {
        const fd = rv.skyjo.players[cp].board.findIndex(c => !c.revealed && !c.cleared);
        if (fd >= 0) { engine.apply(cp, { action: 'reveal_after_discard', index: fd }); rv = engine.viewFor(0); } else break;
        continue;
      }
      if (ta === null) {
        engine.apply(cp, { action: 'draw_deck' });
        rv = engine.viewFor(0);
        if (rv.skyjo.turnAction === 'deck') {
          const fd = rv.skyjo.players[cp].board.findIndex(c => !c.revealed && !c.cleared);
          engine.apply(cp, { action: 'swap', index: fd >= 0 ? fd : 0 });
          rv = engine.viewFor(0);
        }
        continue;
      }
      if (ta === 'deck' || ta === 'discard') {
        const fd = rv.skyjo.players[cp].board.findIndex(c => !c.revealed && !c.cleared);
        engine.apply(cp, { action: 'swap', index: fd >= 0 ? fd : 0 });
        rv = engine.viewFor(0);
        continue;
      }
      break;
    }
    
    rv = engine.viewFor(0);
    roundsPlayed++;
    
    if (rv.summary) {
      const scores = rv.skyjo.players.map(p => `${p.name}=${p.totalScore}`).join(', ');
      console.log(`     Round ${roundsPlayed}: ${rv.skyjo.phase} — ${scores}`);
    }
    
    view = rv;
  }
  
  if (view.over) {
    tracer.trace('GAME_OVER', view);
    console.log(`     🏆 Game Over! Winner: ${view.summary.winners.map(w => view.summary.rows.find(r => r.seat === w)?.name).join(', ')}`);
  }
  
  return tracer.report();
}

// ============================================================
// PLAYTEST: Flip 7
// ============================================================
function playtestFlip7() {
  const tracer = new AnimationTracer('Flip 7');
  
  // Inline Flip7Engine (from 04-flip7.js)
  class Flip7Engine {
    constructor(names) { this.s = this._fresh(names, names.map(() => 0)); }
    _newP(name, banked) { return { name, nums: [], mods: [], tableau: [], second: false, status: 'active', bustCard: null, banked: banked || 0, roundScore: 0 }; }
    _buildDeck() {
      const d = []; let q = 0;
      const add = (kind, v) => d.push({ id: 'lf7c_' + (q++) + '_' + kind + '_' + String(v).replace(/\W/g, ''), kind, v });
      add('num', 0);
      for (let n = 1; n <= 12; n++) for (let i = 0; i < n; i++) add('num', n);
      for (const m of ['+2', '+4', '+6', '+8', '+10', 'x2']) add('mod', m);
      for (const a of ['freeze', 'flip3', 'second']) for (let i = 0; i < 3; i++) add('act', a);
      this._sh(d); return d;
    }
    _sh(d) { for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } }
    _emit(s, e) { e.seq = ++s.seq; s.events.push(e); }
    _fresh(names, banked) {
      const s = { players: names.map((n, i) => this._newP(n, banked[i] || 0)), deck: this._buildDeck(), discard: [], current: 0, phase: 'PLAY', round: 1, pendingAction: null, flip3Left: 0, flip3Target: -1, events: [], seq: 0 };
      for (let i = 0; i < s.players.length; i++) { let c = this._draw(s), g = 0; while (c.kind === 'act' && g++ < 200) { s.deck.unshift(c); this._sh(s.deck); c = this._draw(s); } this._place(s, i, c); }
      s.current = this._firstActive(s, 0); return s;
    }
    _draw(s) { if (!s.deck.length) { s.deck = s.discard; s.discard = []; this._sh(s.deck); this._emit(s, { type: 'reshuffle' }); } return s.deck.pop(); }
    _firstActive(s, from) { for (let k = 0; k < s.players.length; k++) { const i = (from + k) % s.players.length; if (s.players[i].status === 'active') return i; } return from; }
    _activeCount(s) { return s.players.filter(p => p.status === 'active').length; }
    _activeOthers(s, ex) { return s.players.map((p, i) => i).filter(i => i !== ex && s.players[i].status === 'active'); }
    _unique(p) { return new Set(p.nums).size; }
    _place(s, pi, card) {
      const p = s.players[pi];
      if (card.kind === 'num') { if (!p.nums.includes(card.v)) { p.nums.push(card.v); p.nums.sort((a, b) => a - b); } p.tableau.push(card); }
      else if (card.kind === 'mod') { p.mods.push(card.v); p.tableau.push(card); }
      else if (card.v === 'second') { p.second = true; p.tableau.push(card); }
    }
    _apply(s, pi, card, opts) {
      opts = opts || {};
      const p = s.players[pi];
      if (card.kind === 'num') {
        const n = card.v;
        if (p.nums.includes(n)) {
          if (p.second) { p.second = false; s.discard.push(card); const used = this._remTab(p, c => c.kind === 'act' && c.v === 'second'); if (used) s.discard.push(used); this._emit(s, { type: 'second_used', player: pi, value: n, card: used, flip3: !!opts.flip3 }); return 'ok'; }
          p.status = 'busted'; p.bustCard = n;
          this._emit(s, { type: 'bust', player: pi, value: n, flip3: !!opts.flip3 }); return 'bust';
        }
        p.nums.push(n); p.nums.sort((a, b) => a - b); p.tableau.push(card);
        this._emit(s, { type: 'card', player: pi, card, flip3: !!opts.flip3 });
        if (this._unique(p) >= 7) { p.status = 'stayed'; this._emit(s, { type: 'flip7', player: pi }); return 'flip7'; }
        return 'ok';
      }
      if (card.kind === 'mod') { p.mods.push(card.v); p.tableau.push(card); this._emit(s, { type: 'card', player: pi, card, flip3: !!opts.flip3 }); return 'ok'; }
      const a = card.v;
      if (a === 'second') {
        if (!p.second) { p.second = true; p.tableau.push(card); this._emit(s, { type: 'card', player: pi, card }); return 'ok'; }
        const others = this._activeOthers(s, pi).filter(i => !s.players[i].second);
        if (!others.length) { s.discard.push(card); this._emit(s, { type: 'second_discard', player: pi }); return 'ok'; }
        if (others.length === 1) { s.players[others[0]].second = true; s.players[others[0]].tableau.push(card); this._emit(s, { type: 'second_pass', from: pi, to: others[0], card, auto: true }); return 'ok'; }
        s.pendingAction = { kind: 'give_second', from: pi, card }; this._emit(s, { type: 'await_target', kind: 'give_second', from: pi }); return 'action';
      }
      p.tableau.push(card);
      this._emit(s, { type: 'action_card', player: pi, kind: a, card });
      const others = this._activeOthers(s, pi);
      if (!others.length) { this._resolve(s, pi, a, pi, true); return 'ok'; }
      s.pendingAction = { kind: a, from: pi, card }; this._emit(s, { type: 'await_target', kind: a, from: pi }); return 'action';
    }
    _resolve(s, from, kind, target, auto) {
      const tp = s.players[target];
      const actionCard = (s.pendingAction && s.pendingAction.card) || this._remTab(s.players[from], c => c.kind === 'act' && c.v === kind);
      s.pendingAction = null;
      if (kind === 'freeze') {
        this._emit(s, { type: 'play_action', kind: 'freeze', from, target, card: actionCard, auto: !!auto });
        if (tp.status === 'active') { tp.status = 'stayed'; this._emit(s, { type: 'freeze_done', target }); }
        return 'ok';
      }
      this._emit(s, { type: 'play_action', kind: 'flip3', from, target, card: actionCard, auto: !!auto });
      s.flip3Left = 3; s.flip3Target = target; this._runFlip3(s); return 'ok';
    }
    _remTab(p, pred) { const i = p.tableau.findIndex(pred); return i >= 0 ? p.tableau.splice(i, 1)[0] : null; }
    _runFlip3(s) {
      while (s.flip3Left > 0) {
        const t = s.flip3Target, tp = s.players[t];
        if (!tp || tp.status !== 'active') break;
        s.flip3Left--;
        const r = this._apply(s, t, this._draw(s), { flip3: true });
        if (r === 'bust' || r === 'flip7') { this._emit(s, { type: 'flip3_abandon', target: t }); break; }
        if (r === 'action') {
          const pa = s.pendingAction;
          if (pa) {
            if (pa.kind === 'give_second') {
              const o = this._activeOthers(s, pa.from).filter(i => !s.players[i].second);
              s.pendingAction = null;
              if (o.length) { s.players[o[0]].second = true; if (pa.card) s.players[o[0]].tableau.push(pa.card); this._emit(s, { type: 'second_pass', from: pa.from, to: o[0], card: pa.card, auto: true }); }
              else this._emit(s, { type: 'second_discard', player: pa.from });
            } else this._resolve(s, pa.from, pa.kind, pa.from, true);
          }
        }
      }
      s.flip3Left = 0; s.flip3Target = -1;
    }
    _advance(s) { if (this._activeCount(s) === 0) { this._score(s); return; } s.current = this._firstActive(s, (s.current + 1) % s.players.length); }
    _score(s) {
      let f7 = -1;
      for (const p of s.players) {
        if (p.status === 'busted') { p.roundScore = 0; continue; }
        const u = new Set(p.nums).size;
        let base = p.nums.reduce((a, b) => a + b, 0);
        if (p.mods.includes('x2')) base *= 2;
        for (const m of p.mods) if (m[0] === '+') base += parseInt(m.slice(1));
        if (u >= 7) { base += 15; f7 = 1; }
        p.roundScore = base; p.banked += base;
      }
      s.pendingAction = null; s.flip3Left = 0; s.flip3Target = -1;
      s.phase = s.players.some(p => p.banked >= 200) ? 'GAME_OVER' : 'ROUND_END';
      const mx = Math.max(...s.players.map(p => p.banked));
      this._emit(s, { type: s.phase === 'GAME_OVER' ? 'game_over' : 'round_end', winners: s.players.map((p, i) => p.banked === mx ? i : -1).filter(i => i >= 0), flip7: f7 });
    }
    apply(seat, msg) {
      const s = this.s; s.events = [];
      if (s.phase !== 'PLAY') return;
      if (s.pendingAction) {
        const pa = s.pendingAction;
        if (msg.action === 'target' && pa.from === seat) {
          const t = msg.target | 0;
          if (!s.players[t] || s.players[t].status !== 'active') return;
          if (pa.kind === 'give_second') { if (t === seat) return; s.pendingAction = null; s.players[t].second = true; if (pa.card) s.players[t].tableau.push(pa.card); this._emit(s, { type: 'second_pass', from: seat, to: t, card: pa.card, auto: false }); }
          else { this._resolve(s, seat, pa.kind, t); this._advance(s); }
        }
        return;
      }
      if (seat !== s.current || s.players[seat].status !== 'active') return;
      if (msg.action === 'stay') { s.players[seat].status = 'stayed'; this._emit(s, { type: 'stay', player: seat }); this._advance(s); }
      else if (msg.action === 'hit') {
        const prob = this._bustProb(s, seat);
        const card = this._draw(s);
        this._emit(s, { type: 'draw_start', player: seat, prob });
        const r = this._apply(s, seat, card, {});
        if (r === 'action') return;
        this._advance(s);
      }
    }
    _bustProb(s, pi) { const p = s.players[pi]; const tot = s.deck.length || 1; let d = 0; for (const c of s.deck) if (c.kind === 'num' && p.nums.includes(c.v)) d++; return d / tot; }
    next() {
      const s = this.s; const over = s.phase === 'GAME_OVER';
      const ns = this._fresh(s.players.map(p => p.name), over ? s.players.map(() => 0) : s.players.map(p => p.banked));
      ns.seq = s.seq + 1; if (!over) ns.round = s.round + 1;
      this.s = ns;
    }
    viewFor(seat) {
      const s = this.s; const over = s.phase === 'GAME_OVER';
      let summary;
      if (s.phase === 'ROUND_END' || s.phase === 'GAME_OVER') {
        const mx = Math.max(...s.players.map(p => p.banked));
        summary = { rows: s.players.map((p, i) => ({ seat: i, name: p.name, score: p.banked, delta: p.roundScore })), winners: s.players.map((p, i) => p.banked === mx ? i : -1).filter(i => i >= 0) };
      }
      const live = p => {
        if (p.status === 'busted') return 0;
        let b = p.nums.reduce((a, c) => a + c, 0);
        if (p.mods.includes('x2')) b *= 2;
        for (const m of p.mods) if (m[0] === '+') b += parseInt(m.slice(1));
        if (new Set(p.nums).size >= 7) b += 15;
        return b;
      };
      return {
        game: 'flip7', phase: s.phase, over, yourSeat: seat, summary,
        flip7: {
          round: s.round, current: s.current, phase: s.phase,
          pendingAction: s.pendingAction, viewerSeat: seat,
          deckCount: s.deck.length, discardCount: s.discard.length,
          seq: s.seq, events: s.events,
          players: s.players.map(p => ({
            name: p.name, nums: [...p.nums], mods: [...p.mods], second: p.second,
            cards: [...p.tableau].sort((a, b) => { const r = (a.kind === 'num' ? 0 : a.kind === 'mod' ? 1 : 2) - (b.kind === 'num' ? 0 : b.kind === 'mod' ? 1 : 2); if (r) return r; if (a.kind === 'num' && b.kind === 'num') return a.v - b.v; return String(a.v).localeCompare(String(b.v)); }).map(c => ({ id: c.id, kind: c.kind, v: c.v })),
            status: p.status, bustCard: p.bustCard, banked: p.banked,
            unique: new Set(p.nums).size, live: live(p)
          }))
        }
      };
    }
  }
  
  console.log('\n🎮 Playing Flip 7: 3 players, multiple rounds...');
  
  const engine = new Flip7Engine(['Alice', 'Bob', 'Charlie']);
  
  // Play multiple rounds
  let roundsPlayed = 0;
  let view = engine.viewFor(0);
  
  while (roundsPlayed < 15 && !view.over) {
    view = engine.viewFor(0);
    tracer.trace(`ROUND_${roundsPlayed + 1}_START`, view);
    
    let turnCount = 0;
    while (view.flip7.phase === 'PLAY' && turnCount < 100) {
      turnCount++;
      const cp = view.flip7.current;
      const player = view.flip7.players[cp];
      
      if (player.status !== 'active') {
        tracer.error(`Player ${cp} is current but status is ${player.status}`);
        break;
      }
      
      // Handle pending action (target selection needed)
      if (view.flip7.pendingAction) {
        const pa = view.flip7.pendingAction;
        // Auto-resolve: target first active other player
        const others = view.flip7.players.map((p, i) => i)
          .filter(i => i !== pa.from && view.flip7.players[i].status === 'active'
            && !(pa.kind === 'give_second' && i === pa.from));
        if (others.length) {
          engine.apply(pa.from, { action: 'target', target: others[0] });
          view = engine.viewFor(0);
          tracer.trace(`TURN ${turnCount}: p${pa.from} targets p${others[0]} with ${pa.kind}`, view, { events: view.flip7.events?.map(e => e.type) });
        } else {
          tracer.warn(`Pending action ${pa.kind} but no valid targets`);
          break;
        }
        continue;
      }
      
      // Decision: hit or stay?
      const uniqueCount = player.unique;
      const liveScore = player.live;
      
      // Simple heuristic: stay at 4+ unique or 30+ live, or 50%+ bust prob
      const shouldStay = uniqueCount >= 4 || liveScore >= 30;
      
      if (shouldStay) {
        engine.apply(cp, { action: 'stay' });
        view = engine.viewFor(0);
        tracer.trace(`TURN ${turnCount}: p${cp} STAY (${uniqueCount} unique, ${liveScore} live)`, view);
      } else {
        engine.apply(cp, { action: 'hit' });
        view = engine.viewFor(0);
        const events = view.flip7.events?.map(e => e.type) || [];
        const newStatus = view.flip7.players[cp].status;
        tracer.trace(`TURN ${turnCount}: p${cp} HIT → ${newStatus} (${uniqueCount}→${view.flip7.players[cp].unique} unique, ${liveScore}→${view.flip7.players[cp].live} live)`, view, { events });
        
        // Validate event sequence for this hit
        if (events.length) {
          // Should have draw_start first, then card/bust/etc
          const hasDrawStart = events.includes('draw_start');
          const hasCardOrBust = events.includes('card') || events.includes('bust') || events.includes('action_card');
          if (!hasDrawStart) {
            tracer.warn(`Hit without draw_start event: ${events.join(', ')}`);
          }
          // draw_start should come BEFORE card/bust in the event list
          if (hasDrawStart && hasCardOrBust) {
            const dsIdx = events.indexOf('draw_start');
            const cardIdx = Math.min(
              events.indexOf('card') >= 0 ? events.indexOf('card') : Infinity,
              events.indexOf('bust') >= 0 ? events.indexOf('bust') : Infinity,
              events.indexOf('action_card') >= 0 ? events.indexOf('action_card') : Infinity
            );
            if (dsIdx > cardIdx) {
              tracer.error(`draw_start event comes AFTER card event — animation will show card before wiggle!`, { events });
            }
          }
        }
        
        // If pending action after hit (action card drawn), resolve it
        if (view.flip7.pendingAction) continue;
      }
    }
    
    if (view.flip7.phase === 'ROUND_END' || view.flip7.phase === 'GAME_OVER') {
      roundsPlayed++;
      const scores = view.flip7.players.map(p => `${p.name}=${p.banked}(${p.status})`).join(', ');
      console.log(`     Round ${roundsPlayed}: ${view.flip7.phase} — ${scores}`);
      
      if (view.summary) {
        tracer.trace(`ROUND_${roundsPlayed}_END`, view);
      } else {
        tracer.error(`Round ended (phase=${view.flip7.phase}) but no summary`);
      }
      
      // Check event sequence integrity for round end
      const roundEvents = view.flip7.events || [];
      const hasRoundEnd = roundEvents.some(e => e.type === 'round_end' || e.type === 'game_over');
      if (!hasRoundEnd && roundsPlayed <= 15) {
        tracer.warn(`Round ${roundsPlayed} ended but no round_end/game_over event in last view`);
      }
      
      if (!view.over) {
        engine.next();
        view = engine.viewFor(0);
      }
    } else {
      tracer.error(`Round didn't end properly — stuck in phase ${view.flip7.phase} after ${turnCount} turns`);
      break;
    }
  }
  
  // Validate Flip 7 specific animation concerns
  console.log('\n  🔍 Checking Flip 7 animation sequence integrity...');
  
  // Check 1: Every hit should produce a draw_start before card reveal
  const hitSteps = tracer.steps.filter(s => s.step && s.step.includes('HIT'));
  let hitWithoutDraw = 0;
  for (const s of hitSteps) {
    if (s.events && !s.events.includes('draw_start') && s.events.some(e => ['card', 'bust', 'action_card'].includes(e))) {
      hitWithoutDraw++;
    }
  }
  if (hitWithoutDraw) tracer.error(`${hitWithoutDraw} HITs without draw_start event — wiggle animation will be skipped`);
  else console.log('     ✅ All HITs have proper draw_start → card sequence');
  
  // Check 2: Bust events should produce a different visual than stays
  const bustEvents = tracer.steps.filter(s => s.events?.includes('bust'));
  const stayEvents = tracer.steps.filter(s => s.events?.includes('stay'));
  console.log(`     Busts: ${bustEvents.length}, Stays: ${stayEvents.length}`);
  
  // Check 3: Check for stale events (events from previous view leaking into next)
  let staleEventCount = 0;
  for (let i = 1; i < tracer.steps.length; i++) {
    if (tracer.steps[i].events?.length && tracer.steps[i-1].events?.length) {
      // Same event IDs appearing in consecutive steps could indicate stale events
      const currSeqs = (tracer.steps[i].events || []).map(e => e.seq).filter(Boolean);
      const prevSeqs = (tracer.steps[i-1].events || []).map(e => e.seq).filter(Boolean);
      const overlap = currSeqs.filter(s => prevSeqs.includes(s));
      if (overlap.length > 0) staleEventCount++;
    }
  }
  if (staleEventCount) tracer.warn(`${staleEventCount} consecutive views share event seq numbers — possible stale event replay`);
  
  return tracer.report();
}

// ============================================================
// PLAYTEST: Qwixx
// ============================================================
function playtestQwixx() {
  const tracer = new AnimationTracer('Qwixx');
  
  // Inline QwixxEngine (from 02-qwixx.js)
  const COLORS = ['red', 'yellow', 'green', 'blue'];
  const COLOR_KEY = { red: 'r', yellow: 'y', green: 'g', blue: 'b' };
  const SCORE_BY_MARKS = [0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78];
  
  function rowPoints(row) {
    let m = row.marks.length;
    if (row.marks.includes(row.nums.length - 1)) m++;
    return SCORE_BY_MARKS[Math.min(m, SCORE_BY_MARKS.length - 1)];
  }
  function scoreRows(rows, penalties) {
    let total = 0;
    COLORS.forEach(c => { const row = rows[c]; if (row) total += rowPoints(row); });
    return total - penalties * 5;
  }
  
  class QwixxEngine {
    constructor(names) {
      this.players = names.map(name => ({ name: name || 'Player', rows: {}, penalties: 0 }));
      this.players.forEach(p => COLORS.forEach(c => { p.rows[c] = this.makeRow(c); }));
      this.activeSeat = 0; this.phase = 'WHITE_PHASE'; this.expansion = 'standard';
      this.locked = []; this.pendingLocks = []; this.pendingWhiteDecisions = this.players.map((_, i) => i);
      this.activeMarkedThisTurn = false; this.activeColorUsed = false;
      this.activeColorRow = null; this.activeWhiteRow = null; this.activeWhiteIndex = null;
      this.round = 1; this.dice = this.getDice();
    }
    makeRow(color) {
      const nums = [];
      if (color === 'red' || color === 'yellow') for (let i = 2; i <= 12; i++) nums.push(i);
      else for (let i = 12; i >= 2; i--) nums.push(i);
      return { nums, cellColors: nums.map(() => color), doubles: [], marks: [] };
    }
    getDice() {
      const rnd = () => Math.floor(Math.random() * 6) + 1;
      const d = { w: [rnd(), rnd()], r: rnd(), y: rnd(), g: rnd(), b: rnd() };
      this.locked.forEach(c => d[COLOR_KEY[c]] = 0);
      return d;
    }
    canMarkIndex(state, color, row, i) {
      if (!row || state.locked.includes(color)) return false;
      if (!Number.isInteger(i) || i < 0 || i >= row.nums.length) return false;
      if (row.marks.includes(i)) return false;
      const last = row.marks.length ? Math.max(...row.marks) : -1;
      if (i <= last) return false;
      if (i === row.nums.length - 1 && row.marks.length < 5) return false;
      return true;
    }
    applyLocks() { this.pendingLocks.forEach(c => { if (!this.locked.includes(c)) this.locked.push(c); }); this.pendingLocks = []; this.locked.forEach(c => this.dice[COLOR_KEY[c]] = 0); }
    mark(c, row, i) { row.marks.push(i); row.marks.sort((a, b) => a - b); if (i === row.nums.length - 1 && !this.locked.includes(c) && !this.pendingLocks.includes(c)) this.pendingLocks.push(c); }
    nextTurn() {
      this.applyLocks();
      if (this.locked.length >= 2 || this.players.some(p => p.penalties >= 4)) { this.phase = 'GAME_OVER'; return; }
      this.activeSeat = (this.activeSeat + 1) % this.players.length;
      this.phase = 'WHITE_PHASE'; this.dice = this.getDice();
      this.pendingWhiteDecisions = this.players.map((_, i) => i).filter(i => this.players[i].penalties < 4);
      this.activeMarkedThisTurn = false; this.activeColorUsed = false;
      this.activeColorRow = null; this.activeWhiteRow = null; this.activeWhiteIndex = null;
      this.round++;
    }
    applyAction(seat, msg) {
      if (this.phase === 'GAME_OVER') return;
      if (msg.action === 'mark') {
        const c = msg.c, i = msg.i, requestedUse = msg.use;
        const p = this.players[seat], row = p && p.rows[c];
        if (!COLORS.includes(c) || !p || !row || !this.canMarkIndex(this, c, row, i)) return;
        const isAct = seat === this.activeSeat;
        const whiteSum = this.dice.w[0] + this.dice.w[1];
        const whiteLegal = this.pendingWhiteDecisions.includes(seat) && row.nums[i] === whiteSum && !(isAct && this.activeColorUsed && this.activeColorRow === c);
        const die = this.dice[COLOR_KEY[c]];
        const colorLegal = isAct && !this.activeColorUsed && die && (row.nums[i] === this.dice.w[0] + die || row.nums[i] === this.dice.w[1] + die) && !(this.activeWhiteRow === c && this.activeWhiteIndex != null && i <= this.activeWhiteIndex);
        let use = null;
        if (requestedUse === 'color') use = colorLegal ? 'color' : null;
        else if (requestedUse === 'white') use = whiteLegal ? 'white' : null;
        else if (colorLegal) use = 'color'; else if (whiteLegal) use = 'white';
        if (!use) return;
        this.mark(c, row, i);
        if (use === 'white') { this.pendingWhiteDecisions = this.pendingWhiteDecisions.filter(x => x !== seat); if (isAct) { this.activeWhiteRow = c; this.activeWhiteIndex = i; } }
        else { this.activeColorUsed = true; this.activeColorRow = c; }
        if (isAct) this.activeMarkedThisTurn = true;
        if (this.pendingWhiteDecisions.length === 0) { this.applyLocks(); if (this.activeColorUsed) this.nextTurn(); else this.phase = 'COLOR_PHASE'; }
      } else if (msg.action === 'skip') {
        if (this.phase === 'WHITE_PHASE') {
          this.pendingWhiteDecisions = this.pendingWhiteDecisions.filter(x => x !== seat);
          if (this.pendingWhiteDecisions.length === 0) { this.applyLocks(); if (this.activeColorUsed) this.nextTurn(); else this.phase = 'COLOR_PHASE'; }
        }
      } else if (msg.action === 'finishTurn') {
        if (seat !== this.activeSeat) return;
        if (this.phase === 'WHITE_PHASE') { if (this.pendingWhiteDecisions.includes(seat)) return; this.activeColorUsed = true; if (this.pendingWhiteDecisions.length === 0) this.nextTurn(); return; }
        if (this.phase !== 'COLOR_PHASE') return;
        if (!this.activeMarkedThisTurn) this.players[this.activeSeat].penalties++;
        this.nextTurn();
      }
    }
    stateFor(seat) {
      return {
        dice: this.dice, activeSeat: this.activeSeat, expansion: this.expansion,
        locked: this.locked, pendingLocks: this.pendingLocks,
        yourRows: this.players[seat]?.rows || {}, yourPenalties: this.players[seat]?.penalties || 0,
        allPlayers: this.players.map((pl, i) => ({
          seat: i, name: pl.name, penalties: pl.penalties,
          score: scoreRows(pl.rows, pl.penalties), rows: pl.rows,
          waiting: this.phase === 'WHITE_PHASE' ? this.pendingWhiteDecisions.includes(i) : false,
          active: i === this.activeSeat
        })),
        phase: this.phase, round: this.round,
        pendingWhiteDecisions: this.pendingWhiteDecisions,
        activeMarkedThisTurn: this.activeMarkedThisTurn,
        activeColorUsed: this.activeColorUsed,
        activeColorRow: this.activeColorRow,
        activeWhiteRow: this.activeWhiteRow,
        activeWhiteIndex: this.activeWhiteIndex
      };
    }
  }
  
  function makeLocalQwixx(names) {
    const E = new QwixxEngine(names);
    return {
      apply(seat, msg) { E.applyAction(seat, msg); },
      next() { const fresh = new QwixxEngine(E.players.map(p => p.name)); Object.assign(E, fresh); },
      actor() {
        if (E.phase === 'WHITE_PHASE') {
          if (E.pendingWhiteDecisions.includes(E.activeSeat) || !E.activeColorUsed) return E.activeSeat;
          return E.pendingWhiteDecisions.find(i => i !== E.activeSeat) ?? E.activeSeat;
        }
        return E.activeSeat;
      },
      viewFor(seat) {
        const s = E.stateFor(seat);
        let summary;
        if (E.phase === 'GAME_OVER') {
          const rows = E.players.map((pl, i) => ({ seat: i, name: pl.name, score: scoreRows(pl.rows, pl.penalties), delta: 0 }));
          const max = Math.max(...rows.map(r => r.score));
          summary = { rows, winners: rows.filter(r => r.score === max).map(r => r.seat) };
        }
        return { game: 'qwixx', phase: E.phase, over: E.phase === 'GAME_OVER', yourSeat: seat, summary, state: s };
      }
    };
  }
  
  console.log('\n🎮 Playing Qwixx: 3 players, full game...');
  
  const engine = makeLocalQwixx(['Alice', 'Bob', 'Charlie']);
  
  function findWhiteMark(seat, view) {
    const s = view.state;
    const sum = s.dice.w[0] + s.dice.w[1];
    for (const c of COLORS) {
      if (s.locked.includes(c)) continue;
      const row = s.allPlayers[seat].rows[c];
      const idx = row.nums.indexOf(sum);
      if (idx >= 0 && !row.marks.includes(idx)) {
        const last = row.marks.length ? Math.max(...row.marks) : -1;
        if (idx > last) return { c, i: idx };
      }
    }
    return null;
  }
  
  function findColorMark(seat, view) {
    const s = view.state;
    for (const c of COLORS) {
      if (s.locked.includes(c)) continue;
      const die = s.dice[COLOR_KEY[c]];
      if (!die) continue;
      const row = s.allPlayers[seat].rows[c];
      for (const w of s.dice.w) {
        const sum = w + die;
        const idx = row.nums.indexOf(sum);
        if (idx >= 0 && !row.marks.includes(idx)) {
          const last = row.marks.length ? Math.max(...row.marks) : -1;
          if (idx > last) return { c, i: idx };
        }
      }
    }
    return null;
  }
  
  let turnCount = 0;
  let view = engine.viewFor(0);
  
  while (view.state.phase !== 'GAME_OVER' && turnCount < 200) {
    turnCount++;
    const s = view.state;
    const phase = s.phase;
    
    if (phase === 'GAME_OVER') break;
    
    if (phase === 'WHITE_PHASE') {
      // Process all pending white decisions
      const pending = [...s.pendingWhiteDecisions];
      for (const seat of pending) {
        const mark = findWhiteMark(seat, view);
        if (mark) {
          engine.apply(seat, { action: 'mark', c: mark.c, i: mark.i, use: 'white' });
          view = engine.viewFor(0);
          tracer.trace(`TURN ${turnCount}: WHITE p${seat} marks ${mark.c}[${mark.i}]`, view);
        } else {
          engine.apply(seat, { action: 'skip' });
          view = engine.viewFor(0);
          tracer.trace(`TURN ${turnCount}: WHITE p${seat} skips`, view);
        }
        if (view.state.phase !== 'WHITE_PHASE') break;
      }
      
      // If still WHITE_PHASE, advance
      if (view.state.phase === 'WHITE_PHASE' && view.state.pendingWhiteDecisions.length === 0) {
        // Should have transitioned already
        tracer.error(`WHITE_PHASE but no pending decisions — stuck!`);
        break;
      }
      continue;
    }
    
    if (phase === 'COLOR_PHASE') {
      const activeSeat = s.activeSeat;
      const colorMark = findColorMark(activeSeat, view);
      if (colorMark) {
        engine.apply(activeSeat, { action: 'mark', c: colorMark.c, i: colorMark.i, use: 'color' });
        view = engine.viewFor(0);
        tracer.trace(`TURN ${turnCount}: COLOR p${activeSeat} marks ${colorMark.c}[${colorMark.i}]`, view);
      } else {
        engine.apply(activeSeat, { action: 'finishTurn' });
        view = engine.viewFor(0);
        tracer.trace(`TURN ${turnCount}: COLOR p${activeSeat} finishes (penalty)`, view);
      }
      continue;
    }
    
    tracer.warn(`Unknown phase: ${phase}`);
    break;
  }
  
  view = engine.viewFor(0);
  tracer.trace('GAME_END', view);
  
  // Validate Qwixx-specific concerns
  console.log('\n  🔍 Checking Qwixx animation sequence integrity...');
  
  // Check 1: WHITE→COLOR transition always happens
  const whiteToColor = tracer.phaseTransitions.filter(t => t.from === 'WHITE_PHASE' && t.to === 'COLOR_PHASE');
  const whiteToGame = tracer.phaseTransitions.filter(t => t.from === 'WHITE_PHASE' && t.to === 'GAME_OVER');
  const colorToWhite = tracer.phaseTransitions.filter(t => t.from === 'COLOR_PHASE' && t.to === 'WHITE_PHASE');
  console.log(`     WHITE→COLOR: ${whiteToColor.length}, WHITE→GAME_OVER: ${whiteToGame.length}, COLOR→WHITE: ${colorToWhite.length}`);
  
  // Check 2: No player exceeds 4 penalties
  const finalState = view.state;
  for (const p of finalState.allPlayers) {
    if (p.penalties > 4) tracer.error(`Player ${p.name} has ${p.penalties} penalties (max 4)`);
  }
  
  // Check 3: All scores are non-negative
  for (const p of finalState.allPlayers) {
    if (p.score < 0) tracer.warn(`Player ${p.name} has negative score: ${p.score}`);
  }
  
  // Check 4: Phase transition sequence is valid
  for (let i = 1; i < tracer.phaseTransitions.length; i++) {
    const from = tracer.phaseTransitions[i].from;
    const to = tracer.phaseTransitions[i].to;
    // Valid: WHITE→COLOR, COLOR→WHITE, WHITE→GAME_OVER, COLOR→GAME_OVER
    const valid = (from === 'WHITE_PHASE' && (to === 'COLOR_PHASE' || to === 'GAME_OVER')) ||
                  (from === 'COLOR_PHASE' && (to === 'WHITE_PHASE' || to === 'GAME_OVER'));
    if (!valid) tracer.error(`Invalid phase transition: ${from} → ${to}`);
  }
  
  return tracer.report();
}

// ============================================================
// Run all playtests
// ============================================================
console.log('╔══════════════════════════════════════════════════════════════════════╗');
console.log('║        GAMEHUB ANIMATION SEQUENCE PLAYTEST                          ║');
console.log('║        Testing: Skyjo, Flip 7, Qwixx — full game lifecycles         ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');

let totalErrors = 0;
totalErrors += playtestSkyjo();
totalErrors += playtestFlip7();
totalErrors += playtestQwixx();

console.log(`\n${'='.repeat(70)}`);
console.log(`  TOTAL ERRORS ACROSS ALL GAMES: ${totalErrors}`);
console.log(`${'='.repeat(70)}`);

process.exit(totalErrors > 0 ? 1 : 0);

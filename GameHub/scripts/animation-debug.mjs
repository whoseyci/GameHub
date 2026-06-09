// Debug the 3 failures

// --- Flip 7: Bust test ---
console.log("\n=== DEBUG: Flip 7 Bust Test ===");
class Flip7Engine {
  constructor(names) { this.s = this._fresh(names, names.map(() => 0)); }
  _newP(name, banked) { return { name, nums: [], mods: [], tableau: [], second: false, status: 'active', bustCard: null, banked: banked || 0, roundScore: 0 }; }
  _buildDeck() { const d = []; let q = 0; const add = (kind, v) => d.push({ id: 'lf7c_' + (q++) + '_' + kind + '_' + String(v).replace(/\W/g, ''), kind, v }); add('num', 0); for (let n = 1; n <= 12; n++) for (let i = 0; i < n; i++) add('num', n); for (const m of ['+2', '+4', '+6', '+8', '+10', 'x2']) add('mod', m); for (const a of ['freeze', 'flip3', 'second']) for (let i = 0; i < 3; i++) add('act', a); this._sh(d); return d; }
  _sh(d) { for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } }
  _emit(s, e) { e.seq = ++s.seq; s.events.push(e); }
  _fresh(names, banked) { const s = { players: names.map((n, i) => this._newP(n, banked[i] || 0)), deck: this._buildDeck(), discard: [], current: 0, phase: 'PLAY', round: 1, pendingAction: null, flip3Left: 0, flip3Target: -1, events: [], seq: 0 }; for (let i = 0; i < s.players.length; i++) { let c = this._draw(s), g = 0; while (c.kind === 'act' && g++ < 200) { s.deck.unshift(c); this._sh(s.deck); c = this._draw(s); } this._place(s, i, c); } s.current = this._firstActive(s, 0); return s; }
  _draw(s) { if (!s.deck.length) { s.deck = s.discard; s.discard = []; this._sh(s.deck); this._emit(s, { type: 'reshuffle' }); } return s.deck.pop(); }
  _firstActive(s, from) { for (let k = 0; k < s.players.length; k++) { const i = (from + k) % s.players.length; if (s.players[i].status === 'active') return i; } return from; }
  _activeOthers(s, ex) { return s.players.map((p, i) => i).filter(i => i !== ex && s.players[i].status === 'active'); }
  _place(s, pi, card) { const p = s.players[pi]; if (card.kind === 'num') { if (!p.nums.includes(card.v)) { p.nums.push(card.v); p.nums.sort((a, b) => a - b); } p.tableau.push(card); } else if (card.kind === 'mod') { p.mods.push(card.v); p.tableau.push(card); } else if (card.v === 'second') { p.second = true; p.tableau.push(card); } }
  _remTab(p, pred) { const i = p.tableau.findIndex(pred); return i >= 0 ? p.tableau.splice(i, 1)[0] : null; }
  _bustProb(s, pi) { const p = s.players[pi]; const tot = s.deck.length || 1; let d = 0; for (const c of s.deck) if (c.kind === 'num' && p.nums.includes(c.v)) d++; return d / tot; }
  _apply(s, pi, card, opts) { opts = opts || {}; const p = s.players[pi]; if (card.kind === 'num') { const n = card.v; if (p.nums.includes(n)) { if (p.second) { p.second = false; s.discard.push(card); const used = this._remTab(p, c => c.kind === 'act' && c.v === 'second'); if (used) s.discard.push(used); this._emit(s, { type: 'second_used', player: pi, value: n, card: used, flip3: !!opts.flip3 }); return 'ok'; } p.status = 'busted'; p.bustCard = n; this._emit(s, { type: 'bust', player: pi, value: n, flip3: !!opts.flip3 }); return 'bust'; } p.nums.push(n); p.nums.sort((a, b) => a - b); p.tableau.push(card); this._emit(s, { type: 'card', player: pi, card, flip3: !!opts.flip3 }); if (new Set(p.nums).size >= 7) { p.status = 'stayed'; this._emit(s, { type: 'flip7', player: pi }); return 'flip7'; } return 'ok'; } if (card.kind === 'mod') { p.mods.push(card.v); p.tableau.push(card); this._emit(s, { type: 'card', player: pi, card, flip3: !!opts.flip3 }); return 'ok'; } const a = card.v; p.tableau.push(card); this._emit(s, { type: 'action_card', player: pi, kind: a, card }); const others = this._activeOthers(s, pi); if (!others.length) { /* self-resolve */ } s.pendingAction = { kind: a, from: pi, card }; this._emit(s, { type: 'await_target', kind: a, from: pi }); return 'action'; }
  _advance(s) { if (s.players.filter(p => p.status === 'active').length === 0) { this._score(s); return; } s.current = this._firstActive(s, (s.current + 1) % s.players.length); }
  _score(s) { let f7 = -1; for (const p of s.players) { if (p.status === 'busted') { p.roundScore = 0; continue; } const u = new Set(p.nums).size; let base = p.nums.reduce((a, b) => a + b, 0); if (p.mods.includes('x2')) base *= 2; for (const m of p.mods) if (m[0] === '+') base += parseInt(m.slice(1)); if (u >= 7) { base += 15; f7 = 1; } p.roundScore = base; p.banked += base; } s.phase = s.players.some(p => p.banked >= 200) ? 'GAME_OVER' : 'ROUND_END'; }
  apply(seat, msg) { const s = this.s; s.events = []; if (s.phase !== 'PLAY') return; if (s.pendingAction) return; if (seat !== s.current || s.players[seat].status !== 'active') return; if (msg.action === 'stay') { s.players[seat].status = 'stayed'; this._emit(s, { type: 'stay', player: seat }); this._advance(s); } else if (msg.action === 'hit') { this._emit(s, { type: 'draw_start', player: seat, prob: this._bustProb(s, seat) }); const card = this._draw(s); const r = this._apply(s, seat, card, {}); if (r === 'action') return; this._advance(s); } }
}

const E = new Flip7Engine(['A', 'B']);
console.log(`  Initial current player: ${E.s.current}`);
console.log(`  Player ${E.s.current} nums: [${E.s.players[E.s.current].nums}]`);
console.log(`  Player ${E.s.current} initial card:`, E.s.players[E.s.current].tableau.map(c => `${c.kind}:${c.v}`));

// Add target number to current player
const cp = E.s.current;
const targetNum = E.s.players[cp].nums[0] || 5; // Use a number they already have
console.log(`  Using existing number for bust: ${targetNum}`);

// If player already has this number, drawing it again should bust
// Push the bust card to end of deck (will be drawn first since pop())
E.s.deck.push({ id: 'bust_card', kind: 'num', v: targetNum });

// Verify the deck has the bust card at the end
console.log(`  Deck top (will be drawn): kind=${E.s.deck[E.s.deck.length-1]?.kind}, v=${E.s.deck[E.s.deck.length-1]?.v}`);

E.apply(cp, { action: 'hit' });
console.log(`  After hit:`);
console.log(`    Events: ${E.s.events.map(e => e.type).join(', ')}`);
console.log(`    Player status: ${E.s.players[cp].status}`);
console.log(`    Player nums: [${E.s.players[cp].nums}]`);
console.log(`    Player bustCard: ${E.s.players[cp].bustCard}`);

// The issue might be that deck.pop() gets the card, but the player's nums
// already has that number from the initial deal AND the forced add
// But actually, we added the number to nums, then pushed same value to deck
// So when _apply runs, it checks p.nums.includes(n) → should be true → bust
// Unless the number was already there from initial deal and we're adding a duplicate
// In that case, nums won't have the duplicate (push doesn't add if includes check in _place)

// Actually wait: I pushed to nums directly, but _place also pushes.
// Let me check if the initial deal already gave them targetNum...
// If E.s.players[cp].nums already has the number from the deal, 
// and I push the same number to deck, then drawing it should bust.

// But there's a subtlety: the _place function checks `if (!p.nums.includes(card.v))` 
// before adding to nums. So initial deal numbers are deduplicated in nums.
// My direct push `p.nums.push(targetNum)` would add a duplicate to nums if it's already there!
// That would mean `p.nums.includes(targetNum)` is true, so bust should work.

// Let me check what actually happened with the events
if (!E.s.events.some(e => e.type === 'bust')) {
  // Maybe the drawn card wasn't the bust card?
  const drawnCard = E.s.events.find(e => e.type === 'card');
  console.log(`  Drawn card event:`, drawnCard?.card);
  
  // Or maybe it was an action card?
  const actionCard = E.s.events.find(e => e.type === 'action_card');
  console.log(`  Action card event:`, actionCard);
}

// Now test with a definitely new number
console.log("\n=== DEBUG: Flip 7 Bust Test (clean) ===");
const E2 = new Flip7Engine(['A', 'B']);
const cp2 = E2.s.current;
console.log(`  Current player: ${cp2}`);
console.log(`  Player nums: [${E2.s.players[cp2].nums}]`);

// Find a number the player DOES have (from initial deal)
const existingNum = E2.s.players[cp2].nums[0];
console.log(`  Player has number: ${existingNum}`);

// Push same number to deck (will be drawn via pop)
E2.s.deck.push({ id: 'forced_bust', kind: 'num', v: existingNum });
console.log(`  Pushed ${existingNum} to deck top`);

E2.apply(cp2, { action: 'hit' });
console.log(`  Events: ${E2.s.events.map(e => `${e.type}(${e.seq})`).join(', ')}`);
console.log(`  Status: ${E2.s.players[cp2].status}`);
console.log(`  bustCard: ${E2.s.players[cp2].bustCard}`);

// Debug: what did _draw actually return?
// The deck might have been shuffled by the initial deal setup
// or the _draw might have reshuffled

// Let's check if the bust card is still at the top
console.log(`  Deck size after: ${E2.s.deck.length}`);

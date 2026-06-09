/**
 * CardManager Prototype — Permanent Card System
 *
 * This is a working prototype that demonstrates the design. It runs in Node.js
 * with a minimal DOM mock. The real implementation would be in `public/js/00-core.js`.
 *
 * Run with: node scripts/card-manager-prototype.mjs
 */

// ─── Types (documented as JSDoc) ────────────────────────────────

/**
 * @typedef {'deck'|'discard'|'hand'|'grid'|'table'|'transit'|'removed'} Zone
 *
 * @typedef {Object} Location
 * @property {Zone} zone
 * @property {number} [player]    - owning player index
 * @property {number} [slot]      - slot index within zone
 * @property {number} [position]  - ordinal position (e.g., discard stack)
 * @property {Location} [from]    - only when zone='transit'
 * @property {Location} [to]      - only when zone='transit'
 *
 * @typedef {Object} CardFace
 * @property {'number'|'modifier'|'action'|'special'} kind
 * @property {number|string} value
 * @property {string} [color]
 *
 * @typedef {Object} Card
 * @property {string} id
 * @property {CardFace} face
 * @property {boolean} faceUp
 * @property {Location} location
 * @property {Object} [meta]
 *
 * @typedef {Object} ViewOfCard
 * @property {'face'|'back'|'empty'|'hidden'} mode
 * @property {CardFace} [face]
 *
 * @typedef {(card: Card, viewer: number, state: any) => ViewOfCard} VisibilityPolicy
 */

// ─── Transition Log (proves animations happen in correct order) ──

class TransitionLog {
  constructor() { this.entries = []; }
  log(type, cardId, detail) {
    this.entries.push({ time: Date.now(), type, cardId, detail });
  }
  get forCard() {
    const map = {};
    for (const e of this.entries) {
      (map[e.cardId] ??= []).push(e);
    }
    return map;
  }
  toString() {
    return this.entries.map(e => `  [${e.type}] ${e.cardId}: ${JSON.stringify(e.detail)}`).join('\n');
  }
}

// ─── CardManager ────────────────────────────────────────────────

class CardManager {
  /** @type {Map<string, Card>} */
  cards = new Map();
  /** @type {VisibilityPolicy} */
  policy = () => ({ mode: 'back' });
  /** @type {TransitionLog} */
  log = new TransitionLog();
  _nextId = 0;

  /**
   * Create a new card.
   * @param {CardFace} face
   * @param {Location} location
   * @param {boolean} [faceUp=false]
   * @returns {string} stable card ID
   */
  create(face, location, faceUp = false) {
    const id = `card:${++this._nextId}`;
    const card = { id, face: { ...face }, faceUp, location: { ...location }, meta: {} };
    this.cards.set(id, card);
    this.log.log('created', id, { face: face.value, zone: location.zone });
    return id;
  }

  /** Remove a card from the game. */
  destroy(id) {
    this.cards.delete(id);
    this.log.log('destroyed', id, {});
  }

  /** Get a card by ID. */
  get(id) { return this.cards.get(id); }

  /** Get all cards. */
  all() { return [...this.cards.values()]; }

  /** Get cards in a specific zone. */
  inZone(zone, filter = {}) {
    return this.all().filter(c => {
      if (c.location.zone !== zone) return false;
      return Object.entries(filter).every(([k, v]) => c.location[k] === v);
    });
  }

  /**
   * Move a card to a new location.
   * In the real implementation, this triggers an animation.
   * Here, we just log the transition and update state.
   */
  async moveTo(id, to, opts = {}) {
    const card = this.cards.get(id);
    if (!card) throw new Error(`Card ${id} not found`);

    const from = { ...card.location };
    // During animation, card is "in transit"
    card.location = { zone: 'transit', from, to: { ...to } };
    this.log.log('transit-start', id, { from: from.zone, to: to.zone, slot: to.slot });

    // Simulate animation delay
    if (opts._simulateDelay) await new Promise(r => setTimeout(r, opts._simulateDelay));

    // After animation, card arrives
    card.location = { ...to };
    this.log.log('transit-end', id, { zone: to.zone, slot: to.slot });
  }

  /** Flip a card. */
  async flip(id, faceUp) {
    const card = this.cards.get(id);
    if (!card) return;
    card.faceUp = faceUp;
    this.log.log('flipped', id, { faceUp, value: card.face.value });
  }

  /** What does a viewer see? */
  viewOf(id, viewer, gameState) {
    const card = this.cards.get(id);
    if (!card) return { mode: 'empty' };
    return this.policy(card, viewer, gameState);
  }

  /** Set the visibility policy. */
  setVisibilityPolicy(policy) { this.policy = policy; }

  /** Verify invariant: no card is in two places at once. */
  verifyInvariants() {
    const errors = [];
    const locationMap = new Map();

    for (const card of this.all()) {
      const key = locationKey(card.location);
      if (key && locationMap.has(key)) {
        errors.push(`COLLISION: ${card.id} and ${locationMap.get(key)} both at ${key}`);
      }
      if (key) locationMap.set(key, card.id);
    }

    return { ok: errors.length === 0, errors };
  }
}

function locationKey(loc) {
  if (loc.zone === 'transit' || loc.zone === 'removed') return null; // transit is temporary
  // Deck and discard are unordered stacks — multiple cards share the zone.
  // Only track collisions for positions where exactly ONE card should be.
  if (loc.zone === 'deck') return null;  // many cards in deck, no collision
  if (loc.zone === 'discard') return null;  // many cards in discard, no collision
  return `${loc.zone}:p${loc.player ?? 'x'}:s${loc.slot ?? 'x'}`;
}

// ─── Skyjo Color Function ──────────────────────────────────────

function skyjoColor(v) {
  if (v < 0) return '#4338ca';
  if (v === 0) return '#0ea5e9';
  if (v <= 4) return '#22c55e';
  if (v <= 8) return '#eab308';
  return '#ef4444';
}

// ─── Skyjo Game Simulation ─────────────────────────────────────

async function simulateSkyjo() {
  console.log('\n════════════════════════════════════════════════');
  console.log('  SKYJO — Permanent Card System Simulation');
  console.log('════════════════════════════════════════════════\n');

  const mgr = new CardManager();

  // Set up Skyjo visibility policy
  mgr.setVisibilityPolicy((card, viewer, state) => {
    const loc = card.location;

    if (loc.zone === 'deck') return { mode: 'back' };

    if (loc.zone === 'discard') return { mode: 'face', face: card.face };

    if (loc.zone === 'grid') {
      if (card.meta?.cleared) return { mode: 'empty' };
      if (card.faceUp) return { mode: 'face', face: card.face };
      return { mode: 'back' }; // face-down: nobody sees
    }

    if (loc.zone === 'hand') {
      if (loc.player === viewer) return { mode: 'face', face: card.face };
      return { mode: 'back' };
    }

    if (loc.zone === 'transit') {
      // During transit, show face if heading to the viewer
      if (card.faceUp) return { mode: 'face', face: card.face };
      if (loc.to?.zone === 'hand' && loc.to?.player === viewer) return { mode: 'face', face: card.face };
      return { mode: 'back' };
    }

    return { mode: 'back' };
  });

  // ── Create deck ──
  const deckCardIds = [];
  const faceCounts = { '-2': 5, '-1': 10, '0': 15 };
  for (let v = 1; v <= 12; v++) faceCounts[String(v)] = 10;

  for (const [val, count] of Object.entries(faceCounts)) {
    for (let i = 0; i < count; i++) {
      const v = Number(val);
      const id = mgr.create(
        { kind: 'number', value: v, color: skyjoColor(v) },
        { zone: 'deck' }
      );
      deckCardIds.push(id);
    }
  }

  // Shuffle
  for (let i = deckCardIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deckCardIds[i], deckCardIds[j]] = [deckCardIds[j], deckCardIds[i]];
  }

  console.log(`Created ${mgr.all().length} cards in deck`);

  // ── Deal ──
  const players = ['Alice', 'Bob'];
  const gridIds = players.map(() => []); // gridIds[player][slot]

  // Move first card to discard
  await mgr.moveTo(deckCardIds.pop(), { zone: 'discard', position: 0 });

  // Deal 12 cards to each player
  for (let pi = 0; pi < players.length; pi++) {
    for (let si = 0; si < 12; si++) {
      const id = deckCardIds.pop();
      gridIds[pi].push(id);
      await mgr.moveTo(id, { zone: 'grid', player: pi, slot: si });
    }
  }

  console.log(`Dealt 12 cards each to ${players.length} players`);

  // ── Reveal 2 cards each ──
  for (let pi = 0; pi < players.length; pi++) {
    const slot0 = Math.floor(Math.random() * 12);
    let slot1 = Math.floor(Math.random() * 11);
    if (slot1 >= slot0) slot1++;

    await mgr.flip(gridIds[pi][slot0], true);
    await mgr.flip(gridIds[pi][slot1], true);
    console.log(`${players[pi]} reveals slots ${slot0} and ${slot1}`);
  }

  // ── Verify: what does player 0 see? ──
  console.log('\n── Player 0\'s view of their own board ──');
  const p0Grid = mgr.inZone('grid', { player: 0 }).sort((a, b) => a.location.slot - b.location.slot);
  for (const card of p0Grid) {
    const view = mgr.viewOf(card.id, 0, {});
    if (view.mode === 'face') {
      console.log(`  Slot ${card.location.slot}: ${view.face.value} (color: ${view.face.color})`);
    } else {
      console.log(`  Slot ${card.location.slot}: [face down]`);
    }
  }

  console.log('\n── Player 1\'s view of player 0\'s board (same cards, different visibility!) ──');
  for (const card of p0Grid) {
    const view = mgr.viewOf(card.id, 1, {});
    if (view.mode === 'face') {
      console.log(`  Slot ${card.location.slot}: ${view.face.value}`);
    } else {
      console.log(`  Slot ${card.location.slot}: [face down]`);
    }
  }

  // ── Draw from deck ──
  const drawnCardId = deckCardIds.pop();
  await mgr.moveTo(drawnCardId, { zone: 'hand', player: 0 });
  const drawnCard = mgr.get(drawnCardId);
  console.log(`\n${players[0]} draws from deck: ${drawnCard.face.value}`);

  // ── Swap drawn card with grid slot ──
  const swapSlot = p0Grid.find(c => !c.faceUp)?.location.slot ?? 0;
  const oldCardId = gridIds[0][swapSlot];

  console.log(`${players[0]} swaps drawn card (${drawnCard.face.value}) with slot ${swapSlot}`);
  await mgr.moveTo(drawnCardId, { zone: 'grid', player: 0, slot: swapSlot });
  gridIds[0][swapSlot] = drawnCardId;
  await mgr.moveTo(oldCardId, { zone: 'discard', position: 0 });
  const oldCard = mgr.get(oldCardId);
  console.log(`  Old card (${oldCard.face.value}) goes to discard`);

  // ── Simulate a triplet ──
  // Force three matching cards in column 0
  const tripletValue = 7;
  const tripletSlots = [0, 4, 8];
  for (const si of tripletSlots) {
    const id = gridIds[0][si];
    const card = mgr.get(id);
    card.face = { kind: 'number', value: tripletValue, color: skyjoColor(tripletValue) };
    card.faceUp = true;
  }
  console.log(`\n🔥 Triplet! Three ${tripletValue}s in column 0`);

  // "Clear" the triplet: move to discard
  for (const si of tripletSlots) {
    const id = gridIds[0][si];
    mgr.get(id).meta.cleared = true;
    await mgr.moveTo(id, { zone: 'discard', position: 0 });
  }

  // ── Verify invariants ──
  const inv = mgr.verifyInvariants();
  console.log(`\n✓ Invariant check: ${inv.ok ? 'PASS' : 'FAIL'}`);
  if (!inv.ok) inv.errors.forEach(e => console.log(`  ✗ ${e}`));

  // ── Show transition log ──
  console.log('\n── Full Transition Log ──');
  console.log(mgr.log.toString());

  return mgr;
}

// ─── Flip 7 Game Simulation ────────────────────────────────────

async function simulateFlip7() {
  console.log('\n\n════════════════════════════════════════════════');
  console.log('  FLIP 7 — Permanent Card System Simulation');
  console.log('════════════════════════════════════════════════\n');

  const mgr = new CardManager();

  // Flip 7 visibility: all dealt cards are public
  mgr.setVisibilityPolicy((card, viewer, state) => {
    const loc = card.location;
    if (loc.zone === 'deck') return { mode: 'back' };
    if (loc.zone === 'discard') return { mode: 'back' };
    if (loc.zone === 'grid' || loc.zone === 'hand') return { mode: 'face', face: card.face };
    if (loc.zone === 'transit') {
      if (card.faceUp || loc.to?.zone === 'grid') return { mode: 'face', face: card.face };
      return { mode: 'back' };
    }
    return { mode: 'back' };
  });

  // ── Create deck ──
  const deckIds = [];

  // Number cards: one 0, two 1s, three 2s, ..., twelve 12s
  let cardNum = 0;
  const addCard = (kind, value) => {
    const id = mgr.create({ kind, value }, { zone: 'deck' });
    deckIds.push(id);
    cardNum++;
  };

  addCard('number', 0);
  for (let n = 1; n <= 12; n++) for (let i = 0; i < n; i++) addCard('number', n);
  for (const m of ['+2', '+4', '+6', '+8', '+10', 'x2']) addCard('modifier', m);
  for (const a of ['freeze', 'flip3', 'second']) for (let i = 0; i < 3; i++) addCard('action', a);

  // Shuffle
  for (let i = deckIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deckIds[i], deckIds[j]] = [deckIds[j], deckIds[i]];
  }

  console.log(`Created ${mgr.all().length} Flip 7 cards`);

  const players = ['Alice', 'Bob'];
  const playerSlots = players.map(() => 0);

  // ── Deal initial card to each player ──
  for (let pi = 0; pi < players.length; pi++) {
    const id = deckIds.pop();
    mgr.get(id).faceUp = true;
    await mgr.moveTo(id, { zone: 'grid', player: pi, slot: playerSlots[pi]++ });
    console.log(`${players[pi]} gets initial card: ${mgr.get(id).face.value}`);
  }

  // ── Simulate a few hits for player 0 ──
  console.log(`\n${players[0]}'s turn:`);
  for (let hit = 0; hit < 3; hit++) {
    const id = deckIds.pop();
    const card = mgr.get(id);
    card.faceUp = true;
    await mgr.moveTo(id, { zone: 'grid', player: 0, slot: playerSlots[0]++ });
    console.log(`  Hit! Drew ${card.face.kind}:${card.face.value} → row has ${playerSlots[0]} cards`);
  }

  // ── Player 0 stays ──
  console.log(`  ${players[0]} stays.`);

  // ── Player 1 hits and busts ──
  console.log(`\n${players[1]}'s turn:`);
  const p1Nums = [];
  for (let hit = 0; hit < 4; hit++) {
    const id = deckIds.pop();
    const card = mgr.get(id);
    card.faceUp = true;
    p1Nums.push(card.face.value);
    await mgr.moveTo(id, { zone: 'grid', player: 1, slot: playerSlots[1]++ });
    console.log(`  Hit! Drew ${card.face.kind}:${card.face.value}`);

    // Check for bust (simplified: if duplicate number)
    if (card.face.kind === 'number' && p1Nums.filter(n => n === card.face.value).length > 1) {
      card.meta.bustCause = true;
      console.log(`  💥 BUST! Duplicate ${card.face.value}`);
      break;
    }
  }

  // ── Verify invariants ──
  const inv = mgr.verifyInvariants();
  console.log(`\n✓ Invariant check: ${inv.ok ? 'PASS' : 'FAIL'}`);
  if (!inv.ok) inv.errors.forEach(e => console.log(`  ✗ ${e}`));

  // ── Show what's on each player's board ──
  for (let pi = 0; pi < players.length; pi++) {
    console.log(`\n── ${players[pi]}'s board ──`);
    const cards = mgr.inZone('grid', { player: pi }).sort((a, b) => a.location.slot - b.location.slot);
    for (const card of cards) {
      const view = mgr.viewOf(card.id, 0, {});
      const label = view.mode === 'face' ? `${view.face.kind}:${view.face.value}` : '[back]';
      const extras = card.meta?.bustCause ? ' ← BUST CAUSE' : '';
      console.log(`  Slot ${card.location.slot}: ${label}${extras}`);
    }
  }

  // ── Show transition log (abbreviated) ──
  console.log('\n── Transition Log (card movements only) ──');
  const movements = mgr.log.entries.filter(e => e.type === 'transit-start' || e.type === 'transit-end');
  for (const e of movements.slice(-12)) {
    console.log(`  [${e.type}] ${e.cardId}: ${JSON.stringify(e.detail)}`);
  }

  return mgr;
}

// ─── Invariant Tests ────────────────────────────────────────────

function runInvariantTests() {
  console.log('\n\n════════════════════════════════════════════════');
  console.log('  INVARIANT TESTS');
  console.log('════════════════════════════════════════════════\n');

  let pass = 0, fail = 0;
  function assert(cond, msg) {
    if (cond) { pass++; console.log(`  ✓ ${msg}`); }
    else { fail++; console.log(`  ✗ ${msg}`); }
  }

  const mgr = new CardManager();

  // Test 1: Card never in two places
  const id1 = mgr.create({ kind: 'number', value: 5 }, { zone: 'deck' });
  assert(mgr.get(id1).location.zone === 'deck', 'Card created in deck');

  mgr.moveTo(id1, { zone: 'grid', player: 0, slot: 0 });
  assert(mgr.get(id1).location.zone === 'grid', 'Card moved to grid');

  const inv1 = mgr.verifyInvariants();
  assert(inv1.ok, 'No collision: one card, one location');

  // Test 2: Two cards in different slots — no collision
  const id2 = mgr.create({ kind: 'number', value: 3 }, { zone: 'grid', player: 0, slot: 1 });
  const inv2 = mgr.verifyInvariants();
  assert(inv2.ok, 'No collision: two cards, two different slots');

  // Test 3: Two cards in SAME slot — collision detected
  const id3 = mgr.create({ kind: 'number', value: 7 }, { zone: 'grid', player: 0, slot: 0 });
  const inv3 = mgr.verifyInvariants();
  assert(!inv3.ok, 'Collision detected: two cards in same slot');

  // Test 4: Visibility — deck cards hidden for everyone
  mgr.setVisibilityPolicy(() => ({ mode: 'back' }));
  const id4 = mgr.create({ kind: 'number', value: 10 }, { zone: 'deck' });
  const v1 = mgr.viewOf(id4, 0, {});
  const v2 = mgr.viewOf(id4, 1, {});
  assert(v1.mode === 'back' && v2.mode === 'back', 'Deck cards hidden for all viewers');

  // Test 5: Visibility — owner sees face, others see back
  mgr.setVisibilityPolicy((card, viewer) => {
    if (card.location.zone === 'hand' && card.location.player === viewer) return { mode: 'face', face: card.face };
    return { mode: 'back' };
  });
  const id5 = mgr.create({ kind: 'number', value: 8 }, { zone: 'hand', player: 0 });
  assert(mgr.viewOf(id5, 0, {}).mode === 'face', 'Owner sees face of hand card');
  assert(mgr.viewOf(id5, 1, {}).mode === 'back', 'Other player sees back of hand card');

  // Test 6: Destroy removes card completely
  mgr.destroy(id5);
  assert(!mgr.get(id5), 'Destroyed card is gone');
  assert(mgr.viewOf(id5, 0, {}).mode === 'empty', 'Destroyed card renders as empty');

  // Test 7: Transition log tracks full lifecycle
  const mgr2 = new CardManager();
  const id6 = mgr2.create({ kind: 'number', value: 2 }, { zone: 'deck' });
  mgr2.moveTo(id6, { zone: 'hand', player: 0 });
  mgr2.moveTo(id6, { zone: 'grid', player: 0, slot: 0 });
  mgr2.flip(id6, true);

  const cardLog = mgr2.log.forCard[id6];
  assert(cardLog.length >= 6, `Full lifecycle logged: ${cardLog.length} entries`);
  assert(cardLog[0].type === 'created', 'First event: created');
  assert(cardLog.some(e => e.type === 'transit-start' && e.detail.from === 'deck'), 'Moved from deck');
  assert(cardLog.some(e => e.type === 'transit-end' && e.detail.zone === 'grid'), 'Arrived at grid');
  assert(cardLog.some(e => e.type === 'flipped'), 'Flip recorded');

  console.log(`\n  Results: ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

// ─── Run Everything ─────────────────────────────────────────────

(async () => {
  await simulateSkyjo();
  await simulateFlip7();
  runInvariantTests();

  console.log('\n════════════════════════════════════════════════');
  console.log('  DESIGN SUMMARY');
  console.log('════════════════════════════════════════════════');
  console.log(`
  Key insight: A card is a PERMANENT OBJECT with:
    • Stable ID (created once, never changes)
    • One location at a time (deck → hand → grid → discard)
    • Face data (value, color — immutable)
    • Visibility computed per-viewer (poker: owner-only, skyjo: revealed-only)

  This eliminates:
    ❌ CardRegistry visibility ownership conflicts
    ❌ "Card in two places" bugs
    ❌ "Card vanishes during animation" bugs
    ❌ Render-before-animate anti-pattern
    ❌ Manual sync/reconcile/cleanup

  And enables:
    ✅ Automatic animations (location change = animated transition)
    ✅ Multi-viewer rendering (same card, different views for different players)
    ✅ Replay/debug (full transition log per card)
    ✅ Invariant verification (no collisions, no orphans)
    ✅ Easy game addition (just define cards + visibility policy)
  `);
})();

# 🃏 Permanent Card System — Design Document

## Question 1: What Exactly Is the Shadow State?

Flip 7 uses a technique called **shadow state** to separate "what's on screen right now"
from "what the game state actually is."

### The Problem It Solves

When the server sends a new game view, it contains the **final** state — all events
already applied. For example, if the player drew a 5 and busted, the view already says
`status: 'busted'`. If you just render this view directly, the board instantly shows
the busted state. There's nothing to animate.

### How It Works

```
Server sends: view = { players: [{ nums: [2, 5, 8], status: 'busted' }], events: [...] }

playEvents(view):
  1. shadow = clone(prevView)     ← copy LAST frame's state (before the bust)
  2. For each event:
     a. draw(shadow)              ← render the board as it was BEFORE this event
     b. animate the transition    ← card flies in, board shakes, BUST! banner
     c. applyShadowEvent(shadow)  ← mutate shadow to reflect the event
     d. draw(shadow)              ← render the board AFTER the event
  3. draw(view)                   ← render the final server state
```

The "shadow" is literally just `JSON.parse(JSON.stringify(prevView))` — a deep clone
of the previous render's state. It represents the **starting point** for animations.
Each event incrementally mutates it, and we render after each mutation.

### Why Skyjo Doesn't Use It

Skyjo doesn't have an event timeline — it only gets a single `lastAction` per render.
So it has to figure out what changed by comparing `lastAction` with the previous one.
This is why Skyjo has the "render-before-animate" problem: `render()` builds the final
DOM, then `runAnim()` tries to animate on top of it. The shadow state pattern avoids
this entirely.

### In One Sentence

**Shadow state = a copy of the previous frame that you mutate event-by-event so you
can render intermediate states during animations, instead of jumping to the final state.**

---

## Question 2: Should Cards Be Permanent With Visibility Rules?

**Yes, absolutely.** This is not just a good idea — it's the standard architecture
for every professional card game engine. Here's why:

### The Current Mess

Right now, a "card" in GameHub is not one thing — it's **three separate things** that
have to be kept in sync:

| Layer | What it is | Lifecycle |
|-------|-----------|-----------|
| **Engine** | `{ value: 5, revealed: true, cleared: false }` (data in an array) | Permanent — lives in game state |
| **DOM** | `<div class="board-card">5</div>` (HTML element in the board grid) | Recreated every render — `drawBoards()` rebuilds the entire grid |
| **CardRegistry** | `{ id, el, anchor, hidden }` (fixed-position overlay under `<body>`) | Created/destroyed during animations |

None of these layers know about each other. The engine doesn't know a DOM element
exists. The DOM element doesn't know a CardRegistry overlay is positioned on top of it.
The CardRegistry doesn't know the engine data changed. **Syncing them is the source
of every animation bug.**

### What "Permanent Cards" Would Mean

A card is created ONCE (when dealt) and destroyed ONCE (when leaving the game).
Between those moments, it has:

- A **stable identity** (`id: "skyjo:r1:p0:c5"`)
- A **current location** (`deck` → `hand:player0` → `grid:player0:slot5` → `discard`)
- A **visual state** (`faceUp: true`, `value: 5`)
- A **visibility rule** (`who can see this card's face?`)

The card moves between locations, flips, changes visibility — but it's always the
same object. The rendering layer just reflects whatever the card's current state is.

### Your Poker Example

This is exactly right. In poker:
- Your hand cards: `visibility = 'owner-only'` — only you see the face
- Community cards: `visibility = 'public'` — everyone sees
- Deck cards: `visibility = 'hidden'` — no one sees
- Folded cards: `visibility = 'hidden'` + `location = 'muck'`

In Skyjo:
- Your face-down grid cards: `visibility = 'owner-only'` — you DON'T see them either
  (so actually `'hidden'` for everyone including owner until revealed)
- Revealed cards: `visibility = 'public'`
- Deck top card (after draw): `visibility = 'owner-only'` during draw, then `'public'` if discarded

In Flip 7:
- Your hand cards: `visibility = 'owner-only'` — only you see the actual value
- Actually wait — in Flip 7 everyone sees the cards on the board. The hidden info
  is the deck composition. So it's simpler: all dealt cards are `'public'`.

The point is: **visibility is a computed property of (card, gameState, viewerIndex)**,
not something baked into the DOM structure.

---

## Question 3: The Design — A Permanent Card System

Your idea is not stupid at all. It's the correct architecture. Let me design it
concretely.

### Core Principles

1. **A Card is a first-class object with a stable ID**
2. **A Card has exactly one Location at all times** (never in two places)
3. **A CardTransition animates a card between locations** (temporary overlay)
4. **The render layer reflects card state — it never creates or destroys cards**
5. **Visibility is computed, not stored** (any viewer asks "what do I see?")

### The Type System

```typescript
// ─── Card Identity ─────────────────────────────────────────────
// A card exists from the moment it enters the game until it leaves.
// It has a stable ID that never changes.

type CardId = string;  // e.g. "skyjo:r1:p0:c5", "f7:card:42"

// ─── Card Face ─────────────────────────────────────────────────
// What's on the card. This is the "truth" — independent of who sees it.

interface CardFace {
  kind: 'number' | 'modifier' | 'action' | 'special';
  value: number | string;     // e.g. 5, 'x2', 'freeze', -2
  color?: string;             // derived from value + kind
}

// ─── Location ──────────────────────────────────────────────────
// Where the card is right now. A card is always in exactly one place.

type Location =
  | { zone: 'deck' }                                    // face-down in the deck
  | { zone: 'discard', position: number }               // in the discard pile
  | { zone: 'hand', player: number }                    // held by a player
  | { zone: 'grid', player: number, slot: number }      // on a player's board
  | { zone: 'table', position: number }                  // on the table (community)
  | { zone: 'transit', from: Location, to: Location }   // animating between zones
  | { zone: 'removed' };                                 // out of the game

// ─── Card ──────────────────────────────────────────────────────
// The permanent card object.

interface Card {
  id: CardId;
  face: CardFace;
  faceUp: boolean;
  location: Location;
  meta?: Record<string, any>;  // game-specific: cleared, bustCard, etc.
}

// ─── Visibility ────────────────────────────────────────────────
// What a specific viewer sees when looking at this card.

type ViewOfCard =
  | { mode: 'face', face: CardFace }        // see the actual face
  | { mode: 'back' }                        // see the card back
  | { mode: 'empty' }                       // slot exists but no card
  | { mode: 'hidden' };                     // slot doesn't exist for this viewer

// ─── Visibility Policy ─────────────────────────────────────────
// Each game defines how to compute visibility. This is a pure function.

type VisibilityPolicy = (card: Card, viewer: number, gameState: any) => ViewOfCard;
```

### The Card Manager

```typescript
// ─── CardManager ───────────────────────────────────────────────
// Owns all cards. The single source of truth.

class CardManager {
  private cards = new Map<CardId, Card>();
  private observers = new Set<CardObserver>();

  // ── Lifecycle ──────────────────────────────────────
  
  /** Create a new card. Returns its stable ID. */
  create(face: CardFace, location: Location, faceUp = false): CardId {
    const id = this.generateId();
    const card: Card = { id, face, faceUp, location };
    this.cards.set(id, card);
    return id;
  }

  /** Remove a card from the game entirely. */
  destroy(id: CardId): void {
    this.cards.delete(id);
    this.notify('destroyed', id);
  }

  // ── Queries ────────────────────────────────────────

  get(id: CardId): Card | undefined { return this.cards.get(id); }

  /** What does a specific viewer see when looking at this card? */
  viewOf(id: CardId, viewer: number, gameState: any): ViewOfCard {
    const card = this.cards.get(id);
    if (!card) return { mode: 'empty' };
    return this.visibilityPolicy(card, viewer, gameState);
  }

  /** All cards in a zone (e.g., all cards on player 0's grid). */
  inZone(zone: string, filter?: Partial<Location>): Card[] {
    return [...this.cards.values()].filter(c => {
      if (c.location.zone !== zone) return false;
      if (filter) return Object.entries(filter).every(([k, v]) => c.location[k] === v);
      return true;
    });
  }

  // ── Mutations (these trigger animations) ───────────

  /** Move a card to a new location. Returns a transition promise. */
  async moveTo(id: CardId, to: Location, opts?: TransitionOpts): Promise<void> {
    const card = this.cards.get(id);
    if (!card) return;
    
    const from = card.location;
    card.location = { zone: 'transit', from, to };
    this.notify('transition-start', id, { from, to });
    
    // The renderer handles the actual animation
    await this.animate(id, from, to, opts);
    
    card.location = to;
    this.notify('transition-end', id, { from, to });
  }

  /** Flip a card face-up or face-down. */
  async flip(id: CardId, faceUp: boolean): Promise<void> {
    const card = this.cards.get(id);
    if (!card) return;
    card.faceUp = faceUp;
    this.notify('flipped', id, { faceUp });
  }

  // ── Visibility ─────────────────────────────────────

  private visibilityPolicy: VisibilityPolicy;

  setVisibilityPolicy(policy: VisibilityPolicy) {
    this.visibilityPolicy = policy;
  }
}
```

### How Skyjo Would Use This

```typescript
// ── Skyjo Card Setup ───────────────────────────────────────────

// At game start: create 150 cards in the deck
const skyjoCards: CardId[] = [];
for (let i = 0; i < 150; i++) {
  const face = skyjoCardFaces[i]; // { kind:'number', value: 5 }
  const id = cardMgr.create(face, { zone: 'deck' });
  skyjoCards.push(id);
}

// Deal: move 12 cards to each player's grid
for (let pi = 0; pi < numPlayers; pi++) {
  for (let si = 0; si < 12; si++) {
    const cardId = skyjoCards.pop()!;
    await cardMgr.moveTo(cardId, { zone: 'grid', player: pi, slot: si });
  }
}

// Skyjo's visibility policy
const skyjoVisibility: VisibilityPolicy = (card, viewer, state) => {
  const loc = card.location;
  
  // Deck cards: always hidden
  if (loc.zone === 'deck') return { mode: 'back' };
  
  // Discard top: always visible
  if (loc.zone === 'discard' && loc.position === 0) return { mode: 'face', face: card.face };
  if (loc.zone === 'discard') return { mode: 'back' };
  
  // Grid cards: visible if revealed or cleared, hidden otherwise
  if (loc.zone === 'grid') {
    if (card.meta?.cleared) return { mode: 'empty' };
    if (card.faceUp) return { mode: 'face', face: card.face };
    return { mode: 'back' };
  }
  
  // Hand cards: visible only to the player who drew them
  if (loc.zone === 'hand') {
    if (loc.player === viewer) return { mode: 'face', face: card.face };
    return { mode: 'back' };
  }
  
  return { mode: 'back' };
};

// ── Skyjo Swap Action (before vs after) ────────────────────────

// BEFORE (current code — three separate systems, manual sync):
function swap_before(s, pi, bi) {
  const target = cardAt(pi, bi);                        // find DOM element
  if (CardRegistry.has('skyjo:held')) {
    CardRegistry.move('skyjo:held', { to: target, ... }); // animate overlay
    CardRegistry.remove('skyjo:held');                    // clean up registry
  }
  Card.move('skyjo:swap:...', { from: target, to: discard, ... }); // animate DOM
  // BUG: if registry was already removed, animation breaks
  // BUG: if sync() runs during animation, visibility re-hides elements
  // BUG: if triplet overwrites lastAction, swap animation never plays
}

// AFTER (with CardManager — one system, automatic):
async function swap_after(cardMgr, heldCardId, gridCardId, pi, bi, discardSlotId) {
  // Move held card to the grid slot
  await cardMgr.moveTo(heldCardId, { zone: 'grid', player: pi, slot: bi });
  // Move the old grid card to discard
  await cardMgr.moveTo(gridCardId, { zone: 'discard', position: 0 });
  // That's it. No registry management. No DOM sync. No hidden state.
  // The renderer automatically:
  //   1. Animates held→grid (card is in transit)
  //   2. Animates grid→discard (card is in transit)
  //   3. Renders final positions (cards are in their new locations)
}
```

### How Flip 7 Would Use This

```typescript
// ── Flip 7 Event Processing (before vs after) ─────────────────

// BEFORE (current code — shadow state, manual card tracking):
async function cardDeal_before(shadow, event) {
  removeCardFromShadow(shadow.players[event.actor], event.card);  // manually update shadow
  draw(shadow);                                                    // render intermediate
  const travelResult = await dealTravel(row, card, seq, before);  // complex animation
  applyShadowEvent(shadow, event);                                 // manually update shadow
  draw(shadow);                                                    // render post-event
  if (travelResult.flyId) CardRegistry.remove(travelResult.flyId); // manual cleanup
}

// AFTER (with CardManager — shadow state becomes automatic):
async function cardDeal_after(cardMgr, event) {
  const cardId = event.card.id;  // stable card identity
  // Move from deck to player's row. CardManager handles everything:
  //   - Animates from deck position to row position
  //   - No gap, no ghost, no registry cleanup
  await cardMgr.moveTo(cardId, { zone: 'grid', player: event.actor, slot: nextSlot });
  // The renderer shows the card in transit (overlay), then in its final position (in-grid).
}
```

### Why This Eliminates Every Bug Class

| Bug Class | Current Cause | How Permanent Cards Prevent It |
|-----------|--------------|-------------------------------|
| Card vanishes during animation | Registry removed too early / DOM rebuilt | Card has one location; renderer shows it wherever it is |
| Card reappears unexpectedly | sync() re-hides anchor after manual show | No `hidden` state — renderer always reflects card.location |
| Card flies from wrong position | Registry created at (0,0) after removal | Card always has a position (its current location) |
| Card in two places | Registry overlay + DOM both visible | Card has exactly one location — rendered once |
| Triplet overwrites swap animation | Single lastAction field | Cards move independently — both animations play |
| Render-before-animate | DOM rebuilt with final state before animation | Renderer draws from card state, which includes 'transit' |

### The Rendering Contract

The renderer becomes trivially simple:

```typescript
function renderCard(card: Card, viewer: number, gameState: any) {
  const view = cardMgr.viewOf(card.id, viewer, gameState);
  
  switch (view.mode) {
    case 'face':
      return renderFaceUp(card.face);      // show the value
    case 'back':
      return renderFaceDown();              // show card back
    case 'empty':
      return renderEmptySlot();             // cleared/removed
    case 'hidden':
      return null;                          // don't render at all
  }
}

function renderAllCards(viewer: number, gameState: any) {
  // Render every card in its current location
  for (const card of cardMgr.allCards()) {
    const element = renderCard(card, viewer, gameState);
    placeInSlot(element, card.location);  // position according to location
  }
}
```

No `sync()`. No `hidden` state. No `reconcile()`. No `remove()`. No `place()`.
No timing-sensitive cleanup. The card IS, and the renderer SHOWS it.

---

## Implementation Status (updated)

- ✅ **Phase 1 — CardManager Core**: implemented in `public/js/00-core.js`
  (`CardManager` with stable ids, single-location invariant, `verifyInvariants()`).
- ✅ **Phase 2 — Skyjo**: migrated to `CardManager` (held card + board cards).
- ✅ **Phase 3 — Flip 7**: migrated. The separate "shadow" copy and its scattered
  mutators (`applyShadowEvent` / `addCardToShadow` / `removeCardFromShadow`) were
  replaced by a single `liveView` advanced by one reducer (`advanceLiveView`),
  with the permanent `CardManager` cards as the source of truth for overlays.
- ✅ **Shim retired**: the backward-compat `CardRegistry` shim has been removed;
  all consumers (core resize/scroll/clear/renderTable, Flip 7 fallbacks) now call
  `CardManager` directly.
- ✅ **Invariant guard wired**: `verifyInvariants()` runs after each table render
  via `Kit.assertCardInvariants()`, gated by `localStorage.setItem('cardDebug','1')`
  (dev-only; warns, never throws).
- ⏸️ **Qwixx**: intentionally NOT migrated — it is a dice/grid game with no card
  travel animations, so the permanent-card system does not apply.

> Note: Qwixx is deliberately out of scope for the permanent-card system.

## Implementation Strategy (original plan)

This is a significant refactor but can be done incrementally:

### Phase 1: CardManager Core (no game changes)
- Implement `Card`, `Location`, `CardManager` classes
- Implement `VisibilityPolicy` type
- Wire up to the existing DOM rendering (CardManager drives what's shown,
  but the actual DOM manipulation still uses the current system)

### Phase 2: Migrate Skyjo
- Replace the three-layer system (engine data + DOM + CardRegistry) with CardManager
- Skyjo's engine stores CardIds instead of inline `{ value, revealed, cleared }`
- Animations become `cardMgr.moveTo()` calls
- Delete `syncSkyjoCards()`, `CardRegistry` calls, `hidden` management

### Phase 3: Migrate Flip 7
- Replace shadow state with CardManager state
- Events become CardManager mutations
- Delete `applyShadowEvent()`, `removeCardFromShadow()`, `addCardToShadow()`
- The shadow state concept becomes unnecessary — CardManager IS the shadow

### Phase 4: Generalize
- Extract common patterns into the Kit
- `CardManager` becomes part of `Kit`
- Each game provides a `VisibilityPolicy` and a `LayoutEngine`
- Adding a new game = define cards, layout, and visibility

### The Big Win

After this refactor, **adding a new card game takes hours instead of days**,
and **animation bugs become structurally impossible** — not because we're more
careful, but because the architecture doesn't allow them to exist.

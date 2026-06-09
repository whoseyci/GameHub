# 🔬 Animation Pipeline Audit — Skyjo & Flip 7

> Deep logical analysis of every animation path in both game pipelines.
> Traces the exact code execution order, identifies race conditions, state
> conflicts, and missing animations with root causes.

---

## Executive Summary

| Pipeline | Paths Audited | Bugs Found | Critical | Fixable Client-Only |
|----------|--------------|------------|----------|---------------------|
| Skyjo    | 7 action types | 4          | 2        | 3 (+ 1 server)      |
| Flip 7   | 13 event types | 1          | 0        | 1                   |
| Meta     | —             | 6 systemic | —        | 4                   |

**Critical finding:** The previous fix for "Skyjo held card invisible" (Bug A)
introduced a regression that **breaks swap and discard_drawn animations**.
Both the swap animation (held→grid) and the discard animation (held→discard)
now either skip entirely or animate from the wrong position.

---

## 1. Skyjo Animation Pipeline

### 1.1 Architecture

Skyjo's animation system is **action-comparison based**:
```
render(view)
  ├─ drawPiles(s, viewer, myTurn, ta)  — rebuilds pile UI + held card
  ├─ drawBoards(s, viewer)             — rebuilds player boards
  │   └─ syncSkyjoCards(s)             — reconciles CardRegistry with DOM anchors
  └─ if newAction → runAnim(s, viewer) — plays one animation
```

`runAnim()` is **async but not awaited** by `render()`. The `animating` flag
prevents concurrent renders. After animation completes, `flushView()` triggers
a re-render to update the UI.

**Key constraint:** Only ONE `lastAction` exists per view. If multiple actions
happen atomically (e.g., swap + triplet), only the last one is animated.

### 1.2 Animation Path Trace

#### Path 1: `draw_deck` (viewer draws from deck)

```
Engine: drawDeck(pi) → turnAction='deck', lastAction={type:'draw_deck'}

render():
  drawPiles(ta='deck'):
    held wrapper: classList.remove('hidden')  → VISIBLE
    held content: textContent = myDrawnCard
    ★ FIX APPLIED: CardRegistry.remove('skyjo:held') → REMOVES REGISTRY CARD
  
  drawBoards():
    syncSkyjoCards() → rAF(sync) scheduled
  
  newAction=true → runAnim(draw_deck):
    animating=true
    CardRegistry.move('skyjo:held', {from:uiDeck, to:uiHeldCard, hideTarget:true})
      → Creates skyjo:held, animates deck→held (520ms)
      → After animation: it.hidden = {el:uiHeldCard}
    animating=false
    flushView() → render() again

Second render():
  drawPiles(ta='deck'):
    ★ FIX APPLIED: CardRegistry.has('skyjo:held') → TRUE → REMOVES IT
    → uiHeldCard visibility restored
    held wrapper: still visible (ta='deck')
    held content: textContent = myDrawnCard → USER SEES CARD ✅
```

**Bug A original was here (sync re-hides uiHeldCard). Fix A solved it.** ✅

#### Path 2: `swap` (viewer swaps held card with grid card) — **BROKEN BY FIX A**

```
Engine: swap(pi, bi) → turnAction='turn_end_delay', lastAction={type:'swap'}
  ⚠ If swap triggers triplet: lastAction OVERWRITTEN to {type:'triplet'}

render():
  drawPiles(ta='turn_end_delay'):
    ★ FIX APPLIED: CardRegistry.has('skyjo:held') → FALSE (removed in Path 1!)
    → Wrapper: classList.add('hidden') → DISPLAY:NONE
    → held card slot has zero dimensions
  
  drawBoards():
    Board rebuilt showing FINAL state (card already swapped in grid)
    syncSkyjoCards() → rAF(sync) scheduled
  
  newAction=true → runAnim(swap):
    target = cardAt(player, index)  → points to NEW board DOM (shows new card)
    
    ❌ CardRegistry.has('skyjo:held') → FALSE (was removed!)
    → HELD→GRID ANIMATION SKIPPED ENTIRELY
    
    Card.move('skyjo:swap:...', {from:target, to:uiDiscard, value:oldVal, ...})
    → Old card animates from grid to discard
    → But grid already shows NEW card value (drawBoards rebuilt it)
    → Visual: new card appears instantly, old card flies away from same spot
    
    flushView() → render() again
```

**What user sees:**
1. Held card vanishes (wrapper hidden by drawPiles)
2. New card instantly appears in grid (drawBoards rendered final state)
3. Old card flies from grid to discard
4. No float text for score diff

**Root cause:** Fix A removes `skyjo:held` in `drawPiles()` which runs BEFORE
`runAnim()`. The swap animation needs `skyjo:held` but it's already gone.

#### Path 3: `discard_drawn` (viewer discards drawn card) — **BROKEN BY FIX A**

```
Engine: discardDrawnCard(pi) → turnAction='must_reveal', lastAction={type:'discard_drawn'}

render():
  drawPiles(ta='must_reveal'):
    ★ FIX APPLIED: CardRegistry.has('skyjo:held') → TRUE → REMOVES IT
    held wrapper: classList.remove('hidden') (must_reveal is in the if-branch)
    held.style.visibility = 'hidden' (intentional: card was discarded)
  
  newAction=true → runAnim(discard_drawn):
    CardRegistry.move('skyjo:held', {to:uiDiscard, ...})
    → skyjo:hed was REMOVED → ensure() creates NEW entry
    → No `from` specified, it.anchor is null → overlay at (0,0) with 0 size
    → Card flies from TOP-LEFT CORNER to discard pile ❌
    
    CardRegistry.remove('skyjo:held')
    flushView()
```

**What user sees:** A card appears from the top-left corner and flies to the
discard pile. Looks completely broken.

#### Path 4: `take_discard` → `swap` — **SAME ISSUES AS PATHS 2+3**

take_discard works correctly (creates skyjo:held), but the subsequent swap
hits the same broken path as Path 2.

#### Path 5: `triplet` (when triggered by swap) — **SWAP ANIMATION LOST**

```
Engine: swap(pi, bi)
  → lastAction = {type:'swap', ...}
  → _end() → checkTriplets()
    → triplet found!
    → lastAction = {type:'triplet', ...}  ← OVERWRITES SWAP!
    → turnAction = 'turn_end_delay'

render():
  Only sees lastAction.type === 'triplet'
  runAnim(triplet):
    Tries to animate cardAt() indices → but drawBoards already shows cleared state
    Stacks and discards "cleared" cards → visually confusing
```

**What user sees:**
1. Held card vanishes, new card appears in grid (swap not animated)
2. No score diff float text
3. Column already appears cleared (drawBoards rendered it)
4. Cards stack/discard on an already-empty column

**This bug exists in BOTH client engine AND server engine.**

#### Path 6: `reveal` / `reveal_after_discard` — ✅ WORKS CORRECTLY

Direct DOM flip via `revealSkyjoRegistryCard()`. No registry conflicts.

#### Path 7: `draw_deck` for opponent — ✅ WORKS CORRECTLY

Animation skipped (a.player !== viewer). Only deck display changes.

---

## 2. Flip 7 Animation Pipeline

### 2.1 Architecture

Flip 7 uses an **event-timeline with shadow state**:
```
playEvents(view)
  ├─ Filter events with seq > lastSeq
  ├─ Shadow = clone of prevView (intermediate rendering state)
  └─ For each event:
       ├─ runUnifiedEvent(shadow, event, finalView)
       │   ├─ Mutate shadow state (add/remove cards, change status)
       │   ├─ draw(shadow) — render intermediate state
       │   ├─ Animate (fly cards, shake, VFX)
       │   ├─ applyShadowEvent(shadow, event) — update shadow to post-event
       │   ├─ draw(shadow) — render post-event state
       │   └─ Cleanup transient registry entries
       └─ lastSeq updated
  └─ draw(finalView) — render final state
```

This is the **correct pattern**: shadow state allows rendering intermediate
frames during animation, avoiding the render-before-animate problem that
plagues Skyjo.

### 2.2 Event Path Analysis

#### `card.deal` — ✅ CORRECT (after previous fix)

```
removeCardFromShadow(shadow, card)  — card removed from shadow
draw(shadow)                         — board WITHOUT card (clean slate)
captureF7Layout()                    — snapshot positions
dealTravel(row, card):
  ├─ Ghost anchor inserted (hidden)
  ├─ syncF7Cards() + animateF7Layout() — smooth layout transition
  └─ flyF7Card(deck, ghost, card)     — flying card visible during flight
       └─ Returns flyId (NOT removed yet)
applyShadowEvent(shadow, event)      — card added to shadow
draw(shadow)                         — board WITH card (permanent card created)
CardRegistry.remove(flyId)           — flying card removed AFTER permanent exists
ghost.remove()                       — cleanup
```

**Zero-gap continuity:** The flying card stays visible until the permanent
board card takes its place. ✅

#### `card.transfer` — ✅ CORRECT

Action cards fly from source player to target player. VFX overlay plays.
Shadow state updated correctly.

#### `effect.bust` — ✅ CORRECT

Board shakes, BUST banner shown. Shadow state marks player as busted.

#### `deck.wiggle` — ✅ CORRECT

Deck element wiggles with intensity proportional to bust probability.

#### `effect.flip7` — ✅ CORRECT

Confetti, FLIP 7 banner, sound.

#### `effect.round_end` / `effect.game_over` — ✅ CORRECT

Summary overlay shown. No animation conflicts.

#### Potential Issue: `playEvents()` prevView bootstrap

When `prevView` is null (first render), shadow is cloned from `view` (final
state). Events are applied on top of final state → double application.
**Mitigated:** All `applyShadowEvent` operations are idempotent (nums dedup,
status is set-not-toggled, action cards use removeOne). No visible bug. ✅

#### Potential Issue: `syncF7Cards()` rAF race with `animateF7Layout()`

Both schedule `requestAnimationFrame` callbacks. The sync runs first (scheduled
first), positioning cards at new anchor positions. Then animateF7Layout's rAF
clears the offset transform, starting the smooth transition. **This actually
works correctly** because:
1. animateF7Layout sets `transition:none` + `transform:offset` BEFORE the rAF
2. sync positions cards at new positions (overwritten, but transform still has offset)
3. animateF7Layout's rAF sets `transition` and clears transform → smooth animation ✅

---

## 3. Bug Catalog

### 🔴 Critical

#### BUG-S1: Skyjo swap animation broken (regression from Bug A fix)

**Severity:** High — visible to all players every turn
**Files:** `public/js/03-skyjo.js` (drawPiles + runAnim)

The `Kit.CardRegistry.remove('skyjo:held')` in `drawPiles()` removes the
registry card before `runAnim()` can use it for the swap animation. Result:
held card vanishes instantly, no fly-to-grid animation.

**Fix:** Replace the unconditional remove with conditional wrapper visibility
that keeps the registry card alive through the swap animation.

#### BUG-S2: Skyjo discard_drawn animates from wrong position (regression)

**Severity:** High — card flies from top-left corner
**Files:** `public/js/03-skyjo.js` (runAnim)

After skyjo:held is removed by drawPiles, `CardRegistry.move()` creates a new
entry with no position (ensure() creates at 0,0). The card flies from the
top-left corner to the discard pile.

**Fix:** Same as BUG-S1 — keep skyjo:held alive until after the animation.

### 🟠 Medium

#### BUG-S3: Triplet overwrites swap lastAction

**Severity:** Medium — swap animation + score diff text lost
**Files:** `public/js/03-skyjo.js` (SkyjoEngine), `src/engine.ts` (server)

When a swap triggers a column triplet, `checkTriplets()` overwrites
`lastAction` from `{type:'swap'}` to `{type:'triplet'}`. The swap animation
never plays. Users miss:
- The held→grid fly animation
- The score diff float text (+3 or -2)
- The old card→discard animation

**Affects:** Both local play (client engine) and online play (server engine).

**Fix:** Chain triplet as a sub-field of swap's lastAction instead of
overwriting. Play both animations sequentially.

#### BUG-F1: Flip 7 local board swap can flash during rapid events

**Severity:** Low — 650ms dwell usually sufficient
**Files:** `public/js/04-flip7.js` (playEvents)

The 650ms `setTimeout(renderLocal)` after events complete could theoretically
fire during a bot's turn if event processing is very fast. In practice, the
`animating` flag prevents this from causing visual issues.

---

## 4. Root Cause Analysis

### 4.1 The Render-Before-Animate Anti-Pattern (Skyjo)

Skyjo's `render()` builds the **final DOM state** (drawPiles + drawBoards)
BEFORE `runAnim()` plays the animation. This means:
- The board already shows the result of the action
- Animations must "undo" the render to show intermediate states
- CardRegistry overlays are used to mask the final state and animate transitions

**Why it breaks:** When drawPiles() removes the registry card (Fix A), the
final state is shown with no way to animate the transition.

### 4.2 The Shadow State Pattern (Flip 7 — Correct)

Flip 7 clones the previous view as a "shadow" and renders intermediate states:
- Before event: draw shadow (previous state)
- Animate: fly card, shake, etc.
- After event: apply event to shadow, draw again (new state)
- Cleanup: remove transient registry entries

**Why it works:** The shadow state always represents the correct visual for
the current animation frame. No fighting between render and animate.

### 4.3 CardRegistry Visibility Ownership Conflict

The CardRegistry's `hidden` mechanism is designed for **permanent overlays**
(board positions that the registry fully owns). When used for **transient
animations** (flying cards, held card), two systems fight over visibility:

| Owner | Mechanism | Works for | Breaks for |
|-------|-----------|-----------|------------|
| CardRegistry | it.hidden + sync() | Permanent board cards | Transient animations |
| Direct DOM | style.visibility | Static content | Overlaid by registry |

The fix needs to transfer ownership at the right moment:
- During animation: CardRegistry owns the element
- After animation completes: DOM owns the element
- Before next animation: CardRegistry re-acquires ownership

### 4.4 Single-Action Animation Limit (Skyjo)

Skyjo can only animate ONE `lastAction` per render cycle. When multiple
actions happen atomically (swap + triplet), only the last one is animated.
This is a fundamental design limitation.

---

## 5. Meta Analysis: Systemic Prevention

### 5.1 Adopt the Shadow State Pattern for All Games

**Problem:** Skyjo's render-before-animate causes constant state conflicts.
**Solution:** Implement Flip 7's shadow state pattern in Skyjo:
```
render(view):
  if newAction:
    shadow = clone(prevView)
    drawShadowState(shadow)     // render intermediate state
    await animateTransition()    // play animation
    applyAction(shadow, action)  // update shadow
    drawShadowState(shadow)     // render post-action state
  else:
    drawFinalState(view)        // normal render
```

**Impact:** Eliminates the entire class of "registry vs DOM" visibility bugs.
The shadow state is the single source of truth for what's on screen.

### 5.2 Formalize CardRegistry Lifecycle Contracts

**Problem:** No clear rules for when registry entries should exist.
**Solution:** Define explicit lifecycle types:

```typescript
// Permanent: exists as long as the board slot exists
// Created by sync/renderSlot, removed by reconcile
type Permanent = { type: 'permanent', anchor: Element }

// Transient: exists only during an animation
// Created before animation, removed after permanent card exists
type Transient = { type: 'transient', expiresAfter: string }
```

**Impact:** Prevents the "remove too early" (Flip 7 Bug B) and "remove too
late" (Skyjo Bug A) classes of bugs.

### 5.3 Replace `lastAction` with Action Queue

**Problem:** Single `lastAction` field means only one animation per render.
**Solution:** Use an action queue that animations consume:

```typescript
let animationQueue: AnimAction[] = []

function queueAction(action: AnimAction) {
  animationQueue.push(action)
}

async function processQueue() {
  while (animationQueue.length > 0) {
    const action = animationQueue.shift()!
    await animate(action)
  }
}
```

**Impact:** Fixes the triplet-overwrites-swap bug naturally. Both actions
are queued and played sequentially.

### 5.4 Animation State Machine

**Problem:** `animating` boolean is insufficient for tracking complex states.
**Solution:** Formal state machine:

```
IDLE → (new view with action) → ANIMATING
ANIMATING → (animation complete) → CLEANUP
CLEANUP → (registry entries released) → IDLE
ANIMATING → (new view arrives) → QUEUED (pendingView)
```

**Impact:** Makes state transitions explicit and testable. No more ad-hoc
boolean checks scattered across functions.

### 5.5 Separate Animation Layer from Render Layer

**Problem:** `drawPiles()` and `drawBoards()` both modify DOM AND affect
animation state (via syncSkyjoCards and registry reconciliation).
**Solution:** Split into two phases:
1. **Data layer:** Compute what should be on screen (pure function)
2. **Animation layer:** Transition from previous state to new state
3. **Render layer:** Apply the animated state to DOM

**Impact:** Each layer has a single responsibility. Animations can't break
renders and vice versa.

### 5.6 Test Infrastructure for Animation Pipelines

**Problem:** No automated tests for animation state transitions.
**Solution:**
- Unit tests for each animation path (mock DOM, verify registry state)
- Integration tests that trace full action sequences (draw→swap→end)
- State invariant checks (after every animation, verify: no orphaned registry
  entries, no hidden anchors that should be visible, no duplicate overlays)

**Example test:**
```javascript
test('draw_deck then swap: skyjo:held persists through drawPiles', () => {
  engine.drawDeck(0)
  client.render(engine.viewFor(0))  // draw animation
  
  expect(CardRegistry.has('skyjo:held')).toBe(true)
  expect($('uiHeldCard').style.visibility).not.toBe('hidden')
  
  engine.swap(0, 5)
  client.render(engine.viewFor(0))  // swap animation
  
  expect(CardRegistry.has('skyjo:held')).toBe(false)  // cleaned up after swap
})
```

---

## 6. Fix Priority

| Bug | Severity | Effort | Impact | Status |
|-----|----------|--------|--------|--------|
| S1: Swap animation broken | Critical | Small | Every Skyjo turn | ✅ Fixed |
| S2: Discard from wrong pos | Critical | Small | Every discard_drawn | ✅ Fixed |
| S3: Triplet overwrites swap | Medium | Medium | ~15% of swaps | ✅ Fixed (client + server) |
| Meta: Shadow state pattern | — | Large | Eliminates class | 📋 Documented |
| Meta: Action queue | — | Medium | Fixes chained actions | 📋 Documented |
| Meta: Lifecycle contracts | — | Medium | Prevents registry bugs | 📋 Documented |

### Verification

- **67 tests pass** (53 original + 14 new animation pipeline tests)
- **Smoke test passes**
- **TypeScript typecheck clean**
- New test file `tests/animation-pipeline.test.ts` covers:
  - Skyjo: triplet chaining, held card lifecycle, sync() non-regression
  - Flip 7: event normalization, lastSeq filtering, shadow idempotency
  - Cross-cutting: lastAction invariants, source code structural checks

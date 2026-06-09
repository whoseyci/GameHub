# 🎬 Animation Playtesting — Bug Report & Applied Fixes

> Reproduced from live play at `https://gamehub.whoseyci.workers.dev/`
> All fixes verified: 53 unit tests ✅, smoke test ✅, typecheck ✅

---

## Bug A: Skyjo — Held Card Field Always Empty

**What the player sees:** After drawing from the deck, the held card area
shows the labels ("Drew from Deck:", "Tap a card to swap, or Discard to
drop it.") but the actual card value is invisible. The 40×56px card slot
appears blank.

### Root Cause

The `CardRegistry` and `drawPiles()` fight over the `uiHeldCard` element's
visibility:

1. `runAnim()` calls `Kit.CardRegistry.move('skyjo:held', {hideTarget: true})`
   which sets `it.hidden = {el: uiHeldCard}` and hides the element.

2. After the animation, `flushView()` → `drawPiles()` runs and sets
   `held.style.visibility = ''` to show the card. ✅

3. Then `drawBoards()` → `syncSkyjoCards()` calls `requestAnimationFrame(() => CardRegistry.sync())`.

4. `sync()` iterates ALL registry items. For `'skyjo:held'`, `it.hidden` is
   still set, so it calls `setAt(it, anchor, {hideAnchor: true})` which
   **re-hides `uiHeldCard`**, overriding what `drawPiles()` just did. ❌

The registry card is never removed between draw_deck and swap/discard, so
every `sync()` call re-hides the held element.

### Fix Applied

**File:** `public/js/03-skyjo.js` — In `drawPiles()`, before setting up the
held card content, explicitly release CardRegistry control:

```javascript
// Before the held card setup block:
if (typeof Kit !== 'undefined' && Kit.CardRegistry 
    && Kit.CardRegistry.has('skyjo:held'))
  Kit.CardRegistry.remove('skyjo:held');
```

The registry card was only needed during the fly animation. Once the
animation completes and `drawPiles()` runs, the DOM element should own its
own visibility.

---

## Bug B: Flip 7 — Cards Disappear on Arrival, Reappear Before Board Swap

**What the player sees (local 2-player):**
1. Card flies from deck toward player board ✅
2. Card **vanishes** the instant it reaches the board ❌
3. Card **reappears** inside the board a moment later ✅
4. Board immediately swaps to the next player ❌

### Root Cause

Two interacting issues in `dealTravel()` and `flyF7Card()`:

**Issue B1: Flying card removed before board rebuild**

`flyF7Card()` called `Kit.CardRegistry.remove(id)` immediately after the
flight animation completed. But the call chain was:

```
dealTravel()
  → flyF7Card()           // card visible during flight
  → CardRegistry.remove() // ← card gone from screen!
  → ghost.remove()
← back in card.deal handler:
  → applyShadowEvent()    // add card to shadow state
  → draw(shadow)          // rebuild board WITH the card (card reappears)
```

Between `CardRegistry.remove()` and `draw(shadow)`, there's a ~1-2ms gap
where the card simply doesn't exist on screen. The human eye perceives
this as "disappeared on arrival."

**Issue B2: Card reappears then board swaps**

After all events process, `playEvents()` calls `draw(view)` (final draw)
which shows the current player's board with the new card. Then 650ms later,
`renderLocal()` switches to the next player. The user sees the card appear
and immediately gets whisked away — feels broken.

### Fix Applied

**File:** `public/js/04-flip7.js` — Two changes:

**Change 1:** `flyF7Card()` no longer removes the registry card. Instead
it returns the ID so the caller can clean up after the board is rebuilt:

```javascript
// Before: Kit.CardRegistry.remove(id);
// After:  return id;
```

**Change 2:** `dealTravel()` returns cleanup handles `{flyId, ghost}`
instead of removing them itself. The `card.deal` event handler in
`runUnifiedEvent` now cleans up AFTER the board rebuild:

```javascript
const travelResult = await dealTravel(row, e.card, e.seq, before);
applyShadowEvent(shadow, e);
draw(shadow);  // ← board rebuilt, permanent registry cards created
// NOW safe to remove — no visible gap:
if (travelResult?.flyId) Kit.CardRegistry.remove(travelResult.flyId);
if (travelResult?.ghost?.parentNode) travelResult.ghost.remove();
```

This ensures **zero-gap continuity**: the flying card stays visible until
the permanent board card takes its place. Once B1 is fixed, the 650ms
dwell before board swap feels natural — the card lands, sits visibly in
the board, then smoothly transitions to the next player.

---

## The Core Pattern

Both bugs stem from the same design issue in the `CardRegistry` system:

| Bug | Registry card lifecycle | DOM element |
|-----|------------------------|-------------|
| Skyjo held | Never removed after move → `sync()` perpetually re-hides anchor | Can't show its own content |
| Flip 7 deal | Removed too early → visible gap before board rebuild | Not yet created |

The `CardRegistry`'s `hideAnchor` mechanism works well for **permanent**
cards (board positions that the registry fully owns). But for **transient**
animations (flying cards, held card), the DOM element needs to take back
control after the animation — and the registry needs to let go at the
right moment: not too early (Flip 7 gap), not too late (Skyjo hiding).

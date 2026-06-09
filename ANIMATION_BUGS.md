# 🐛 Live Playtesting Bugs — Exact Root Causes & Fixes

> Found by playing the actual game on `https://gamehub.whoseyci.workers.dev/`
> and tracing every frame of the animation pipelines.

---

## Bug A: Skyjo — Held Card Field Always Empty

**Symptom:** When you draw from the deck (or take discard), the held card area
never shows your card. You see the labels ("Drew from Deck:", "Tap a card to
swap") but the card slot is blank/invisible.

### Root Cause

It's a **CardRegistry visibility ownership conflict**. Two systems fight over
the `uiHeldCard` element's visibility:

**Step 1:** `runAnim()` detects `draw_deck` and calls:
```javascript
// 03-skyjo.js line 173
await Kit.CardRegistry.move('skyjo:held', {
  from: $('uiDeck'), to: $('uiHeldCard'), 
  hideTarget: true,   // ← the registry "owns" uiHeldCard now
});
```
`CardRegistry.move()` internally calls `setAt(it, to, {hideAnchor: true})`
which sets `it.hidden = {el: uiHeldCard, visibility: 'visible'}` then sets
`uiHeldCard.style.visibility = 'hidden'`.

**Step 2:** `flushView()` triggers a re-render. `drawPiles()` runs and tries
to show the held card:
```javascript
// 03-skyjo.js line ~96
held.style.visibility = '';     // ← tries to unhide
held.style.display = 'flex';
held.textContent = s.myDrawnCard; // ← sets the value
```

**Step 3:** `drawBoards()` → `syncSkyjoCards()` runs. It calls:
```javascript
requestAnimationFrame(() => Kit.CardRegistry.sync());
```

**Step 4:** `CardRegistry.sync()` iterates ALL registry items including
`'skyjo:held'`:
```javascript
// 00-core.js line 292
function sync() {
  for (const it of items.values())
    if (it.anchor) setAt(it, it.anchor, { hideAnchor: !!it.hidden });
}
```
Since `it.hidden` is still set (from step 1), `hideAnchor: true` runs,
which **re-hides `uiHeldCard`** — overriding what `drawPiles()` just did.

**Result:** `uiHeldCard` is perpetually hidden by the CardRegistry. The
held card area shows the wrapper, labels, and "Tap a card to swap" subtitle
but the actual card value is invisible.

### Fix

**File: `public/js/03-skyjo.js`** — In `drawPiles()`, when setting up the
held card, explicitly release the CardRegistry's control:

```javascript
// Around line 96, BEFORE the held card content is set, add:
if (typeof Kit !== 'undefined' && Kit.CardRegistry && Kit.CardRegistry.has('skyjo:held')) {
  Kit.CardRegistry.remove('skyjo:held');
}
```

This lets `drawPiles()` fully own the `uiHeldCard` element's visibility.
The registry card was only needed during the fly animation — once the
animation completes and we re-render, the DOM element should take over.

**Alternative (more robust):** Change `CardRegistry.sync()` to skip items
that haven't been written to since last sync:
```javascript
// 00-core.js line 292
function sync() {
  for (const it of items.values())
    if (it.anchor) setAt(it, it.anchor, { hideAnchor: false }); // never re-hide
}
```
But this would change semantics for all games. The targeted fix above is
safer.

---

## Bug B: Flip 7 — Cards Disappear on Arrival, Reappear Before Board Swap

**Symptom:** In local 2-player mode, when you hit and a card is dealt:
1. Card flies from the deck toward your board ✅
2. Card **vanishes** the instant it reaches the board ❌
3. Card **reappears** inside the board a moment later ✅
4. Board immediately swaps to player 2 ❌ (feels jarring)

### Root Cause — Two interacting issues

#### Issue B1: Flying card removed too early

**File: `public/js/04-flip7.js` lines 225–242**

`flyF7Card()` removes the registry card immediately after the flight:
```javascript
async function flyF7Card(fromEl, toEl, card, {...}) {
  const id = 'flip7:flying:' + Date.now() + ':' + ...;
  await Kit.CardRegistry.move(id, { from: fromEl, to: toEl, ... });
  Kit.CardRegistry.remove(id);  // ← removes the visible card!
}
```

The call chain is:
```
runUnifiedEvent('card.deal')
  → dealTravel(row, card)
    → flyF7Card(deck, ghost, card)  // card becomes visible during flight
    → ghost.remove()                 // invisible anchor removed
  // back in card.deal:
  → applyShadowEvent(shadow, e)      // adds card to shadow state
  → draw(shadow)                     // rebuilds board WITH the card
```

Between `flyF7Card` completing (card removed from registry) and `draw(shadow)`
(board rebuilt), there's a gap of ~1–2ms where the card is simply **gone**
from the screen. The human eye perceives this as "disappeared on arrival."

#### Issue B2: Card reappears then board instantly swaps

After all events in a turn are processed, `playEvents()` does:

```javascript
// 04-flip7.js line ~370
draw(view);  // ← final draw with the REAL view (not shadow)
prevView = cloneView(view);
curView = cloneView(view);

// Then, in local mode:
if (mode === 'local' && view.flip7.phase === 'PLAY' 
    && view.flip7.current !== view.flip7.viewerSeat) {
  setTimeout(() => {
    if (mode === 'local' && localGameId === 'flip7') renderLocal();
  }, 650);
}
```

The final `draw(view)` renders the current player's board with the new card
visible. Then 650ms later, `renderLocal()` switches the view to the next
player's board. The user sees: card appears → 650ms → board swaps. This
creates the "reappears right before the swap" feeling.

### Fix for B1: Keep flying card visible until board rebuilds

**File: `public/js/04-flip7.js`** — Modify `flyF7Card` to NOT remove the
card, and return its ID so the caller can clean up:

```javascript
async function flyF7Card(fromEl, toEl, card, {duration=620, startFaceDown=false, revealMidway=false, spin=true}={}) {
  const id = 'flip7:flying:' + Date.now() + ':' + Math.random().toString(36).slice(2);
  await Kit.CardRegistry.move(id, {
    from: fromEl,
    to: toEl,
    card,
    render: (c) => { const el = cardEl(c?.kind||'num', c?.v??'?'); el.classList.add('f7-flying-card'); return el; },
    backHTML: f7BackHTML(),
    startFaceDown,
    revealMidway,
    spin,
    duration,
    land: false,
    hideTarget: true,
    onReveal: () => SFX.flip(),
  });
  // DON'T remove here — caller handles cleanup after board rebuild
  return id;
}
```

Then modify `dealTravel` to clean up after the board is rebuilt:

```javascript
function dealTravel(toRowEl, card, seq='x', before=null) {
  return new Promise(async res => {
    const deck = $('f7Deck');
    if (!deck || !toRowEl) { res(); return; }
    deck.classList.remove('deal'); void deck.offsetWidth; deck.classList.add('deal');
    const ghost = cardEl(card?.kind||'num', card?.v??'?');
    ghost.style.visibility = 'hidden';
    if (card?.kind === 'num') {
      const nums = [...toRowEl.querySelectorAll('.f7-card.num')];
      const firstSpecial = [...toRowEl.querySelectorAll('.f7-card:not(.num)')][0] || null;
      const after = nums.find(el => Number(el.textContent) > Number(card.v)) || firstSpecial;
      toRowEl.insertBefore(ghost, after || null);
    } else toRowEl.appendChild(ghost);
    if (before) { syncF7Cards(); animateF7Layout(before); }
    SFX.flip();
    const flyId = await flyF7Card(deck, ghost, card, {startFaceDown:true, revealMidway:true, spin:true, duration:620});
    // DON'T remove ghost yet — keep flying card visible
    res({ flyId, ghost });  // return cleanup handles
  });
}
```

Then in `runUnifiedEvent`, clean up AFTER the board rebuild:

```javascript
case 'card.deal': {
  if (mode === 'local') eventFocus = e.actor;
  removeCardFromShadow(shadow.flip7.players[e.actor], e.card);
  draw(shadow);
  const row = rowOf(e.actor);
  if (e.flip3) await sleep(SPEED.flip3Gap * 0.2);
  const before = captureF7Layout();
  const { flyId, ghost } = await dealTravel(row, e.card, e.seq, before);
  applyShadowEvent(shadow, e);
  draw(shadow);  // ← board now has the card as a registry-anchor
  // syncF7Cards() inside draw() creates the permanent registry card
  // NOW safe to remove the flying card and ghost
  if (flyId) Kit.CardRegistry.remove(flyId);
  if (ghost && ghost.parentNode) ghost.remove();
  await sleep(SPEED.beat * 0.18);
  break;
}
```

This ensures zero gap: the flying card stays visible until the permanent
registry card takes its place.

### Fix for B2: Add visual dwell time before board swap

**File: `public/js/04-flip7.js`** — After processing all events for a turn
in local mode, add a dwell so the current player's final state is visible
before switching:

```javascript
// At the end of playEvents(), after the existing local-mode setTimeout:
if (mode === 'local' && view.flip7.phase === 'PLAY' 
    && view.flip7.current !== view.flip7.viewerSeat) {
  // The existing 650ms delay already exists — but the card reappears
  // right before it fires because draw(view) just ran.
  // Solution: also add a brief delay after the LAST card.deal event
  // so the user sees the card land before anything else happens.
}
```

Actually, the 650ms delay IS there. The real issue is B1 — once the card
doesn't disappear, the 650ms dwell will feel natural: card lands → stays
visible → smooth transition to next player. So fixing B1 should fix B2 as
well.

---

## Summary: The Core Pattern

Both bugs stem from the same design issue in the `CardRegistry` system:

| Bug | Registry card removed... | ...but DOM element not ready yet |
|-----|-------------------------|--------------------------------|
| Skyjo held | Never removed after move | Registry keeps hiding anchor via sync() |
| Flip 7 deal | Removed immediately after flight | Board not rebuilt yet |

The CardRegistry's `hideAnchor` mechanism is designed for cases where the
registry card fully replaces the DOM element (like board cards). But for
transient animations (flying cards, held card), the DOM element needs to
take back control after the animation — and the registry needs to let go.

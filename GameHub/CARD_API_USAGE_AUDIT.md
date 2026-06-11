# Card-API usage audit — are the card games using everything the shared API offers?

**Date:** 2026-06-11 · **Scope:** the three card-based games (Skyjo, Flip 7, Schotten Totten) vs the shared card API (`Kit.Cards`, `Kit.CardBoard`, `Kit.CardManager`, `Kit.Status`, `Kit.Controls`, `Kit.MiniBoard`, `Kit.EventRunner`, `Kit.dealCascade/triplet/confetti/floatText/turnBanner/revealEl`, `GameShell`, `SeatModel`, `GameActions`).

**Method:** grepped each game client for every `Kit.*` / shell call and for the manual patterns the API is meant to replace (raw card markup, hand-rolled flights via `getBoundingClientRect`, `Math.random`, raw status/overlay DOM). Findings below are file+line specific.

---

## TL;DR

The card API is **well adopted** — better than the older `UNIFICATION_AUDIT.md` implies (two of its claims are now stale: `EventRunner` *is* used, and no game hand-rolls card HTML anymore — everything goes through `Kit.Cards.el`). But there are **three real, layered gaps** where games still hand-roll something the API already does:

| Rank | Gap | Game(s) | Status |
|---|---|---|---|
| **A** | Skyjo bypassed the high-level `Kit.Cards.board()` loop and hand-rolled create/pin/reconcile (`syncSkyjoCards`, 42 raw `Kit.CardManager.*` calls) | Skyjo | ✅ **DONE** — now one `Kit.Cards.board('skyjo:table:')` call (commit `5896d87`) |
| **B** | `ctx.inspect()` existed in the shell but no game used it — all three reached into `$('investigateOverlay')`/`$('investigateBox')` directly | all 3 | ✅ **DONE** — routed through `GameShell.inspect/closeInspect` (commit `acd6c6e`) |
| **C** | Pile/zone widgets `Kit.Cards.deck/discard/grid/hand` unused by Skyjo & Flip 7 | Skyjo, Flip 7 | ⚪ **WON'T-FIX** — investigated; the helpers are thin factories, the games' piles/rows are legitimately game-specialized static/inline DOM + tuned CSS. Migrating = churn + regression risk, no gain. See Gap C section. |

Plus two smaller items (D, E) below.

---

## What each game uses today (evidence)

### Schotten Totten — the gold standard ✅
Uses the **high-level declarative** layer almost exclusively:
`Kit.Cards.anchor` ×2, `Kit.Cards.board` ×3, `Kit.Cards.deal`, `Kit.Cards.move`, `Kit.Cards.deck`, `Kit.Cards.hand`, `Kit.Cards.drop`, `Kit.Cards.snapshot` ×2, `Kit.CardBoard.fly`, `Kit.Controls.set/clear`, `Kit.floatText`.
Drops to raw `Kit.CardManager` only twice (`has`, `clear`). **This is the shape the other two should converge toward.**

### Skyjo — heavy raw-CardManager user ⚠️
- `Kit.CardManager.*` used **42×** directly (`create/pin/reconcile/moveTo/destroy/get/has/sync`) — it hand-rolls the exact loop `Kit.Cards.board()` exists to own (`syncSkyjoCards`, `03-skyjo.js:88-97`).
- Does use `Kit.Cards.el` (card visuals ✅), `Kit.MiniBoard` ✅, `Kit.Status.set` ×9 ✅, `Kit.dealCascade` ✅, `Kit.cardColor` ✅.
- Does **not** use: `Kit.Cards.board/anchor/deal/move/toPile`, `Kit.Cards.deck/discard/grid`, `Kit.Controls`, `ctx.inspect`.

### Flip 7 — mixed ⚠️
- Uses high-level `Kit.Cards.anchor/board/deal/toPile` ✅, `Kit.Cards.el` ✅, `Kit.Controls.set/clear` ✅, `Kit.Status.set` ×8 ✅, `Kit.MiniBoard` ✅, `Kit.EventRunner.run` ✅ (`04-flip7.js:413`), `Kit.confetti` ✅, `Kit.turnBanner` ✅.
- Still hand-rolls: a FLIP-style layout reflow with `getBoundingClientRect` (`captureF7Layout`/`animateF7Layout`, lines 89-90) and a transient action-card fly `flyF7Card` (line 289). Drops to raw `Kit.CardManager` 11×.
- Does **not** use: `Kit.Cards.deck/discard/grid/hand`, `ctx.inspect`.

---

## Gap A — Skyjo should drive its grid through `Kit.Cards.board()` ⭐
**Files:** `public/js/03-skyjo.js:88-97` (`syncSkyjoCards`), `:222-226` (anchor build).

Skyjo already builds each grid cell as a framework `.kc` anchor with a `data-card-reg`:
```js
card.className='kc kc-zone-skyjo board-card registry-anchor';
card.dataset.cardReg = skyjoCardId(s,pi,ci);   // 03-skyjo.js:226  (raw createElement, NO data-kcSpec)
```
…but instead of one `Kit.Cards.board('skyjo:table:')` call it hand-walks the anchors and calls `create → get/renderer → pin → reconcile → sync` itself:
```js
function syncSkyjoCards(s){const active=[]; s.players.forEach((p,pi)=>p.board.forEach((c,ci)=>{
  const id=skyjoCardId(s,pi,ci), anchor=document.querySelector(`[data-card-reg="${id}"]`);
  if(anchor){active.push(id);
    if(!Kit.CardManager.has(id)) Kit.CardManager.create({...},{...},{id,renderer,faceUp:c.revealed});
    else { const card=Kit.CardManager.get(id); if(card) card.renderer=makeRenderer(); }
    Kit.CardManager.pin(id,anchor,{hideAnchor:false,updateContent:true});
}}));Kit.CardManager.reconcile('skyjo:table:',active);requestAnimationFrame(()=>Kit.CardManager.sync());}
```
This is **exactly** what `Kit.Cards.board(prefix,{location,faceUp})` does (it reads `[data-card-reg^=prefix]`, rebuilds the overlay from each anchor's embedded `data-kcSpec`, reconciles, syncs). Two Skyjo-specific needs:
- **per-card `faceUp`** — `board()` already takes a `faceUp(anchor)` callback (`CardBoard.sync`, line 9), so that's covered;
- **the card's value/renderer** — today Skyjo's raw anchors carry **no `data-kcSpec`**, which is why it must pass a custom `renderer`. To use `board()` cleanly, build the anchor with `Kit.Cards.anchor(id, skyjoSpec(c), {placeholder:true})` (embeds the spec → `board()`'s default renderer works and the placeholder shell avoids the duplicate-card issue we just fixed in Totten). Its custom reveal-flip styling would move into `skyjoSpec`/a `faceUp` toggle.

**Caveat / why it's Med-risk, not Low:** Skyjo deliberately keeps the anchor *visible & clickable* under the overlay (`hideAnchor:false`) because the grid cells are click targets and `makeRenderer()` flips face-up/down with custom reveal styling. So a migration must (a) switch the anchors to `Kit.Cards.anchor(... ,{placeholder:true})` (like the Totten fix from the last batch) and (b) pass `faceUp:(a)=>...` to `board()`. Doable, removes ~10 lines + the bespoke loop, and makes Skyjo's board reconcile identical to Schotten/Flip 7.

---

## Gap B — `ctx.inspect()` is dead; all three games hand-roll the inspect overlay ⭐
**Shell API:** `GameShell.ctx().inspect(html)` → sets `#investigateBox` + unhides `#investigateOverlay` (`00-core.js`).
**Reality:** every game pokes the DOM directly instead:
- `02-qwixx.js:277-279` — `$('investigateBox').innerHTML = ...; $('investigateOverlay').classList.remove('hidden')`
- `03-skyjo.js:341-344` — same
- `04-flip7.js:227-229` — same

So `ctx.inspect()` is **exported but unused** — the audit's "dead or migrate" call. Cheapest correct fix: route all three through `ctx.inspect(html)` (and add a matching `ctx.closeInspect()` so the ✕/Esc handler isn't a raw `$('investigateOverlay')` reach-in at `05-bots-init.js:145`). Net: one shared open/close path, three call sites simplified, no behavior change.

---

## Gap C — pile & zone widgets (`Kit.Cards.deck/discard/grid/hand`): investigated, intentionally NOT migrated ⚠️
**Files:** Skyjo piles are **static elements in `index.html`** (`#uiDeck`/`#uiDiscard`, mutated by `drawPiles`, `03-skyjo.js:140-153`); Flip 7's deck/discard are built as an **inline HTML template** with `f7-deck`/`f7-discard` classes (`04-flip7.js:193`); grids/rows use game-specific CSS (`.board-grid`, `.f7-row`).

**Finding (after digging in): this is the one gap that should be left as-is.** The reason the audit flagged it overstates the benefit:
- `Kit.Cards.deck()/discard()/grid()/hand()` are **thin factory functions** — they return a `<div>` with a base class and minimal CSS (`.kc-hand` = 1 rule, `.kc-grid` = 1 rule). They do **not** carry game styling.
- The gold-standard game (Schotten) proves the pattern: it calls `Kit.Cards.hand()/deck()` but then applies its **own** `st-hand`/`st-hand-card`/`st-deckrail` classes for the real styling.
- Skyjo & Flip 7 already have heavily-tuned, breakpoint-specific CSS for `.board-grid` / `.f7-row` / `.f7-deck` (e.g. `main.css:151,173,193,301,321,331,594`) plus a delicate clickability/overlay hand-off on the Skyjo discard pile. Replacing the containers with the generic helpers would force re-adding all that CSS to keep the identical look — **net churn + regression risk to the very pile/discard animations just fixed**, with zero functional or visual gain.

**Decision:** keep Skyjo's static piles and Flip 7's inline pile template. They are legitimately game-specialized DOM, not "un-unified" duplication. Forcing the helpers here would be de-unification by breaking working layouts. (If a *new* card game is added, it should still start from `Kit.Cards.deck/discard/grid/hand` + its own classes, like Schotten.)

---

## Gap D — Flip 7's `animateF7Layout` is a hand-rolled FLIP reflow (`getBoundingClientRect` ×3)
**File:** `04-flip7.js:89-90`. When a row reflows (a card added shifts siblings), Flip 7 measures before/after rects and manually translates each overlay. This is a legitimate "FLIP" animation the API does **not** currently offer a primitive for — so it's *justified* hand-rolling, but it's the one place a new shared helper (`Kit.CardBoard.reflow(prefix)`) would remove duplicated math if another game ever needs it. **Low priority** (only one consumer today).

## Gap E — `flyF7Card` transient (`04-flip7.js:289`) vs `Kit.CardManager.flyTransient`
Already a thin wrapper over `Kit.CardManager.flyTransient` — fine. Mentioned only for completeness; **no action needed.**

---

## Things that are ALREADY unified (so the older audit is partly stale)
- ✅ **All card visuals** go through `Kit.Cards.el` (Skyjo `skyjoVisual`, Flip 7 `cardEl`) — no game hand-writes card HTML anymore.
- ✅ **`Kit.EventRunner` is used** (Flip 7 `:413`) — not dead infra as `UNIFICATION_AUDIT.md` claimed.
- ✅ `GameShell.renderTable` — one call per render in all three.
- ✅ `Kit.Status` / `Kit.MiniBoard` — all three card games.
- ✅ `SeatModel` / `ctx.focus` / `GameActions.send` — all three.
- ✅ Intro deal cascade (`Kit.dealCascade`) now animates overlays (fixed last batch).

---

## Outcome
1. ✅ **Gap B (ctx.inspect)** — done (`acd6c6e`). One shared open/close path; 3 games + Esc handler migrated; smoke guard added.
2. ✅ **Gap A (Skyjo → Kit.Cards.board)** — done (`5896d87`). Bespoke sync loop deleted; Skyjo's grid reconciles identically to Schotten/Flip 7; 3 architecture tests updated; faces + draw/swap/triplet verified.
3. ⚪ **Gap C (pile/zone widgets)** — investigated and intentionally left (see Gap C). Forcing the generic factories onto the games' specialized static/inline piles would be churn + regression risk with no gain.
4. **Gap D** — left as the one justified hand-roll (no second consumer needs a `reflow` primitive yet).

**Net result of this pass:** every place a game was hand-rolling something the API *genuinely replaces* now uses the shared API. The remaining hand-rolled bits (Gap C piles, Gap D reflow) are legitimately game-specialized, not duplication.

# 🐛 GameHub — Visual & Functional Bug Report

> Audited against `main` branch (build v20-ci-smoke-pass) and live deployment
> at `https://gamehub.whoseyci.workers.dev/`

---

## 🔴 High Severity (Visible to Users, Clear Fixes)

### Bug 1: Fonts Never Load — Site Falls Back to System Fonts

**Where:** Every page, every screen
**File:** `public/index.html` + `public/styles/main.css`

The CSS declares `font-family:'Nunito',system-ui,...` (line 54) and
`font-family:'Fredoka',sans-serif` (line 18/255), but **no Google Fonts
`<link>` tag is in `index.html`**. Every browser silently falls back to the
system font stack. The site never renders in the intended typeface.

**Fix** — add inside `<head>` in `public/index.html`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&family=Fredoka:wght@700&display=swap" rel="stylesheet">
```

---

### Bug 2: No Favicon — Browser Shows Default Icon

**Where:** Browser tab on every page
**File:** `public/index.html`

No `<link rel="icon">` is declared. The live site returns the HTML page for
`/favicon.ico` (200 with `text/html`), so browsers display a generic globe or
blank icon instead of Game Hub branding.

**Fix** — add a favicon in `<head>`:
```html
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🃏</text></svg>">
```

---

### Bug 3: Mobile Menu Cards Clip Content — Bottom Buttons Inaccessible

**Where:** "Play Online", "Local Game", and other menu screens on mobile
**File:** `public/styles/main.css` line 307

```css
@media(max-width:760px){... .menu-card{max-height:96dvh;overflow:hidden;padding:16px}}
```

`overflow:hidden` clips the menu card with **no way to scroll**. On phones,
if you add multiple same-device players (each adds an input row), the
bottom buttons ("⚡ Quick Play", "Make a Room", "Join a Room") get pushed
below the fold and are invisible/tappable. Users are stuck with no way to
proceed.

**Fix:**
```css
@media(max-width:760px){
  .menu-card{max-height:96dvh;overflow-y:auto;padding:16px}
}
```

---

### Bug 4: Native `confirm()` Dialogs Break UI Polish

**Where:** In-game back arrow (←) button
**File:** `public/js/01-network-local.js` lines 88–90

```javascript
if(mode==='local'){ if(confirm('Leave the game?')){...} return; }
if(net.isHost){ if(confirm('Return everyone to the room lobby?'))... }
else { if(confirm('Leave the game?')) leaveOnline(); }
```

The entire app uses a beautiful dark theme with custom overlays, but the
leave-game confirmation uses the browser's native `confirm()` — a plain white
dialog that looks completely alien. On mobile, it even changes the page title
temporarily.

**Fix** — replace with the existing overlay system. Example:

```javascript
function leaveGameToRoom(){
  if(mode==='local'){
    showConfirmOverlay('Leave the game?', () => { resetGameUi(); showScreen('menuScreen'); });
    return;
  }
  if(net.isHost){
    showConfirmOverlay('Return everyone to the room lobby?', () => net.send({type:'to_room'}));
  } else {
    showConfirmOverlay('Leave the game?', () => leaveOnline());
  }
}

function showConfirmOverlay(msg, onYes) {
  const box = $('overlayBox');
  box.innerHTML = `
    <h2 style="margin:0 0 12px">Are you sure?</h2>
    <p style="font-weight:700">${msg}</p>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn secondary" onclick="hideOverlay()">Cancel</button>
      <button class="btn" onclick="hideOverlay();(${onYes.toString()})()">Yes</button>
    </div>`;
  $('overlay').classList.remove('hidden');
}
```

---

### Bug 5: Bot Difficulty Segment Visible When No Bots Exist (Local)

**Where:** Local Game setup screen
**File:** `public/index.html` (localBotDiff div)

The "😊 Easy / 🙂 Medium / 🤖 Hard" segment is always visible in the Local
Game screen, even when there are zero bots. This confuses users — they see
difficulty settings for something they haven't added.

**Fix** — hide the segment by default, show it when a bot is added:

In `public/index.html`, add `style="display:none"` to the segment:
```html
<div class="seg" id="localBotDiff" style="margin:6px 0;display:none">
```

In `public/js/01-network-local.js`, update `renderLocalSeats()`:
```javascript
const botDiff = $('localBotDiff');
if (botDiff) botDiff.style.display = localSeats.some(s => s.bot) ? '' : 'none';
```

---

## 🟠 Medium Severity (Visual Polish / Edge Cases)

### Bug 6: ~2KB Dead/Legacy CSS Bloat at Top of main.css

**Where:** `public/styles/main.css` lines 12–55

The top of the file contains the **old 3D cube Qwixx dice system**
(`.qwixx-scene`, `.qwixx-cube`, `.qwixx-cube__face--*`, `.qwixx-scene.can`,
etc.) that was replaced by the Kit dice system. These classes are never used
in any JavaScript module. They bloat the CSS (~2KB), slow first paint, and
confuse anyone reading the stylesheet.

Similarly, `.qwixx-scorecard{min-width:400px}` and the old `.qwixx-cell`
definitions at the top are immediately overridden by more specific rules later
in the file (which set `min-width:0; width:100%`).

**Fix** — Delete lines 12–55 (the entire first Qwixx block, ending before the
`:root` card-kit block).

---

### Bug 7: `overflow:hidden` on Rules Overlay Prevents Scrolling Long Rules

**Where:** Rules overlay (📖 How to Play)
**File:** `public/styles/main.css`

```css
.overlay-box{...max-height:90vh;overflow:auto}
```

The `.overlay-box` has `overflow:auto`, but the **Flip 7 rules** (6 steps +
tip) are long enough that on very small screens (iPhone SE), the "Got it"
button gets pushed below the viewport. The `max-height:90vh` clips it, and
while `overflow:auto` allows scrolling, the overlay box itself may not render
scrollbars on mobile Safari. Should be `overflow-y:scroll` or add
`-webkit-overflow-scrolling:touch`.

---

### Bug 8: Skyjo Local — `turn_end_delay` setTimeout Never Cancelled

**Where:** Local Skyjo play, between turns
**File:** `public/js/03-skyjo.js` (inside `LocalEngines['skyjo']`)

```javascript
if(E.turnAction==='turn_end_delay')
  setTimeout(()=>{E.completeTurnEnd();renderLocal();},1200);
```

This timeout is fire-and-forget. If the user navigates away (back to menu)
during the 1.2s delay, `completeTurnEnd()` fires on a stale engine and
`renderLocal()` runs with the game screen hidden. This can cause ghost DOM
elements (floating text, turn banners) to appear on the menu screen.

**Fix** — Track and cancel the timeout:
```javascript
let _skyjoTurnTimer = null;

// In apply():
if(E.turnAction==='turn_end_delay'){
  clearTimeout(_skyjoTurnTimer);
  _skyjoTurnTimer = setTimeout(()=>{E.completeTurnEnd();renderLocal();},1200);
}

// In resetGameUi():
clearTimeout(_skyjoTurnTimer);
```

---

### Bug 9: CardRegistry `sync()` Not Throttled on Scroll/Resize

**Where:** Any game in play
**File:** `public/js/00-core.js`

```javascript
window.addEventListener('resize',()=>CardRegistry.sync(),{passive:true});
window.addEventListener('scroll',()=>CardRegistry.sync(),{passive:true});
```

`CardRegistry.sync()` iterates all registered cards, calls
`getBoundingClientRect()` on each anchor, and updates fixed-position overlays.
On resize/scroll, this fires **every single animation frame** with no
debouncing. In an 8-player Skyjo game (96 cards registered), this causes
visible jank during scroll or orientation change.

**Fix** — Throttle with requestAnimationFrame:
```javascript
let _syncRaf = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(_syncRaf);
  _syncRaf = requestAnimationFrame(() => CardRegistry.sync());
}, {passive:true});
window.addEventListener('scroll', () => {
  cancelAnimationFrame(_syncRaf);
  _syncRaf = requestAnimationFrame(() => CardRegistry.sync());
}, {passive:true});
```

---

### Bug 10: Qwixx Local Play — Simultaneous White Phase Not Handled for Humans

**Where:** Local Qwixx with 2+ human players, WHITE_PHASE
**File:** `public/js/02-qwixx.js` (local engine `actor()`)

In Qwixx's WHITE_PHASE, all players simultaneously decide whether to take a
white-dice mark. But the local pass-and-play UI (`localDisplaySeat()`) only
shows one player's board at a time. Non-active human players **cannot make
their white-phase decision**. The game appears to hang because it's waiting
for a player who can't interact.

This is a fundamental UX issue for local Qwixx with 2+ humans.

**Suggested fix** — During WHITE_PHASE in local mode, cycle through each human
player who has a pending decision, showing a prompt like "Player 2: mark a
white combo or skip". This requires changes to `renderLocal()` to handle the
multi-player-simultaneous-turn case.

---

### Bug 11: Rules Overlay Missing Background-Click-to-Close

**Where:** Rules overlay (📖 How to Play)
**File:** `public/index.html`

The investigate overlay closes on background click:
```html
<div id="investigateOverlay" class="overlay hidden" onclick="this.classList.add('hidden')">
```

But the rules overlay does NOT:
```html
<div id="rulesOverlay" class="overlay hidden">
```

Users must find the "Got it" / "Close" button. Inconsistent with the other
overlay behavior and frustrating when you just want to dismiss quickly.

**Fix:**
```html
<div id="rulesOverlay" class="overlay hidden" onclick="this.classList.add('hidden')">
```

---

### Bug 12: Version Stamp Positioned Between Subtitle and Buttons

**Where:** Main menu screen
**File:** `public/index.html`

```html
<p class="muted" style="margin-bottom:26px">Play card games with friends.</p>
<div id="verStamp" style="margin-top:4px;..."></div>
<button class="btn purple" ...>Play Online</button>
```

The "build v20-ci-smoke-pass" text sits between the subtitle and the primary
CTA button. It creates a visual gap that makes the button feel disconnected
from the header. On mobile, the small gray text also looks like it might be
clickable.

**Fix** — Move the stamp below the buttons (before closing `</div>` of
`.menu-card`), or position it at the absolute bottom of the card:
```html
<!-- Move to after the last button -->
<button class="btn secondary" ...>📖 How to Play</button>
<div id="verStamp" style="margin-top:16px;font-size:.68rem;..."></div>
```

---

## 🟡 Low Severity (Minor Polish / Edge Cases)

### Bug 13: CSS `!important` Wars in Responsive Rules

**Where:** Multiple places in `public/styles/main.css`

Several scattered rules use `!important` to override each other:
- `.qwixx-player-board.compact{display:none!important}` (line 311)
- `.qwixx-mini-pens{display:flex!important}` (line 318)
- `.qwixx-row-score small{display:block!important}` (line 318)

These are fighting earlier responsive rules that hide/show the same elements.
The `!important` chain creates a fragile specificity hierarchy that breaks
when any new rule is added.

**Fix** — Restructure so responsive rules cascade naturally without
`!important`. Use more specific selectors or CSS layers instead.

---

### Bug 14: Skyjo Local — Deck Recycle Edge Case When Both Deck & Discard Empty

**Where:** Local Skyjo play, many players, late game
**File:** `public/js/03-skyjo.js` `drawDeck()`

```javascript
if(this.deck.length===0){
  this.deck=this.discard.slice(0,-1);
  this.discard=[this.discard[this.discard.length-1]];
  // shuffle...
}
```

If both `deck` and `discard` are empty (rare but possible with 7-8 players
and many revealed cards), the shuffle runs on an empty array and the game
soft-locks — the current player can't draw and nobody can proceed.

**Fix** — Add a guard:
```javascript
if(this.deck.length===0){
  this.deck=this.discard.slice(0,-1);
  this.discard=[this.discard[this.discard.length-1]];
  if(this.deck.length===0) return; // can't draw — skip turn or end round
  // shuffle...
}
```

---

### Bug 15: Flip 7 Controls Appended to `document.body`, Not `#app`

**Where:** In-game Flip 7 controls
**File:** `public/js/04-flip7.js`

```javascript
ctrl=document.createElement('div');
ctrl.id='f7Controls';
ctrl.className='f7-controls';
document.body.appendChild(ctrl);
```

The Hit/Stay buttons are appended to `document.body`, outside the `#app`
container. If `GameShell.unmount()` fails (e.g., a JS error in a game
client's `unmount()`), these controls can linger on screen after navigating
to a menu. They should be inside `#app` or cleaned up more defensively.

**Fix** — Append to `#app`:
```javascript
(document.getElementById('app') || document.body).appendChild(ctrl);
```

---

### Bug 16: Qwixx "Throw dice" Button Style Inconsistent with Design System

**Where:** Qwixx game, dice area
**File:** `public/styles/main.css`

All primary buttons use `.btn.green`, `.btn.purple`, or `.btn` classes. The
Qwixx "🎲 Throw dice" button uses a custom `.qwixx-throw-btn` with its own
gradient and shadow that doesn't match any other button in the app. It looks
like a different design language was used.

**Fix** — Use the standard button system:
```html
<button class="btn green" id="qwixxThrowBtn" style="margin:0">
  🎲 Throw dice
</button>
```
And remove the `.qwixx-throw-btn` CSS rule.

---

### Bug 17: No `<meta name="description">` or Open Graph Tags

**Where:** `public/index.html` `<head>`

The site has no SEO/social sharing metadata. When someone shares the URL in
Discord/Slack/Twitter, the preview shows no title, description, or image.

**Fix** — Add to `<head>`:
```html
<meta name="description" content="Play Skyjo, Flip 7, and Qwixx with friends — real-time multiplayer card games in your browser.">
<meta property="og:title" content="Game Hub — Play Card Games Online">
<meta property="og:description" content="Multiplayer Skyjo, Flip 7, and Qwixx. No install needed.">
<meta property="og:type" content="website">
```

---

## 📋 Summary

| # | Severity | Bug | Impact |
|---|----------|-----|--------|
| 1 | 🔴 High | Fonts never load | Site never looks as designed |
| 2 | 🔴 High | No favicon | Unprofessional browser tab |
| 3 | 🔴 High | Mobile menu clips content | Users can't reach buttons |
| 4 | 🔴 High | Native `confirm()` dialogs | Breaks UI polish, ugly on mobile |
| 5 | 🔴 High | Bot difficulty visible with 0 bots | Confusing UX |
| 6 | 🟠 Med | Dead legacy CSS (2KB) | Slower load, confusing code |
| 7 | 🟠 Med | Rules overlay may clip on small screens | Can't close rules |
| 8 | 🟠 Med | Skyjo timeout never cancelled | Ghost DOM elements |
| 9 | 🟠 Med | CardRegistry sync not throttled | Jank on scroll/resize |
| 10 | 🟠 Med | Qwixx local simultaneous turns broken | Local Qwixx hangs with 2+ humans |
| 11 | 🟠 Med | Rules overlay missing bg-click close | Inconsistent UX |
| 12 | 🟠 Med | Version stamp breaks button spacing | Visual oddity on home screen |
| 13 | 🟡 Low | CSS `!important` wars | Fragile maintainability |
| 14 | 🟡 Low | Skyjo deck+discard empty edge case | Game soft-lock (rare) |
| 15 | 🟡 Low | F7 controls outside `#app` | Potential stale DOM |
| 16 | 🟡 Low | Qwixx throw button style mismatch | Visual inconsistency |
| 17 | 🟡 Low | No meta/OG tags | Poor social sharing |

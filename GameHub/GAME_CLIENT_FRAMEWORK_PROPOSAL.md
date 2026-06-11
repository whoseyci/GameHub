# GameHub — The "Zero-Touch Game Client" Architecture

> **Goal:** Adding game #5 should require writing **only** the server-side rules
> (`GameModule`) and a thin declarative **layout description** (~50–80 lines).  
> Animations, seat rotation, mini boards, inspect popups, card flights, SFX,
> turn banners, summary overlay, bot scheduling — all handled by the framework
> automatically, from one place, with zero per-game copy-paste.

---

## The Problem: A Forensic Inventory

I audited every line of every game client and catalogued **exactly** what each
one hand-rolls today. Here is the full matrix:

| Concern | Skyjo | Flip 7 | Qwixx | Schotten | Template |
|---|---|---|---|---|---|
| **Card spec → visual** (`f7Spec`, `skyjoSpec`, `clanSpec`) | ✍️ custom | ✍️ custom | ✍️ custom (dots) | ✍️ custom | ❌ stub |
| **Card ID scheme** (`skyjo:table:rN:pP:cC`, `flip7:table:pP:key`) | ✍️ custom | ✍️ custom | N/A | ✍️ custom | ❌ |
| **Board sync** (`syncSkyjoCards`, `syncF7Cards`, `Kit.Cards.board`) | ✍️ custom | ✍️ custom | N/A | ✍️ 3-line | ❌ |
| **Mini board rendering** (card grid / dot grid per game) | ✍️ custom | ✍️ custom | ✍️ custom | N/A (2p) | ❌ |
| **Inspect popup** (prev/next navigation, static board) | ✍️ 20 lines | ✍️ 15 lines | ✍️ 10 lines | N/A | ❌ |
| **Turn change detection** (`prevView` diff) | ✍️ custom | ✍️ custom | ✍️ inline | ✍️ inline | ❌ |
| **Turn banner** (`Kit.turnBanner`) | ✍️ manual call | ✍️ manual call | ✍️ manual call | ❌ missing | ❌ |
| **Your-turn SFX** | ✍️ manual | ✍️ manual | ❌ missing | ❌ missing | ❌ |
| **Animation gate** (`animating` / `pendingView` / `flushView`) | ✍️ manual | ✍️ manual | ❌ none | ❌ none | ❌ |
| **Deal cascade** (intro animation) | ✍️ manual call | ✍️ manual call | N/A | ❌ | ❌ |
| **Swap/discard flight** (hand→board→discard) | ✍️ 80 lines | ✍️ 60 lines | N/A | ✍️ 15 lines | ❌ |
| **Triplet/column clear flight** | ✍️ 40 lines | N/A | N/A | N/A | ❌ |
| **Bust/Flip7/Stay VFX** | N/A | ✍️ 30 lines | N/A | N/A | ❌ |
| **Action card transfer flight** | N/A | ✍️ 50 lines | N/A | N/A | ❌ |
| **Event timeline player** (`playEvents` / `runUnifiedEvent`) | ❌ | ✍️ 200 lines | ❌ | ❌ | ❌ |
| **lastAction animation dispatch** (`runAnim`) | ✍️ 80 lines | ❌ (uses events) | ❌ (none) | ✍️ 40 lines | ❌ |
| **Summary overlay** (`showSummary`) | ✍️ called | ✍️ called | ✍️ called | ✍️ called | ✍️ stub |
| **Seat rotation** (pass-and-play) | ✍️ (hub-level) | ✍️ (hub-level) | ✍️ (hub-level) | ✍️ (hub-level) | ✍️ |
| **Controls** (Hit/Stay, End Turn, Skip) | ✍️ custom HTML | ✍️ custom HTML | ✍️ custom HTML | ✍️ Kit.Controls | ❌ |
| **SFX calls** | ✍️ 8 manual | ✍️ 10 manual | ✍️ 2 manual | ✍️ 2 manual | ❌ |
| **State diff for animation trigger** | ✍️ JSON.stringify hack | ✍️ seq comparison | ❌ none | ✍️ seq comparison | ❌ |
| **removeQwixxUi()** (game cleanup) | ✍️ called | ✍️ called | ✍️ defined | ✍️ N/A | ❌ |

**Total per-game hand-rolled client code:**
- Skyjo: ~367 lines
- Flip 7: ~590 lines (200 alone for event timeline)
- Qwixx: ~288 lines (zero animation, zero card flights)
- Schotten: ~270 lines

The median game client is **~350 lines of hand-rolled code**, of which roughly
**60–70% is repeated patterns** that should be owned by the framework. What
remains truly game-specific is surprisingly small.

---

## The Solution: A Declarative Game Client API

### Core Insight

Every game client does the same 6 things in the same order:

```
1. READ the view → extract game-specific state
2. FOCUS → decide which seat to show as "main" vs "mini"
3. RENDER MAIN board → cards/cells/hand in the focused player's area
4. RENDER OPPONENTS → mini boards with inspect popups
5. ANIMATE → fly cards, play SFX, show banners
6. CONTROLS → show action buttons, status text
```

Steps 2, 4, 5, and 6 are nearly identical across games. Steps 1 and 3 contain
the game-specific logic. The framework should own 2/4/5/6 completely and give
games a declarative API for 1 and 3.

### The `GameClientSpec`

A new file — `public/js/00-game-client-api.js` — loaded after `00-cards.js`,
that provides a single entry point:

```javascript
// A game defines a SPEC — the framework does everything else.
window.GameClientFramework = {

  /**
   * Register a game client declaratively.
   *
   * @param {string} gameId           - must match the server GameModule.meta.id
   * @param {object} spec
   *
   * spec = {
   *   // ── REQUIRED: what the game looks like ──────────────────────────
   *
   *   // Card → declarative spec (the ONLY per-game visual definition)
   *   cardSpec(card, context) → Kit.Cards spec object | null
   *     // context = { zone:'board'|'hand'|'discard'|'deck', seat, slot, viewerSeat, ... }
   *     // Return null for "no visual" (e.g. empty slot)
   *
   *   // Stable card ID from game state (for CardManager identity)
   *   cardId(card, context) → string
   *     // e.g. 'skyjo:table:r3:p1:c7' or 'flip7:table:p2:num-5'
   *
   *   // Where cards live in the view
   *   cards(viewerView) → Array<{ id, card, zone, seat, slot }>
   *     // Returns EVERY card that should be on screen right now.
   *     // The framework creates/destroys/reconciles CardManager entries.
   *
   *   // ── LAYOUT: how the main board is structured ────────────────────
   *
   *   layout: 'grid' | 'row' | 'hand-only' | 'custom',
   *     // 'grid'  → Skyjo-style 4×3 grid (cols inferred from card count)
   *     // 'row'   → Flip7-style horizontal tableau
   *     // 'hand-only' → Schotten-style (hand at bottom, board elsewhere)
   *     // 'custom' → game provides its own renderBoard(viewerView) → Element
   *
   *   gridCols: 4,   // only for layout:'grid'
   *
   *   // ── INTERACTION: what the player can click ──────────────────────
   *
   *   // Which cards/zones are clickable and what they do
   *   clickable(context) → { action:string, extra?:object } | null
   *     // context = { zone, seat, slot, card, viewerSeat, phase, turnAction, ... }
   *
   *   // ── ANIMATIONS: declarative mapping from lastAction → VFX ──────
   *
   *   animations: {
   *     // Map lastAction.type to a VFX recipe.
   *     // The framework runs these automatically when lastAction changes.
   *     // Recipes are composed from primitives the framework provides.
   *
   *     'swap': {
   *       fly: { from: 'held', to: { zone:'board', seat:'action.player', slot:'action.index' } },
   *       then: { fly: { from: { zone:'board', seat:'action.player', slot:'action.index' },
   *                       to: 'discard', spin: true } },
   *       sfx: 'swap',
   *       floatText: { at: 'action.player', text: expr('diff > 0 ? "+"+diff : diff'),
   *                     color: expr('diff > 0 ? "#10b981" : "#ef4444"') },
   *     },
   *
   *     'draw_deck': {
   *       fly: { from: 'deck', to: 'held', faceDown: true, revealMidway: true },
   *       sfx: 'draw',
   *     },
   *
   *     'reveal': {
   *       flip: { at: { zone:'board', seat:'action.player', slot:'action.card' } },
   *       sfx: 'reveal',
   *     },
   *   },
   *
   *   // ── OPTIONAL OVERRIDES ──────────────────────────────────────────
   *
   *   // Custom controls (action buttons). If omitted, framework auto-generates
   *   // from GameViewState.pendingAction.
   *   controls?(viewerView) → Array<{ label, kind, onClick }>,
   *
   *   // Custom status text. If omitted, framework generates from GameViewState.
   *   status?(viewerView) → string,
   *
   *   // Custom mini-board body. If omitted, framework renders card thumbnails.
   *   miniBody?(playerView) → Element | string,
   *
   *   // Custom inspect popup. If omitted, framework shows a static card grid.
   *   inspect?(seat) → void,
   *
   *   // Extra cleanup on unmount
   *   unmount?() → void,
   *
   *   // Game-specific HTML for the main board (only for layout:'custom')
   *   renderBoard?(viewerView) → Element,
   *
   *   // Game-specific center area (e.g. Qwixx dice zone)
   *   centerArea?(viewerView) → { html: string, onMount?(container) → void },
   * }
   */
  register(gameId, spec) { ... },
};
```

### What The Framework Automatically Handles

When `register()` is called, the framework installs a complete
`window.GameClients[gameId]` with `render`, `act`, `unmount`, and `inspect`
— all generated from the spec. Specifically:

| Feature | Today | With Framework |
|---|---|---|
| **Card identity / reconciliation** | Each game has its own ID scheme + sync loop | `cards()` returns a flat list; framework reconciles |
| **Mini boards** | Each game builds `Kit.MiniBoard({...})` with custom body | Framework calls `miniBody()` if provided, else renders card thumbnails automatically |
| **Inspect popup** | Each game writes 10–20 lines of prev/next navigation + static board | Framework auto-generates with seat cycling |
| **Turn banner** | Each game diffs `prevView` manually and calls `Kit.turnBanner` | Framework detects `currentSeat` change in `GameViewState` |
| **Your-turn SFX** | Some games call `SFX.yourTurn()`, some don't | Framework calls it automatically when turn changes to viewer |
| **Animation gate** | Skyjo/Flip7 manage `animating`/`pendingView`/`flushView` manually | Framework owns the gate; all animation recipes are awaitable chains |
| **Deal cascade** | Games call `Kit.dealCascade()` manually at the right moment | Framework detects first render / new round and cascades |
| **Summary overlay** | Each game calls `showSummary(view)` + manages `summaryShown` flag | Framework reads `view.over` / `view.summary` from `GameView` |
| **Seat rotation** | Already hub-level ✓ | No change |
| **Card flights** | 40–80 lines per game of `CardManager.moveTo` / `pin` / `destroy` | Declarative recipes: `{ fly: { from, to } }` |
| **Board cleanup** | Each game calls `removeQwixxUi()` and clears game-specific globals | Framework calls `unmount()` and clears all anchors with the game's prefix |

### The Animation Recipe Language

The biggest win. Today, card animation code is the #1 source of bugs and the
#1 reason adding a new game takes days. The recipe language turns imperative
async code into declarative data:

```javascript
animations: {
  'draw_deck': [
    // Step 1: fly a card from the deck to the held position
    { fly: { from: 'deck', to: 'held', startFaceDown: true, revealMidway: true },
      sfx: 'draw' },
  ],

  'swap': [
    // Step 1: fly held card to the board slot
    { fly: { from: 'held',
             to: { zone: 'board', seat: 'a.player', slot: 'a.index' } } },
    // Step 2: simultaneously fly the old board card to discard
    { fly: { from: { zone: 'board', seat: 'a.player', slot: 'a.index' },
             to: 'discard', spin: true, startFaceDown: '!a.wasRevealed',
             revealMidway: '!a.wasRevealed' },
      sfx: 'swap',
      floatText: { at: { seat: 'a.player' },
                    text: '(a.diff>0?"+":"")+a.diff',
                    color: 'a.diff>0?"#10b981":"#ef4444"' },
    },
    // Step 3: check for chained triplet
    { conditional: { if: 'a.triplet', then: 'triplet' } },
  ],

  'triplet': [
    // Multi-card gather + fly to discard
    { gather: { seats: ['a.player'], slots: 'a.indices', to: 'discard' },
      sfx: 'triplet',
      floatText: { at: { seat: 'a.player' }, text: '"Triplet!"', color: '"#eab308"' } },
  ],

  'reveal': [
    { flip: { at: { zone: 'board', seat: 'a.player', slot: 'a.card' } },
      sfx: 'reveal' },
  ],

  'take_discard': [
    { fly: { from: 'discard', to: 'held' },
      sfx: 'draw' },
  ],

  'discard_drawn': [
    { fly: { from: 'held', to: 'discard', spin: true },
      sfx: 'discard' },
  ],

  'reveal_after_discard': [
    { flip: { at: { zone: 'board', seat: 'a.player', slot: 'a.index' } },
      sfx: 'reveal' },
  ],
}
```

The recipe runner:
1. Detects that `lastAction` changed (by comparing `seq` or deep-diffing).
2. Looks up `animations[lastAction.type]`.
3. Executes steps sequentially; each step is one of:
   - `fly` — `Kit.Cards.move` or `CardManager.moveTo`
   - `flip` — in-place Y-axis flip (the existing `revealSkyjoRegistryCard` pattern)
   - `gather` — multi-card collect + fly (triplets)
   - `sfx` — `SFX[name]()`
   - `floatText` — `Kit.floatText` at a board element
   - `banner` — `Kit.turnBanner`
   - `vfx` — custom DOM effect (screen shake, freeze aura, confetti)
   - `conditional` — branch to another recipe
   - `sleep` — `await sleep(ms)`
4. Sets `animating = true` during execution, queuing pending views.

**Expression strings** like `'a.player'` or `'a.diff > 0 ? "#10b981" : "#ef4444"'`
are evaluated against the current `lastAction` object (`a`). This is safe because
the recipe is author-defined static data — it's not user input.

### How This Eliminates Per-Game Bugs

| Bug Category | Root Cause | Framework Fix |
|---|---|---|
| **Card overlay behind board** | Game forgets to call `sync()` after rebuild | Framework calls `sync()` after every render + animation step |
| **Stale card overlays** | Game doesn't call `reconcile()` | Framework reconciles from `cards()` return value every render |
| **Pointy-edge flights** | Game uses wrong source element (wide container) | Framework always uses `Kit.Cards.snapshot()` rects |
| **Missing deal cascade** | Game forgets `Kit.dealCascade()` | Framework detects first render / new round automatically |
| **Double animation** | Game doesn't gate on `animating` / `lastAction.seq` | Framework owns the gate centrally |
| **Broken inspect after card changes** | Game's `investigate()` uses stale state | Framework's auto-inspect reads from current `_renderView` |
| **Seat rotation breaks cards** | `syncOverlaysFor` not called | Framework calls it inside the rotation handler |
| **Missing SFX** | Game author forgot to call `SFX.draw()` | Recipe specifies `sfx: 'draw'` — it always plays |
| **Summary doesn't show** | Game forgets `summaryShown` flag management | Framework reads `view.over` + `view.summary` |
| **Wrong mini-board state** | Game renders mini with wrong `viewerSeat` | Framework always passes correct `viewerSeat` |

---

## The Event-Timeline Protocol (Flip 7 Pattern)

Flip 7 introduced an event-sequence model (`state.events`) that's dramatically
better for complex, multi-step animations. The framework should support this
as a first-class option:

```javascript
spec = {
  // Instead of lastAction-based recipes, games can emit an ordered event list.
  // The framework replays them one-by-one with dramatic pacing.
  useEventTimeline: true,

  // Map event.type → recipe (same recipe language as above)
  eventAnimations: {
    'card.deal':  [{ fly: { from: 'deck', to: { zone: 'board', seat: 'e.actor', slot: 'auto' } },
                    sfx: 'flip' }],
    'effect.bust': [{ vfx: 'shake', sfx: 'bad', banner: { text: 'e.actor+" BUST!"', mine: false } }],
    'card.transfer': [{ fly: { from: { zone: 'board', seat: 'e.actor' }, to: { zone: 'board', seat: 'e.target' }, spin: true },
                         sfx: 'triplet' }],
    // ...
  },

  // Pacing between events
  eventPacing: { base: 420, min: 150, max: 1700 },
};
```

When `useEventTimeline: true`, the framework:
1. Detects new events by comparing `state.seq` / `state.events.length`.
2. Replays each event through `eventAnimations[event.type]`.
3. Waits for each animation to finish + the pacing delay.
4. Queues views that arrive during playback.

---

## The Mini-Board Auto-Renderer

Today, every game renders its own mini-board body (card thumbnails for Skyjo,
ordered tableau for Flip 7, dot grids for Qwixx). The framework can do this
automatically for card games:

```javascript
// If the spec does NOT provide miniBody(), the framework generates one:
function autoMiniBody(gameId, playerView, viewerSeat) {
  const spec = registeredSpecs[gameId];
  const cards = spec.cards(playerView);  // all cards for this player
  const grid = document.createElement('div');
  grid.className = 'kc-mini-grid';
  cards.forEach(c => {
    if (c.zone !== 'board') return;
    const cardSpec = spec.cardSpec(c.card, { ...c, viewerSeat });
    if (cardSpec) grid.appendChild(Kit.Cards.el(cardSpec));
  });
  return grid;
}
```

Games that need custom mini bodies (Qwixx's dot grid) override `miniBody()`.
Everyone else gets a working mini board for free.

---

## The Auto-Inspect Popup

The inspect (board popup) pattern is identical across games:

1. Get the list of non-viewer seats.
2. Build a header with ‹ prev / player name / › next / ✕ close.
3. Render a **static** board for the inspected seat (no CardManager overlays).
4. Wire navigation buttons.

The framework generates this automatically:

```javascript
// Auto-generated inspect — works for any card game
function autoInspect(gameId, seat) {
  const view = window._renderView;
  const s = view[gameId];
  const viewerSeat = view.yourSeat;
  const others = s.players.map((_, i) => i).filter(i => i !== viewerSeat);
  const idx = others.indexOf(seat);
  const prev = others[(idx - 1 + others.length) % others.length];
  const next = others[(idx + 1) % others.length];

  const box = GameShell.inspect(
    `<div class="inspect-head">
      <button class="icon-btn" onclick="window.GameClients['${gameId}'].inspect(${prev})">‹</button>
      <b>${esc(s.players[seat]?.name)}</b>
      <button class="icon-btn" onclick="window.GameClients['${gameId}'].inspect(${next})">›</button>
      <button class="icon-btn" onclick="GameShell.closeInspect()">✕</button>
    </div>`
  );

  // Static board: render cardSpec thumbnails inline (no CardManager)
  const body = autoStaticBoard(gameId, view, seat);
  box.appendChild(body);
}
```

---

## What A New Game Looks Like

Here's what adding a hypothetical "Hearts" game would look like with this
framework:

```javascript
// public/js/games/hearts.js — the ENTIRE client
(function(){
  GameClientFramework.register('hearts', {
    // Card appearance
    cardSpec(card, ctx) {
      const suit = { h:'♥', d:'♦', c:'♣', s:'♠' };
      const red = card.suit === 'h' || card.suit === 'd';
      return {
        bg: '#fff',
        border: '#333',
        content: { text: suit[card.suit] + card.rank, color: red ? '#dc2626' : '#1a1a1a' },
        state: ctx.selected ? 'selected' : ctx.playable ? 'selectable' : undefined,
      };
    },

    cardId(card, ctx) { return `hearts:${card.id}`; },

    cards(view) {
      const s = view.hearts;
      const out = [];
      // My hand
      s.myHand.forEach((c, i) => out.push({ id: `hearts:${c.id}`, card: c, zone: 'hand', seat: view.yourSeat, slot: i }));
      // Tricks on the table
      s.trick.forEach((entry, i) => out.push({ id: `hearts:trick:${i}`, card: entry.card, zone: 'board', seat: entry.seat, slot: i }));
      return out;
    },

    layout: 'hand-only',   // hand at bottom, custom board area for tricks
    gridCols: 0,

    renderBoard(view) {
      const s = view.hearts;
      const trick = document.createElement('div');
      trick.className = 'hearts-trick';
      // 4 positions around a virtual table
      s.trick.forEach(entry => {
        const anchor = Kit.Cards.anchor(`hearts:trick:${entry.seat}`,
          { bg: '#fff', content: { text: entry.card.rank + {h:'♥',d:'♦',c:'♣',s:'♠'}[entry.card.suit] } });
        anchor.classList.add('hearts-trick-pos', 'seat-' + entry.seat);
        trick.appendChild(anchor);
      });
      return trick;
    },

    clickable(ctx) {
      if (ctx.zone !== 'hand') return null;
      if (!ctx.playable) return null;
      return { action: 'play', cardIndex: ctx.slot };
    },

    animations: {
      'play': [
        { fly: { from: { zone: 'hand', seat: 'a.player', slot: 'a.cardIndex' },
                 to: { zone: 'board', seat: 'a.player', slot: 'a.seat' } },
          sfx: 'flip' },
      ],
      'take_trick': [
        { gather: { seats: 'a.winners', to: 'discard' },
          sfx: 'good' },
      ],
    },

    // Mini board: just show card count + score
    miniBody(player) {
      return `${player.handCount} cards · ${player.score} pts`;
    },

    status(view) {
      const s = view.hearts;
      if (view.over) return 'Game Over';
      if (s.currentSeat === view.yourSeat) return 'Your turn — play a card';
      return `${s.players[s.currentSeat]?.name}'s turn`;
    },

    controls(view) {
      // Hearts has no extra controls beyond card selection
      return [];
    },
  });
})();
```

**That's ~60 lines** for a fully functional Hearts client with animated card
play, auto mini boards, auto inspect, auto summary, auto turn banners, and
auto SFX. No manual `Kit.CardManager` calls, no manual `animating` gate, no
manual `prevView` diff, no manual `flushView`, no manual `summaryShown`.

Compare to the current minimum of ~350 lines per game.

---

## Implementation Plan

### Phase 1: The Framework Core (1 week)

1. **`00-game-client-api.js`** — the `GameClientFramework.register()` function
   that builds `GameClients[id]` from a spec.
2. **`cards()` reconciliation** — the framework calls `cards()`, diffs against
   previous state, and creates/destroys CardManager entries.
3. **Auto-render loop** — `render(view, ctx)` implementation that calls the
   spec's layout, cards, clickable, etc.
4. **Animation recipe runner** — parses recipe objects and executes them via
   `Kit.CardManager` / `SFX` / `Kit.floatText`.
5. **Auto-summary / auto-banner / auto-SFX** — driven from `GameViewState`.

### Phase 2: Migrate One Game (3–5 days)

1. Migrate **Schotten Totten** (simplest client, 270 lines, all card-based).
2. Verify every animation still works identically.
3. Iterate on the framework API until Schotten's spec is < 80 lines.

### Phase 3: Migrate Remaining Games (1 week)

1. Skyjo — exercise the `lastAction` recipe system with complex flights
   (triplets, swap chains).
2. Flip 7 — exercise the event-timeline system.
3. Qwixx — exercise custom `centerArea()` and custom `miniBody()`.

### Phase 4: Update Scaffold (1 day)

Update `scripts/scaffold-game.mjs` to generate a `GameClientFramework.register()`
skeleton instead of the current 120-line hand-rolled template.

### Phase 5: Legacy Compatibility

Existing `window.GameClients[id]` entries that were hand-rolled continue to work
unchanged — the framework only takes over when `register()` is called. Games can
migrate one at a time. **Zero breaking changes.**

---

## What Stays Per-Game

Not everything can or should be automated. These remain the game author's job:

| Concern | Why It's Per-Game |
|---|---|
| **`cardSpec(card)`** — what a card looks like | Colors, borders, content are game-specific visual identity |
| **`cards(view)`** — what's on the table | Each game has different card locations (hand, board, trick, stone…) |
| **`clickable(ctx)`** — interaction rules | "Can I click this card?" depends on game phase, turn state, etc. |
| **Animation recipes** — which VFX play when | Each game has unique actions (swap vs play vs claim) |
| **Server-side `GameModule`** — rules engine | Always per-game; unchanged by this proposal |
| **Bot strategy** — AI decision logic | Always per-game |

But even these are **dramatically simpler** because the game author never touches
`CardManager`, `sync()`, `reconcile()`, `animating`, `flushView`, `prevView`,
`summaryShown`, `Kit.MiniBoard`, `inspect()`, `turnBanner`, or SFX timing.

---

## Summary: Before vs After

| Metric | Before (today) | After (with framework) |
|---|---|---|
| Lines per game client | ~350 | ~60–80 |
| Manual CardManager calls | 15–30 per game | 0 |
| Animation bugs per new game | 5–10 (inevitable) | ~0 (recipes are data) |
| Missing SFX/turn banner | Common | Impossible (auto-generated) |
| Inspect popup code | 10–20 lines per game | 0 (auto-generated) |
| Mini board code | 15–30 lines per game | 0 (auto-generated) or custom override |
| Time to add a new game | 2–3 days | 4–6 hours |
| Risk of breaking existing games | Per-game manual testing | Framework test suite covers all |

---

## Prototype Implementation

A working prototype of the framework core is in:

```
public/js/00-game-client-api.js   ← the framework (~380 lines)
```

This file is loaded after `00-cards.js` and provides `GameClientFramework.register()`.
Legacy hand-rolled clients (`02-qwixx.js`, `03-skyjo.js`, `04-flip7.js`,
`games/schotten.js`) continue to work unchanged — the framework only activates
when `register()` is called. **Zero breaking changes.**

To migrate a game, you would:
1. Create a spec object from the patterns above (~60–80 lines).
2. Call `GameClientFramework.register('skyjo', spec)` instead of the current IIFE.
3. Delete the old client file.
4. Verify animations match (the recipe language covers all current patterns).

The prototype handles:
- ✅ Card reconciliation from `cards()` return value
- ✅ Auto mini-board rendering (with `miniBody()` override for custom layouts)
- ✅ Auto inspect popup with prev/next seat navigation
- ✅ Turn change detection → banner + SFX
- ✅ Summary overlay auto-trigger
- ✅ Animation recipe runner (fly / flip / gather / sfx / floatText / banner / vfx / conditional / sleep)
- ✅ Event-timeline player (for Flip 7-style games)
- ✅ Animation gating (`animating` / `flushView`)
- ✅ Click handler wiring from `clickable()`
- ✅ Grid and custom board layout modes
- ✅ Per-game cleanup on unmount

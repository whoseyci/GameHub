# Kit.Cards — the unified card + board framework

**Goal:** one card design across the whole hub, one animation path, zero room for
visual bugs or design drift. Games declare card *intent*; the framework owns every
pixel and every flight.

---

## 1. The card spec (front)

A card is built ONLY via `Kit.Cards.el(spec)` (or `Kit.Cards.anchor(id, spec)` to
mount one on the board). The spec is **strict — tokens only, no raw classes and no
HTML injection** — but very design-expressive:

```js
Kit.Cards.el({
  size: 'md' | 'sm' | 'xs' | 'mini',     // default md
  faceDown: false,                        // → the ONE shared card back
  bg:     '#1e293b'                        // background fill, OR
        | { gradient: ['#f87171','#dc2626'], angle: 160 }   // smooth blend, OR
        | { multicolor: ['#f00','#0f0','#00f'], angle: 135 }, // hard-stop stripes
  border: '#fca5a5' | {gradient:[...]} | {multicolor:[...]},
  borderWidth: 'thin' | 'normal' | 'thick',
  emblem: '★',                            // faint centred watermark glyph (text)
  content: {                              // TEXT ONLY (rendered as text, never HTML)
    text: 7, font: 'Georgia', size: 24 | '1.4rem',
    rotation: -8, align: 'center'|'tl'|'tr'|'bl'|'br',
    color: '#fff' | {gradient:[...]} | {multicolor:[...]},
    weight: 700, italic: true, shadow: false,
  },
  pips: [7, 7],                           // optional corner pips
  state: 'cleared'|'dim'|'shake'|'highlight'|'selectable'|'selected' | [..],
  zone: 'skyjo',                          // structural sizing tag → .kc-zone-<id>
  data: { cardReg: '…' },                 // data-* (click wiring / board sync)
});
```

`bg` / `border` / `content.color` accept **solid `#hex`, gradient, or multicolor**.
Geometry (corner radius, aspect ratio, shadow, sheen) and the card **back** are
fixed by the framework — games cannot change them, which is what keeps the look
uniform.

**Strictness is enforced, not just documented.** `el()` ignores any `classes:` or
`html:` keys (they do nothing); a card's visuals come ONLY from the tokens above and
its **state** comes ONLY from the enumerated `state` tokens. A game's per-card
styling and sizing happens through `state` (visual states) and `zone` (a structural
sizing tag whose CSS may only set `--kc-w`). The lockdown test fails CI if any card
spec carries a raw `classes:`/`html:` key or sets card geometry directly.

## 2. Geometry is water-tight

One CSS class `.kc` defines the canonical card: a single `--kc-radius`, a locked
`--kc-aspect` (width-driven via `--kc-w`, height follows), shadow, sheen, and the
shared `.kc-back`. The corners are pinned with `!important` on **both** the idle
overlay and the **flying** overlay:

```css
.kit-card-registered.kc, .kit-card-moving.kc { border-radius: var(--kc-radius)!important; overflow:hidden!important }
```

So a card can never render as a pointy rectangle mid-flight. Size in a context
(focus / mini / opponent board) is set by overriding `--kc-w` — never width/height —
so every size keeps the same proportions and nothing fights the default.

## 3. Board zones & wiring

Reusable primitives, all auto-wired to the CardManager:

```js
Kit.Cards.hand()              // a hand row
Kit.Cards.grid(cols)          // a card grid
Kit.Cards.deck({id,count,onClick})       // a draw pile
Kit.Cards.discard({id,count})            // a discard pile
Kit.Cards.drop(targetEl,{onClick})       // a drop target
Kit.Cards.board(prefix, {location})      // register/pin/reconcile EVERY anchor at once
```

`board()` rebuilds each overlay from the anchor's embedded spec — so what's on
screen always matches the declared spec.

## 4. Movement (one path, no bugs)

```js
Kit.Cards.snapshot(prefix)               // capture rects BEFORE a DOM rebuild (FLIP)
Kit.Cards.deal(id, deckEl, toAnchor)     // deck → slot, face-down + mid-flip reveal
Kit.Cards.move(id, fromRect, toAnchor)   // slot → slot (card-sized source: no ballooning)
Kit.Cards.toPile(id, pileEl)             // card → deck/discard
```

All flights run through `Kit.CardManager` and always stage a **card-sized** source,
so a card never balloons to a container's width.

## 5. Other shared presets

- `Kit.Controls.set([{label,onClick,kind,disabled}], {id})` / `Kit.Controls.clear(id)`
  — one floating control bar; no game hand-rolls its own anymore.

## 6. Lockdown (so it stays water-tight)

`tests/card-lockdown.test.ts` fails CI if a game: renders cards without
`Kit.Cards`, sets raw card geometry inline, or `innerHTML`s a card element. The
geometry/back/corner-lock invariants are asserted (teeth-verified).

## 7. Why CSS cards, not SVG (Skyjo included)

We deliberately render cards as themed `.kc` **divs**, not SVG:

- The CSS model is already resolution-independent *enough* (content scales with the
  card via `--kc-w`; text is crisp on HiDPI). Cards never zoom far enough for vector
  to matter.
- The declarative spec (gradients, multicolor, rotation, centering) is trivial in
  CSS and awkward in SVG — keeping it CSS keeps the spec expressive and consistent.
- Interaction states (hover lift, selected outline, drop pulse, blended sheen) are
  native CSS.
- SVG `viewBox`/`preserveAspectRatio` interacts badly with the CardManager's
  `transform:scale` flights — it would re-open the very scaling edge cases we closed.

**Every card game is now on the framework.** Schotten, Flip 7 and Skyjo all build
cards via `Kit.Cards` (Skyjo's old inline-SVG card visual was replaced by a
declarative `.kc` spec — white face, value-coloured number). Qwixx has no cards.
The lockdown test (below) covers all three game clients, so none can drift back to
bespoke cards.

## Adding a game

`node scripts/scaffold-game.mjs --id=x --name="X" --emoji=🎲 --min=2 --max=2`
emits a client using `Kit.Cards` by default. Declare your card specs, lay out zones
with the primitives, and call `Kit.Cards.board(PREFIX, …)` — flights, geometry,
back, and cleanup come for free.

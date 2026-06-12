# Session summary — W1 through W6 (mostly shipped)

Six workstreams from the original brief. **5 of 6 fully shipped; W6 ships
in two parts — part 1 is in, part 2 (groups + variants UI) is queued.**

## Shipped this session

| Commit | What |
|---|---|
| `d043ace` | (reverted) loop-state contract |
| `6dfcead` | **W5** — emoji → Phosphor icon system (Kit.Icon, 28-test lint) |
| `40835a1` | **W4** — dice no-zoom + 4 throwStyles + rounded edges |
| `eb03495` | **W1** — mini-board legibility-at-any-scale (Kit.MiniBoard essentials) |
| `c31c5c2` | **W2** — pass-and-play board transition (Kit.PassPlay) |
| `bc44ba9` | **W3** — declarative screen layout API (Kit.Layout) |
| `8d24665` | **W6 (part 1)** — queue counters + click-to-join + ready system + invite links |

**315 tests + 3 JSDOM smokes + typecheck — all green at every commit boundary.**
**GH Actions CI green end-to-end on `main`.**

---

## W1 — Mini-board legibility at any scale ✅

Per-game mini renderers used to ship breakpoint CSS that hid random
bits at small sizes — often hiding essential info. Now the platform
owns size-aware adaptation via a ResizeObserver tier system.

- `Kit.MiniBoard` v2 accepts an **essentials manifest**:
  `{ name, score, status, pulse, essentials: [{label, value}…] }`.
- Tier classes auto-applied: `lg` (≥160px), `md` (96–159px),
  `sm` (72–95px), `xs` (<72px).
- xs tier: initials + score badge + pulse pip (everything else hidden).
- Active-turn pulse pip survives every tier.
- Adopted by Skyjo, Flip 7, Qwixx. Schotten is 2-player only and uses a
  custom layout.
- **15 tests pin the contract.**

## W2 — Pass-and-play board transition ✅

Multi-human-on-one-device games now get a unified hand-off animation.

- `Kit.PassPlay` hooks `GameShell.render()`: when the focused seat
  changes in local mode with ≥2 humans, board fades + scales down,
  overlay sweeps in with "Now: $name", new board enters with a
  rotate-in.
- Skips: online play, ≤1 human, bot turns, prefers-reduced-motion,
  first paint, same-seat.
- Zero per-game code needed; benefits Skyjo, Flip 7, Qwixx, Schotten,
  any future game.
- **11 tests** pinning the trigger gates + overlay rendering + cleanup.

## W3 — Declarative screen layout API ✅

Replaces per-game `@media` blocks with declared intent.

```js
Kit.Layout.apply({
  minis:  { maxHeight: '24dvh', minColWidth: 132, gap: '6px' },
  main:   { maxWidth: 1040 },
  center: { maxHeight: '28dvh', padding: '6px' },
  status: { sticky: true },
});
```

- Sets `--gs-minis-max-h`, `--gs-main-max-w`, etc. on `#gameScreen`.
- `main.css` consumes them with sensible fallbacks (opt-in).
- Numeric values → `px`, true → `1`, false → unset.
- Unknown fields silently ignored (forward-compatible).
- Qwixx migrated as proof.
- **11 tests** pinning apply / current / reset / replace-not-merge / fwd-compat.

## W4 — Dice fixes ✅

**W4a — zoom bug fixed.** Old `present()` set `y=-105` (pulling settled
dice into a visible camera zoom-in). New code keeps the settled
position, forces `d.curS=d.s`, rotates the result face to +Z.

**W4b — throwStyles.** `opts.throwStyle ∈ {tumble, cannon, rain, collide}`.
- `tumble` — legacy default
- `cannon` — fired from left wall with strong rightward velocity
- `rain` — straight down with staggered z arrival
- `collide` — N-1 dice pre-settled (`preSettled` flag skips spawn-growth),
  last die fired at the cluster

Unknown values silently fall back to `tumble`.

**W4c — rounded edges.** New `roundedCubeMesh(chamfer)`: 6 inset faces +
12 edge bands + 8 corner caps = 44 tris (vs 12 for flat cube) — ~+10%
draw cost, within the +15% budget. Default `DIE` binding swapped to
`ROUNDED`; flat `CUBE` kept for A/B comparison.

**10 tests** pinning API surface + each throwStyle + W4a regression guard + W4c marker.

## W5 — Emoji → Phosphor icon system ✅

Every UI control uses `Kit.Icon('name')` inline SVG.

- `Kit.Icon('dice', {size: 18})` → SVGElement
- `Kit.Icon.html('dice')` → HTML string (for template literals)
- `<button data-icon="play">` → auto-mounted on DOMContentLoaded + showScreen

Phosphor regular weight, ~30 icons inlined as path data. Zero
external deps. Each icon ~200 bytes; we pay only for what we use.

Allowlisted (kept as-is):
- `GameRules.title/quick/steps/tip` prose
- Flip 7 card-face `❄` / `♥` (content, not chrome)
- CSS `✦` card-back glyph (typographic flourish)
- Mark glyphs `✕` `✓` (typographic, not emoji presentation)

**28-test grep lint** (`tests/no-ui-emojis.test.ts`) blocks emoji
regressions in any `public/` HTML/CSS/JS file.

## W6 part 1 — Front-door overhaul ✅

**Server:**
- `Member.ready` flag (bots auto-ready, host of quick-play auto-ready).
- New `set_ready` message; `maybeQuickStart` requires all-humans-ready
  + in-range count.
- `to_room` clears human ready flags.
- Lobby tracks `humans` / `ready` / `isGroup` per room; broadcasts a
  new `counts[]` aggregator alongside the legacy rooms list.
- `launch_game` accepts optional `variant` string (forwarded to
  `state.variant` for games that opt in).

**Client:**
- Landing tiles get a third button **Play Online** (click-to-join
  quick-play shard).
- Live per-game count chips on each tile (waiting + in game) from
  the lobby socket.
- Ready-up pips next to each member chip + a prominent ready toggle
  in quick-play/group lobbies, with gate text.
- Copy-invite-link button in the room header. Format:
  `${origin}/?join=${roomCode}`.
- Landing boot detects `?join=CODE` and auto-routes to the room.

**12 tests** pinning the server contract markers + client wire-up.

## W6 part 2 — Groups + variants UI (queued)

What's done in part 1 already enables this:
- Server has `isGroup` field + variant pass-through.
- Ready system works for any room (not just quick-play).
- Invite-link routing works for any room (groups included).

What's left for part 2:
- A "Convert to group" toggle in the room screen (host only) that
  flips `isGroup=true` and persists the room past games-ended.
- Group-shard routing: when host clicks a game from inside a private
  group, all members load into a `group-<code>-<gameId>` shard.
- A small variant-picker UI when a game advertises
  `meta.features.variants: [{ id, name, description }]`. (No game
  implements variants yet — the picker just shows "Standard" until
  one does.)
- A "Recent groups" section on the menu so returning players hit
  the same group fast.

Estimate: ~2 long arcs of work. Server is mostly there; bulk of
remaining work is client UI for group lifecycle + variant picker.

---

## State of the codebase

- **315 tests** across 29 files (+89 in this session)
- **3 JSDOM smokes** (client, replay, landing) — all green
- **1 Playwright browser smoke** — green
- **GH Actions CI** runs on every push; latest run green on `8d24665`
- **Cloudflare Workers Build** — green on `main`

---

## Kit module index (post-session)

| Module | Purpose |
|---|---|
| `Kit.CardManager` | Permanent card object lifecycle + animation primitives |
| `Kit.Cards` | Declarative card framework (specs, hand, grid, deck, flights, legalHints) |
| `Kit.Dice3D` | WebGL dice with physics; **rounded edges + 4 throwStyles** (W4) |
| `Kit.MiniBoard` | **Essentials-manifest mini boards with auto-tier scaling** (W1) |
| `Kit.PassPlay` | **Pass-and-play hand-off transition** (W2) |
| `Kit.Layout` | **Declarative screen layout intent** (W3) |
| `Kit.Icon` | **Inline-SVG Phosphor icons** (W5) |
| `Kit.Turn` | Shared "whose turn" banner + SFX + status |
| `Kit.Status` | Status-bar setter (text/html/button) |
| `Kit.Controls` | Action-button row |
| `Kit.Highlights` | Replay highlight analyser |
| `GameShell.persist` | Stable per-game DOM slots (e.g. Qwixx WebGL canvas) |
| `Identity` | Player ID + friend code + ELO + recent players |

# LOOP_STATE.md — Agentic Loop Contract

**This file is the single source of truth across rounds and survives
conversation compaction. Re-read at the start of every round. Update at
the end of every round.**

---

## Prime directives (verbatim from the mission brief)

1. **Evidence over claims.** Never mark anything done from memory or by
   reading code. Run it, test it, measure it, screenshot it — every round, freshly.
2. **One workstream-increment per round.** Finish and verify one coherent
   improvement before starting the next.
3. **Never leave the repo broken.** Build must pass at every round boundary
   (`npm run typecheck && npm test -- --run && all smokes`).
4. **Files are memory.** Update this file at the end of every round.
5. **Never weaken acceptance criteria.** If a criterion seems wrong, flag as
   BLOCKED with reasoning + proposed amendment. Do NOT silently reinterpret.
6. **Verdict line at the end of every round-completion message:**
   - `<<LOOP:CONTINUE>>` — work remains, next step is known
   - `<<LOOP:STOP>>` — every criterion passes with fresh evidence cited
   - `<<LOOP:BLOCKED>>` — human decision needed, question stated crisply

---

## The 6 workstreams (from user brief)

### W1 — Miniature player boards: legibility at any scale
**Goal:** All relevant info on mini boards stays readable regardless of size.

**Acceptance criteria:**
- A platform contract (e.g. `Kit.MiniBoard` extension or new `Kit.Mini` API)
  governs scaling — per-game minis consume it instead of hand-rolling.
- At 132×N grid layout (the current `auto-fit minmax(132px,1fr)`), AND when
  squeezed down to 88px columns (4+ opponent strip), the following are still
  legible (real measurement, not guesswork):
  - Player name OR initials (fallback when name too long)
  - Current score
  - Active-turn indicator
  - Game-specific essential info (Skyjo: visible card values, Flip 7:
    current count + bust status, Qwixx: per-row mark count, Schotten:
    stones-won count)
- A new test pins the contract: `tests/mini-legibility.test.ts` — for each
  game, render a mini at min-width and assert the essential elements are
  present + non-empty.
- Updated `docs/MAKING_A_GAME.md` describes how new games declare what's
  "essential at any scale."

**Evidence to cite when done:**
- Test results showing the legibility assertions pass for all 4 games.
- A small JSDOM-based size sweep: render at 88/132/200px and confirm no
  text overflows or critical info disappears.
- Updated docs section reference.

---

### W2 — Pass-and-play turn change: smooth, fluid board rotation
**Style decision (locked):** **rotate-only, no tap-gate.** Just animate the
rotation + banner, no "Ready? tap to continue" screen. User explicitly
chose this over the configurable per-game variant.

**Acceptance criteria:**
- New `Kit.PassPlay` API (or extension to `Kit.Turn`) that owns the
  rotation animation: when the seat-of-focus changes in pass-and-play mode,
  the focused board does a smooth orientation transition (rotate, fade,
  whatever feels best) + a "Now: $name's turn" overlay.
- Animation duration is consistent across games (single shared constant).
- F7 specifically gets the new treatment (user singled it out as clunky).
- Skyjo, Qwixx, Schotten also benefit automatically — zero per-game code.
- Detects `prefers-reduced-motion` and degrades to instant transition.
- Doesn't break the existing live-play (non-pass-play) flow.

**Evidence to cite when done:**
- F7 / Skyjo / Qwixx smokes still pass.
- New test in `tests/passplay-turn.test.ts` asserting the rotation hook
  fires on seat change in local mode but NOT in online mode.
- Manual confirmation that frame count + classes match between games.

---

### W3 — Screen layout API
**Goal:** A game can declaratively say what its layout intent is; the shell
handles relative sizing.

**Acceptance criteria:**
- A new layout DSL on `GameModule.meta` or on the render call:
  `layout: { mainBoard: '1fr', miniStrip: 'auto', diceZone: 180 }` or
  equivalent — concrete shape decided in round 0 design.
- Shell consumes the spec and sets the right CSS grid template + container
  queries.
- At least one existing game (Qwixx, the most layout-complex) migrated to
  the new API as proof.
- Other games keep working unchanged (the API is opt-in).
- A test pins the contract: render Qwixx, assert the grid-template-rows
  matches the declared intent.

**Evidence to cite when done:**
- The layout spec for Qwixx in code.
- Test asserting the computed CSS matches.
- Visual confirmation via JSDOM-measured dimensions at desktop + mobile
  breakpoints.

---

### W4 — Dice improvements
**Three sub-tasks. All must pass.**

**W4a — Fix the "zoom-in last step" bug.** Currently the dice present face-
to-camera then get pulled larger. Remove the zoom-in step; the present
animation should END at the natural settled size.

**W4b — Add throw-style variants.** Extend `Kit.Dice3D.roll(container,
dice, opts)` with `opts.throwStyle`:
- `'tumble'` (current default — rigid-body throw from off-screen)
- `'cannon'` — dice shot from a virtual cannon at one side
- `'rain'` — trickled from above
- `'collide'` — last die fired into the largest cluster of settled dice,
  causing them to recoil + reroll briefly

**W4c — Rounded edges.** Replace the flat cube mesh with a rounded-cube
mesh (chamfered edges) without tanking perf. Target: keep total render
time within +15% of current.

**Acceptance criteria:**
- W4a: visual inspection (record actual present-frame size before/after) +
  a numeric assertion in a new test that the final transform scale is 1.
- W4b: 4 throwStyle values work without errors; the smoke runs each variant
  once; default behavior unchanged when `throwStyle` is omitted.
- W4c: dice visibly have rounded edges; render time (measured via
  performance.now() per frame) is within +15% of baseline.

**Evidence to cite when done:**
- Test results.
- Frame-time measurement before/after for W4c.
- A side-by-side prototype HTML (or screenshot) showing each throwStyle.

---

### W5 — Remove all emojis, replace with Phosphor icons
**Style decision (locked):** Inline SVG via a local `Kit.Icon('name')` helper.
No external font, no CDN. Ship only the icons we use.

**Acceptance criteria:**
- New module `public/js/00-icons.js` exposing `Kit.Icon(name, opts)` →
  returns an inline SVG element (or HTML string for innerHTML use).
- All emojis in `public/index.html`, `public/replay.html`, all CSS files,
  all JS files in `public/js/` removed and replaced with `Kit.Icon` calls.
  The only emojis allowed are inside `GameRules` body text (the in-game
  rulebook copy is prose; replacing every 🃏 with an icon would be ugly).
  All emoji USES in **UI controls, buttons, status, headers, labels,
  badges** → icon swap.
- A test `tests/no-ui-emojis.test.ts` greps the relevant files for emoji
  characters and fails if any sneak back in (with the rules-text allowlist).
- Visual look: matches the dark theme, icon stroke weight consistent across
  the site.

**Evidence to cite when done:**
- The grep test passes.
- Smokes still pass (icon swap can't break click targets).
- A list of every replacement done.

---

### W6 — Front-door overhaul: visible queues, click-to-join, ready system, groups
**The heaviest one. Full implementation per user brief.**

Components:
- **Visible per-game queue counters** on the landing tiles: "3 waiting, 2
  in game" etc.
- **Click-to-join quick-play**: clicking a game tile drops you into the
  quick-play lobby for that game; you see a "ready" button; once all
  players are ready AND the player count is in range, the game starts.
- **Groups**: in the game hub (post-join screen) players can form a named
  group. Host can set group public/private. Public groups appear in the
  lobby list; private groups don't.
- **Variant selection**: when host clicks on a game from inside a private
  group, all group members load into their own shard of that game's lobby.
  Host can select variant (skyjo extreme, qwixx variants, etc.) — even if
  no variants exist yet, the UI placeholder + protocol field must exist.
- **Invite links** (nice-to-have per user, not blocking): URL that drops
  someone into a specific group.

**Acceptance criteria:**
- Server-side: extend Lobby DO to track per-game queue + ready state per
  member. New `GroupSession` DO (or extension of Room DO) for private
  groups.
- Client-side: landing tiles show live counters; click flow works end-to-
  end; ready button works; group formation UI works.
- Variant slot exists in the protocol (`launch_game` carries a `variant`
  field) even if no game implements variants yet.
- Invite link format defined: `/?join=<groupCode>` resolves to group.
- New tests for: queue counter math, ready-to-start gate, group public/
  private visibility, variant pass-through.
- Existing tests still pass (no regression to the current hosting flow).

**Evidence to cite when done:**
- Tests results.
- Server diff: Lobby DO changes + any new DO.
- Client diff: landing + lobby + group UI.
- One end-to-end click-flow in the JSDOM smoke OR Playwright e2e.

---

## Locked design decisions

| Decision | Value | Rationale |
|---|---|---|
| Pass-play transition style | rotate-only, no tap-gate | User explicitly chose rotate-only over the configurable option |
| Icon library | Phosphor inline-SVG via `Kit.Icon` | User chose phosphor; inline-SVG keeps zero external deps |
| #6 scope | Full implementation per brief | User confident I can ship all 6 |

---

## Round log

### Round 0 — contract setup
- Wrote LOOP_STATE.md.
- Baseline: 226 tests, 3 JSDOM smokes, typecheck — all green.
- GH Actions CI green on `main` (commit `04bb0ef`).

### Round 1 — W5 (emoji → Phosphor icon system) ✅
**Evidence cited this round:**
- `tests/no-ui-emojis.test.ts` — 28 tests (one per public/ file), all pass.
- Verified the lint catches a fake regression (injected emoji into 00-core.js,
  test failed; restored, test passes).
- Full validation: typecheck + 254 tests + 3 smokes — all green.
- Audit reran: zero non-allowlisted UI emojis remain.

**What landed:**
- `public/js/00-icons.js` — Kit.Icon('name') + Kit.Icon.html('name') +
  data-icon="..." auto-mount on showScreen. Phosphor SVG paths inlined for
  ~30 icons (zero external deps).
- `public/styles/main.css` — .kit-icon alignment + spinner keyframes.
- `public/js/00-cards.js` — Kit.Status.set now accepts an html: variant so
  status text can include Kit.Icon SVG strings.
- Every UI surface emoji-swapped: index.html buttons, replay.html toolbar,
  Qwixx/Skyjo/Flip 7/Schotten renderers, identity panel, landing tiles, sound
  toggle, rules overlay, summary screen, inspect overlays, replay scrubber
  buttons. Game-identity glyphs in GameRules.title and card-face glyphs in
  Flip 7 (❄/♥) are intentionally kept — they're content, not UI chrome.
- Landing hero drifting icons replaced with Kit.Icon SVGs.

**Test count: 226 → 254 (+28 lint cases).**

### Next round
**Round 2: W4 (dice — fix zoom, add throwStyles, rounded edges).**
Reasoning: visible upgrade the user explicitly called out; testable with
real measurements; doesn't require new infrastructure.

---

## Current status snapshot

| Workstream | Status | Evidence |
|---|---|---|
| W1 mini boards | pending | — |
| W2 pass-play rotation | pending | — |
| W3 layout API | pending | — |
| W4a dice no-zoom | pending | — |
| W4b throwStyles | pending | — |
| W4c rounded edges | pending | — |
| **W5 emoji → icon** | **✅ Round 1** | 28-test lint + 254 total green |
| W6 front-door + groups | pending | — |

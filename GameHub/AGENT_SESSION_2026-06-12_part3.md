# Agent session — 2026-06-12 (part 3: finish the migration)

Continuation of part 2. The honest-audit answer to "is everything
running through the API?" turned out to be "mostly built, partially
migrated." This pass closes that gap.

## What landed

| Commit  | Phase                                                    | Tests |
| ------- | -------------------------------------------------------- | ----- |
| 2471610 | Qwixx dice fix (WebGL canvas persists across renders)    | +4 (222) |
| 48ea2bd | Migrate Skyjo, Flip 7, Qwixx renderers to legalHints     | —     |
| 64ed621 | Renderer-purity lint + live-play invariants in CI smoke  | +4 (226) |

**226 tests + 3 smokes + typecheck — all green at every step.**

## The Qwixx dice bug (root cause + fix)

Symptom: real WebGL 3D dice rolled correctly, then a fraction of a
second later "weird 2D dice" appeared.

Root cause: every Qwixx state update (mark, opponent action, focus
change) called `GameShell.renderTable` which wiped `topArea`'s
`game-shell-center` and rebuilt it from the `center` HTML string.
That HTML contained `<div id="qwixxDiceKit">`, which means the dice
tray was being torn out + recreated empty on every render. The
post-render reattach logic then ran `Kit.Dice3D.showStatic()` — the
CSS-3D fallback faces, intended only for the no-WebGL path — which
is what you saw.

Fix: new platform primitive `GameShell.persist(key, factory)`. A
persisted node is created once and re-mounted into matching
`[data-persist-slot]` placeholders across every `renderTable` call.
The WebGL canvas inside the persisted dice tray survives state ticks
untouched. Cleared automatically when the game unmounts.

Pinned by `tests/persist-slot.test.ts` (4 tests including a
"canvas survives 5 mount cycles" check).

While I was in there, polished Qwixx feel:
- Throw button **pulses** when it's YOUR turn to throw (respects
  prefers-reduced-motion)
- Empty dice tray gets a dashed placeholder so the affordance reads
- Header restructured: "Your throw" vs "Waiting for X to throw"
  instead of generic "New throw"
- Round badge moves right; header reads left-to-right as a sentence
- Legacy `.qwixx-die` CSS removed (the leftover misled my initial
  hunt for the actual cause)

## The full API migration

### Before: 1 of 4 renderers consumed legalHints
- Schotten: full migration ✓
- Skyjo, Flip 7, Qwixx: still encoded "can I tap this?" inline

### After: 4 of 4 renderers consume server-emitted legality
- **Skyjo** — `drawPiles` reads `hints.has('draw_deck' | 'take_discard'
  | 'discard_drawn')`; `canClick` defers to `view.state.legal` for the
  viewer's seat and to `module.legalActions(s, pi)` for pass-and-play
  on another local seat; `cardClick` picks the matching legal action
  by `(action, index)` instead of re-deriving from `turnAction`.
- **Flip 7** — Hit/Stay buttons only emit when those verbs appear in
  legal; targeting affordance (`canTarget`) reads from legal. New
  helper `f7LegalFor(view, seat)` picks the right source.
- **Qwixx** — `actionLegalForCell` is a one-liner over
  `view.state.legal`. The `recommendedMove` AI hint is INTENTIONALLY
  kept on the client — that's display compute, not a rule check, and
  it consumes `possibleWhiteMarks`/`possibleColorMarks` for the
  suggestion-quality calculus.

### CI now blocks future regressions

**`tests/renderer-purity.test.ts`** — grep lint that fires on patterns
like `onclick=... s.phase === 'PLAY'` or `canX = ... && s.currentPlayer
=== seat`. A new renderer that re-encodes a rule fails CI. Escape
hatch: `// [renderer-purity-ok: reason]` on the line. I verified the
lint catches a fake violation when injected.

**`scripts/smoke-client.mjs`** — `assertAnimationInvariants(window,
label)` after each per-game smoke. The same API-10 guard that already
runs in the replay smoke now also runs in the live-play path. Any new
game leaking cards (orphan overlays, zone collisions, detached
overlays) fails CI here — not just in replay.

## The honest "is everything through the API now?" answer

| Concern | Answer |
|---|---|
| Server emits legality hints for all 4 games | ✅ yes |
| All 4 renderers consume those hints for their affordances | ✅ yes |
| Both online AND offline (LocalEngine) attach `legal[]` | ✅ yes |
| Re-encoding rules in a renderer is a CI failure | ✅ yes (renderer-purity lint) |
| Turn UI is shared (no per-game blocks) | ✅ yes (Kit.Turn) |
| Animation glitches in replay are a CI failure | ✅ yes (smoke-replay invariants) |
| Animation glitches in live-play are a CI failure | ✅ yes (smoke-client invariants) |
| The WebGL dice canvas survives state updates | ✅ yes (GameShell.persist) |
| Future games can scaffold + ship in ~300 LOC end-to-end | ✅ yes (docs/MAKING_A_GAME.md) |

The one Flip 7 line that still references `view.flip7.current` and
`prevView.flip7.current` (line 628) is an **empty if-block** I left as
a marker — it's the comment site explaining that Kit.Turn now owns
the banner. Deleting it is cosmetic, not behavioural.

## What remains genuinely client-side (and why that's correct)

- **`recommendedMove` AI hint in Qwixx** — picks the best move from
  possible ones to show as a 💡 suggestion. That's display compute,
  not a rule check.
- **`canMarkIndex` / `possibleWhiteMarks` / `possibleColorMarks` in
  Qwixx** — feed the recommendation calculus above. Kept for the same
  reason.
- **Display strings** — "Your turn", "Waiting for Alice", etc. are
  UI judgement calls, never gated on legality.

## Test coverage growth this session

| Session | Tests | Smokes |
|---|---|---|
| Start of day | 161 | 1 |
| After part 1 (replay+identity+landing) | 177 | 3 |
| After part 2 (DX overhaul + unlocks) | 218 | 3 |
| After part 3 (this) | **226** | 3 (live-play smoke now also checks invariants) |

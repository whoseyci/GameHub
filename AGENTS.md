# AGENTS.md — GameHub

Guidance for AI coding agents (and humans) working in this repo. It adapts the
[agent-skills](https://github.com/addyosmani/agent-skills) engineering playbooks
to **this** project's stack and conventions. Read this before making changes.

> **Where things live:** the deployable app is in **`GameHub/`** (this folder).
> The deployed Cloudflare Worker is named **`skyjo-pro`** for back-compat even
> though the product is a multi-game hub. Don't rename the Worker without also
> updating `wrangler.jsonc` + the dashboard.

---

## 0. The non-negotiable gate

**Every change must pass the local validation gate before it's considered done:**

```bash
npm run validate        # typecheck + client-games build check + client JS check + vitest + wrangler dry-run
# or the CI-equivalent (adds the smoke + browser passes):
npm run validate:ci
```

If you touch browser code, also run the relevant smoke:

```bash
npm run check:client      # syntax-checks every public/js/*.js module
npm run smoke:client      # jsdom UI / bot-cleanup smoke
npm run smoke:browser     # Playwright over the real app shell (needs: npx playwright install chromium)
```

CI runs `validate:ci` + `browser-smoke` on every push/PR. A red gate blocks merge.

---

## 1. Architecture you must respect

```
public/index.html          The entire client shell (one file). Loads ordered <script>s.
public/js/00-*.js          Shared "Card Kit" + core (Kit, SFX, network, identity, layout…)
public/js/0N-<game>.js     Per-game client renderers (02-qwixx, 03-skyjo, 04-flip7…)
public/js/games/<id>.js    Newer per-game clients (e.g. schotten)
public/js/00-game-modules.js  AUTO-GENERATED — never hand-edit (see §5)
public/styles/main.css     Shared visuals + the in-game responsive layout system
src/server.ts              Worker entry: Room + Lobby Durable Objects + fetch router
src/games/types.ts         The GameModule contract every game implements
src/games/<id>/            meta.ts / server.ts / engine.ts / index.ts per game
src/games/registry.ts      Central additive game registry
src/protocol.ts            Runtime validation of untrusted WebSocket payloads
```

**The hub is intentionally game-agnostic.** It only calls the `GameModule`
interface (`create / applyAction / viewFor / isOver` + optional
`tick / migrate / legalActions / addPlayer / joinScore`). Keep it that way:

- **Game state is plain JSON** — no class instances, functions, or `Date`s.
  It's persisted to Durable Object storage on every change.
- **`viewFor()` hides other players' secrets** — deal a personalized snapshot.
- **Game-specific data lives under a namespaced key** (`view.skyjo`,
  `view.qwixx`, …) so the hub's shared fields (`phase`, `over`, `yourSeat`,
  `summary`, `state`) never clash.
- **Randomness goes through `src/rng.ts`** with the numeric `rngState` stored in
  state — this keeps replays + bot sims deterministic (the
  `replay-determinism` test enforces it).
- Adding a game = add files + two registry lines. Existing games must stay
  untouched and unbreakable. See `ADDING_A_GAME.md`.

---

## 2. Frontend / UI engineering (this project's flavor)

- **Reuse the Card Kit.** Build card UI from `window.Kit` (`Kit.Cards`,
  `Kit.MiniBoard`, `Kit.flyCard`, `Kit.dealCascade`, `Kit.confetti`,
  `Kit.Dice3D`, `Kit.turnBanner`, …) and `SFX` so every game looks/feels
  identical. Don't invent a new card visual — theme the **front** of the
  canonical `.kc` card via the declarative spec; you cannot change its shape.
- **The in-game layout is pure CSS Flexbox**, not a JS solver (the old
  `Kit.Layout.fit` solver was removed — don't reintroduce one). The
  `#gameScreen.active` flex column distributes height; `#mainBoardsContainer`
  is the single **grower that may also shrink** (`flex:1 1 auto; min-height:0`).
- **Emotes are animated EMOTION CHARACTERS (`public/js/00-emotes.js`,
  `Kit.Emotes`)** — a cast of distinct characters (happy, furious, smug, cool,
  shocked, sad, cry, think, love, nervous, party, laugh) that express the FEELING
  via face + signature CSS animation, NO emoji attached. `Kit.Emotes.svg(id)`
  renders one; the wire `react` message's `emoji` field now carries an emotion id.
  **Contextual auto-emotes:** `Kit.Emotes.fromEvent(game, ev)` maps a game event
  → a mood; the `dispatchView` hook (01-network-local.js) fires them for NEW
  events (dedup by seq) so dramatic moments react automatically (Flip 7 bust →
  furious, Flip 7 bonus → party, Qwixx lock → party, Skyjo low-card discard →
  smug…). NOTE games NORMALIZE events (Flip 7 emits `type:"effect.bust",
  actor:<seat>, legacy:"bust"`), so `fromEvent` matches on `legacy` and strips the
  `effect.`/`card.` prefix — don't break that or auto-emotes go silent.
- **Social layer (`public/js/00-social.js`, `window.Social`)** — online-only room
  **chat** + animated **reaction emojis**. Rides the existing WebSocket: the
  server (`src/server.ts`) parses `chat`/`react` (see `parseClientMessage` in
  `src/protocol.ts`), attributes the author from the connection's controlled
  pids, and `broadcast()`s; a small in-memory `chatLog` ring buffer (≤80) is sent
  to (re)joiners in `hello`. Client: `Social.handleNet(m)` is called first in
  `handleNet` (01-network-local.js) and returns `true` if it consumed the message;
  `Social.setActive(online)` shows/hides the topbar `#chatBtn`/`#reactBtn`
  (disabled in pass-and-play — one device). Reactions float via the
  `#reactionFxLayer` CSS. This is cheap on the free tier (messages over an open
  socket aren't per-request; CPU is trivial) — see `docs/FEATURE_FEASIBILITY.md`.
  Note: reaction emojis are intentionally exempt from the no-UI-emoji guard
  (`tests/no-ui-emojis.test.ts`) because they ARE the feature's payload.
- **Action controls never overlap boards.** The floating bottom control bar
  (`Kit.Controls`, `public/js/00-cards.js`) is `position:fixed` + high z-index AND
  reserves its own height + the status pill's as a bottom safe-zone on
  `#gameScreen` (`--gs-bottom-reserve`), applied as `#mainBoardsContainer`'s
  `padding-bottom`. So Kit.Fit's available area stops ABOVE the buttons and a
  board can never grow under them. Don't render game action buttons inside a
  board — route them through `Kit.Controls`.
- **Kit.Fit must measure the container's CONTENT box** — read `clientWidth/Height`
  and SUBTRACT the computed padding (clientHeight INCLUDES padding). Using the
  border box (getBoundingClientRect) or raw clientHeight ignores the reserved
  safe-zone and the board grows under the controls / clips at the top.
- **The focus board re-renders on EVERY state change** (incl. an opponent's/bot's
  move) because the whole table is rebuilt to update opponent boards + dice. So
  the fit must NOT visibly change when your own board's data is unchanged:
  `renderTable` applies `Kit.Fit` **synchronously** right after `setHTML` (never in
  a later rAF — that painted the board full-size for one frame = the "twitch"),
  the first apply for a freshly-mounted board is **instant** (no transition), and
  Kit.Fit's content `MutationObserver` **ignores its own style/transform writes**
  so it can't re-measure itself into a flicker loop. The smooth transition only
  applies to genuine ResizeObserver-driven resizes. If you ever see a board
  twitch on an opponent move again, check these three things first.
- **Schema-defined games (the visual-creator foundation).** A game can be pure
  DATA: `src/games/schema/specs/*.ts` is a `GameSpec`, `makeSchemaGame(spec)`
  (`src/games/schema/engine.ts`) interprets it into a normal `GameModule`, and the
  generic client `public/js/games/schema-game.js` renders ANY schema game from its
  `viewFor` payload (no per-game client). Sample: **Septet** (`septet`). Rules:
  schema games reuse SHARED verbs (`hit`/`stay`/`next_round`) so the bot driver +
  self-play harness understand them for free; private view data is namespaced
  under `view[meta.id]`; cards go through `Kit.Cards.el`; the engine is tagged
  `meta.__schema=true` so the catalogue + generic client/ parity tests detect it.
  NEVER run untrusted code — a spec only selects among audited, bounded
  behaviours. See `docs/GAME_SCHEMA.md`. Next: more spec `kind`s, then the visual
  editor that emits a `GameSpec`, then a human-reviewed community submission queue.
- **Adaptive board sizing is automatic via `Kit.Fit`** (`public/js/00-kit-fit.js`).
  `GameShell.renderTable` auto-fits the focus board to fill its container — it
  **grows into void space and shrinks to avoid overflow**, content-aware, for
  EVERY game, regardless of internal layout (grid/flex/SVG/canvas). It measures
  the board's natural (intrinsic, `max-content`) size and applies a clamped
  `transform: scale()` = `min(widthFit, heightFit)`, re-fitting on container
  resize (ResizeObserver) + content change (MutationObserver). Opt out with
  `renderTable({fit:false})` or tune with `fit:{min,max,axis,align,padding,grow}`.
  Don't hand-roll per-game size breakpoints for the focus board — let Kit.Fit do
  it. (Opponent strips / top-area widgets aren't fit-managed; size those with CSS
  or a `--reel-size`-style knob.)
- **Rolling (dice/symbols) goes through a swappable roller API.** Two renderers
  share one contract — `roll(container, [{color,value}], opts) -> Promise`,
  `showStatic`, `supported`:
  - `Kit.Roller` — cartoony **2D slot machine** (`public/js/00-roller.js`): pull
    the lever → reels spin with **per-reel RNG profiles** (each wheel gets its
    own randomized duration + deceleration flavour: `snap` = sudden stop,
    `glide` = slow roll-on, `normal`) → each reel **bounces individually** as it
    locks → cabinet settle-bounce. JS rAF-driven (not CSS), so the motion varies
    every spin. Pure DOM/CSS otherwise (no WebGL). Customizable in 3 dimensions:
    reel **count** (`reels.length`), reel **colour** (`reels[i].color`), reel
    **symbols** (`reels[i].symbol`/`.icon`, or `opts.symbols` for the strip). Use
    `Kit.Roller.spin(container, {reels, lever, autoPull, onPull, onLock})`.
  - `Kit.Dice3D` — WebGL physics dice (steered settle; see below).
  A game picks a renderer via a single `const ROLLER = ...` (see Qwixx) — both are
  drop-in, so swapping is one line. **Per-game customization (define on the roll
  opts):** `marquee` (themed crown text), `jackpot(reels)->bool` (when sparkles +
  cabinet glow fire — each game owns its win rule, e.g. Qwixx = "roller can close
  a row") + `jackpotColor`, and `needed(reel)->bool` (a per-reel playful flash
  when a wheel lands on a value the player can use).
  **Reveal timing (hardened):** `onPull` fires at spin START, `onLock` fires only
  after the reels VISUALLY settle (spin END). When a game gates marking
  options/bots on "results are official", do it in **`onLock`** (and the `roll()`
  Promise, which also resolves at settle) — never `onPull` — so options don't
  appear mid-animation.
- **Pass-and-play focus is per-game via `localFocusSeat(state, humanSeats)`** on
  the game client. The device should stay on the **active player until they fully
  finish their turn**, then pass to the next local human — don't let focus
  ping-pong on every sub-decision (Qwixx's white phase is simultaneous, so its
  `localFocusSeat` holds the roller, then rotates through other local
  pending-white humans, then returns to the roller for the colour phase).
  Online/bot seats resolve simultaneously without stealing local focus.
- **Card sizing is height-aware.** Card widths are
  `min(widthClamp, --card-h-cap)` so they rescale on short viewports instead of
  being clipped. If you add a board with a different row count, tune
  `--card-h-cap` (via a `@media (max-height)` rule or `Kit.Layout.apply`) rather
  than hardcoding pixel sizes. **Verify in Chromium at 1280×720, 1024×600, and
  390×844 — short/wide viewports are where clipping bugs hide.**
- **Accessibility & input:** keyboard-reachable controls, visible focus, ARIA
  labels on icon-only buttons, ≥44px tap targets on mobile, and honor
  `prefers-reduced-motion` (the codebase already does — keep it).
- **No "AI aesthetic."** Match the existing dark/neon design system, spacing,
  and motion curves (`var(--spring)` family). No generic blue-purple gradients.
- **No emojis in UI chrome** — use `Kit.Icon` (Phosphor). The `no-ui-emojis`
  test enforces this; emojis remain only as data/fallbacks in `meta`.

---

## 3. Test-driven development (the Prove-It pattern)

- **Reproduce bugs with a failing test first**, then fix. "Seems right" is not
  done — a test is the proof. Put new tests in `tests/`.
- For game logic, cover: invalid actions don't mutate state; `viewFor(state,-1)`
  works for spectators; hidden info is absent from opponent/spectator views;
  state + views stay JSON-serializable after every action; scoring/end-summary
  edge cases.
- Layout/CSS behaviors are guarded by string-matching tests
  (`tests/in-game-layout.test.ts`, `tests/layout.test.ts`). If you intentionally
  change layout behavior, **update the test to assert the new correct behavior**
  — don't delete the guard.
- Run `npm test -- --run` (or `npx vitest run <file>`) and keep the suite green.

---

## 4. Debugging: stop-the-line, root-cause, verify in the browser

When something breaks: **stop adding features, preserve the evidence, find the
root cause, fix it, then guard against recurrence.** Don't guess.

- **Verify UI/layout/interaction changes in a real browser BEFORE deploying —
  this is mandatory, not optional** (user directive). Use Playwright (already a
  devDependency) to drive the real app (`window.setLocalSeats` +
  `window.startLocalForGame`), measure, AND **capture + visually inspect
  screenshots** at desktop (e.g. 1280×800, 1440×900) and mobile (e.g. 390×844)
  sizes. Numeric checks alone are NOT enough: a `transform:scale()`d board that
  overflows its container gets **clipped without any document scroll**, so
  `scrollHeight - clientHeight` reads 0 while the board is visibly cut off — the
  Flip7/Skyjo clipping bugs were invisible to the metric and only caught by
  eyeballing the screenshot. To check a fit board really fits, compare the
  CONTENT's `getBoundingClientRect()` against its container's rect (left/right/
  top/bottom within bounds), not document scroll.
- **Per sprint, cycle through the WHOLE app** (every menu, every button/modal,
  all four games) on mobile AND desktop and confirm each looks + works right.
- Watch for **CSS cascade-order traps**: equal-specificity rules where a later
  one silently wins (this caused real bugs here — Skyjo cards ignoring
  `--bcard-w`). When a value "should" apply but doesn't, dump the *computed*
  value in the browser to find the overriding rule.
- Beware **specificity asymmetry**: `#gameScreen .x` (id+class) beats `.x`
  (class). Several layout budgets were overridden this way.

---

## 5. The generated client bundle (don't trip on it)

`public/js/00-game-modules.js` is **auto-generated** by
`scripts/build-client-games.mjs` from `src/client-games.ts` + the shared
`src/games/*` rules engine (this is how the *same* rules power offline/local play
and bots without duplication).

- **Never hand-edit it.** Change the TS source, then:
  ```bash
  npm run build:client-games     # regenerate
  npm run check:client-games     # verify the committed bundle is up to date (CI checks this)
  ```
- Commit the regenerated bundle together with the source change.

---

## 6. Incremental delivery & git workflow

- Build in **thin vertical slices**: implement → test → verify → commit. Don't
  write hundreds of lines before running anything.
- **Conventional, scoped commits** with a body explaining *why* and *what was
  verified* (e.g. `fix(layout): …`, `feat(qwixx): …`). Reference the test that
  guards the change.
- One logical change per commit. Keep the bundle (§5) in the same commit as its
  source.

---

## 7. Performance & the free-tier budget

The Worker runs on Cloudflare's free DO tier (1M req/mo, 400K GB-s/mo). The cost
driver is **DO compute while sockets are open** + **cross-DO subrequests**. The
mitigations are load-bearing — preserve them:

- WebSocket **Hibernation** (`static options = { hibernate: true }`).
- `setWebSocketAutoResponse('ping','pong')` so keep-alives never wake the DO.
- Lobby pinged **only on membership/game-status change**, not per action.
- **One alarm** drives both game ticks and idle-close.
- Personalized view diffs computed **once per seat per broadcast**.
- Bots "think" on the host's client (≈0 server compute) — keep it that way.

On the client: avoid layout thrash, prefer transforms for animation, and respect
`prefers-reduced-motion`.

---

## 8. Security & input hygiene

- **All inbound WebSocket messages are untrusted.** They must go through
  `src/protocol.ts` validators (bounded keys/strings/ints, reserved-key
  protection). A new game can add action fields without editing the parser —
  `applyAction()` remains the final authority on whether fields are meaningful.
- The host may drive **bot** seats only, and only when it's actually that bot's
  turn. Don't widen seat-control authorization.
- The public replay API exposes **public game state only** — never hidden
  card/deck state. Keep the debug endpoint token-gated.
- Never commit secrets. `DEBUG_TOKEN` is a Worker secret, not a committed value.

---

## 9. Definition of done

A change is done when:

1. It does what the task asked, with edge/error paths handled.
2. There's a test proving it (and the test fails without the fix).
3. `npm run validate` is green; browser-affecting changes are verified in
   Chromium at desktop, tablet, and phone widths.
4. The generated bundle (§5) is regenerated + committed if TS game logic changed.
5. The commit message explains the change and what was verified.
6. No existing game, test, or layout guard was broken (or the guard was
   intentionally and correctly updated).

---

### Skill index (source: addyosmani/agent-skills)

The full playbooks these principles distill from: `frontend-ui-engineering`,
`test-driven-development`, `debugging-and-error-recovery`,
`browser-testing-with-devtools`, `code-review-and-quality`,
`incremental-implementation`, `git-workflow-and-versioning`,
`performance-optimization`, `api-and-interface-design`,
`security-and-hardening`, `planning-and-task-breakdown`,
`spec-driven-development`. Apply the matching skill whenever a task fits it.

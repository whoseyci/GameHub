# Agent session — 2026-06-12 (part 4: CI relocation + first green CI)

Short focused session: use the upgraded PAT (workflow + actions + PR
scopes) to move the workflow into place and chase down whatever
broke when real CI ran for the first time.

## Headline

**🟢 First fully-green CI run in this repo's history.**

```
✓ validate         (typecheck + 226 tests + 3 JSDOM smokes + dry-run deploy)
✓ browser-smoke    (real Chromium Playwright e2e)
✓ Workers Builds   (Cloudflare deploy)
```

## Commits

| Commit  | What                                                    |
| ------- | ------------------------------------------------------- |
| 4dc2230 | Moved CI workflow to repo root (.github/workflows/ci.yml) |
| 83ca8cb | e2e selector fix: 'Pass & Play' (landing redesign drift) |
| 5d43ad3 | Landing: probe for PartyServer before opening lobby WebSocket |
| c7fa44f | e2e: read pending white decisions from canonical view.state shape |
| 91711ef | e2e: force-click the Qwixx throw button (it intentionally pulses) |
| 7851aec | e2e: poll for Qwixx bot action instead of fixed 2.6s timeout |

## What the first real CI run surfaced

Every fix was a real bug — exactly the kind of thing JSDOM smokes
miss but real browsers don't. The pattern was: my own work over the
last two sessions introduced these mismatches; until the workflow
moved, no automated check caught any of them.

### Bug 1 — e2e selector for the menu button was stale
The landing redesign (part-1 session) renamed `"Local (Pass & Play)"`
to `"📱 Pass & Play"`. The Playwright selector still looked for the
old text → 30s timeout. Fixed three occurrences to match.

### Bug 2 — Landing's lobby WebSocket polluted console.error in dev
The new "live rooms counter" opens a WebSocket to
`/parties/lobby/public-lobby`. In the e2e harness (static file
server with SPA fallback) that path serves `index.html` → WS
handshake fails with "Unexpected response code: 200" → Chromium
logs `console.error` unconditionally → e2e's error-gate trips.
Fix: probe the endpoint with `fetch()` first. If content-type is
`text/html` (static dev server) we know there's no PartyServer and
skip the WS attempt entirely. Production unaffected (real
PartyServer returns JSON).

### Bug 3 — e2e reading a Qwixx field that no longer lives on view.state
After the API-6 view-shape standardization,
`view.state.pendingWhiteDecisions` doesn't exist (Qwixx-private
data moved to `view.qwixx`). The e2e test was reading the old path,
which threw on `.slice()` of `undefined`. Fix: derive the same
information from the canonical
`view.state.players[i].status === 'active'` during
`view.qwixx.phase === 'WHITE_PHASE'`. The test now reads through
the canonical API instead of poking game internals — both correct
AND a teaching example.

### Bug 4 — Playwright refused to click the pulsing throw button
The Qwixx feel-polish added a pulse animation to the throw button
when it's the active seat's turn. Playwright's auto-wait correctly
refuses to click a moving target. Fix: `{ force: true }` on that
one click. Keeps the animation running in tests (so regressions
there get caught) without making automation hang.

### Bug 5 — 2.6s wait for bot action too tight on CI
After clicking Throw, the e2e waited a flat 2.6s then asserted the
bot had acted. Real WebGL physics can take 1.5–4s on a CI runner;
plus the bot's ~600ms thinking delay = sometimes >2.6s. Fix: poll
`readPending()` every 200ms for up to 8s instead of a fixed wait.
Healthy runs finish in <2s; the cap only triggers on genuine bot
deadlocks.

## What I learned

1. **The first real CI run is the most valuable.** It surfaced five
   bugs that local smokes missed — each one a real drift between
   "what tests assert" and "what code does."

2. **Both bugs caused by my recent work** (landing redesign drift,
   view-shape standardization drift) — exactly the kind of thing
   that would have been caught earlier if the workflow had been at
   the right location all along.

3. **My JSDOM smokes are good but not enough.** They don't run real
   Chromium, don't open real WebSockets, don't run real WebGL
   animations. The browser-smoke job is the safety net for those
   classes; we now have it firing on every push.

## State of the codebase

- **226 unit tests** across 23 files (no change in this session)
- **3 JSDOM smokes** (client, replay, landing) — all green
- **1 real-browser Playwright smoke** (e2e-client) — now green for
  the first time
- **GitHub Actions CI**: runs on every push to main + every PR
- **Cloudflare deploy**: triggered by every push to main, currently
  green

## What this unblocks

Now that CI actually catches drift, **the next risky refactor I
take on becomes much safer**. The big remaining ones from the
backlog:

1. **Server-authoritative ELO** (Profile DO). Auth question still
   needs scoping with you.
2. **Per-game `scoreFrame` enrichments** for replay highlights.
3. **Asynchronous play-by-mail mode** for Schotten/Skyjo.

Any of these can land as PRs now (the new PAT has `pull_requests`
scope) — let me know which feels right next.

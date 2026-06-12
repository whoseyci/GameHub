# Agent session — 2026-06-12

Four phases shipped to `main`. Local validation green at every step
(177 tests + 3 smokes + typecheck).

## What landed

| Commit  | Phase                                            | Tests + smokes |
| ------- | ------------------------------------------------ | -------------- |
| d712542 | Replay capture (server) + per-game `ReplayBundle` | +7 (168 total) |
| 3d2c20c | Replay player UI + scrubber + share + smoke       | +1 smoke       |
| 8017217 | Identity + recent-players social graph             | +9 (177 total) |
| be76dfb | Landing page: hero + instant-bot tiles + live counter | +1 smoke   |

## What you can try in production right now

1. **Replay a finished game.** Play any online game to completion, then on the
   summary screen there's a new **📺 Watch Replay / 🔗 Copy Link** row.
   The URL shape is `/replay.html?room=ABC&id=ABC-3-xyz` — shareable, no auth,
   immutable, aggressively cached. Open it in a private tab to verify
   strangers can watch.

2. **Scrub the timeline.** On the replay page, drag the scrubber, use
   ◀ ▶| step buttons, ⏮ ⏭ jump, ▶ play with 5 speeds (0.5×–10×), or
   keyboard: `←/→` step, `Space` play/pause, `Home/End` jump.

3. **Friend code + recent players.** The menu now has a "You" card with
   your auto-derived friend code (e.g. `FOX-94K`) and a chip strip of
   everyone you've played with — hover for W–L · last-seen, click × to
   forget. Bots and self-encounters are skipped. Persists in localStorage.

4. **Live rooms counter.** The landing's hero shows live "N rooms · M
   players online" via the existing public-lobby socket. Auto-disconnects
   when you leave the menu.

5. **Instant play vs bot.** Each landing tile has a `⚡ Play vs Bot`
   button that jumps straight into a 3-player local game (you + 2 medium
   bots) — no setup screen.

## What I didn't touch and why

- **Game-Module DX overhaul** (server-emitted `legalActions` hints).
  This is the right compounds-forever investment but it's a 1–2 day
  refactor on its own — every game needs a `legalActions(state, seat)`
  method and every client renderer needs to consume the hints in
  place of its private rule checks. Not safe to half-ship in the tail
  of a session.

- **CI workflow location.** Your `.github/workflows/ci.yml` lives at
  `GameHub/.github/workflows/` where GitHub Actions can't see it. I
  prepared the corrected workflow at
  `GameHub/proposed-workflows/ci.yml.proposed` (in commit d712542)
  but **my GitHub PAT lacks the `workflow` scope** so I couldn't move
  it for you. To finish the CI relocation:

  ```bash
  mkdir -p .github/workflows
  cp GameHub/proposed-workflows/ci.yml.proposed .github/workflows/ci.yml
  rm GameHub/proposed-workflows/ci.yml.proposed
  # Also delete the old, never-running copy:
  git rm -r GameHub/.github
  git add -A && git commit -m "Move CI workflow to repo root"
  git push
  ```

  Once that lands, every push runs `validate:ci` (which now includes the
  new replay + landing smokes) before Cloudflare ever sees the change.

- **The `failure` check on `main`** in the GitHub UI is Cloudflare's
  **Workers Build**, not GitHub Actions. I couldn't see the Cloudflare
  logs from the API, but the local `validate:ci` is green so the failure
  is likely a Cloudflare-side env issue (Node version, missing secret,
  etc). Check the dashboard link in the failed check.

## New developer surface

- `src/replay-capture.ts` — `ReplayBundle` schema + helpers.
- DO endpoints: `GET /replays`, `GET /replays/<id>`.
- Public API:
  - `GET /api/replays/<roomCode>` → `{ replays: ReplayIndexEntry[] }`
  - `GET /api/replay/<roomCode>/<replayId>` → `ReplayBundle`
  - Both CORS-open and (for ended games) cached `max-age=86400, immutable`.
- `window.Identity` (client) — see `public/js/00-identity.js` for the API.
- `window.setLocalSeats(arr)`, `window.setLocalPick(id)`,
  `window.startLocalForGame(id)` — public setters so non-network UI can
  drive the local-play pipeline.
- New scripts: `npm run smoke:replay`, `npm run smoke:landing`.

## What I learned about your codebase

The determinism contract (RNG-in-state, no wall-clock reads in
`applyAction`, verified by `tests/replay-determinism`) is the single
most leveraged thing in this project — it's why the entire replay
system is ~300 lines instead of ~3000, and why the next 5 features I'd
build on top (highlight detection, "what if" branch sim, ELO from
replays, …) are also cheap. Protect that invariant religiously; it's
your platform.

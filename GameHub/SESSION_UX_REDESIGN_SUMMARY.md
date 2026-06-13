# Session summary — UX redesign (Phases 1–9)

Two asks from the user, addressed in one session:
1. **Bots aren't working** (especially Skyjo not starting)
2. **Thorough redesign** of the UX (back-button quirks, accidental game
   switching in quick-play, too many setup screens, …)

Resolution: the bot issue turned out to be a known latent bug from the
W6 part 1 protocol parser (silent `set_ready` drop → ready gate never
fires → game never starts → looks like "bot stuck"). Fixing it was
already in W6 part 2 (`730f5a7`). The redesign rewrites enough of the
flow that the symptom can't recur.

---

## North-star (locked in with user, see UX_REDESIGN_PLAN.md)

- **Sticky header** at the top of every menu/lobby screen with:
  - **Local ↔ Online toggle** (Local default, persisted)
  - **Group button** with dropdown (Create new / Recent groups / Join by code)
  - Hidden inside the game so the game owns the full viewport.
- **Landing tiles are the only entry point.** Pick mode, click tile, play.
- **Quick-play hard-locks the game** — no accidental game switching.
- **One Cloudflare DO connection per session** (lobby + room — multi-room
  multiplexing is impossible given the DO topology; what we DID fix is the
  lobby socket only opening when the user actually goes online, and
  idle-closing after 60s).

## Shipped (9 phases + plan)

| Commit | What |
|---|---|
| `533c06d` | UX_REDESIGN_PLAN.md (locked design) |
| `557628f` | **Phase 1** — sticky mode header + group picker (16 tests) |
| `9425797` | **Phase 2** — OnlineSession owns lobby socket lifecycle (10 tests) |
| `cb70d11` | **Phase 3** — landing tiles are mode-aware, one big click target (10 tests) |
| `92f9f9f` | **Phase 4** — kill the middle screens (5 screens, 100+ lines of HTML) (15 tests) |
| `de1fe08` | **Phase 5** — hard-lock the game inside quick-play rooms (7 tests) |
| `225a295` | **Phase 6** — inline local seat editor (replaces #localPick) (12 tests) |
| `28b2c52` | **Phase 7** — fix mini-board legibility (delete CSS soup) (6 tests) |
| `9239577` | **Phase 8** — bot verification regression guards (3 tests) |
| _this commit_ | **Phase 9** — cleanup + summary |

**Final state: 418 tests across 38 files (+82 in this session). 3 JSDOM
smokes + 1 Playwright e2e + typecheck all green at every commit
boundary. GH Actions CI green on every push.**

## What you'll notice in production

1. **Sticky header** at the top: GameHub brand + Local / Online toggle +
   Group button. Survives refresh (mode + recent groups persist).
2. **One-tap play.** Click any tile on the landing — boom, you're in.
   In Local mode that's you + 2 bots, ready to play. In Online mode
   that's the quick-play queue for that game.
3. **No more "Online Setup / Quick Pick / Host / Join" screens.** The
   header replaces them. The Group picker replaces "Make a Room" and
   "Join by Code" with one dropdown.
4. **Inside a quick-play room:** ONE banner identifying the queued
   game. No tile picker, no way to accidentally switch games. Game
   auto-launches when everyone's ready.
5. **Inside a local game:** new `#seatsBtn` (people icon) in the
   topbar opens an inline drawer where you can add/remove seats,
   change bot difficulty, and restart. No menu round-trip needed.
6. **Mini-boards are actually legible now.** Opponent names + scores
   visible at every viewport size. The W1 tier system finally owns
   adaptation without legacy CSS fighting it.
7. **No wasted lobby socket** for Local-only users. The page is fully
   offline until you express online intent.

## What you can rely on

- **Game engines** (Skyjo / Flip 7 / Qwixx / Schotten) — untouched.
- **Kit modules** (Icon, Cards, MiniBoard, PassPlay, Layout, Turn,
  Status, Controls, Dice3D, CardManager) — untouched.
- **Identity** (pid + friend code + recents + ELO + recent groups) — untouched.
- **Replay system** (URL routing, server endpoints, replay player) — untouched.
- **Invite links** (`/?join=CODE` routing) — untouched.
- **Variant picker** — untouched, still works.
- **Ready system** — untouched, still gates group launches.

## Honest trade-offs

1. **Header takes ~56px of vertical space.** Worth it: it eliminated
   5 screens.
2. **Local is the default mode.** First-time users see Local play
   immediately; Online needs one tap. Matches the Jackbox pattern
   (low-friction default → opt into multiplayer).
3. **Quick-play rooms can't switch games.** Strangers in a Skyjo
   queue expect Skyjo. Switching games via the **Group** flow
   instead (which is what groups are for).
4. **No more "Make a Room" with custom code + visibility + max-players
   knobs.** Power-user feature, mostly unused. Group picker covers
   the 95% case. If anyone misses it, the legacy `hostRoom()` helper
   still exists in 01-network-local.js — just unreachable from UI.
5. **Cloudflare DO topology forces N sockets for N rooms.** We can't
   "have one HTTP request when devoting to play online then everything
   over messages" in the strictest sense (the user's hope). What we
   DID deliver: lobby socket only opens on Online intent + idle-closes
   after 60s. Realistically that's "one HTTP request per online
   session" for most users.

## Files added this session

- `UX_REDESIGN_PLAN.md` — the design doc
- `public/js/00-mode.js` — Mode + GroupPicker
- `public/js/00-online-session.js` — Lobby socket lifecycle
- `public/js/00-local-seat-editor.js` — Inline seat editor
- `tests/ux-redesign-phase{1..8}.test.ts` — 82 new tests

## Files modified this session

- `public/index.html` — header DOM, killed screens, legacy hidden slots
- `public/js/00-core.js` — `goOnline()` repointed to Mode.set+menuScreen
- `public/js/00-landing.js` — mode-aware tile clicks, OnlineSession sub
- `public/js/00-identity-ui.js` — removed onlineSetup re-render trigger
- `public/js/01-network-local.js` — quick-play banner, group toggle,
  window mirrors for cross-module reads, repointed leaveOnline
- `public/js/05-bots-init.js` — flagged legacy hidden-slot calls
- `public/styles/main.css` — Phase 7 mini-board cleanup
- `public/styles/landing.css` — header + group picker + tile redesign
  + quick-play banner + seat editor

## Files deleted (entire screens removed from index.html)

- `#onlineSetup` (Play Online entry — replaced by Mode toggle)
- `#quickPick` (game picker — replaced by landing tiles)
- `#localPick` (manual seat setup — replaced by inline drawer)
- `#hostSetup` (custom-code rooms — covered by Group picker)
- `#joinSetup` (join + public list — covered by Group picker)

## Cleanup deferred (flagged for future)

- 05-bots-init.js still calls `renderTiles('quickTiles', quickPlay)`
  for the hidden `#quickTiles` DOM slot. Safe to remove once we
  confirm no path reads it; left in for now to preserve the bootstrap
  helpers' init order.
- `hostRoom() / joinByCode() / randomCode() / setVis() / bumpMax()`
  helpers in 00-core.js + 01-network-local.js are now unreachable
  from the UI but kept for any external linkers. Candidate for
  deletion after a stability window.

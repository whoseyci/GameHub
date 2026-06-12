# UX redesign — execution plan

## North-star (locked in with user)

**Two-mode app with a persistent header.** A prominent **Local ↔ Online** toggle
(Local default) and a **Group** button live in the header on every menu/lobby
screen. The header hides once you're in a game so the game can use the full
viewport.

**Landing tiles are the only entry point.** No more Online Setup / Quick Pick /
Host Setup / Join Setup / Local Pick screens. The current mode + the tile click
fully determine where you go:

| Tile click | Local mode | Online mode |
|---|---|---|
| Skyjo | Drop into local Skyjo with you + 2 bots (editable seats inline) | Drop into a quick-play Skyjo shard (matchmaking) |
| Flip 7 | Same | Same |
| Qwixx | Same | Same |
| Schotten | Same | Same |

**Quick-play hard-locks the game.** Once you're in `quick-skyjo-N`, the room
lobby only exposes Skyjo. Other tiles are hidden. No accidental game-switching.

**Group flow stays separate.** Header's Group button opens a persistent group
lobby (the place where switching games IS the feature). Anyone can host a
group; the code/invite link works as today.

**Persistent online socket.** Flipping the Local→Online toggle (or clicking
an Online-mode tile from Local) opens ONE WebSocket. All room hops, joins,
leaves, ready toggles, launches travel over that socket. **Auto-close after
~60s idle** (no menu activity AND no room membership). One HTTP request per
session, not per room hop.

## Why this fixes the quirks

| Old quirk | Fixed by |
|---|---|
| "Back from game goes to weird page" | Only two screens behind a game now: the room (if joined a room) or the landing. Back goes to the right one because there are no in-between screens. |
| "Inside quick-play room a different game can be chosen" | Hard lock on quick-play rooms — only the queued game appears. |
| "Too many menus / setup screens" | Killed entirely. Landing → game in one tap. |
| "Re-connect every time I hop rooms" | Persistent socket; hops are messages. |
| "Bots silently broken" | Surfaced + fixed as part of the new clean code (bots aren't menu-coupled). |
| "Mini-boards too small / invisible" | New game-screen layout with explicit height budget; no contradicting `@media` rules layered on top. |

## What survives

- All four game engines (Skyjo/Flip7/Qwixx/Schotten) — server + client untouched.
- Kit modules (Icon, Cards, MiniBoard, PassPlay, Layout, Turn, Status, Controls, Dice3D, CardManager) — they're game-rendering primitives, mode-agnostic.
- Identity (pid + friend code + recents + recent groups + ELO).
- Replay system (URL routing, server endpoints, replay player).
- Invite links (`/?join=CODE` routing).
- Variant picker (`Kit.Cards` overlay-based modal, called from group launch).
- Ready system (still gates group launches; the soft "auto-ready" for quick-play single hosts stays).

## What gets removed / merged

- `#onlineSetup` screen → killed; toggle in header replaces it.
- `#quickPick` screen → killed; landing tiles in Online mode replace it.
- `#hostSetup` screen → demoted to a tiny inline form in the header's "Make a
  Room" dropdown (still useful for private custom-code rooms).
- `#joinSetup` screen → demoted to an inline "Join by code" field in the
  header's join dropdown.
- `#localPick` screen → killed; landing tiles in Local mode replace it.
  Seat editing happens in a small drawer that opens INSIDE the local game
  screen (above the board) before first move.
- `08-bots-init.js`'s top-of-file `renderTiles('quickTiles', quickPlay)` call
  → gone (the screen it populates is gone).

## Phased commits (CI must stay green at each boundary)

Each phase is a separate commit so it's easy to revert / review.

### Phase 1 — Header + mode store (no flow changes yet)
- Add `Mode` global: `{ current: 'local' | 'online', set(m), onChange(cb) }`.
- Add a persistent header `<div id="modeHeader">` above the landing/menu
  screens with the Local/Online toggle + Group button.
- Toggle just flips the mode for now (no flow consequences).
- Persist mode in `localStorage.gh.mode`.
- Header hides when `.screen.active` is the game screen.
- TESTS: mode persistence, header DOM presence, hide-in-game.

### Phase 2 — Persistent Online socket (Cloudflare-DO honest version)
**Constraint:** Cloudflare DO routing means each ROOM is its own WebSocket
endpoint (`/parties/room/<code>`). We cannot multiplex N rooms over one
socket. The lobby (`/parties/lobby/public-lobby`) is also its own DO
with its own socket. Two sockets is the floor.
What we CAN cleanly avoid:
- Opening the lobby socket on landing load when the user never goes
  online (currently it opens immediately — wastes a DO connection on
  every landing visit, including bots/crawlers).
- Spurious room-socket reconnects when nothing changed.

**Implementation:**
- New `OnlineSession` module wraps the existing `net.ws` + lobby `ws`
  lifecycle. Funnels `connectRoom` / `quickPlay` / `leaveOnline` through
  one place.
- Lobby socket opens when:
    * `Mode.set('online')` fires, OR
    * the user clicks an online action from Local mode (we flip mode + open).
- Lobby socket closes when:
    * `Mode.set('local')` fires AND not in a room, OR
    * 60s pass with no inbound message AND `!net.room`.
- Room socket lifecycle unchanged (per-room WS), but `OnlineSession`
  exposes a single `enterRoom(code, opts)` / `leaveRoom()` API so the
  call sites stop reaching directly into `net.ws`.
- All current message types still work (transport refactor only).
- TESTS: lobby socket NOT opened on landing in local mode; opens when
  flipping to online; idle close kicks in; entering a room from any
  mode works; leaving a room returns to landing without dropping the
  lobby socket prematurely.

### Phase 3 — Wire landing tiles to mode
- In Local mode, tile click does what "vs Bot" currently does (instant
  local game with you + 2 bots).
- In Online mode, tile click does what "Play Online" currently does.
- Remove the per-tile button row entirely — one big tile click is the
  action; rules stays as the "?" affordance.
- Update landing copy: "Local play" vs "Online play" subhead under toggle.
- TESTS: tile click path per mode, rules button still works.

### Phase 4 — Kill the middle screens
- Delete `#onlineSetup`, `#quickPick`, `#localPick` markup + the
  `showScreen('onlineSetup' | 'quickPick' | 'localPick')` callers.
- `hostSetup` and `joinSetup` survive but are reached from the header's
  "More" dropdown (rare flow — most people just click a tile or use
  Group).
- Inline seat editor for local games: a small `<details>` drawer above
  the board that opens BEFORE first move; closes once the game starts.
- TESTS: navigation regression suite (back button always lands
  somewhere coherent).

### Phase 5 — Hard-lock quick-play game
- In the room screen, when `m.quickGame` is set, ONLY show that game's
  tile (or skip the tile picker entirely and auto-launch when ready).
- Add a banner: "Quick play · Skyjo". Add a "Leave queue" button (←).
- TESTS: tile filter is correct, leave returns to landing.

### Phase 6 — Local game inline seat editor
- Above the board, a collapsible row of seat chips (name input + add/
  remove bot/human). Open by default if it's the first time you played
  this game; collapse after first move.
- Default: you + 2 medium bots.
- "Restart with new seats" button when collapsed.
- TESTS: editor opens/closes, seat changes restart the engine cleanly.

### Phase 7 — Mini-board fixes
- Strip the contradicting `.board-mini` `@media` overrides. The
  Kit.MiniBoard tier system already adapts; the legacy Skyjo-specific
  `.board-mini` rules from the pre-W1 era are double-styling and
  hiding things at narrow widths.
- Pin mini-board container to a clear height budget via Kit.Layout
  (28–32% of game-screen height, scrollable on overflow).
- TESTS: mini-board renders at every viewport size; opponent header
  visible (not display:none on mobile anymore).

### Phase 8 — Bot verification
- Add a real-browser smoke (the JSDOM one already passes — by user's
  account this is an in-browser specific failure).
- Investigate the actual production issue once the new flow is live;
  may turn out to be a screen-flow regression that the redesign fixes
  organically.

### Phase 9 — Cleanup pass
- Remove dead code: orphaned helpers from killed screens, unused CSS
  selectors, stale comments referencing old screens.
- Update `SESSION_W1-W6_SUMMARY.md` to reflect new state.
- Bump version stamp.

## Test discipline

- Every phase adds vitest tests for its new contract.
- Every phase runs `npm run smoke:client` + `npm run smoke:landing`
  before commit.
- CI must be green at every commit boundary. No "fix in next commit"
  unless explicitly noted.

## Trade-offs called out up-front

1. **Header takes screen real estate.** Landing hero shrinks ~60px. Worth
   it — eliminates 4 screens.
2. **Local mode is now the default.** First-time users will see local
   play immediately; online needs one extra tap. This matches the
   "low-friction default → opt into multiplayer" pattern (Jackbox does
   this).
3. **Quick-play hard lock removes a tiny edge case** (host changing
   game on a public quick-play room with a stranger waiting). Worth it
   — strangers in a quick-play room expect to play THAT game.
4. **Persistent socket uses Cloudflare DO time even when idle.** Mitigated
   by 60s auto-close + the `ping/pong` server-side auto-response that
   doesn't wake the DO. Realistic cost: cents per active user per month.

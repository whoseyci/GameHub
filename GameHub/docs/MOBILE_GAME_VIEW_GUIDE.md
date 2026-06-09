# Mobile in-game layout guide

Goal: once a game is running, a phone user should not need page-level scrolling. The
whole table should fit into `100dvh` with one focused board and tiny opponent boards.

## Standard pattern

1. **Opponent space at top**: semantic miniatures only; shrink here first as player count grows.
2. **Dice/deck space in the middle**: compact shared randomness/deck/pile controls.
3. **Action/focused-board space at bottom**: the active player’s required interaction area.
4. **No game-page scroll**: shrink/hide secondary text before allowing scrolling.

## Miniature-board contract

A miniature is not a tiny screenshot. It is a purpose-built status glyph containing the minimum useful public info.

For every game, define:

- whose board it is,
- active/turn marker,
- current score / risk state,
- enough board-state marks to understand threats/opportunities,
- warnings/penalties/lives if relevant.

### Qwixx miniature

Qwixx uses:

- 4 rows,
- 13 dots per row,
- 4 penalty warning icons.

Dot meaning:

| State | Visual |
|---|---|
| marked | row color |
| skipped/unavailable | dark gray |
| unmarked/available | muted gray |
| locked | gold lock/status dot |
| unused filler | transparent |

Penalty icon meaning:

| State | Visual |
|---|---|
| unused | dark gray warning |
| used | dark red warning |

## Seat/focus rule

Use the shared `SeatModel` idea everywhere:

- same-device human seats are controlled by this device and may become the focused board;
- bot seats behave like remote/other-device seats and should not steal focus;
- remote seats are shown as miniatures/popup inspection only;
- local and online should use the same renderer and differ only in the source of `controlledSeats`.

Local pass-and-play should use the **same renderer** as online mode. The local engine's
`actor()` returns the seat that needs rules processing, but the UI focus should resolve
through controlled human seats, not blindly through `actor()`. Opponent boards are
miniatures and can be tapped to inspect.

## Agent checklist for new games

- Implement one renderer for both local and online.
- Provide a compact miniature representation before polishing animations.
- Keep the focused board plus all miniatures inside the viewport at 360×700 CSS px.
- Use CSS media queries to remove labels before shrinking critical information.
- Never rely on page-level scroll during a game.

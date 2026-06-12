/* kit-turn.js — Kit.Turn: shared "whose turn" detection + banner + SFX.
 *
 * Replaces the copy-pasted "did currentPlayer change? if mine play SFX +
 * banner" block that every game's render() used to carry. Games now just
 * call Kit.Turn.update(view) once per render; the module:
 *
 *   1. Detects when the canonical view.state.currentSeat changes (or moves
 *      to a different focusSeat in simultaneous-turn games).
 *   2. Shows a banner: "Your turn!" (green) or "Alice's turn" (blue),
 *      using the canonical view.state.players[currentSeat].name.
 *   3. Plays SFX.yourTurn() once when it becomes the viewer's turn.
 *   4. Calls Kit.Status.set({ text, tone }) so the bottom status bar stays
 *      in sync without per-game wiring.
 *   5. Bumps the status bar (the same .bump pulse the per-game blocks
 *      used to fire themselves).
 *
 * Migration safety: while old games still carry their own turn block, we
 * watch Kit.turnBanner() and silently skip our own banner if one was
 * already shown in the last 300ms. Means turning Kit.Turn on cannot
 * double-fire on legacy games; deleting their per-game block later just
 * works.
 *
 * NOTE: `Kit` is a script-scoped const declared in 00-core.js, NOT on
 * window — sibling scripts reference it lexically (see 00-cards.js for
 * the same pattern). This module follows that convention.
 */
(function () {
  'use strict';
  if (typeof Kit === 'undefined') { console.error('[Kit.Turn] Kit not loaded'); return; }

  // Wrap the existing Kit.turnBanner once so we can tell when a game has
  // already shown a banner this tick.
  let _lastBannerAt = 0;
  if (Kit.turnBanner && !Kit.turnBanner._tracked) {
    const orig = Kit.turnBanner;
    Kit.turnBanner = function () { _lastBannerAt = Date.now(); return orig.apply(this, arguments); };
    Kit.turnBanner._tracked = true;
  }
  const SUPPRESS_WINDOW_MS = 300;

  /** Per-game memory of the last seat we announced + the last over-ness flag. */
  const memory = Object.create(null);
  /** Reset memory when render() switches games. */
  let lastGame = null;

  function nameOf(state, seat) {
    if (!state || !Array.isArray(state.players)) return '';
    const p = state.players.find((x) => x.seat === seat);
    return p?.name || '';
  }

  function detectActiveSeat(view) {
    const st = view && view.state;
    if (!st) return -1;
    if (typeof st.currentSeat === 'number' && st.currentSeat >= 0) return st.currentSeat;
    // Simultaneous-turn games may expose focusSeat (Qwixx's roller).
    if (typeof st.focusSeat === 'number' && st.focusSeat >= 0) return st.focusSeat;
    return -1;
  }

  /**
   * Drive the shared turn UI from a freshly rendered view.
   * @param {object} view
   * @param {object} [opts]
   * @param {boolean} [opts.quiet]      suppress banner this render
   * @param {number}  [opts.viewerSeat] override view.yourSeat
   */
  function update(view, opts) {
    opts = opts || {};
    if (!view || !view.state) return;
    if (view.game !== lastGame) {
      for (const k of Object.keys(memory)) delete memory[k];
      lastGame = view.game;
    }
    const mem = memory[view.game] = memory[view.game] || { seat: null, over: false };
    const viewer = (opts.viewerSeat != null) ? opts.viewerSeat : view.yourSeat;
    const active = detectActiveSeat(view);
    const over = !!view.over;

    if (over) { mem.over = true; mem.seat = active; return; }
    if (mem.over) mem.over = false;

    if (active < 0) { mem.seat = active; return; }
    if (mem.seat == null) { mem.seat = active; return; } // first-paint suppression
    if (active === mem.seat) return;
    mem.seat = active;

    if (opts.quiet) return;
    // Migration: if a legacy per-game block already fired a banner this
    // tick, don't double-up.
    if (Date.now() - _lastBannerAt < SUPPRESS_WINDOW_MS) return;

    const mine = viewer >= 0 && active === viewer;
    const name = nameOf(view.state, active);
    const text = mine ? 'Your turn!' : (name ? `${name}'s turn` : 'New turn');
    try { Kit.turnBanner(text, mine); } catch {}
    if (mine && window.SFX?.yourTurn) { try { SFX.yourTurn(); } catch {} }
    if (Kit.Status?.set) { try { Kit.Status.set({ text, tone: mine ? 'go' : 'info' }); } catch {} }
    if (typeof window.bumpStatus === 'function') { try { window.bumpStatus(); } catch {} }
  }

  /** Reset detection state (called by GameShell.unmount). */
  function reset(gameId) {
    if (gameId) delete memory[gameId];
    else for (const k of Object.keys(memory)) delete memory[k];
    if (!gameId) lastGame = null;
  }

  Kit.Turn = { update, reset, _peek: () => ({ ...memory }), _lastBannerAt: () => _lastBannerAt };
})();

/* kit-passplay.js — shared pass-and-play turn transition.
 *
 * When 2+ humans share one device (mode==='local' with ≥2 non-bot seats),
 * a turn change should feel like the device is being handed across the
 * table. Previously each game's focused board just snapped to the next
 * player. Now Kit.PassPlay runs a unified transition:
 *
 *   1. The current board fades + scales down slightly ("you're done")
 *   2. A full-bleed "Now: $name" overlay sweeps in
 *   3. The new board fades up from a slight rotation ("table rotates")
 *
 * Hook: GameShell.render() (in 00-core.js) calls Kit.PassPlay.beforeRender
 * BEFORE handing the view to the game's client.render, and .afterRender
 * AFTER. The platform handles all the timing; games don't change.
 *
 * Skipped automatically when:
 *   • mode !== 'local'
 *   • there are < 2 non-bot seats (single-player vs bots, no need)
 *   • prefers-reduced-motion is on
 *   • the focused seat is a bot (pure bot vs bot turn change isn't a "hand off")
 *   • Kit.Turn already suppressed the banner (quiet:true games during animations)
 *
 * NOTE: Kit is a script-scoped const in 00-core.js (same pattern as
 * 00-kit-turn.js). Sibling scripts reference it lexically.
 */
(function () {
  'use strict';
  if (typeof Kit === 'undefined') { console.error('[Kit.PassPlay] Kit not loaded'); return; }

  const ANIM_MS = 520;            // total duration; matches the CSS keyframes
  const memory = Object.create(null);
  let _lastGame = null;
  let _busy = false;              // suppress overlapping transitions

  function prefersReducedMotion() {
    try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; }
    catch { return false; }
  }

  /** "Is this device shared by 2+ humans?" — the only place we trigger. */
  function isPassPlay() {
    if (typeof mode === 'undefined' || mode !== 'local') return false;
    // localSeats lives in 01-network-local.js (lexically visible).
    if (typeof localSeats === 'undefined') return false;
    const humans = localSeats.filter((s) => !s.bot).length;
    return humans >= 2;
  }

  function nameOf(view, seat) {
    if (seat < 0) return '';
    const st = view?.state;
    if (st && Array.isArray(st.players)) {
      const p = st.players.find((x) => x.seat === seat);
      if (p?.name) return p.name;
    }
    return localSeats?.[seat]?.name || `Player ${seat + 1}`;
  }
  function isBotSeat(seat) {
    return !!(typeof localSeats !== 'undefined' && localSeats[seat]?.bot);
  }

  function pickActiveSeat(view) {
    const st = view?.state;
    if (!st) return -1;
    if (typeof st.currentSeat === 'number' && st.currentSeat >= 0) return st.currentSeat;
    if (typeof st.focusSeat === 'number' && st.focusSeat >= 0) return st.focusSeat;
    return -1;
  }

  function clearOverlay() {
    const old = document.querySelector('.kit-passplay-overlay');
    if (old) old.remove();
  }

  /** Show the "Now: X" overlay over the main board area. */
  function showOverlay(text) {
    clearOverlay();
    const main = document.getElementById('mainBoardsContainer');
    if (!main) return null;
    const ov = document.createElement('div');
    ov.className = 'kit-passplay-overlay';
    ov.setAttribute('aria-live', 'polite');
    const inner = document.createElement('div');
    inner.className = 'kit-passplay-card';
    inner.innerHTML = `
      <div class="kit-passplay-eyebrow">Pass the device</div>
      <div class="kit-passplay-name">${escapeHtml(text)}</div>
      <div class="kit-passplay-sub">It's your turn</div>
    `;
    ov.appendChild(inner);
    main.appendChild(ov);
    // Force a reflow so the .visible class triggers the CSS transition.
    void ov.offsetWidth;
    ov.classList.add('visible');
    return ov;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /**
   * Called by GameShell.render() right BEFORE handing the view to the game
   * client. Returns true if we initiated a transition (and the caller should
   * still proceed — the overlay sits above the new render so the swap is
   * visually hidden).
   */
  function beforeRender(view) {
    if (!view || !view.game) return false;
    if (_busy) return false;
    // Reset memory when switching games entirely.
    if (view.game !== _lastGame) {
      for (const k of Object.keys(memory)) delete memory[k];
      _lastGame = view.game;
    }
    const mem = memory[view.game] = memory[view.game] || { seat: null };
    const active = pickActiveSeat(view);
    if (active < 0) { mem.seat = active; return false; }
    if (mem.seat == null) { mem.seat = active; return false; } // first paint
    if (active === mem.seat) return false;                      // no change
    mem.seat = active;

    if (!isPassPlay()) return false;
    if (prefersReducedMotion()) return false;
    // If the seat we're handing TO is a bot, the device hand-off metaphor
    // doesn't apply — let the normal banner play.
    if (isBotSeat(active)) return false;

    const main = document.getElementById('mainBoardsContainer');
    if (!main) return false;
    main.classList.add('kit-passplay-leaving');
    _busy = true;
    setTimeout(() => {
      try {
        showOverlay(nameOf(view, active));
        main.classList.remove('kit-passplay-leaving');
        main.classList.add('kit-passplay-entering');
      } catch {}
    }, Math.floor(ANIM_MS * 0.35));
    setTimeout(() => {
      try {
        main.classList.remove('kit-passplay-entering');
        clearOverlay();
        _busy = false;
      } catch { _busy = false; }
    }, ANIM_MS);
    return true;
  }

  function afterRender(_view) {
    // Reserved for future use (e.g. animate the new main board in once it's
    // rendered). The overlay timing currently covers this naturally.
  }

  function reset(gameId) {
    if (gameId) delete memory[gameId]; else for (const k of Object.keys(memory)) delete memory[k];
    if (!gameId) _lastGame = null;
    _busy = false;
    clearOverlay();
    const main = document.getElementById('mainBoardsContainer');
    if (main) main.classList.remove('kit-passplay-leaving', 'kit-passplay-entering');
  }

  Kit.PassPlay = { beforeRender, afterRender, reset, _peek: () => ({ ...memory, _busy }) };
})();

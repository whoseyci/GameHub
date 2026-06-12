/* mode.js — UX redesign Phase 1.
 *
 * Owns the Local↔Online mode state and the Group picker dropdown. This
 * module is intentionally pure DOM + localStorage: no socket, no flow
 * changes. Later phases hook into Mode.onChange() to:
 *   - open/close the persistent online socket (Phase 2)
 *   - route landing-tile clicks per mode (Phase 3)
 *
 * Mode persists across reloads via `localStorage.gh.mode`. Defaults to
 * 'local' for first-time visitors (low-friction default; opt-in to
 * multiplayer matches the Jackbox pattern).
 *
 * The mode header is hidden when the active screen is #gameScreen (the
 * game owns the full viewport). We toggle `body.in-game` from
 * showScreen() — CSS in landing.css handles the rest.
 */
(function () {
  'use strict';

  const STORE_KEY = 'gh.mode';
  const VALID = new Set(['local', 'online']);
  const subscribers = new Set();
  const $ = (id) => document.getElementById(id);

  function readStored() {
    try {
      const v = localStorage.getItem(STORE_KEY);
      return VALID.has(v) ? v : 'local';
    } catch { return 'local'; }
  }
  function writeStored(m) {
    try { localStorage.setItem(STORE_KEY, m); } catch {}
  }

  let current = readStored();

  function notify(prev, next) {
    for (const cb of subscribers) {
      try { cb(next, prev); } catch (e) { console.warn('Mode subscriber threw:', e); }
    }
  }

  function paintHeader() {
    const lo = $('modeBtnLocal');
    const on = $('modeBtnOnline');
    if (lo) { lo.classList.toggle('on', current === 'local');   lo.setAttribute('aria-selected', String(current === 'local')); }
    if (on) { on.classList.toggle('on', current === 'online'); on.setAttribute('aria-selected', String(current === 'online')); }
  }

  function set(next) {
    if (!VALID.has(next) || next === current) return;
    const prev = current;
    current = next;
    writeStored(next);
    paintHeader();
    notify(prev, next);
  }

  /**
   * Show/hide the mode header based on the active screen. Called by the
   * showScreen() patch below. Game screen → hidden + `body.in-game`;
   * every other screen → visible + no `in-game` class.
   *
   * Also closes the Group picker dropdown when navigating away — it's a
   * transient menu, not a persistent panel.
   */
  function applyHeaderVisibility(screenId) {
    const header = $('modeHeader');
    if (!header) return;
    const inGame = (screenId === 'gameScreen');
    document.body.classList.toggle('in-game', inGame);
    header.classList.toggle('hidden', inGame);
    // Close transient dropdown on any nav.
    if (window.GroupPicker && typeof window.GroupPicker.close === 'function') {
      window.GroupPicker.close();
    }
  }

  function patchShowScreen() {
    if (typeof window.showScreen !== 'function' || window._modePatched) return;
    window._modePatched = true;
    const orig = window.showScreen;
    window.showScreen = function (id) {
      const r = orig.apply(this, arguments);
      applyHeaderVisibility(id);
      return r;
    };
    // Apply once for the initial screen (menuScreen by default).
    const active = document.querySelector('.screen.active');
    applyHeaderVisibility(active?.id || 'menuScreen');
  }

  // Expose API.
  window.Mode = {
    get: () => current,
    set,
    onChange: (cb) => {
      if (typeof cb !== 'function') return () => {};
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
  };

  // Multi-tab sync: if the user opens GameHub in two tabs and flips mode
  // in one, the other's header updates too.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORE_KEY || !VALID.has(e.newValue) || e.newValue === current) return;
    const prev = current;
    current = e.newValue;
    paintHeader();
    notify(prev, current);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { paintHeader(); patchShowScreen(); });
  } else {
    paintHeader(); patchShowScreen();
  }
})();

/* groupPicker — small dropdown attached to the header's Group button.
 *
 * Phase 1 scope: just the picker UI + wiring to the existing
 * hostGroup() / connectRoom() / Identity.getRecentGroups(). No new
 * server work; reuses W6 part 2 infrastructure.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const SAFE = /^[A-Z0-9_-]{1,64}$/i;

  function renderRecents() {
    const slot = $('groupPickerRecents');
    if (!slot) return;
    const recents = window.Identity?.getRecentGroups ? window.Identity.getRecentGroups() : [];
    if (!recents.length) {
      slot.innerHTML = '<span class="empty">No recent groups yet.</span>';
      return;
    }
    slot.innerHTML = recents.map((g) => {
      const label = (g.label || g.code).replace(/[<>&"']/g, '');
      const code  = String(g.code).replace(/[<>&"']/g, '');
      return `<button class="group-picker-recent-chip" data-code="${code}" title="Rejoin ${code}">${label}</button>`;
    }).join('');
    slot.querySelectorAll('[data-code]').forEach((btn) => {
      btn.addEventListener('click', () => rejoin(btn.getAttribute('data-code')));
    });
  }

  function open() {
    const p = $('groupPicker');
    if (!p) return;
    renderRecents();
    p.classList.remove('hidden');
    // One-shot outside-click closer.
    setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
  }
  function close() {
    const p = $('groupPicker');
    if (p) p.classList.add('hidden');
    document.removeEventListener('click', onDocClick, true);
  }
  function toggle() {
    const p = $('groupPicker');
    if (!p) return;
    if (p.classList.contains('hidden')) open(); else close();
  }
  function onDocClick(e) {
    const p = $('groupPicker');
    const btn = $('groupBtn');
    if (!p || p.classList.contains('hidden')) return;
    if (p.contains(e.target) || (btn && btn.contains(e.target))) return;
    close();
  }

  function createNew() {
    close();
    if (typeof window.hostGroup === 'function') window.hostGroup();
    else if (typeof window.toast === 'function') window.toast('Online not loaded yet.');
  }

  function joinByCode() {
    const inp = $('groupPickerCode');
    const raw = (inp?.value || '').trim().toUpperCase();
    if (!SAFE.test(raw)) {
      if (typeof window.toast === 'function') window.toast('Enter a valid group code.');
      return;
    }
    close();
    if (typeof window.ensureName === 'function') window.ensureName();
    if (typeof window.connectRoom === 'function') {
      window.connectRoom(raw, { isGroup: true });
    }
  }

  function rejoin(code) {
    if (!code || !SAFE.test(code)) return;
    close();
    if (typeof window.ensureName === 'function') window.ensureName();
    if (typeof window.connectRoom === 'function') {
      window.connectRoom(code, { isGroup: true });
    }
  }

  window.GroupPicker = { open, close, toggle, createNew, joinByCode, rejoin };
})();

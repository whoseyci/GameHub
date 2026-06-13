/* local-seat-editor.js — UX redesign Phase 6.
 *
 * Replaces the killed #localPick screen with an inline drawer that lives
 * above the game board. Lets the user:
 *   • Rename their own seat
 *   • Add / remove human or bot seats (within the game's min/max range)
 *   • Pick bot difficulty per seat
 *   • Restart the game with the new seats (one button, never auto-restarts
 *     mid-game)
 *
 * The editor is local-mode-only: in online play, seats are server-owned
 * and the room screen handles add/remove. We surface the #seatsBtn in
 * the game topbar only when mode === 'local' and there's an active local
 * engine.
 *
 * Data model: reads + writes the existing window.localSeats array
 * (managed by 01-network-local.js). Restart goes through
 * window.startLocalGame() so all the existing lifecycle (resetGameUi,
 * GameShell.unmount, etc.) runs unchanged.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const BOT_NAMES = ['Botley', 'Chip', 'Ada', 'Turing', 'Pixel', 'Nova', 'Echo', 'Zar'];

  function gameMeta() {
    const gid = window.localGameId || (window.curView && window.curView.game);
    if (!gid || !window.GameCatalogue) return null;
    return window.GameCatalogue.find((g) => g.id === gid) || null;
  }

  function seats() {
    return Array.isArray(window.localSeats) ? window.localSeats : [];
  }

  function setSeats(next) {
    if (typeof window.setLocalSeats === 'function') window.setLocalSeats(next);
    else if (Array.isArray(window.localSeats)) { window.localSeats.length = 0; for (const s of next) window.localSeats.push(s); }
    render();
  }

  function addHuman() {
    const meta = gameMeta();
    const max = meta?.maxPlayers ?? 8;
    if (seats().length >= max) return;
    setSeats([...seats(), { name: 'Player ' + (seats().length + 1), bot: false }]);
  }
  function addBot(difficulty = 'medium') {
    const meta = gameMeta();
    const max = meta?.maxPlayers ?? 8;
    if (seats().length >= max) return;
    const nBots = seats().filter((s) => s.bot).length;
    setSeats([...seats(), { name: BOT_NAMES[nBots] || ('Bot ' + (nBots + 1)), bot: true, difficulty }]);
  }
  function removeSeat(i) {
    const meta = gameMeta();
    const min = meta?.minPlayers ?? 2;
    if (seats().length <= min) return;
    setSeats(seats().filter((_, j) => j !== i));
  }
  function renameSeat(i, name) {
    const s = seats();
    if (!s[i]) return;
    s[i].name = String(name || '').slice(0, 20);
    // Don't re-render on every keystroke — that would steal focus.
  }
  function changeDifficulty(i, diff) {
    const s = seats();
    if (!s[i] || !s[i].bot) return;
    s[i].difficulty = diff;
    render();
  }

  function restart() {
    if (typeof window.startLocalGame !== 'function') return;
    close();
    window.startLocalGame();
  }

  function isVisible() {
    const ed = $('localSeatEditor');
    return !!ed && !ed.classList.contains('hidden');
  }
  function open() {
    const ed = $('localSeatEditor');
    if (!ed) return;
    render();
    ed.classList.remove('hidden');
    ed.setAttribute('aria-hidden', 'false');
  }
  function close() {
    const ed = $('localSeatEditor');
    if (!ed) return;
    ed.classList.add('hidden');
    ed.setAttribute('aria-hidden', 'true');
  }
  function toggle() { isVisible() ? close() : open(); }

  function render() {
    const ed = $('localSeatEditor');
    if (!ed) return;
    const meta = gameMeta();
    const min = meta?.minPlayers ?? 2;
    const max = meta?.maxPlayers ?? 8;
    const list = seats();
    const canRemove = list.length > min;
    const canAdd = list.length < max;

    const rows = list.map((s, i) => {
      const isBot = !!s.bot;
      const diff = s.difficulty || 'medium';
      const nameInput = isBot
        ? `<span class="seat-name seat-name-bot" title="${esc(s.name)}">${Kit.Icon.html('robot', { size: 13, cls: 'kit-icon-inline' })}${esc(s.name)}</span>`
        : `<input class="input seat-name-input" maxlength="20" value="${esc(s.name)}" data-seat="${i}" placeholder="Player ${i+1}">`;
      const diffPicker = isBot
        ? `<div class="seg seat-diff" data-seat="${i}">
             <button data-d="easy"   class="${diff==='easy'?'on':''}">Easy</button>
             <button data-d="medium" class="${diff==='medium'?'on':''}">Med</button>
             <button data-d="hard"   class="${diff==='hard'?'on':''}">Hard</button>
           </div>`
        : '';
      const removeBtn = canRemove
        ? `<button class="icon-btn seat-remove" data-seat="${i}" title="Remove">${Kit.Icon.html('x', { size: 14 })}</button>`
        : '';
      return `<div class="seat-row ${isBot ? 'is-bot' : 'is-human'}">${nameInput}${diffPicker}${removeBtn}</div>`;
    }).join('');

    ed.innerHTML = `
      <div class="lse-head">
        <div class="lse-title">${Kit.Icon.html('users', { size: 16 })}<span>Seats</span> <span class="muted">${list.length}/${max}</span></div>
        <button class="icon-btn" onclick="LocalSeatEditor.close()" title="Close — keep seats and play">${Kit.Icon.html('x', { size: 16 })}</button>
      </div>
      <div class="lse-seats">${rows}</div>
      <div class="lse-actions">
        <button class="btn secondary" ${canAdd ? '' : 'disabled'} onclick="LocalSeatEditor.addHuman()">${Kit.Icon.html('plus', { size: 13, cls: 'kit-icon-inline' })}Player</button>
        <button class="btn secondary" ${canAdd ? '' : 'disabled'} onclick="LocalSeatEditor.addBot()">${Kit.Icon.html('robot', { size: 13, cls: 'kit-icon-inline' })}Bot</button>
        <button class="btn green" onclick="LocalSeatEditor.restart()">${Kit.Icon.html('play', { size: 13, cls: 'kit-icon-inline' })}Restart with these seats</button>
      </div>
      <div class="lse-hint muted">${esc(meta?.name || 'Game')} needs ${min}–${max} players · Close (×) to play with the current seats.</div>
    `;

    // Wire delegated handlers (avoids inline onclicks for dynamic rows).
    ed.querySelectorAll('.seat-name-input').forEach((inp) => {
      inp.addEventListener('input', (e) => renameSeat(Number(inp.dataset.seat), inp.value));
    });
    ed.querySelectorAll('.seat-remove').forEach((btn) => {
      btn.addEventListener('click', () => removeSeat(Number(btn.dataset.seat)));
    });
    ed.querySelectorAll('.seat-diff button').forEach((btn) => {
      const seg = btn.parentElement;
      const i = Number(seg.dataset.seat);
      btn.addEventListener('click', () => changeDifficulty(i, btn.dataset.d));
    });
  }

  // Show/hide the topbar seats button when the active screen + mode
  // changes. The button is only useful in local mode while a game screen
  // is active. We poll on showScreen via the icons.js auto-mount hook
  // (already patched) — simplest is a small refresher.
  function refreshButton() {
    const btn = $('seatsBtn');
    if (!btn) return;
    // The script-scoped `mode` and `localEngine` from 00-core.js /
    // 01-network-local.js live in the shared classic-script global
    // lexical environment — bare references work across files, but
    // window.mode / window.localEngine do NOT (top-level `let` isn't
    // exposed as a window property). Wrap the lookup in a try so we
    // gracefully no-op if those scripts haven't loaded yet.
    // window.mode and window.localEngine are kept in sync by the
    // setters in 01-network-local.js (Phase 6). Fall back to bare
    // references for safety if those haven't been mirrored yet.
    let runtimeMode = window.mode;
    if (runtimeMode == null) {
      try { runtimeMode = (typeof mode !== 'undefined') ? mode : 'online'; } catch {}
    }
    let engineLive = !!window.localEngine;
    if (!engineLive) {
      try { engineLive = (typeof localEngine !== 'undefined') && !!localEngine; } catch {}
    }
    const active = document.querySelector('.screen.active')?.id;
    const inLocalGame = (active === 'gameScreen') && (runtimeMode === 'local') && engineLive;
    btn.classList.toggle('hidden', !inLocalGame);
    if (!inLocalGame) close();
  }

  // Patch showScreen so the seats button toggles whenever we navigate.
  function patchShowScreen() {
    if (typeof window.showScreen !== 'function' || window._lseShowScreenPatched) return;
    window._lseShowScreenPatched = true;
    const orig = window.showScreen;
    window.showScreen = function (id) {
      const r = orig.apply(this, arguments);
      refreshButton();
      return r;
    };
    refreshButton();
  }

  window.LocalSeatEditor = {
    open, close, toggle, render, refreshButton,
    addHuman, addBot, removeSeat, changeDifficulty, restart,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchShowScreen);
  } else {
    patchShowScreen();
  }
})();

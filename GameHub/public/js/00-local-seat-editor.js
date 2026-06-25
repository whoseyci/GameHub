/* local-seat-editor.js — Seat configuration for local play.
 *
 * Two contexts, one render core:
 *   1. PRE-GAME screen  (#seatScreen) — full-screen, reached when the
 *      user clicks a Local landing tile. Lets them set up seats before
 *      the engine ever spins. Default: 1 human (just you). Add/remove
 *      humans or bots, then tap "Start".
 *   2. IN-GAME overlay  (#seatOverlay) — modal popup, reached via the
 *      Seats button on the game topbar. Same UI; the action button reads
 *      "Restart with these seats" since a game is already running.
 *
 * Both contexts read + write the same window.localSeats array (managed
 * by 01-network-local.js). Pre-game "Start" sets the chosen game id
 * (window._localPick) and calls window.startLocalGame(); the in-game
 * "Restart" just calls window.startLocalGame() (same flow, just keeps
 * the existing game id).
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const BOT_NAMES = ['Botley', 'Chip', 'Ada', 'Turing', 'Pixel', 'Nova', 'Echo', 'Zar'];

  // Which game are we configuring? Pre-game uses window._pendingLocalGame
  // (set by openSeatScreen). In-game falls back to the live engine's id.
  function gameMeta() {
    const gid = window._pendingLocalGame || window.localGameId || (window.curView && window.curView.game);
    if (!gid || !window.GameCatalogue) return null;
    return window.GameCatalogue.find((g) => g.id === gid) || null;
  }

  function seats() {
    return Array.isArray(window.localSeats) ? window.localSeats : [];
  }

  function variantsFor(meta) {
    return (meta?.variants || meta?.features?.variants || []).filter((v) => v && v.id);
  }
  function selectedVariantId(gid, variants) {
    window._localVariantByGame = window._localVariantByGame || {};
    const saved = window._localVariantByGame[gid];
    if (saved && variants.some((v) => v.id === saved)) return saved;
    try {
      const live = window.localGameId === gid && window.localEngine?._state ? window.localEngine._state().variant : null;
      if (live && variants.some((v) => v.id === live)) return live;
    } catch {}
    return variants[0]?.id || 'standard';
  }
  function setVariant(gid, vid) {
    if (!gid || !vid) return;
    window._localVariantByGame = window._localVariantByGame || {};
    window._localVariantByGame[gid] = vid;
    renderAll();
  }
  function renderVariantPicker(meta) {
    const variants = variantsFor(meta);
    if (variants.length <= 1) return '';
    const selected = selectedVariantId(meta.id, variants);
    return `<div class="seat-variant-block">
      <div class="seat-variant-label">Variant</div>
      <div class="seg seat-variant" data-game="${esc(meta.id)}">
        ${variants.map((v) => `<button data-vid="${esc(v.id)}" class="${v.id === selected ? 'on' : ''}" title="${esc(v.description || v.name)}">${esc(v.name)}</button>`).join('')}
      </div>
      <div class="muted seat-variant-desc">${esc(variants.find((v) => v.id === selected)?.description || '')}</div>
    </div>`;
  }

  function setSeats(next) {
    if (typeof window.setLocalSeats === 'function') window.setLocalSeats(next);
    else if (Array.isArray(window.localSeats)) { window.localSeats.length = 0; for (const s of next) window.localSeats.push(s); }
    renderAll();
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
    // Pre-game allows shrinking down to 1 (so the user can switch a
    // single player to a bot etc. before adding others). In-game we
    // honour the engine's hard minimum. Both paths still let the user
    // confirm with the "Need N players" hint and a disabled Start.
    const meta = gameMeta();
    const isPre = !!window._pendingLocalGame;
    const min = isPre ? 1 : (meta?.minPlayers ?? 2);
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
    renderAll();
  }

  // Start (pre-game) / Restart (in-game). Both funnel through the
  // existing window.startLocalGame which handles engine + UI reset.
  function commit() {
    if (typeof window.startLocalGame !== 'function') return;
    const isPre = !!window._pendingLocalGame;
    const gid = isPre ? window._pendingLocalGame : (window.localGameId || 'skyjo');
    const g = (window.GameCatalogue||[]).find(x => x.id === gid);
    const variants = variantsFor(g);
    window._localVariantPick = variants.length ? selectedVariantId(gid, variants) : null;
    if (isPre) {
      // Set the game id the start helper reads. setLocalPick is the
      // public setter exposed by 01-network-local.js.
      if (typeof window.setLocalPick === 'function') {
        window.setLocalPick(window._pendingLocalGame);
      }
      window._pendingLocalGame = null;
    }
    closeOverlay();
    closeScreen();
    window.startLocalGame();
  }

  // ─── Pre-game seat SCREEN ────────────────────────────────────────────
  /**
   * Open the dedicated pre-game seat screen for a game. Sets up the
   * defaults (1 human) and navigates to #seatScreen.
   */
  function openSeatScreen(gameId) {
    if (!gameId) return;
    window._pendingLocalGame = gameId;
    const myName = (window.Identity?.getName() || 'You').trim() || 'You';
    setSeats([{ name: myName, bot: false }]);
    renderScreen();
    if (typeof window.showScreen === 'function') window.showScreen('seatScreen');
  }
  function closeScreen() {
    window._pendingLocalGame = null;
  }

  function renderScreen() {
    const host = $('seatScreenBody');
    if (!host) return;
    const meta = gameMeta();
    if (!meta) {
      host.innerHTML = '<div class="muted">No game selected.</div>';
      return;
    }
    const list = seats();
    const min = meta.minPlayers || 2;
    const max = meta.maxPlayers || 8;
    const canAdd = list.length < max;
    const enoughPlayers = list.length >= min;
    const glyph = Kit.Icon.forGame(meta, { size: 36, cls: 'kit-icon-tile' });

    host.innerHTML = `
      <div class="seat-screen-head">
        <div class="seat-screen-glyph">${glyph}</div>
        <div>
          <div class="seat-screen-eyebrow">Local game</div>
          <h2 class="seat-screen-title">${esc(meta.name)}</h2>
          <div class="muted seat-screen-meta">${esc(meta.description || '')}</div>
        </div>
      </div>
      ${renderVariantPicker(meta)}
      <div class="seat-screen-rows">${renderRowsHtml(list, { canRemove: list.length > 1 })}</div>
      <div class="seat-screen-add-row">
        <button class="btn secondary" ${canAdd ? '' : 'disabled'} onclick="LocalSeatEditor.addHuman()">${Kit.Icon.html('plus', { size: 14, cls: 'kit-icon-inline' })}Player</button>
        <button class="btn secondary" ${canAdd ? '' : 'disabled'} onclick="LocalSeatEditor.addBot()">${Kit.Icon.html('robot', { size: 14, cls: 'kit-icon-inline' })}Bot</button>
      </div>
      <button class="btn green seat-screen-start" ${enoughPlayers ? '' : 'disabled'} onclick="LocalSeatEditor.commit()">
        ${Kit.Icon.html('play', { size: 16, cls: 'kit-icon-inline' })}Start${enoughPlayers ? '' : ` · need ${min - list.length} more`}
      </button>
      <div class="seat-screen-foot muted">${esc(meta.name)} plays with ${min}–${max} players.</div>
    `;
    wireRowHandlers(host);
  }

  // ─── In-game seat OVERLAY (modal popup) ──────────────────────────────
  function openOverlay() {
    const ov = $('seatOverlay');
    if (!ov) return;
    renderOverlay();
    ov.classList.remove('hidden');
    ov.setAttribute('aria-hidden', 'false');
  }
  function closeOverlay() {
    const ov = $('seatOverlay');
    if (!ov) return;
    ov.classList.add('hidden');
    ov.setAttribute('aria-hidden', 'true');
  }
  function toggleOverlay() {
    const ov = $('seatOverlay');
    if (!ov) return;
    ov.classList.contains('hidden') ? openOverlay() : closeOverlay();
  }
  function isOverlayOpen() {
    const ov = $('seatOverlay');
    return !!ov && !ov.classList.contains('hidden');
  }

  function renderOverlay() {
    const host = $('seatOverlayBody');
    if (!host) return;
    const meta = gameMeta();
    if (!meta) { host.innerHTML = ''; return; }
    const list = seats();
    const min = meta.minPlayers || 2;
    const max = meta.maxPlayers || 8;
    const canAdd = list.length < max;
    const enough = list.length >= min;

    host.innerHTML = `
      <div class="lse-head">
        <div class="lse-title">${Kit.Icon.html('users', { size: 16 })}<span>Seats</span> <span class="muted">${list.length}/${max}</span></div>
        <button class="icon-btn" onclick="LocalSeatEditor.closeOverlay()" title="Close — keep current seats">${Kit.Icon.html('x', { size: 16 })}</button>
      </div>
      ${renderVariantPicker(meta)}
      <div class="lse-seats">${renderRowsHtml(list, { canRemove: list.length > min })}</div>
      <div class="lse-actions">
        <button class="btn secondary" ${canAdd ? '' : 'disabled'} onclick="LocalSeatEditor.addHuman()">${Kit.Icon.html('plus', { size: 13, cls: 'kit-icon-inline' })}Player</button>
        <button class="btn secondary" ${canAdd ? '' : 'disabled'} onclick="LocalSeatEditor.addBot()">${Kit.Icon.html('robot', { size: 13, cls: 'kit-icon-inline' })}Bot</button>
        <button class="btn green" ${enough ? '' : 'disabled'} onclick="LocalSeatEditor.commit()">${Kit.Icon.html('play', { size: 13, cls: 'kit-icon-inline' })}Restart with these seats</button>
      </div>
      <div class="lse-hint muted">${esc(meta.name)} needs ${min}–${max} players · Close to keep playing with the current seats.</div>
    `;
    wireRowHandlers(host);
  }

  // ─── Shared row rendering + handler wiring ───────────────────────────
  function renderRowsHtml(list, { canRemove }) {
    return list.map((s, i) => {
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
  }
  function wireRowHandlers(host) {
    host.querySelectorAll('.seat-name-input').forEach((inp) => {
      inp.addEventListener('input', () => renameSeat(Number(inp.dataset.seat), inp.value));
    });
    host.querySelectorAll('.seat-remove').forEach((btn) => {
      btn.addEventListener('click', () => removeSeat(Number(btn.dataset.seat)));
    });
    host.querySelectorAll('.seat-diff button').forEach((btn) => {
      const seg = btn.parentElement;
      const i = Number(seg.dataset.seat);
      btn.addEventListener('click', () => changeDifficulty(i, btn.dataset.d));
    });
    host.querySelectorAll('.seat-variant button').forEach((btn) => {
      const seg = btn.parentElement;
      btn.addEventListener('click', () => setVariant(seg.dataset.game, btn.dataset.vid));
    });
  }

  // Re-render whichever surface is currently visible. Called after every
  // mutating action so the count, disabled-states, and difficulty
  // segments update in place.
  function renderAll() {
    if (window._pendingLocalGame) renderScreen();
    if (isOverlayOpen()) renderOverlay();
  }

  // ─── Topbar seats button visibility (in-game only) ───────────────────
  function refreshButton() {
    const btn = $('seatsBtn');
    if (!btn) return;
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
    if (!inLocalGame) closeOverlay();
  }

  function patchShowScreen() {
    if (typeof window.showScreen !== 'function' || window._lseShowScreenPatched) return;
    window._lseShowScreenPatched = true;
    const orig = window.showScreen;
    window.showScreen = function (id) {
      const r = orig.apply(this, arguments);
      refreshButton();
      // Render the pre-game seat screen whenever it becomes active
      // (covers reload + back-navigation cases).
      if (id === 'seatScreen' && window._pendingLocalGame) renderScreen();
      return r;
    };
    refreshButton();
  }

  // Public API: open* + close* + the row mutators (the rendered buttons
  // call these via onclick="LocalSeatEditor.…"). `toggle` is kept as an
  // alias for backwards-compat with the existing #seatsBtn onclick in
  // index.html.
  window.LocalSeatEditor = {
    openSeatScreen, closeScreen,
    openOverlay, closeOverlay, toggleOverlay,
    toggle: toggleOverlay, // alias used by the topbar #seatsBtn
    commit,
    addHuman, addBot, removeSeat, changeDifficulty, setVariant,
    renderAll, refreshButton,
    // Kept for back-compat with the in-game smoke that called .open()/.close()
    // directly. Both map to the overlay (the only in-game surface now).
    open: openOverlay, close: closeOverlay,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchShowScreen);
  } else {
    patchShowScreen();
  }
})();

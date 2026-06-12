/* identity-ui.js — renders the "You & Recent Players" panel on the main menu.
 *
 * Pure DOM. Reads from window.Identity (populated by 00-identity.js) and writes
 * back through it. Re-renders whenever the menu screen is shown or whenever a
 * recent encounter is added (we listen via the storage event for multi-tab
 * sync, and the panel is re-rendered every time showScreen('menuScreen') is
 * called via a tiny patch below).
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Read the stored elo map for a player. Identity exposes getElo(gameId)
  // (per-game), but for the panel we want the whole map at once — read from
  // localStorage directly so we don't have to expand the public API.
  function loadElo(_id) {
    try { return JSON.parse(localStorage.getItem('gh.identity') || '{}').elo || {}; }
    catch { return {}; }
  }

  function render() {
    const panel = $('identityPanel');
    if (!panel || !window.Identity) return;
    const me = window.Identity;
    const name = me.getName() || (typeof getPid === 'function' ? '' : '');
    const recents = me.getRecents();

    // Quick stats: total played, total wins
    let totalW = 0, totalL = 0;
    for (const r of recents) {
      if (!r.games) continue;
      for (const id of Object.keys(r.games)) { totalW += r.games[id].w || 0; totalL += r.games[id].l || 0; }
    }
    const winRate = (totalW + totalL > 0) ? Math.round((totalW / (totalW + totalL)) * 100) : null;

    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div style="flex:1">
          <div style="font-size:.72rem;color:var(--text-dim);font-weight:700;letter-spacing:.06em;text-transform:uppercase">You</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
            <input id="identityNameInput" class="input" style="margin:0;padding:8px 10px;font-size:.95rem;flex:1" placeholder="Your name" value="${esc(name)}" maxlength="32" autocomplete="off">
          </div>
        </div>
        <div style="text-align:right">
          <div title="Your shareable friend code" style="font-family:'SF Mono',Menlo,monospace;font-size:1.05rem;font-weight:900;letter-spacing:.06em;color:var(--accent)">${esc(me.friendCode)}</div>
          <button class="ghost-mini" onclick="window.Identity._copyFriend()" style="margin-top:2px;background:transparent;color:var(--text-dim);border:none;padding:2px 0;font-size:.72rem;cursor:pointer;font-weight:700">🔗 copy</button>
        </div>
      </div>
      ${winRate != null ? `<div style="font-size:.78rem;color:var(--text-dim);margin-bottom:10px">Tracked: <b style="color:var(--text)">${totalW}W–${totalL}L</b> (${winRate}%)</div>` : ''}
      ${(() => {
        // ELO chips (one per game we've played). Only render if at least one
        // game has a non-base rating.
        const elos = window.Identity?.getElo ? (loadElo(me) || {}) : {};
        const keys = Object.keys(elos).filter((k) => elos[k] != null && elos[k] !== 1200);
        if (!keys.length) return '';
        const cat = window.GameCatalogue || [];
        const cells = keys.map((id) => {
          const meta = cat.find((g) => g.id === id);
          const emoji = meta?.emoji || '🎲';
          const name = meta?.name || id;
          const rating = Math.round(elos[id]);
          return `<span class="elo-chip" title="${esc(name)} rating"><span style="opacity:.8;margin-right:4px">${esc(emoji)}</span><b>${rating}</b></span>`;
        }).join('');
        return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;align-items:center">
          <span style="font-size:.7rem;color:var(--text-dim);font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-right:4px">ELO</span>
          ${cells}
        </div>`;
      })()}
      <div style="font-size:.72rem;color:var(--text-dim);font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:8px">
        <span>Recent Players</span>
        ${recents.length ? `<button onclick="window.Identity._clearWithConfirm()" style="margin-left:auto;background:none;border:none;color:var(--text-dim);font-size:.7rem;cursor:pointer;font-weight:700">Clear</button>` : ''}
      </div>
      ${recents.length === 0
        ? `<div class="muted" style="font-size:.82rem;line-height:1.5">No-one yet. Play an online game and your room-mates show up here so you can invite them again with one tap.</div>`
        : `<div style="display:flex;flex-wrap:wrap;gap:6px">${recents.slice(0, 12).map((r) => `
            <div class="chip" title="${esc(me.summarizeRecent(r))}" style="display:inline-flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--border);padding:5px 8px;border-radius:999px;font-size:.78rem">
              <span style="font-weight:700">${esc(r.name)}</span>
              ${(() => {
                const s = me.summarizeRecent(r);
                return s ? `<span style="color:var(--text-dim);font-size:.7rem">${esc(s)}</span>` : '';
              })()}
              <button onclick="window.Identity._forget('${esc(r.pid)}')" style="background:none;border:none;color:var(--text-dim);font-weight:900;padding:0 2px;cursor:pointer;font-size:.85rem;line-height:1" title="Forget">×</button>
            </div>`).join('')}</div>`}
    `;

    const inp = $('identityNameInput');
    if (inp) {
      inp.addEventListener('input', () => {
        me.setName(inp.value);
        // Also push into the online setup field if present (so they stay in sync).
        const onlineName = $('onlineName');
        if (onlineName && !onlineName.value) onlineName.value = inp.value;
      });
    }
  }

  // Convenience methods used by the inline onclicks (kept out of the inline
  // handlers themselves so we never inject user input into HTML strings).
  window.Identity._copyFriend = function () {
    const code = window.Identity.friendCode;
    const toast = $('toast');
    const finish = (ok) => {
      if (!toast) return;
      toast.textContent = ok ? `🔗 ${code} copied` : 'Copy failed';
      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 1600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(() => finish(true), () => finish(false));
    } else finish(false);
  };
  window.Identity._clearWithConfirm = function () {
    if (confirm('Forget every recent player?')) {
      window.Identity.clearRecents();
      render();
    }
  };
  window.Identity._forget = function (pid) {
    window.Identity.forgetRecent(pid);
    render();
  };

  // Re-render on menu show. The hub's showScreen function is global; wrap it
  // once to fire a render whenever the menu becomes active. We delay binding
  // until DOMContentLoaded so showScreen is defined.
  function patchShowScreen() {
    if (typeof window.showScreen !== 'function' || window._identityPatched) return;
    window._identityPatched = true;
    const orig = window.showScreen;
    window.showScreen = function (id) {
      const r = orig.apply(this, arguments);
      if (id === 'menuScreen' || id === 'onlineSetup') render();
      return r;
    };
  }

  // Also keep multi-tab in sync.
  window.addEventListener('storage', (e) => { if (e.key === 'gh.identity') render(); });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { patchShowScreen(); render(); });
  } else {
    patchShowScreen(); render();
  }
})();

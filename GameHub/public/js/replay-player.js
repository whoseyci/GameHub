/* replay-player.js — client-side scrubber for /replay/<code>/<id> URLs.
 *
 * Architecture (why this is ~150 lines, not 1500):
 *   • The server captures a ReplayBundle = { initialState, actions[] } per game.
 *     Engines are deterministic (proved by tests/replay-determinism), so any
 *     client can perfectly reproduce frame N by applying actions[0..N] to a
 *     deep-cloned initialState.
 *   • The same game *render* code that runs in live play (GameShell.render +
 *     window.GameClients[id].render) is reused verbatim — we just feed it
 *     module.viewFor(state, -1) at each frame and inert the action callbacks.
 *   • The scrubber only needs to maintain ONE invariant: which frame are we on?
 *     Seeking backwards means rebuilding state from scratch (cheap: even a long
 *     game is <200 actions and each step is sub-ms).
 */

(function () {
  'use strict';

  // Replay viewers control no seats and are spectators by default.
  window._controlledSeats = [];
  // The hub's core.js initialises `mode='online'` — that's fine for replay; the
  // game renderers treat seat=-1 as "spectating", which inerts interactive bits.

  const $ = (id) => document.getElementById(id);

  // ─── URL parsing ─────────────────────────────────────────────────────
  // Two URL shapes are supported:
  //   /replay.html?room=ABC&id=ABC-3-xyz   (always works)
  //   /replay/<room>/<id>                  (pretty; needs SPA fallback)
  function parseReplayParams() {
    const u = new URL(location.href);
    const fromQuery = { room: u.searchParams.get('room'), id: u.searchParams.get('id') };
    if (fromQuery.room && fromQuery.id) return fromQuery;
    const m = u.pathname.match(/^\/replay\/([^/]+)\/([^/]+)\/?$/);
    if (m) return { room: decodeURIComponent(m[1]), id: decodeURIComponent(m[2]) };
    return null;
  }

  function showError(html) {
    const main = $('mainBoardsContainer');
    if (main) main.innerHTML = `<div class="replay-error"><h2>Couldn't load replay</h2>${html}</div>`;
    $('statusBar') && ($('statusBar').textContent = '');
  }

  function showLoader() {
    const main = $('mainBoardsContainer');
    if (main) {
      main.innerHTML = `
        <div class="replay-loader">
          <div><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
          <div style="margin-top:14px;font-size:.85rem">Fetching replay…</div>
        </div>`;
    }
  }

  // ─── Player state ────────────────────────────────────────────────────
  let bundle = null;          // ReplayBundle from /api/replay/...
  let gameModule = null;      // window.GameModules[bundle.gameId]
  let state = null;           // current rehydrated state at frame `cursor`
  let cursor = 0;             // # actions applied so far (0 = initial state)
  let playing = false;
  let frameDelayMs = 1000;
  let playTimer = null;

  // Rebuild state from scratch by deep-cloning initialState and replaying
  // actions[0..targetCursor]. The engines are fast enough that this is
  // imperceptible even on a multi-hundred-action game; doing it this way
  // means seeking backwards is trivially correct.
  function rebuildTo(target) {
    target = Math.max(0, Math.min(target, bundle.actions.length));
    const fresh = JSON.parse(JSON.stringify(bundle.initialState));
    for (let i = 0; i < target; i++) {
      applyOne(fresh, bundle.actions[i]);
    }
    state = fresh;
    cursor = target;
  }

  function applyOne(s, act) {
    // The server captures the synthetic '__tick__' action for game-driven ticks
    // (Skyjo/Flip 7 final-turn resolution etc). Replay reproduces them by calling
    // completeTick — which is the same path the live server takes.
    if (act && act.msg && act.msg.action === '__tick__') {
      if (gameModule.completeTick) {
        try { gameModule.completeTick(s); } catch (e) { console.warn('replay completeTick', e); }
      }
      return;
    }
    try {
      gameModule.applyAction(s, act.seat | 0, act.msg);
    } catch (e) {
      console.warn('replay applyAction failed', act, e);
    }
  }

  // Render the current frame using the same shell + per-game client renderer
  // the live UI uses. Spectator view (seat=-1) so interactive controls inert.
  function renderFrame() {
    if (!gameModule || !state) return;
    const view = gameModule.viewFor(state, -1);
    // Tag the view with explicit "replay viewer" hints some games might use.
    view._isReplay = true;
    view.yourSeat = -1;
    const client = window.GameClients?.[view.game];
    if (!client) {
      showError(`<p>No client renderer registered for game <code>${view.game}</code>.</p>`);
      return;
    }
    // GameShell is a script-scoped const in 00-core.js — visible from sibling
    // <script> tags' globals but NOT on `window`. Probe lexically first; fall
    // back to the per-game renderer if (unexpectedly) it isn't there.
    const shell = (typeof GameShell !== 'undefined') ? GameShell : null;
    if (shell?.render) {
      shell.render(view, client);
    } else {
      client.render(view, {});
    }
    updateScrubUI();
  }

  function updateScrubUI() {
    const total = bundle.actions.length;
    $('frameLabel').textContent = `${cursor} / ${total}`;
    $('replayScrub').max = String(total);
    $('replayScrub').value = String(cursor);
    const lastAct = cursor > 0 ? bundle.actions[cursor - 1] : null;
    if (lastAct) {
      const name = bundle.names[lastAct.seat] ?? (lastAct.seat === -1 ? '⏱ server' : `Seat ${lastAct.seat}`);
      const verb = lastAct.msg?.action ?? '(action)';
      $('actionLabel').textContent = `${name} → ${verb}`;
    } else {
      $('actionLabel').textContent = 'Initial deal';
    }
    $('playBtn').textContent = playing ? '⏸' : '▶';
    // Disable next/play at end
    const atEnd = cursor >= total;
    $('playBtn').disabled = atEnd && !playing;
  }

  // ─── Scrubber controls (window-scoped so the inline onclicks work) ───
  window.step = function step(delta) {
    pause();
    const target = cursor + delta;
    if (target < cursor) rebuildTo(target);
    else for (let i = cursor; i < target && i < bundle.actions.length; i++) {
      applyOne(state, bundle.actions[i]);
      cursor++;
    }
    renderFrame();
  };

  window.seekStart = function seekStart() { pause(); rebuildTo(0); renderFrame(); };
  window.seekEnd = function seekEnd() { pause(); rebuildTo(bundle.actions.length); renderFrame(); };

  window.togglePlay = function togglePlay() {
    if (playing) pause();
    else play();
  };

  function play() {
    if (cursor >= bundle.actions.length) rebuildTo(0); // restart if at end
    playing = true;
    updateScrubUI();
    tick();
  }
  function pause() {
    playing = false;
    if (playTimer) { clearTimeout(playTimer); playTimer = null; }
    updateScrubUI();
  }
  function tick() {
    if (!playing) return;
    if (cursor >= bundle.actions.length) { pause(); return; }
    applyOne(state, bundle.actions[cursor]);
    cursor++;
    renderFrame();
    playTimer = setTimeout(tick, frameDelayMs);
  }

  window.setSpeed = function setSpeed(ms) {
    frameDelayMs = Math.max(50, parseInt(ms, 10) || 1000);
  };

  // Manual scrub
  function onScrubInput(e) {
    pause();
    const target = parseInt(e.target.value, 10) || 0;
    rebuildTo(target);
    renderFrame();
  }

  window.copyShare = function copyShare() {
    const url = location.origin + `/replay.html?room=${encodeURIComponent(bundle.roomCode)}&id=${encodeURIComponent(bundle.id)}`;
    const finish = (ok) => {
      const t = $('toast');
      if (!t) return;
      t.textContent = ok ? '🔗 Link copied!' : 'Copy failed';
      t.className = 'toast replay-toast';
      t.classList.remove('hidden');
      setTimeout(() => t.classList.add('hidden'), 1800);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => finish(true), () => finish(false));
    } else {
      // Fallback for old browsers / non-secure contexts
      const ta = document.createElement('textarea');
      ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); finish(true); } catch { finish(false); }
      document.body.removeChild(ta);
    }
  };

  // Keyboard: ← → step, space play/pause, Home/End jump.
  document.addEventListener('keydown', (e) => {
    if (!bundle) return;
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); window.step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); window.step(-1); }
    else if (e.key === ' ') { e.preventDefault(); window.togglePlay(); }
    else if (e.key === 'Home') { e.preventDefault(); window.seekStart(); }
    else if (e.key === 'End') { e.preventDefault(); window.seekEnd(); }
  });

  // ─── Bootstrap ───────────────────────────────────────────────────────
  async function boot() {
    const params = parseReplayParams();
    if (!params) {
      showError(`<p>No replay specified. URL should be <code>/replay.html?room=CODE&amp;id=REPLAY_ID</code>.</p>`);
      return;
    }
    showLoader();
    let resp;
    try {
      resp = await fetch(`/api/replay/${encodeURIComponent(params.room)}/${encodeURIComponent(params.id)}`);
    } catch (err) {
      showError(`<p>Network error: ${String(err && err.message || err)}</p>`);
      return;
    }
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      showError(`<p>${resp.status} ${resp.statusText}${txt ? ` — ${txt}` : ''}</p><p style="margin-top:10px;color:var(--text-dim);font-size:.85rem">Replays expire when their room closes (≈10 min of inactivity).</p>`);
      return;
    }
    let data;
    try { data = await resp.json(); }
    catch { showError(`<p>Replay response wasn't valid JSON.</p>`); return; }
    if (!data || !data.gameId || !data.initialState || !Array.isArray(data.actions)) {
      showError(`<p>Replay payload is malformed (missing gameId / initialState / actions).</p>`);
      return;
    }

    bundle = data;
    gameModule = window.GameModules?.[bundle.gameId];
    if (!gameModule) {
      showError(`<p>This page doesn't know how to play game <code>${bundle.gameId}</code>. The client may be out of date.</p>`);
      return;
    }

    // Header
    const meta = window.GameCatalogue?.find?.((g) => g.id === bundle.gameId);
    const emoji = meta?.emoji || '🎮';
    const title = `${emoji} ${meta?.name || bundle.gameId}`;
    $('replayTitle').textContent = title;
    const live = !bundle.endedAt ? ' • LIVE' : '';
    const summary = bundle.finalSummary?.winners?.length
      ? ` • Winner: ${bundle.finalSummary.winners.map((s) => bundle.names[s]).join(', ')}`
      : '';
    $('replayMeta').textContent = `Room ${bundle.roomCode} • ${bundle.names.length} players • ${bundle.actions.length} actions${summary}${live}`;
    document.title = `${title} replay · Game Hub`;

    // Initial frame
    rebuildTo(0);
    renderFrame();
    $('replayControls').style.display = 'flex';
    $('replayScrub').addEventListener('input', onScrubInput);
  }

  // Wait for game modules to be on window (scripts above us are synchronous,
  // but be defensive in case load order ever changes).
  if (window.GameModules) boot();
  else window.addEventListener('load', boot);
})();

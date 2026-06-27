/* =====================================================================
   BugReport — in-game bug reports with activity log + screenshot.

   Client-side responsibilities:
     - keep a small activity ring buffer (actions, view changes, UI clicks, errors)
     - capture a best-effort DOM screenshot without external dependencies
     - collect reporter text in a modal
     - POST to /api/bug-report

   Security note: GitHub tokens never live in the browser. The Worker endpoint
   uses a server-side secret (GITHUB_ISSUE_TOKEN) to create the issue.
   ===================================================================== */
(function () {
  'use strict';

  const MAX_LOG = 160;
  const activity = [];
  let overlay = null;
  let patched = false;
  let lastScreenshotError = null;
  let lastScreenshotMeta = null;
  let screenshotFallbackUsed = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function nowIso() { return new Date().toISOString(); }
  function record(type, data) {
    try {
      activity.push({ t: nowIso(), type, data: safeClone(data) });
      if (activity.length > MAX_LOG) activity.splice(0, activity.length - MAX_LOG);
    } catch {}
  }
  function safeClone(value, max = 5000) {
    try {
      const seen = new WeakSet();
      const s = JSON.stringify(value, (k, v) => {
        if (typeof v === 'function') return '[function]';
        if (v && typeof v === 'object') {
          if (seen.has(v)) return '[circular]';
          seen.add(v);
        }
        return v;
      });
      return JSON.parse(s.length > max ? s.slice(0, max) + '…[truncated]' : s);
    } catch { return String(value).slice(0, max); }
  }
  function describeError(e) {
    if (!e) return { message: 'Unknown error' };
    if (e instanceof Error) return { message: e.message, stack: e.stack };
    if (e.type) return { message: `Event:${e.type}`, type: e.type };
    try { return { message: JSON.stringify(e).slice(0, 1000) }; }
    catch { return { message: String(e).slice(0, 1000) }; }
  }

  function viewportInfo() {
    return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1, scrollX, scrollY };
  }
  function cardLocationFromId(id) {
    if (!id) return null;
    let m = /^skyjo:table:r(\d+):p(\d+):c(\d+)/.exec(id);
    if (m) return { game: 'skyjo', round: Number(m[1]), seat: Number(m[2]), index: Number(m[3]) };
    m = /^flip7:table:p(\d+):(.+)/.exec(id);
    if (m) return { game: 'flip7', seat: Number(m[1]), key: m[2] };
    m = /^schotten:/.exec(id);
    if (m) return { game: 'schotten', id };
    return { id };
  }
  function elementSummary(el) {
    const out = {
      tag: el.tagName,
      id: el.id || undefined,
      cls: el.className && String(el.className).slice(0, 160),
      text: (el.textContent || el.title || el.getAttribute('aria-label') || '').trim().slice(0, 220),
      action: el.dataset && (el.dataset.action || el.dataset.g || el.dataset.vid || el.dataset.mode),
    };
    const card = el.closest && el.closest('.kc,.card-slot');
    if (card) {
      const reg = card.dataset?.cardReg || card.dataset?.cmId || card.closest('[data-card-reg]')?.dataset?.cardReg;
      out.card = {
        id: reg,
        location: cardLocationFromId(reg),
        value: card.dataset?.value || card.dataset?.act || undefined,
        kind: card.dataset?.kind || undefined,
        title: card.title || undefined,
        classes: String(card.className || '').slice(0, 180),
        text: (card.textContent || '').trim().slice(0, 120),
        data: safeClone(card.dataset || {}, 1600),
      };
    }
    const btn = el.closest && el.closest('button,[role="button"],[onclick]');
    if (btn && btn !== el) {
      out.control = {
        tag: btn.tagName,
        id: btn.id || undefined,
        text: (btn.textContent || btn.title || btn.getAttribute('aria-label') || '').trim().slice(0, 160),
        disabled: !!btn.disabled,
      };
    }
    return out;
  }

  window.addEventListener('error', (e) => record('error', { message: e.message, source: e.filename, line: e.lineno, col: e.colno }));
  window.addEventListener('unhandledrejection', (e) => record('unhandledrejection', { reason: String(e.reason && (e.reason.stack || e.reason.message || e.reason)) }));
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.bug-report-overlay')) return;
    const el = e.target.closest && e.target.closest('button,a,[role="button"],.game-tile,.landing-tile,.card-slot,.kc');
    if (!el) return;
    record('ui.click', elementSummary(el));
  }, true);

  function patchRuntime() {
    if (patched) return;
    patched = true;
    try {
      if (typeof GameActions !== 'undefined' && GameActions && !GameActions._bugPatched) {
        const oldSend = GameActions.send.bind(GameActions);
        GameActions.send = function (action, extra, seat) {
          record('game.action', { action, extra, seat, game: window._renderView && window._renderView.game });
          return oldSend(action, extra, seat);
        };
        GameActions._bugPatched = true;
      }
    } catch { patched = false; }
    try {
      if (typeof net !== 'undefined' && net && !net._bugPatched) {
        const oldNetSend = net.send.bind(net);
        net.send = function (msg) {
          record('net.send', msg);
          return oldNetSend(msg);
        };
        net._bugPatched = true;
      }
    } catch {}
    try {
      if (typeof dispatchView === 'function' && !dispatchView._bugPatched) {
        const oldDispatch = dispatchView;
        dispatchView = function (view) {
          record('view.dispatch', summarizeView(view));
          return oldDispatch.apply(this, arguments);
        };
        dispatchView._bugPatched = true;
      }
    } catch {}
  }
  setTimeout(patchRuntime, 0);
  setInterval(patchRuntime, 1500);

  function summarizeView(view) {
    if (!view) return null;
    const bag = view[view.game] || {};
    return {
      game: view.game,
      phase: view.phase,
      over: view.over,
      yourSeat: view.yourSeat,
      room: (typeof net !== 'undefined' && net && net.room) || null,
      state: view.state ? {
        currentSeat: view.state.currentSeat,
        pendingAction: view.state.pendingAction,
        actingCount: view.state.actingCount,
        players: (view.state.players || []).map(p => ({ seat: p.seat, name: p.name, status: p.status, score: p.score, banked: p.banked })),
        legal: Array.isArray(view.state.legal) ? view.state.legal.slice(0, 80) : undefined
      } : null,
      gameSummary: summarizeGameBag(view.game, bag),
    };
  }
  function summarizeGameBag(game, bag) {
    if (!bag) return null;
    if (game === 'skyjo') return { phase: bag.phase, currentPlayer: bag.currentPlayer, turnAction: bag.turnAction, variant: bag.variant, lastAction: bag.lastAction, deckCount: bag.deckCount, discardTop: bag.discardTop };
    if (game === 'flip7') return { phase: bag.phase, current: bag.current, variant: bag.variant, pendingAction: bag.pendingAction, deckCount: bag.deckCount, discardTop: bag.discardTop, seq: bag.seq, events: (bag.events || []).slice(-8) };
    if (game === 'qwixx') return { phase: bag.phase, activeSeat: bag.activeSeat, dice: bag.dice, pendingWhiteDecisions: bag.pendingWhiteDecisions };
    return safeClone(bag, 2200);
  }

  function stateSnapshot() {
    const snap = {
      url: location.href,
      build: (typeof BUILD_VERSION !== 'undefined') ? BUILD_VERSION : undefined,
      mode: (typeof mode !== 'undefined') ? mode : undefined,
      room: (typeof net !== 'undefined' && net) ? net.room : null,
      isHost: (typeof net !== 'undefined' && net) ? net.isHost : null,
      currentReplay: window._currentReplay || null,
      controlledSeats: window._controlledSeats || [],
      viewport: viewportInfo(),
      activeScreen: document.querySelector('.screen.active')?.id || null,
      currentLegalActions: Array.isArray(window._renderView?.state?.legal) ? window._renderView.state.legal.slice(0, 160) : [],
      currentView: summarizeView(window._renderView),
      localState: null,
    };
    try {
      if (typeof mode !== 'undefined' && mode === 'local' && typeof localEngine !== 'undefined' && localEngine && typeof localEngine._state === 'function') {
        snap.localState = safeClone(localEngine._state(), 16000);
      }
    } catch {}
    return snap;
  }

  async function captureScreenshot() {
    let stage = 'init';
    let svgLength = 0;
    try {
      screenshotFallbackUsed = false;
      lastScreenshotError = null;
      lastScreenshotMeta = { stage, viewport: viewportInfo(), fallbackUsed: false };
      stage = 'collect-css';
      const css = collectCss();
      stage = 'clone-dom';
      const body = document.body.cloneNode(true);
      body.querySelectorAll('script,.bug-report-overlay,.social-chat-panel,.social-react-bar').forEach(n => n.remove());
      body.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      const style = document.createElement('style');
      style.textContent = css + '\n*{animation:none!important;transition:none!important;}';
      body.prepend(style);
      const vw = Math.max(320, window.innerWidth);
      const vh = Math.max(240, window.innerHeight);
      stage = 'serialize-svg';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="0 0 ${vw} ${vh}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(body)}</foreignObject></svg>`;
      svgLength = svg.length;
      stage = 'load-foreignobject-image';
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      const img = await loadImage(url);
      URL.revokeObjectURL(url);
      stage = 'draw-canvas';
      const maxW = 720;
      const scale = Math.min(1, maxW / vw);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      stage = 'encode-jpeg';
      const out = canvas.toDataURL('image/jpeg', 0.48);
      lastScreenshotMeta = { stage: 'success', viewport: viewportInfo(), svgLength, outputLength: out.length, fallbackUsed: false };
      return out;
    } catch (e) {
      lastScreenshotError = { ...describeError(e), stage, viewport: viewportInfo(), svgLength };
      record('screenshot.error', lastScreenshotError);
      return fallbackScreenshot(lastScreenshotError);
    }
  }
  function collectCss() {
    let css = '';
    for (const sheet of Array.from(document.styleSheets)) {
      try { for (const rule of Array.from(sheet.cssRules || [])) css += rule.cssText + '\n'; }
      catch {}
    }
    return css.slice(0, 180000);
  }
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }
  function fallbackScreenshot(error) {
    try {
      screenshotFallbackUsed = true;
      lastScreenshotMeta = { ...(lastScreenshotMeta || {}), fallbackUsed: true, fallbackReason: error?.message || 'unknown error' };
      const snap = stateSnapshot();
      const dom = domSnapshot();
      const canvas = document.createElement('canvas');
      canvas.width = 900; canvas.height = 620;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#22c55e'; ctx.font = '700 26px system-ui, sans-serif'; ctx.fillText('GameHub Bug Report Snapshot', 32, 48);
      ctx.fillStyle = '#cbd5e1'; ctx.font = '16px ui-monospace, monospace';
      const lines = [
        `DOM screenshot unavailable: ${error?.message || 'unknown error'}`,
        `URL: ${snap.url}`,
        `Build: ${snap.build || 'unknown'}   Mode: ${snap.mode || 'unknown'}   Room: ${snap.room || '-'}`,
        `Game: ${snap.currentView?.game || '-'}   Phase: ${snap.currentView?.phase || '-'}   Seat: ${snap.currentView?.yourSeat ?? '-'}`,
        `Active screen: ${dom.activeScreen || '-'}`,
        '',
        'Visible text:',
        ...(dom.visibleText || '').split('\n').slice(0, 18),
        '',
        'Recent activity:',
        ...activity.slice(-10).map((a) => `${a.t.slice(11, 19)} ${a.type} ${JSON.stringify(a.data).slice(0, 90)}`),
      ];
      let y = 84;
      for (const line of lines) { ctx.fillText(String(line).slice(0, 108), 32, y); y += 22; if (y > 592) break; }
      return canvas.toDataURL('image/jpeg', 0.72);
    } catch {
      return null;
    }
  }
  function domSnapshot() {
    const active = document.querySelector('.screen.active');
    const top = document.querySelector('.game-topbar') || document.querySelector('.mode-header');
    const main = active || document.body;
    const visibleText = (main.innerText || document.body.innerText || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);
    const buttons = Array.from(document.querySelectorAll('button')).filter(isVisible).slice(0, 80).map((b) => ({
      id: b.id || undefined,
      text: (b.textContent || b.title || b.getAttribute('aria-label') || '').trim().slice(0, 120),
      disabled: !!b.disabled,
      classes: String(b.className || '').slice(0, 120),
    }));
    const cards = Array.from(document.querySelectorAll('.kc,.card-slot')).filter(isVisible).slice(0, 80).map((c) => ({
      text: (c.textContent || '').trim().slice(0, 60),
      classes: String(c.className || '').slice(0, 120),
      title: c.title || undefined,
      data: safeClone(c.dataset || {}, 1000),
    }));
    return {
      activeScreen: active?.id || null,
      bodyClasses: document.body.className,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 },
      scroll: { x: scrollX, y: scrollY },
      topbarText: (top?.textContent || '').trim().slice(0, 1000),
      visibleText,
      buttons,
      visibleCards: cards,
    };
  }
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function open() {
    close();
    overlay = document.createElement('div');
    overlay.className = 'bug-report-overlay';
    overlay.innerHTML = `
      <div class="bug-report-box" role="dialog" aria-modal="true" aria-labelledby="bugTitle">
        <div class="bug-report-head">
          <div><div class="eyebrow">Report a problem</div><h2 id="bugTitle">Send bug report to GitHub</h2></div>
          <button class="icon-btn bug-close" type="button" aria-label="Close">&times;</button>
        </div>
        <label>Short title<input id="bugSummary" class="input" maxlength="120" placeholder="e.g. Can't discard drawn Skyjo card"></label>
        <label>What happened?<textarea id="bugDetails" maxlength="2500" placeholder="Tell us what you expected, what happened, and anything you tried."></textarea></label>
        <label>Steps to reproduce<textarea id="bugSteps" maxlength="1800" placeholder="1. Start Skyjo Action\n2. Draw from deck\n3. Click discard…"></textarea></label>
        <label class="bug-inline"><input id="bugIncludeScreenshot" type="checkbox" checked> Include screenshot</label>
        <div class="bug-report-actions">
          <button class="btn secondary" type="button" id="bugCancel">Cancel</button>
          <button class="btn green" type="button" id="bugSubmit">Create GitHub issue</button>
        </div>
        <div id="bugStatus" class="bug-status muted">Activity log and current game state will be included automatically.</div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.bug-close').onclick = close;
    overlay.querySelector('#bugCancel').onclick = close;
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#bugSubmit').onclick = submit;
    setTimeout(() => overlay.querySelector('#bugSummary')?.focus(), 40);
  }
  function close() { if (overlay) { overlay.remove(); overlay = null; } }
  async function submit() {
    const status = overlay.querySelector('#bugStatus');
    const submitBtn = overlay.querySelector('#bugSubmit');
    const summary = overlay.querySelector('#bugSummary').value.trim();
    if (!summary) { status.textContent = 'Please add a short title.'; return; }
    submitBtn.disabled = true;
    status.textContent = 'Capturing screenshot and activity log…';
    const includeScreenshot = overlay.querySelector('#bugIncludeScreenshot').checked;
    const report = {
      summary,
      details: overlay.querySelector('#bugDetails').value.trim(),
      steps: overlay.querySelector('#bugSteps').value.trim(),
      screenshot: includeScreenshot ? await captureScreenshot() : null,
      screenshotError: lastScreenshotError,
      screenshotMeta: lastScreenshotMeta,
      screenshotFallbackUsed,
      activity: activity.slice(-MAX_LOG),
      snapshot: stateSnapshot(),
      domSnapshot: domSnapshot(),
      userAgent: navigator.userAgent,
      createdAt: nowIso(),
    };
    status.textContent = 'Creating GitHub issue…';
    try {
      const res = await fetch('/api/bug-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(report),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.message || `Bug report failed (${res.status})`);
      status.innerHTML = `Created issue: <a href="${esc(json.url)}" target="_blank" rel="noopener">${esc(json.url)}</a>`;
      setTimeout(close, 2600);
    } catch (e) {
      status.textContent = e.message || 'Could not create issue. Downloading local report instead.';
      downloadReport(report);
      submitBtn.disabled = false;
    }
  }
  function downloadReport(report) {
    try {
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `gamehub-bug-report-${Date.now()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch {}
  }

  window.BugReport = { open, close, record, activity: () => activity.slice(), captureScreenshot, stateSnapshot, domSnapshot };
  record('boot', { url: location.href, build: (typeof BUILD_VERSION !== 'undefined') ? BUILD_VERSION : undefined });
})();

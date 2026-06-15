/* =====================================================================
   Social — room chat + animated reaction emojis (online play).

   Cheap, high-ratio social layer that rides the EXISTING WebSocket: a chat
   message or reaction is one tiny broadcast (messages over an open socket don't
   each cost a Worker request, and per-message CPU is microscopic — see
   docs/FEATURE_FEASIBILITY.md). The server (src/server.ts) fans out `chat` /
   `react` to the room; this module renders the chat panel, the reaction bar, and
   the floating-emoji FX.

   Wiring: handleNet() in 01-network-local.js calls Social.handleNet(m) for
   social message types; the topbar buttons call Social.toggleChat() /
   Social.toggleReactions(); Social.setActive(on) shows/hides the buttons (online
   games only — pass-and-play is one device).

   Public API:
     Social.handleNet(m)      // returns true if it consumed the message
     Social.toggleChat()
     Social.toggleReactions()
     Social.sendReaction(emoji)
     Social.setActive(online) // show/hide the buttons for the current screen
     Social.reset()           // clear on leaving a room
   ===================================================================== */
(function () {
  'use strict';

  const REACTIONS = ['👍', '😂', '🎉', '😮', '😢', '🔥', '❤️', '🤔', '👏', '🤯', '😎', '🍀'];
  const MAX_RENDERED = 120;        // cap chat DOM nodes
  const SEND_COOLDOWN = 600;       // ms between reactions (client-side anti-spam)

  let panelEl = null, listEl = null, inputEl = null, barEl = null;
  let chatOpen = false, barOpen = false, unread = 0;
  let lastReactAt = 0;
  const SEAT_COLORS = ['#7c5cff', '#22c55e', '#f59e0b', '#ec4899', '#38bdf8', '#a855f7', '#ef4444', '#14b8a6'];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function seatColor(seat) { return seat >= 0 ? SEAT_COLORS[seat % SEAT_COLORS.length] : '#94a3b8'; }

  // ── Build the chat panel + reaction bar lazily (once). ──────────────
  function ensureUi() {
    if (panelEl) return;
    panelEl = document.createElement('div');
    panelEl.className = 'social-chat-panel';
    panelEl.innerHTML =
      '<div class="social-chat-head"><span>Chat</span>' +
      '<button class="social-chat-close" title="Close" aria-label="Close chat">&times;</button></div>' +
      '<div class="social-chat-list" role="log" aria-live="polite"></div>' +
      '<form class="social-chat-form">' +
      '<input class="social-chat-input" type="text" maxlength="240" placeholder="Say something…" autocomplete="off">' +
      '<button class="social-chat-send" type="submit" aria-label="Send">Send</button>' +
      '</form>';
    document.body.appendChild(panelEl);
    listEl = panelEl.querySelector('.social-chat-list');
    inputEl = panelEl.querySelector('.social-chat-input');
    panelEl.querySelector('.social-chat-close').onclick = () => toggleChat(false);
    panelEl.querySelector('.social-chat-form').onsubmit = (e) => { e.preventDefault(); sendChat(); };

    barEl = document.createElement('div');
    barEl.className = 'social-react-bar';
    barEl.innerHTML = REACTIONS.map((e) => `<button class="social-react-btn" type="button" data-emoji="${e}">${e}</button>`).join('');
    document.body.appendChild(barEl);
    barEl.querySelectorAll('.social-react-btn').forEach((b) => {
      b.onclick = () => { sendReaction(b.dataset.emoji); flashBtn(b); };
    });
  }

  function flashBtn(b) { b.classList.add('pop'); setTimeout(() => b.classList.remove('pop'), 260); }

  // ── Send ────────────────────────────────────────────────────────────
  function speakingPid() {
    // In pass-and-play-over-online a device controls several seats; default to
    // the primary controlled pid so the server attributes the author. The
    // global getPid() is the device's primary identity.
    try { return (typeof getPid === 'function') ? getPid() : undefined; } catch { return undefined; }
  }
  function netSend(o) {
    if (typeof net !== 'undefined' && net && net.send) { net.send(o); return true; }
    return false;
  }
  function sendChat() {
    const text = (inputEl.value || '').trim();
    if (!text) return;
    if (netSend({ type: 'chat', text, pid: speakingPid() })) {
      inputEl.value = '';
    }
  }
  function sendReaction(emoji) {
    const now = Date.now();
    if (now - lastReactAt < SEND_COOLDOWN) return;   // anti-spam
    lastReactAt = now;
    netSend({ type: 'react', emoji, pid: speakingPid() });
    // Optimistic local FX so the sender sees instant feedback even before the
    // broadcast round-trips.
    floatReaction(emoji);
  }

  // ── Receive ─────────────────────────────────────────────────────────
  function handleNet(m) {
    if (!m || !m.type) return false;
    if (m.type === 'hello') {
      if (Array.isArray(m.chat) && m.chat.length) { ensureUi(); m.chat.forEach((c) => addChat(c, true)); }
      return false;   // hello is also consumed elsewhere; don't swallow it
    }
    if (m.type === 'chat') { ensureUi(); addChat(m, false); return true; }
    if (m.type === 'react') { floatReaction(m.emoji, m.name, m.seat); return true; }
    return false;
  }

  function addChat(c, silent) {
    ensureUi();
    const row = document.createElement('div');
    row.className = 'social-chat-msg';
    const time = c.ts ? new Date(c.ts) : new Date();
    const hh = String(time.getHours()).padStart(2, '0'), mm = String(time.getMinutes()).padStart(2, '0');
    row.innerHTML =
      `<span class="social-chat-author" style="color:${seatColor(c.seat)}">${esc(c.name || 'Player')}</span>` +
      `<span class="social-chat-text">${esc(c.text)}</span>` +
      `<span class="social-chat-time">${hh}:${mm}</span>`;
    listEl.appendChild(row);
    while (listEl.children.length > MAX_RENDERED) listEl.removeChild(listEl.firstChild);
    listEl.scrollTop = listEl.scrollHeight;
    if (!silent && !chatOpen) {
      unread++; updateBadge();
      if (typeof SFX !== 'undefined' && SFX.tap) SFX.tap();
      // Brief on-screen "peek" so players notice a message without opening chat.
      showPeek(c);
    }
  }

  // A small toast that previews a new chat message and opens chat when tapped.
  function showPeek(c) {
    if (document.getElementById('reactBtn') && document.getElementById('reactBtn').classList.contains('hidden')) return; // social off
    const old = document.querySelector('.social-chat-peek');
    if (old) old.remove();
    const peek = document.createElement('div');
    peek.className = 'social-chat-peek';
    peek.innerHTML = `<b style="color:${seatColor(c.seat)}">${esc(c.name || 'Player')}</b><span>${esc(c.text)}</span>`;
    peek.onclick = () => { peek.remove(); toggleChat(true); };
    document.body.appendChild(peek);
    setTimeout(() => peek.remove(), 3200);
  }

  function updateBadge() {
    const btn = $('chatBtn');
    if (!btn) return;
    let dot = btn.querySelector('.social-unread');
    if (unread > 0) {
      if (!dot) { dot = document.createElement('span'); dot.className = 'social-unread'; btn.appendChild(dot); }
      dot.textContent = unread > 9 ? '9+' : String(unread);
    } else if (dot) { dot.remove(); }
  }

  // ── Animated CHARACTER emote (Clash-Royale style) ───────────────────
  // A little mascot slides up from the bottom, squash-bounces with a speech
  // bubble holding the emoji, then ducks back down. Far more alive than a
  // floating glyph. Pure inline SVG — themeable, no assets.
  // A small palette so successive emotes / different players get varied mascots.
  const MASCOT_COLORS = [
    { body: '#7c5cff', belly: '#b9a8ff', dark: '#5b3fd6' },
    { body: '#22c55e', belly: '#9ff0bf', dark: '#15803d' },
    { body: '#f59e0b', belly: '#fcd884', dark: '#b45309' },
    { body: '#ec4899', belly: '#f9b6d6', dark: '#be185d' },
    { body: '#38bdf8', belly: '#bae6fd', dark: '#0369a1' },
    { body: '#a855f7', belly: '#e2c7fd', dark: '#7e22ce' },
  ];

  function mascotSvg(c, seat) {
    const pal = MASCOT_COLORS[(seat >= 0 ? seat : (Math.random() * MASCOT_COLORS.length) | 0) % MASCOT_COLORS.length];
    return (
      '<svg class="emote-mascot" viewBox="0 0 100 110" width="84" height="92" aria-hidden="true">' +
      // shadow
      '<ellipse class="emote-shadow" cx="50" cy="104" rx="26" ry="6" fill="rgba(0,0,0,.35)"/>' +
      // ears
      `<circle cx="28" cy="34" r="11" fill="${pal.body}"/><circle cx="72" cy="34" r="11" fill="${pal.body}"/>` +
      `<circle cx="28" cy="34" r="5" fill="${pal.dark}"/><circle cx="72" cy="34" r="5" fill="${pal.dark}"/>` +
      // body
      `<ellipse cx="50" cy="62" rx="34" ry="36" fill="${pal.body}"/>` +
      `<ellipse cx="50" cy="70" rx="22" ry="22" fill="${pal.belly}"/>` +
      // eyes
      '<circle cx="40" cy="54" r="6" fill="#fff"/><circle cx="60" cy="54" r="6" fill="#fff"/>' +
      '<circle class="emote-pupil" cx="41" cy="55" r="3" fill="#1e293b"/>' +
      '<circle class="emote-pupil" cx="61" cy="55" r="3" fill="#1e293b"/>' +
      // cheeks + smile
      `<circle cx="32" cy="64" r="4" fill="${pal.dark}" opacity=".35"/>` +
      `<circle cx="68" cy="64" r="4" fill="${pal.dark}" opacity=".35"/>` +
      `<path d="M42 66 Q50 73 58 66" stroke="${pal.dark}" stroke-width="2.6" fill="none" stroke-linecap="round"/>` +
      '</svg>'
    );
  }

  function floatReaction(emoji, who, seat) {
    if (!emoji) return;
    const layer = $('reactionFxLayer');
    if (!layer) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const el = document.createElement('div');
    el.className = 'emote-actor' + (reduce ? ' reduced' : '');
    // Spread mascots across the lower band so multiple emotes don't stack.
    const x = 12 + Math.random() * 66;     // vw %
    el.style.left = x + '%';
    el.style.setProperty('--rise', (8 + Math.random() * 6) + 'vh');   // varied hop height
    el.innerHTML =
      '<div class="emote-bubble"><span class="emote-glyph">' + emoji + '</span>' +
      '<i class="emote-bubble-tail"></i></div>' +
      mascotSvg(emoji, seat == null ? -1 : seat) +
      (who ? '<span class="emote-who">' + esc(who) + '</span>' : '');
    layer.appendChild(el);

    if (typeof SFX !== 'undefined' && SFX.tap) SFX.tap();
    setTimeout(() => el.remove(), reduce ? 1100 : 2400);
  }

  // ── Toggles + visibility ────────────────────────────────────────────
  function toggleChat(force) {
    ensureUi();
    chatOpen = (force == null) ? !chatOpen : !!force;
    panelEl.classList.toggle('open', chatOpen);
    $('chatBtn') && $('chatBtn').classList.toggle('on', chatOpen);
    if (chatOpen) { unread = 0; updateBadge(); setTimeout(() => inputEl && inputEl.focus(), 60); if (barOpen) toggleReactions(false); }
  }
  function toggleReactions(force) {
    ensureUi();
    barOpen = (force == null) ? !barOpen : !!force;
    barEl.classList.toggle('open', barOpen);
    $('reactBtn') && $('reactBtn').classList.toggle('on', barOpen);
  }

  // Show the buttons only for ONLINE games (pass-and-play is a single device).
  function setActive(online) {
    const cb = $('chatBtn'), rb = $('reactBtn');
    if (cb) cb.classList.toggle('hidden', !online);
    if (rb) rb.classList.toggle('hidden', !online);
    if (!online) { toggleChat(false); toggleReactions(false); }
  }

  function reset() {
    unread = 0; updateBadge();
    if (listEl) listEl.innerHTML = '';
    toggleChat(false); toggleReactions(false);
  }

  // Fire a local character emote without sending it over the wire — used by
  // local bots (and any client-side "celebrate" moment). Online bots emote via
  // the normal broadcast on the host.
  function emote(emoji, who, seat) { floatReaction(emoji, who, seat == null ? -1 : seat); }

  window.Social = { handleNet, toggleChat, toggleReactions, sendReaction, emote, setActive, reset, REACTIONS };
})();

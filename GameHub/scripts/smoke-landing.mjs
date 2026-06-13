// scripts/smoke-landing.mjs — boots index.html in JSDOM and verifies the
// landing's instant-play tiles render and "Play vs Bot" actually starts a
// local game (drives the existing local-play pipeline, which smoke-client
// already exercises in isolation).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const root = process.cwd();
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function installBrowserStubs(window) {
  window.innerWidth = 1280; window.innerHeight = 800;
  window.scrollTo = () => {};
  window.matchMedia = () => ({ matches:false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, dispatchEvent(){return false} });
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  window.confirm = () => true; window.alert = () => {};
  window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
  class FOsc{constructor(){this.frequency={setValueAtTime(){},exponentialRampToValueAtTime(){}}}connect(){}start(){}stop(){}}
  class FGain{constructor(){this.gain={value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}}}connect(){}}
  class FCtx{constructor(){this.currentTime=0;this.state='running';this.destination={}}createGain(){return new FGain()}createOscillator(){return new FOsc()}resume(){return Promise.resolve()}}
  window.AudioContext = FCtx; window.webkitAudioContext = FCtx;
  // No real WebSocket — landing tries to open one for the live counter; stub
  // so it doesn't throw, and stays in CONNECTING forever (no messages).
  class FWS{constructor(url){this.url=url;this.readyState=0;}send(){}close(){this.readyState=3}}
  FWS.OPEN = 1;
  window.WebSocket = FWS;
  window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect(){},save(){},translate(){},rotate(){},fillRect(){},restore(){},
    beginPath(){},closePath(){},fill(){},stroke(){},moveTo(){},lineTo(){},
    set fillStyle(_){},get fillStyle(){return '#000'},
  });
  function dims(el){
    const c=String(el.className||'');
    if(c.includes('board-card')||c.includes('card-slot'))return {width:72,height:102};
    if(c.includes('f7-card'))return {width:52,height:74};
    return {width:180,height:60};
  }
  function rect(el){const {width,height}=dims(el);return {x:0,y:0,left:0,top:0,width,height,right:width,bottom:height,toJSON(){return this}};}
  Object.defineProperty(window.HTMLElement.prototype,'clientWidth',{get(){return dims(this).width}});
  Object.defineProperty(window.HTMLElement.prototype,'clientHeight',{get(){return dims(this).height}});
  Object.defineProperty(window.HTMLElement.prototype,'offsetWidth',{get(){return dims(this).width}});
  Object.defineProperty(window.HTMLElement.prototype,'offsetHeight',{get(){return dims(this).height}});
  window.HTMLElement.prototype.getBoundingClientRect = function(){return rect(this)};
}

async function run() {
  const htmlPath = join(root, 'public', 'index.html');
  const html = readFileSync(htmlPath, 'utf8');
  const scriptSrcs = [...html.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)].map((m) => m[1]);
  const htmlWithoutScripts = html.replace(/<script\s+src="[^"]+"\s*><\/script>/g, '');

  const dom = new JSDOM(htmlWithoutScripts, {
    url: 'https://gamehub.test/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  installBrowserStubs(window);

  const errors = [];
  window.addEventListener('error', (e) => errors.push(`window error: ${e.error?.stack || e.message}`));
  window.addEventListener('unhandledrejection', (e) => errors.push(`unhandled rejection: ${e.reason?.stack || e.reason}`));

  for (const src of scriptSrcs) {
    if (!src.startsWith('/')) throw new Error(`unexpected script src ${src}`);
    const code = readFileSync(join(root, 'public', src.slice(1)), 'utf8');
    const s = window.document.createElement('script');
    s.textContent = code;
    window.document.body.appendChild(s);
  }
  // The DOMContentLoaded path some scripts use never fires for synthetic
  // append, but they also have a fallback that runs immediately if the
  // document is already parsed. Tick once to settle.
  await sleep(40);

  // ── Landing tiles ──
  const tilesEl = window.document.getElementById('landingGameTiles');
  assert(tilesEl, 'landingGameTiles container is missing');
  const tiles = tilesEl.querySelectorAll('.landing-tile');
  assert(tiles.length >= 4, `expected ≥4 landing tiles, got ${tiles.length}`);
  for (const t of tiles) {
    assert(t.querySelector('.lt-title')?.textContent?.trim(), 'tile missing title');
    // Phase 3: tile itself is the button; rules helper is a `?` badge.
    assert(t.tagName === 'BUTTON', `tile is not a <button>: ${t.tagName}`);
    assert(t.hasAttribute('data-game'), 'tile missing data-game');
    assert(t.querySelector('[data-rules-for]'), 'tile missing rules helper "?"');
    assert(t.querySelector('.lt-cta'), 'tile missing CTA chip');
  }

  // ── Identity panel ──
  const idPanel = window.document.getElementById('identityPanel');
  assert(idPanel && idPanel.children.length > 0, 'identityPanel did not render');
  assert(idPanel.textContent.includes('Recent Players'), 'identity panel missing "Recent Players" header');

  // ── Live stats element ──
  const stats = window.document.getElementById('landingStatLive');
  assert(stats, 'landingStatLive missing');
  assert(stats.textContent && stats.textContent.length > 0, 'landingStatLive empty');

  // ── UX redesign Phase 1: mode header ──
  // Header is mounted, default mode is local (button has .on), and the
  // body does NOT yet have the in-game class.
  const modeHeader = window.document.getElementById('modeHeader');
  assert(modeHeader, '#modeHeader missing');
  assert(!modeHeader.classList.contains('hidden'), 'mode header is hidden on landing');
  const localBtn = window.document.getElementById('modeBtnLocal');
  const onlineBtn = window.document.getElementById('modeBtnOnline');
  assert(localBtn?.classList.contains('on'), 'mode toggle: Local should be default-on');
  assert(!onlineBtn?.classList.contains('on'), 'mode toggle: Online should be off by default');
  assert(!window.document.body.classList.contains('in-game'), 'body.in-game set on landing');

  // ── UX redesign Phase 2: OnlineSession lifecycle ──
  // The lobby WebSocket must NOT be opened on landing load in Local mode.
  // (In the test harness window.WebSocket is a stub that never connects,
  // but we can count instantiations via a side-channel.)
  assert(window.OnlineSession, 'window.OnlineSession missing');
  const sessionBefore = window.OnlineSession.state();
  assert(sessionBefore.lobby === 'closed', 'lobby socket opened in Local mode (should be closed)');

  // Flipping mode → online updates buttons + persists.
  window.Mode.set('online');
  assert(onlineBtn.classList.contains('on'), 'flipping to Online did not paint the button');
  assert(!localBtn.classList.contains('on'), 'Local stayed on after switch to Online');
  assert(window.localStorage.getItem('gh.mode') === 'online', 'mode did not persist');
  // Give OnlineSession a microtask to probe + open.
  await sleep(40);
  const sessionAfter = window.OnlineSession.state();
  // In JSDOM the fetch probe returns 404+text/html, so the socket stays
  // closed (which is the correct behaviour — no PartyServer detected).
  // What we're really verifying: flipping to Online TRIGGERS the probe
  // path (no exception). The full "opens an actual socket" verification
  // happens in the browser smoke / production.
  assert(['closed', 'connecting'].includes(sessionAfter.lobby),
    `unexpected lobby state after Mode→online: ${sessionAfter.lobby}`);

  window.Mode.set('local'); // reset for the rest of the smoke

  // Group picker opens / closes via the API.
  const picker = window.document.getElementById('groupPicker');
  assert(picker, 'groupPicker missing');
  assert(picker.classList.contains('hidden'), 'groupPicker should start hidden');
  window.GroupPicker.open();
  assert(!picker.classList.contains('hidden'), 'GroupPicker.open did not show');
  window.GroupPicker.close();
  assert(picker.classList.contains('hidden'), 'GroupPicker.close did not hide');

  // ── Phase 3: clicking a tile in Local mode starts a vs-bot game ──
  // (Mode is already set back to 'local' above.) The tile itself is the
  // button; clicking anywhere on it (except the "?" badge) triggers the
  // mode-aware action.
  const firstTile = tilesEl.querySelector('.landing-tile[data-game]');
  assert(firstTile, 'no landing-tile to click');
  // Confirm the CTA shows "vs Bot" in Local mode.
  const cta = firstTile.querySelector('.lt-cta');
  assert(cta && /vs Bot/i.test(cta.textContent || ''), `Local-mode CTA should say "vs Bot" (got "${cta?.textContent}")`);
  firstTile.click();
  await sleep(40);
  const gameScreen = window.document.getElementById('gameScreen');
  assert(gameScreen?.classList.contains('active'), 'gameScreen did not activate after tile click');
  // After entering the game, mode header hides and body gets .in-game.
  assert(window.document.body.classList.contains('in-game'), 'body.in-game not set after entering game screen');
  assert(modeHeader.classList.contains('hidden'), 'mode header still visible inside the game');

  // ── Phase 6: seats button visible in local mode (drawer hidden by default) ──
  const seatsBtn = window.document.getElementById('seatsBtn');
  const seatEditor = window.document.getElementById('localSeatEditor');
  assert(seatsBtn, '#seatsBtn missing');
  assert(seatEditor, '#localSeatEditor missing');
  assert(!seatsBtn.classList.contains('hidden'), 'seats button should be visible in local game');
  assert(seatEditor.classList.contains('hidden'), 'seat editor drawer should start hidden');
  // Toggle: opens, renders rows, closes.
  window.LocalSeatEditor.toggle();
  assert(!seatEditor.classList.contains('hidden'), 'seat editor did not open on toggle');
  const seatRows = seatEditor.querySelectorAll('.seat-row');
  assert(seatRows.length >= 2, `expected ≥2 seat rows in editor, got ${seatRows.length}`);
  // At least one row should be a bot (instantBotPlay adds you + bots).
  assert(seatEditor.querySelector('.seat-row.is-bot'), 'expected at least one bot seat row');
  window.LocalSeatEditor.close();
  assert(seatEditor.classList.contains('hidden'), 'seat editor did not close');

  if (errors.length) throw new Error(`Errors during landing smoke:\n${errors.join('\n')}`);
  console.log(`Landing smoke OK: ${tiles.length} tiles · instant-bot start works · identity panel rendered · mode header behaves`);
}

await run();

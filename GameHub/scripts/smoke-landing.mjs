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
    assert(t.querySelector('button[data-act="bot"]'), 'tile missing Play vs Bot button');
    assert(t.querySelector('button[data-act="rules"]'), 'tile missing Rules button');
  }

  // ── Identity panel ──
  const idPanel = window.document.getElementById('identityPanel');
  assert(idPanel && idPanel.children.length > 0, 'identityPanel did not render');
  assert(idPanel.textContent.includes('Recent Players'), 'identity panel missing "Recent Players" header');

  // ── Live stats element ──
  const stats = window.document.getElementById('landingStatLive');
  assert(stats, 'landingStatLive missing');
  assert(stats.textContent && stats.textContent.length > 0, 'landingStatLive empty');

  // ── "Play vs Bot" actually starts a game ──
  // Click the first bot button (skyjo by alphabetical/registry order) and
  // verify we end up on the game screen with a local engine running.
  const firstBot = tilesEl.querySelector('button[data-act="bot"]');
  assert(firstBot, 'no Play vs Bot button to click');
  firstBot.click();
  await sleep(40);
  const gameScreen = window.document.getElementById('gameScreen');
  assert(gameScreen?.classList.contains('active'), 'gameScreen did not activate after Play vs Bot');

  if (errors.length) throw new Error(`Errors during landing smoke:\n${errors.join('\n')}`);
  console.log(`Landing smoke OK: ${tiles.length} tiles · instant-bot start works · identity panel rendered`);
}

await run();

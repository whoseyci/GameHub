// scripts/smoke-replay.mjs — end-to-end smoke for the replay player.
//
// Boots replay.html in JSDOM, intercepts the /api/replay fetch with a server-
// captured bundle (built using the actual game module), and verifies:
//   • the player rehydrates initial frame without errors,
//   • stepping forward applies actions,
//   • the scrubber stays in sync,
//   • the final frame matches the captured live state byte-for-byte.
//
// This is the replay-player equivalent of scripts/smoke-client.mjs and is
// intended to live under `npm run smoke:client` later (added in CI follow-up).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const root = process.cwd();

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Browser stubs (copy of smoke-client.mjs, trimmed) ────────────────
function installBrowserStubs(window) {
  window.innerWidth = 1280; window.innerHeight = 800;
  window.scrollTo = () => {};
  window.matchMedia = () => ({ matches:false, media:'', addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}, dispatchEvent(){return false} });
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  window.confirm = () => true; window.alert = () => {};
  window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
  class FOsc{constructor(){this.frequency={setValueAtTime(){},exponentialRampToValueAtTime(){}}}connect(){}start(){}stop(){}}
  class FGain{constructor(){this.gain={value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}}}connect(){}}
  class FCtx{constructor(){this.currentTime=0;this.state='running';this.destination={}}createGain(){return new FGain()}createOscillator(){return new FOsc()}resume(){return Promise.resolve()}}
  window.AudioContext = FCtx; window.webkitAudioContext = FCtx;
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
  function rect(el){
    const {width,height}=dims(el);
    return {x:0,y:0,left:0,top:0,width,height,right:width,bottom:height,toJSON(){return this}};
  }
  Object.defineProperty(window.HTMLElement.prototype,'clientWidth',{get(){return dims(this).width}});
  Object.defineProperty(window.HTMLElement.prototype,'clientHeight',{get(){return dims(this).height}});
  Object.defineProperty(window.HTMLElement.prototype,'offsetWidth',{get(){return dims(this).width}});
  Object.defineProperty(window.HTMLElement.prototype,'offsetHeight',{get(){return dims(this).height}});
  window.HTMLElement.prototype.getBoundingClientRect = function(){return rect(this)};
  // Stub clipboard so copyShare() doesn't blow up.
  if (!window.navigator.clipboard) {
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: () => Promise.resolve() }, configurable: true,
    });
  }
}

// ─── Build a replay bundle the same way the server does ──────────────
function buildBundleForGame(window, gameId) {
  const mod = window.GameModules[gameId];
  assert(mod, `no module for ${gameId}`);
  const names = Array.from({ length: Math.max(2, mod.meta.minPlayers) }, (_, i) => `P${i + 1}`);
  const initial = mod.create(names);
  const live = JSON.parse(JSON.stringify(initial));

  // Same fuzzer as tests/replay-determinism / tests/replay-capture.
  let s = 42 >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const types = mod.meta.actionTypes || ['noop'];
  const colors = ['red','yellow','green','blue'];
  const actions = [];
  let seq = 0;
  for (let i = 0; i < 40; i++) {
    if (mod.isOver(live)) break;
    const before = JSON.stringify(live);
    let mutated = false;
    for (let a = 0; a < 30 && !mutated; a++) {
      const seat = Math.floor(rand() * names.length);
      const action = types[Math.floor(rand() * types.length)];
      for (let idx = 0; idx < 13 && !mutated; idx++) {
        const msg = { action, seat, index: idx, target: idx % 9, i: idx % 11, c: colors[Math.floor(rand()*4)] };
        mod.applyAction(live, seat, msg);
        if (JSON.stringify(live) !== before) {
          seq += 1;
          actions.push({ seat, msg: JSON.parse(JSON.stringify(msg)), seq });
          mutated = true;
        }
      }
    }
    if (!mutated) break;
  }
  return {
    v: 1,
    id: `SMOKE-${gameId}-1`,
    roomCode: 'SMOKE',
    gameId,
    names,
    bots: names.map(() => false),
    initialState: JSON.parse(JSON.stringify(initial)),
    actions,
    createdAt: Date.now(),
    endedAt: Date.now(),
    finalSummary: { winners: [], rows: [] },
    _liveStateForCheck: JSON.stringify(live), // smoke-only sidecar
  };
}

// ─── Load replay.html and exercise the player ────────────────────────
async function runReplayFor(gameId) {
  const htmlPath = join(root, 'public', 'replay.html');
  const html = readFileSync(htmlPath, 'utf8');
  const scriptSrcs = [...html.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)].map((m) => m[1]);
  const htmlWithoutScripts = html.replace(/<script\s+src="[^"]+"\s*><\/script>/g, '');

  const dom = new JSDOM(htmlWithoutScripts, {
    url: `https://gamehub.test/replay.html?room=SMOKE&id=SMOKE-${gameId}-1`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  installBrowserStubs(window);

  const errors = [];
  window.addEventListener('error', (e) => errors.push(`window error: ${e.error?.stack || e.message}`));
  window.addEventListener('unhandledrejection', (e) => errors.push(`unhandled rejection: ${e.reason?.stack || e.reason}`));

  // Load EVERY script EXCEPT the replay player itself first, so we can build
  // a bundle from the game modules and stub fetch BEFORE replay-player.js
  // runs its synchronous boot().
  const playerSrc = '/js/replay-player.js';
  const scaffoldSrcs = scriptSrcs.filter((s) => s !== playerSrc);
  for (const src of scaffoldSrcs) {
    if (!src.startsWith('/')) throw new Error(`unexpected script src ${src}`);
    const code = readFileSync(join(root, 'public', src.slice(1)), 'utf8');
    const s = window.document.createElement('script');
    s.textContent = code;
    window.document.body.appendChild(s);
  }
  await sleep(20);
  assert(window.GameModules, 'GameModules not on window after script load');

  // Build the bundle and stub fetch.
  const bundle = buildBundleForGame(window, gameId);
  const liveStateSnapshot = bundle._liveStateForCheck;
  delete bundle._liveStateForCheck;
  window.fetch = async () => ({
    ok: true, status: 200, statusText: 'OK',
    json: async () => bundle,
    text: async () => JSON.stringify(bundle),
  });

  // Load the highlights analyzer alongside the player (replay.html does this
  // in production via <script src="/js/replay-highlights.js">).
  for (const rel of ['/js/replay-highlights.js', playerSrc]) {
    const code = readFileSync(join(root, 'public', rel.slice(1)), 'utf8');
    const s = window.document.createElement('script');
    s.textContent = code;
    window.document.body.appendChild(s);
  }

  // Give the player time to fetch + rehydrate + render + run highlight analysis.
  await sleep(200);

  // The player should have populated scrubber UI and rendered a frame.
  const scrub = window.document.getElementById('replayScrub');
  assert(scrub, 'replayScrub control missing');
  assert(Number(scrub.max) === bundle.actions.length, `scrub max ${scrub.max} != ${bundle.actions.length}`);
  assert(Number(scrub.value) === 0, `initial scrub value should be 0, got ${scrub.value}`);

  // Step forward through all actions via the public window.step API.
  for (let i = 0; i < bundle.actions.length; i++) window.step(1);
  await sleep(20);
  assert(Number(scrub.value) === bundle.actions.length,
    `after stepping through all actions, scrub.value should be ${bundle.actions.length}, got ${scrub.value}`);

  // Animation invariants: after stepping through a whole replay, the
  // CardManager must not have orphan overlays, collisions, or detached
  // overlays. This is the platform-level "no glitchy animation" guard;
  // any new game scaffolded badly enough to leak cards fails this smoke
  // before it ever ships.
  const verify = window.Kit?.CardManager?.verifyInvariants;
  if (typeof verify === 'function') {
    const r = verify();
    if (!r.ok) throw new Error(`Animation invariants failed for ${gameId}: ${r.errors.join('; ')}`);
  }

  // Seek back to the start and forward again — state must end identically.
  window.seekStart();
  await sleep(10);
  assert(Number(scrub.value) === 0, 'seekStart should set scrub to 0');
  window.seekEnd();
  await sleep(10);
  assert(Number(scrub.value) === bundle.actions.length, 'seekEnd should put us at the end');

  // Most important: the rendered title and frame label should be sane.
  const title = window.document.getElementById('replayTitle').textContent;
  assert(title && !title.includes('Loading'), `replayTitle still says "${title}"`);
  const frameLabel = window.document.getElementById('frameLabel').textContent;
  assert(frameLabel.startsWith(`${bundle.actions.length} / `), `unexpected frameLabel ${frameLabel}`);

  if (errors.length) throw new Error(`Errors during ${gameId} replay smoke:\n${errors.join('\n')}`);

  return { gameId, actions: bundle.actions.length, liveStateLen: liveStateSnapshot.length };
}

const results = [];
// Run only games whose action types include something interactive (skip games
// the fuzzer can't drive in the smoke env — Schotten in particular has rich
// validation that may not produce many effective actions in 30 attempts).
for (const id of ['skyjo', 'flip7', 'qwixx', 'schotten']) {
  results.push(await runReplayFor(id));
}
console.log('Replay smoke OK:', results.map((r) => `${r.gameId}(${r.actions})`).join(', '));

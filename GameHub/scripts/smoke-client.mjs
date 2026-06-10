import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const root = process.cwd();
const htmlPath = join(root, 'public', 'index.html');
const html = readFileSync(htmlPath, 'utf8');
const scriptSrcs = [...html.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)].map((m) => m[1]);
const htmlWithoutScripts = html.replace(/<script\s+src="[^"]+"\s*><\/script>/g, '');

function assert(cond, message) {
  if (!cond) throw new Error(message);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installBrowserStubs(window) {
  window.innerWidth = 1280;
  window.innerHeight = 800;
  window.scrollTo = () => {};
  window.matchMedia = () => ({
    matches: false,
    media: '',
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  });
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  window.confirm = () => true;
  window.alert = () => {};
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

  class FakeOscillator {
    constructor() {
      this.type = 'square';
      this.frequency = {
        setValueAtTime() {},
        exponentialRampToValueAtTime() {},
      };
    }
    connect() {}
    start() {}
    stop() {}
  }
  class FakeGain {
    constructor() {
      this.gain = {
        value: 0,
        setValueAtTime() {},
        exponentialRampToValueAtTime() {},
      };
    }
    connect() {}
  }
  class FakeAudioContext {
    constructor() {
      this.currentTime = 0;
      this.state = 'running';
      this.destination = {};
    }
    createGain() { return new FakeGain(); }
    createOscillator() { return new FakeOscillator(); }
    resume() { this.state = 'running'; return Promise.resolve(); }
  }
  window.AudioContext = FakeAudioContext;
  window.webkitAudioContext = FakeAudioContext;

  class FakeWebSocket {
    static OPEN = 1;
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.sent = [];
      setTimeout(() => this.onopen && this.onopen(), 0);
    }
    send(msg) { this.sent.push(msg); }
    close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  }
  window.WebSocket = FakeWebSocket;

  const canvasProto = window.HTMLCanvasElement.prototype;
  canvasProto.getContext = () => ({
    clearRect() {}, save() {}, translate() {}, rotate() {}, fillRect() {}, restore() {},
    beginPath() {}, closePath() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {},
    set fillStyle(v) {}, get fillStyle() { return '#000'; },
  });

  function dimsFor(el) {
    const cls = String(el.className || '');
    if (cls.includes('board-card')) return { width: 72, height: 102 };
    if (cls.includes('f7-card')) return { width: 52, height: 74 };
    if (cls.includes('card-slot')) return { width: 72, height: 102 };
    if (cls.includes('kit-die') || cls.includes('kit-die-static') || cls.includes('kit-die-phys')) return { width: 42, height: 42 };
    if (cls.includes('btn') || el.tagName === 'BUTTON') return { width: 120, height: 40 };
    if (cls.includes('game-topbar')) return { width: 900, height: 52 };
    if (cls.includes('top-area')) return { width: 900, height: 150 };
    if (cls.includes('boards-container') || cls.includes('mini-boards-container')) return { width: 900, height: 260 };
    if (cls.includes('player-board')) return { width: 360, height: 220 };
    return { width: 180, height: 60 };
  }
  function rectFor(el) {
    const { width, height } = dimsFor(el);
    const all = [...el.ownerDocument.querySelectorAll('*')];
    const idx = Math.max(0, all.indexOf(el));
    const col = idx % 6;
    const row = Math.floor(idx / 6) % 8;
    const left = 20 + col * 140;
    const top = 20 + row * 90;
    return {
      x: left, y: top, left, top,
      width, height,
      right: left + width,
      bottom: top + height,
      toJSON() { return this; },
    };
  }
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return dimsFor(this).width; } });
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get() { return dimsFor(this).height; } });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { get() { return dimsFor(this).width; } });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { get() { return dimsFor(this).height; } });
  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() { return rectFor(this); };
}

async function loadApp() {
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
    const rel = src.replace(/^\//, '');
    const file = join(root, 'public', rel.replace(/^js\//, 'js/'));
    const code = `${readFileSync(file, 'utf8')}\n//# sourceURL=${src}`;
    const script = window.document.createElement('script');
    script.textContent = code;
    window.document.body.appendChild(script);
  }

  await sleep(50);
  return { window, document: window.document, errors };
}

function activeScreen(document) {
  return document.querySelector('.screen.active')?.id || null;
}

function setLocalConfig(window, gameId, seats) {
  const seatsJson = JSON.stringify(seats);
  window.eval(`localSeats = ${seatsJson}; renderLocalSeats(); refreshLocalTiles(); _localPick = ${JSON.stringify(gameId)}; markLocalPick();`);
}

function localView(window, seat = null) {
  const expr = seat == null ? 'localEngine.viewFor(localDisplaySeat())' : `localEngine.viewFor(${seat})`;
  return window.eval(expr);
}

async function smokeSkyjo(window, document) {
  setLocalConfig(window, 'skyjo', [
    { name: 'P1', bot: false },
    { name: 'P2', bot: false },
  ]);
  window.startLocalGame();
  await sleep(80);

  assert(activeScreen(document) === 'gameScreen', 'Skyjo: game screen did not open');
  assert(document.querySelector('#topArea .piles')?.style.display !== 'none', 'Skyjo: piles should be visible');
  assert(!document.querySelector('.qwixx-dice-zone'), 'Skyjo: Qwixx dice zone leaked into Skyjo');
  assert(!document.getElementById('f7Controls'), 'Skyjo: Flip7 controls leaked into Skyjo');

  window.localAct(0, { action: 'reveal', index: 0 });
  window.localAct(0, { action: 'reveal', index: 1 });
  window.localAct(1, { action: 'reveal', index: 0 });
  window.localAct(1, { action: 'reveal', index: 1 });
  await sleep(1400);

  const view = localView(window, 0);
  assert(view.skyjo.phase === 'PLAY' || view.skyjo.tiebreakerPlayers?.length > 0, 'Skyjo: did not leave reveal phase cleanly');

  window.quitLocal();
  await sleep(50);
}

async function smokeQwixx(window, document) {
  setLocalConfig(window, 'qwixx', [
    { name: 'P1', bot: false },
    { name: 'P2', bot: false },
  ]);
  window.startLocalGame();
  await sleep(80);

  assert(document.querySelector('.qwixx-dice-zone'), 'Qwixx: dice zone missing');
  assert(document.getElementById('qwixxThrowBtn'), 'Qwixx: throw button missing');
  assert(!document.getElementById('f7Controls'), 'Qwixx: Flip7 controls leaked into Qwixx');
  assert(document.querySelector('#topArea .piles')?.style.display === 'none', 'Qwixx: shared piles should be hidden');

  document.getElementById('qwixxThrowBtn').onclick();
  await sleep(1200);

  const throwBtn = document.getElementById('qwixxThrowBtn');
  assert(throwBtn.classList.contains('hidden'), 'Qwixx: throw button should hide after roll');
  assert(document.querySelector('#qwixxDiceKit .kit-die-static, #qwixxDiceKit .kit-die-phys'), 'Qwixx: dice did not render');

  const before = localView(window, 0).state.pendingWhiteDecisions.length;
  window.GameClients['qwixx'].act('skip');
  await sleep(50);
  const after = localView(window, 0).state.pendingWhiteDecisions.length;
  assert(after < before, 'Qwixx: skip action did not advance white-phase decisions');

  window.quitLocal();
  await sleep(50);
}

async function smokeFlip7(window, document) {
  setLocalConfig(window, 'flip7', [
    { name: 'P1', bot: false },
    { name: 'P2', bot: false },
  ]);
  window.startLocalGame();
  await sleep(120);

  assert(document.getElementById('f7Controls'), 'Flip7: controls missing');
  assert(document.getElementById('f7DealerWrap'), 'Flip7: dealer area missing');
  assert(!document.querySelector('.qwixx-dice-zone'), 'Flip7: Qwixx dice zone leaked into Flip7');
  assert(document.querySelector('#topArea .piles')?.style.display === 'none', 'Flip7: shared piles should be hidden');

  // Instrument the animation API so we can verify the deck → slot deal flight
  // actually runs (the deal must go through Kit.CardManager.moveTo, not appear
  // instantly) and uses a card-flip (rotateY) so cards land upright, not spun
  // upside-down. Records are read back via window.eval since Kit is script-scoped.
  window.eval(`window.__f7mv=[];(function(){const cm=Kit.CardManager,orig=cm.moveTo;cm.moveTo=function(id,to,opts){if(typeof id==='string'&&id.indexOf('flip7:table:')===0)window.__f7mv.push({id,flip:!!(opts&&opts.flip),spin:!!(opts&&opts.spin)});return orig.call(this,id,to,opts);};})();`);

  // Use the public act API directly because it drives the same code path as the
  // buttons. Hit until at least one card is dealt (every dealt card — number,
  // modifier or action — animates deck → slot via CardManager.moveTo). A single
  // hit always produces a card.deal event for the current seat, so this is
  // deterministic; we loop only to skip rare turns that immediately hand off.
  let dealtEvents = 0;
  for (let i = 0; i < 6 && dealtEvents === 0; i++) {
    const v = localView(window, 0).flip7;
    if (v.phase !== 'PLAY') break;
    window.GameClients['flip7'].act('hit');
    await sleep(1700);
    const after = localView(window, 0).flip7;
    dealtEvents = (after.events || []).filter((e) => e.type === 'card.deal' || e.type === 'card').length;
  }

  const view = localView(window, 0);
  assert(view.flip7.seq > 0, 'Flip7: event timeline did not advance after hit');
  assert(document.querySelector('[data-f7-seat]'), 'Flip7: board markup missing after action playback');
  const deals = JSON.parse(window.eval('JSON.stringify(window.__f7mv)'));
  assert(deals.length > 0, 'Flip7: card deal did not animate via CardManager.moveTo (deck → slot flight missing)');
  // Dealt cards must use the card-flip (rotateY), not the in-plane spin (rotateZ),
  // so they land face-up & upright rather than upside-down.
  assert(deals.every((m) => m.flip && !m.spin), 'Flip7: deal flight should use flip (rotateY), not spin (rotateZ)');

  // ── Bust card must FLY in before the player is shown as busted (regression) ──
  // The engine emits `bust` with no preceding `card` event, so the handler must
  // deal the offending card itself. Drive a deterministic bust via a rigged
  // Flip7Engine and confirm its bust card animates via moveTo.
  const bustResult = JSON.parse(window.eval(`(function(){
    window.__f7mv.length=0;
    const E=new Flip7Engine(['P1','P2']);
    E.s.players[0].nums=[5];E.s.players[0].tableau=[{id:'x5',kind:'num',v:5}];
    E.s.current=0;E.s.players[0].status='active';
    E.s.deck.push({id:'dup5',kind:'num',v:5}); // next draw duplicates the 5 → bust
    E.apply(0,{action:'hit'});
    window._flip7ResetSeq && window._flip7ResetSeq();
    const v=E.viewFor(0);window._renderView=v;
    GameShell.render(v, window.GameClients['flip7']);
    return JSON.stringify({status:E.s.players[0].status});
  })()`));
  assert(bustResult.status === 'busted', 'Flip7: rigged bust scenario did not bust as expected');
  await sleep(2400); // let the bust card fly + bust reaction play
  const bustMoves = JSON.parse(window.eval('JSON.stringify(window.__f7mv)')).filter((m) => m.id.indexOf(':bust-') >= 0);
  assert(bustMoves.length > 0, 'Flip7: busting card did not fly to the board before the bust (it must arrive first)');
  // The card flight must happen BEFORE the busted state is applied. Verified at
  // the SOURCE level (robust): in the effect.bust handler the flyDealCard() call
  // precedes the advanceLiveView() that applies the busted state.
  const f7src = readFileSync(new URL('../public/js/04-flip7.js', import.meta.url), 'utf8');
  const bustCase = f7src.slice(f7src.indexOf("case 'effect.bust':"), f7src.indexOf("case 'effect.freeze_done':"));
  const flyIdx = bustCase.indexOf('flyDealCard(bustPermId');
  const bustApplyIdx = bustCase.indexOf('advanceLiveView(liveView,e)');
  assert(flyIdx >= 0 && bustApplyIdx >= 0 && flyIdx < bustApplyIdx,
    'Flip7: bust card must fly (flyDealCard) BEFORE the bust is applied (advanceLiveView) in the handler');

  // ── Second Chance: duplicate flies in, then it + the 2nd-chance card go to the
  //    discard pile; the engine discard grows by 2. ──
  const scResult = JSON.parse(window.eval(`(function(){
    const E=new Flip7Engine(['P1','P2']);
    E.s.players[0].nums=[5];E.s.players[0].second=true;
    E.s.players[0].tableau=[{id:'x5',kind:'num',v:5},{id:'sc',kind:'act',v:'second'}];
    E.s.current=0;E.s.discard=[];
    E.s.deck.push({id:'dup5b',kind:'num',v:5});
    E.apply(0,{action:'hit'});
    return JSON.stringify({second:E.s.players[0].second, discardLen:E.s.discard.length, discardKinds:E.s.discard.map(c=>c.kind+':'+c.v)});
  })()`));
  assert(scResult.second === false, 'Flip7: second chance was not consumed');
  assert(scResult.discardLen === 2, 'Flip7: second-chance should discard the duplicate + the 2nd-chance card (got ' + JSON.stringify(scResult.discardKinds) + ')');
  // The discard must MOVE the real permanent cards (no transient clone), so no
  // duplicate lingers on the board during the flight.
  assert(f7src.includes('flyPermToDiscard'), 'Flip7: discard should move the real permanent card to the pile');
  assert(!f7src.includes('function flyToDiscard'), 'Flip7: the transient-clone discard helper should be gone (caused a dupe on the board)');
  // The discard pile's top renders as a REAL card (cardEl), so a card's design
  // does not change when it lands on the pile.
  assert(f7src.includes("cardEl(kind,top.v);el.classList.add('f7-discard-card')"), 'Flip7: discard top should render via cardEl (real card), not a bare span');
  // Flip 7 force-ends the round for everyone (active players force-stay & bank).
  assert(f7src.includes('_forceEndRoundOnFlip7'), 'Flip7: a Flip 7 must force-end the round for all active players (client engine)');

  // There is now ONE card system: CardManager. The legacy layers (flyCard,
  // CardMotion, Card, CardEffects) have been removed — assert they are gone and
  // that the single flight path (moveTo, used by flyTransient too) scales
  // uniformly via transform:scale and never animates raw width/height.
  const coreSrc = readFileSync(new URL('../public/js/00-core.js', import.meta.url), 'utf8');
  assert(!coreSrc.includes('const CardMotion='), 'core: legacy CardMotion should be removed');
  assert(!coreSrc.includes('const Card=(()=>'), 'core: legacy Card subsystem should be removed');
  assert(!coreSrc.includes('const CardEffects='), 'core: legacy CardEffects should be removed');
  assert(!coreSrc.includes('function flyCard'), 'core: legacy flyCard should be removed');
  assert(coreSrc.includes('async function flyTransient'), 'core: CardManager.flyTransient should exist (replaces Card.move)');
  const moveToBody = (() => {
    const i = coreSrc.indexOf('async function moveTo');
    const rest = coreSrc.slice(i);
    const next = rest.slice(20).search(/\n    async function |\n    function /);
    return rest.slice(0, next >= 0 ? next + 20 : 4000);
  })();
  assert(!moveToBody.includes('width ${duration}ms'), 'core: moveTo must not transition raw width (use transform:scale)');
  assert(moveToBody.includes('scale('), 'core: moveTo should size the flight via transform:scale');

  window.quitLocal();
  await sleep(50);
}

async function smokeBotFlows(window, document) {
  // Skyjo bot reveal smoke
  setLocalConfig(window, 'skyjo', [
    { name: 'Human', bot: false },
    { name: 'Bot', bot: true, difficulty: 'easy' },
  ]);
  window.startLocalGame();
  await sleep(2200);
  let view = localView(window, 0);
  assert(view.skyjo.players[1].revealCount > 0, 'Skyjo bot did not perform reveal actions');
  window.quitLocal();
  await sleep(50);

  // Qwixx bot white-phase smoke: bots must WAIT until the dice are visually revealed.
  setLocalConfig(window, 'qwixx', [
    { name: 'Human', bot: false },
    { name: 'Bot', bot: true, difficulty: 'medium' },
  ]);
  window.startLocalGame();
  await sleep(1200);
  view = localView(window, 0);
  assert(view.state.pendingWhiteDecisions.includes(1), 'Qwixx bot acted before the dice were revealed');
  document.getElementById('qwixxThrowBtn').onclick();
  await sleep(1600);
  view = localView(window, 0);
  assert(!view.state.pendingWhiteDecisions.includes(1), 'Qwixx bot did not resolve its white-phase choice after the throw');
  window.quitLocal();
  await sleep(50);

  // Flip7 bot turn smoke
  setLocalConfig(window, 'flip7', [
    { name: 'Human', bot: false },
    { name: 'Bot', bot: true, difficulty: 'easy' },
  ]);
  window.startLocalGame();
  await sleep(80);
  window.GameClients['flip7'].act('stay');
  await sleep(2200);
  view = localView(window, 0);
  assert(view.flip7.seq >= 2, 'Flip7 bot did not act after the human stayed');
  window.quitLocal();
  await sleep(50);

  assert(!document.getElementById('f7Controls'), 'Cleanup: Flip7 controls leaked after quitting');
  assert(!document.getElementById('f7DealerWrap'), 'Cleanup: Flip7 dealer leaked after quitting');
  assert(!document.querySelector('.qwixx-dice-zone'), 'Cleanup: Qwixx UI leaked after quitting');
  assert(document.getElementById('overlay').classList.contains('hidden'), 'Cleanup: overlay should be hidden after quitting');
}

async function smokeMidAnimationQuit(window, document) {
  // Flip7: quitting during event playback must not resurrect controls or boards.
  setLocalConfig(window, 'flip7', [
    { name: 'P1', bot: false },
    { name: 'P2', bot: false },
  ]);
  window.startLocalGame();
  await sleep(120);
  window.GameClients['flip7'].act('hit');
  window.quitLocal();
  await sleep(2500);
  assert(activeScreen(document) === 'menuScreen', 'Mid-animation quit: expected to stay on menu');
  assert(!document.getElementById('f7Controls'), 'Mid-animation quit: Flip7 controls came back after quit');
  assert(!document.getElementById('f7DealerWrap'), 'Mid-animation quit: Flip7 dealer came back after quit');
  assert(document.querySelectorAll('[data-f7-seat]').length === 0, 'Mid-animation quit: Flip7 board markup leaked back in');

  // Skyjo: quitting before deferred turn-end resolves must not re-render the table.
  setLocalConfig(window, 'skyjo', [
    { name: 'P1', bot: false },
    { name: 'P2', bot: false },
  ]);
  window.startLocalGame();
  await sleep(80);
  window.localAct(0, { action: 'reveal', index: 0 });
  window.localAct(0, { action: 'reveal', index: 1 });
  window.localAct(1, { action: 'reveal', index: 0 });
  window.localAct(1, { action: 'reveal', index: 1 });
  window.quitLocal();
  await sleep(1400);
  assert(activeScreen(document) === 'menuScreen', 'Skyjo deferred quit: expected to stay on menu');
  assert(document.querySelectorAll('[data-card-reg^="skyjo:"]').length === 0, 'Skyjo deferred quit: registry anchors leaked back in');
}

async function main() {
  const { window, document, errors } = await loadApp();

  assert(activeScreen(document) === 'menuScreen', 'App did not boot into menu screen');
  assert(document.querySelectorAll('#quickTiles .game-tile').length >= 3, 'Quick play tiles did not render');

  await smokeSkyjo(window, document);
  await smokeQwixx(window, document);
  await smokeFlip7(window, document);
  await smokeBotFlows(window, document);
  await smokeMidAnimationQuit(window, document);

  await sleep(50);
  if (errors.length) {
    throw new Error(`Smoke test captured browser errors:\n${errors.join('\n')}`);
  }

  console.log('Client smoke passed: local games, bot flows, and cross-game cleanup look healthy.');
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});

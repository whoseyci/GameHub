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

  // Intro deal cascade must animate the VISIBLE overlays (the empty .board-card
  // anchors carry no pixels after the overlay migration). Regression guard for #1.
  let sawOverlayDeal = false;
  const dealObs = setInterval(() => {
    if (document.querySelectorAll('.kit-card-registered.anim-deal').length > 0) sawOverlayDeal = true;
  }, 25);
  window.eval('Kit.dealCascade()');
  await sleep(400);
  clearInterval(dealObs);
  assert(sawOverlayDeal, 'Skyjo: intro deal cascade did not animate the card overlays (#1 regression)');
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

  // Pass-and-play rotation: the white phase is SIMULTANEOUS, so the display must
  // rotate to EACH seat that still has a pending white decision (driving via act(),
  // which targets the focused/displayed seat — the realistic on-screen-button path).
  // If focus stuck on seat 0, seat 1 could never make its choice (the real bug).
  assert(window._renderView.yourSeat === 0, 'Qwixx: white phase should start focused on the first pending seat (0)');
  const before = localView(window, 0).qwixx.pendingWhiteDecisions.length;
  window.GameClients['qwixx'].act('skip');   // focused seat (0) makes its white choice
  await sleep(150);
  const after = localView(window, 0).qwixx.pendingWhiteDecisions.length;
  assert(after < before, 'Qwixx: skip action did not advance white-phase decisions');
  assert(window._renderView.yourSeat === 1, 'Qwixx: focus did not rotate to the next pending seat (1) — pass-and-play stuck on seat 0');
  window.GameClients['qwixx'].act('skip');   // seat 1 makes its white choice
  await sleep(200);
  assert(localView(window, -1).qwixx.phase !== 'WHITE_PHASE' || localView(window, -1).qwixx.pendingWhiteDecisions.length === 0,
    'Qwixx: white phase did not resolve after both seats decided');

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
    // Drive the rigged scenario through the SHARED rules engine (window.GameModules),
    // the same module the server runs — there is no separate client engine anymore.
    const M=window.GameModules.flip7;
    const st=M.create(['P1','P2']);
    st.players[0].nums=[5];st.players[0].tableau=[{id:'x5',kind:'num',v:5}];
    st.current=0;st.players[0].status='active';
    st.deck.push({id:'dup5',kind:'num',v:5}); // next draw duplicates the 5 → bust
    M.applyAction(st,0,{action:'hit'});
    window._flip7ResetSeq && window._flip7ResetSeq();
    const v=M.viewFor(st,0);window._renderView=v;
    GameShell.render(v, window.GameClients['flip7']);
    return JSON.stringify({status:st.players[0].status});
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
    const M=window.GameModules.flip7;
    const st=M.create(['P1','P2']);
    st.players[0].nums=[5];st.players[0].secondChance=true;
    st.players[0].tableau=[{id:'x5',kind:'num',v:5},{id:'sc',kind:'act',v:'second'}];
    st.current=0;st.discard=[];
    st.deck.push({id:'dup5b',kind:'num',v:5});
    M.applyAction(st,0,{action:'hit'});
    return JSON.stringify({second:st.players[0].secondChance, discardLen:st.discard.length, discardKinds:st.discard.map(c=>c.kind+':'+c.v)});
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
  // This rule now lives ONCE, in the shared rules engine (server GameModule that
  // is bundled into the browser), not in a duplicated client engine.
  const gameModulesSrc = readFileSync(new URL('../public/js/00-game-modules.js', import.meta.url), 'utf8');
  assert(gameModulesSrc.includes('forceEndRoundOnFlip7'), 'Flip7: a Flip 7 must force-end the round for all active players (shared rules engine)');

  // There is now ONE card system: CardManager. The legacy layers (flyCard,
  // CardMotion, Card, CardEffects) have been removed — assert they are gone and
  // that the single flight path (moveTo, used by flyTransient too) scales
  // uniformly via transform:scale and never animates raw width/height.
  const coreSrc = readFileSync(new URL('../public/js/00-core.js', import.meta.url), 'utf8');
  assert(!coreSrc.includes('const CardMotion='), 'core: legacy CardMotion should be removed');
  assert(!coreSrc.includes('const Card=(()=>'), 'core: legacy Card subsystem should be removed');
  assert(!coreSrc.includes('const CardEffects='), 'core: legacy CardEffects should be removed');
  assert(!coreSrc.includes('function flyCard'), 'core: legacy flyCard should be removed');
  assert(coreSrc.includes('async function flyTransient'), 'core: CardManager.flyTransient should exist (internal primitive / ephemeral fallback)');
  // Permanent-identity goal: games move REAL cards between zones rather than
  // spawning transient throwaways. Skyjo has a permanent discard card and routes
  // swap/discard/triplet onto it; Flip 7 plays the real action-card overlay.
  const skyjoSrc = readFileSync(new URL('../public/js/03-skyjo.js', import.meta.url), 'utf8');
  const flip7Src2 = readFileSync(new URL('../public/js/04-flip7.js', import.meta.url), 'utf8');
  assert(skyjoSrc.includes("'skyjo:discard'"), 'Skyjo: discard pile should be a permanent CardManager card');
  assert(!skyjoSrc.includes('Kit.CardManager.flyTransient'), 'Skyjo: should not spawn transient discard cards (move the real card)');
  assert(flip7Src2.includes('actionCardPermId'), 'Flip7: action-card transfer should move the real permanent overlay');
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
  // Investigate popup must show REAL card faces (regression: it used overlay anchors
  // that don't render inside the modal → an empty popup).
  const mini = document.querySelector('.kc-mini');
  assert(mini, 'Skyjo: opponent mini board missing');
  mini.click();
  await sleep(120);
  const popupCards = document.querySelectorAll('#investigateBox .board-card').length;
  assert(popupCards === 12, 'Skyjo: investigate popup must render 12 real cards (got ' + popupCards + ')');
  document.getElementById('investigateOverlay').classList.add('hidden');
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
  assert(view.qwixx.pendingWhiteDecisions.includes(1), 'Qwixx bot acted before the dice were revealed');
  document.getElementById('qwixxThrowBtn').onclick();
  await sleep(1600);
  view = localView(window, 0);
  assert(!view.qwixx.pendingWhiteDecisions.includes(1), 'Qwixx bot did not resolve its white-phase choice after the throw');
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

  // Schotten bot turn smoke: after the human places + ends, the bot must take its
  // turn (place a card, hand still 6 after it draws) — drives the shared engine + bot.
  setLocalConfig(window, 'schotten', [
    { name: 'Human', bot: false },
    { name: 'Bot', bot: true, difficulty: 'medium' },
  ]);
  window.startLocalGame();
  await sleep(120);
  view = localView(window, 0);
  const hSeat = view.yourSeat;
  // human plays first hand card on stone 0, then ends turn
  window.GameClients['schotten'].act('place', { index: 0, target: 0 });
  await sleep(120);
  window.GameClients['schotten'].act('end');
  await sleep(3200); // human draw anim + bot think (place → end)
  view = localView(window, 0);
  const botSeat = 1 - hSeat;
  const botPlaced = view.schotten.stones.some((st) => st.sides[botSeat].length > 0);
  assert(botPlaced, 'Schotten bot did not place a card on its turn');
  window.quitLocal();
  await sleep(50);

  assert(!document.getElementById('f7Controls'), 'Cleanup: Flip7 controls leaked after quitting');
  assert(!document.getElementById('f7DealerWrap'), 'Cleanup: Flip7 dealer leaked after quitting');
  assert(!document.querySelector('.qwixx-dice-zone'), 'Cleanup: Qwixx UI leaked after quitting');
  assert(!document.getElementById('stControls'), 'Cleanup: Schotten controls leaked after quitting');
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

async function smokeSchotten(window, document) {
  setLocalConfig(window, 'schotten', [
    { name: 'You', bot: false },
    { name: 'Rival', bot: false },
  ]);
  window.startLocalGame();
  await sleep(120);

  assert(activeScreen(document) === 'gameScreen', 'Schotten: game screen did not open');
  // Redesign: a real visible DECK pile, 9 stones, a hand of 6.
  assert(document.getElementById('stDeck'), 'Schotten: visible deck pile (#stDeck) missing');
  assert(document.querySelectorAll('.st-stone').length === 9, 'Schotten: should render 9 boundary stones');
  const me = localView(window).yourSeat;
  assert(localView(window).schotten.players[me].hand.length === 6, 'Schotten: opening hand should be 6 cards');
  assert(document.querySelectorAll('.st-hand-card').length === 6, 'Schotten: 6 hand cards should render');
  // Every on-table/hand card is a permanent CardManager card (so it can animate).
  const cmCards = window.eval('Kit.CardManager.ids().filter(i=>i.startsWith("schotten:")).length');
  assert(cmCards >= 6, 'Schotten: hand cards must be registered with CardManager (got ' + cmCards + ')');

  // Pick the first hand card, then place it on stone 0 (drop zone appears).
  window.eval('document.querySelectorAll(".st-hand-card")[0].click()');
  await sleep(60);
  assert(document.querySelectorAll('.st-side-me.kc-drop').length > 0, 'Schotten: selecting a card should reveal stone drop zones');
  window.eval('document.querySelectorAll(".st-side-me.kc-drop")[0].click()');
  // The placed card must actually ANIMATE hand→stone (a moving CardManager overlay
  // appears mid-flight). This guard has teeth: it fails if the flight is skipped
  // (e.g. the old bug where lastAction carried no seq so runAnimation always bailed).
  await sleep(150);
  assert(document.querySelectorAll('.kit-card-moving').length > 0, 'Schotten: placing a card must animate (no moving overlay = flight skipped)');
  await sleep(650);
  const afterPlace = localView(window, me).schotten;
  assert(afterPlace.placedThisTurn === true, 'Schotten: placing a card should set placedThisTurn');
  assert(afterPlace.stones[0].sides[me].length === 1, 'Schotten: the card should land on stone 0');
  assert(!!document.querySelector('#stControls .btn'), 'Schotten: End-turn control should appear after placing');

  // End turn → draws a replacement; the draw must fly from the visible deck pile
  // (deck pulses + a moving/transient overlay appears).
  window.GameClients['schotten'].act('end');
  await sleep(150);
  assert(
    !!document.querySelector('#stDeck.deal') || document.querySelectorAll('.kit-card-moving').length > 0,
    'Schotten: drawing on end-turn must animate from the deck'
  );
  // Schotten must NOT spawn transient throwaway cards — every flight uses a
  // permanent CardManager card (or just a deck pulse). Guard against regressing to
  // the legacy transit pattern.
  assert(
    document.querySelectorAll('[data-cm-id^="cm:transit"]').length === 0,
    'Schotten: must not use transient (cm:transit) cards — animate permanent cards or pulse the deck'
  );
  await sleep(700);
  assert(localView(window, me).schotten.players[me].hand.length === 6, 'Schotten: hand should refill to 6 after drawing on end-turn');

  window.quitLocal();
  await sleep(50);
  assert(document.querySelectorAll('[data-card-reg^="schotten:"]').length === 0, 'Schotten: card anchors should be cleaned up on quit');
}

async function main() {
  const { window, document, errors } = await loadApp();

  assert(activeScreen(document) === 'menuScreen', 'App did not boot into menu screen');
  assert(document.querySelectorAll('#quickTiles .game-tile').length >= 3, 'Quick play tiles did not render');

  await smokeSkyjo(window, document);
  await smokeQwixx(window, document);
  await smokeFlip7(window, document);
  await smokeSchotten(window, document);
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

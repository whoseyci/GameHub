import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const core = readFileSync(new URL("../public/js/00-core.js", import.meta.url), "utf8");
const networkLocal = readFileSync(new URL("../public/js/01-network-local.js", import.meta.url), "utf8");
const skyjo = readFileSync(new URL("../public/js/03-skyjo.js", import.meta.url), "utf8");
const qwixx = readFileSync(new URL("../public/js/02-qwixx.js", import.meta.url), "utf8");
const flip7 = readFileSync(new URL("../public/js/04-flip7.js", import.meta.url), "utf8");
const botInit = readFileSync(new URL("../public/js/05-bots-init.js", import.meta.url), "utf8");
const botDriver = readFileSync(new URL("../public/js/bots/driver.js", import.meta.url), "utf8");
const botFlip7 = readFileSync(new URL("../public/js/bots/flip7.js", import.meta.url), "utf8");
const botQwixx = readFileSync(new URL("../public/js/bots/qwixx.js", import.meta.url), "utf8");
const botSkyjo = readFileSync(new URL("../public/js/bots/skyjo.js", import.meta.url), "utf8");
const templateClient = readFileSync(new URL("../public/js/games/_template-game-client.js", import.meta.url), "utf8");
const scaffold = readFileSync(new URL("../scripts/scaffold-game.mjs", import.meta.url), "utf8");

describe("client module split", () => {
  it("loads frontend scripts as smaller ordered files", () => {
    for (const file of ["00-core", "01-network-local", "02-qwixx", "03-skyjo", "04-flip7", "05-bots-init"]) {
      expect(html).toContain(`/js/${file}.js`);
    }
    expect(html).toContain('/styles/main.css');
  });

  it("loads modular bot scripts before the bot scheduler", () => {
    const order = [
      '/js/bots/driver.js',
      '/js/bots/flip7.js',
      '/js/bots/qwixx.js',
      '/js/bots/skyjo.js',
      '/js/05-bots-init.js',
    ].map((s) => html.indexOf(s));

    for (const pos of order) expect(pos).toBeGreaterThanOrEqual(0);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    expect(botDriver).toContain('const BotDriver');
    expect(botFlip7).toContain("BotDriver.register('flip7'");
    expect(botQwixx).toContain('BotDriver.register("qwixx"');
    expect(botSkyjo).toContain("BotDriver.register('skyjo'");
    expect(botInit).toContain('BotDriver.choose');
  });

  it("keeps Qwixx bots gated behind the visible dice reveal", () => {
    expect(botQwixx).toContain('function diceRevealed');
    expect(botQwixx).toContain('window._qwixxDiceSig');
    expect(botQwixx).toContain('if (!s || !diceRevealed(s)) return false;');
  });
});

describe("shared game shell", () => {
  it("defines shared table shell and routes game dispatch through it", () => {
    expect(core).toContain("const SeatModel");
    expect(core).toContain("const GameShell");
    expect(core).toContain("function renderTable");
    expect(networkLocal).toContain("GameShell.render(view,client)");
  });

  it("exposes a single CardManager animation API and the games use it", () => {
    // ONE system: CardManager. Legacy layers (Card / CardMotion / CardEffects /
    // CardRegistry / flyCard) have been removed.
    expect(core).toContain("const CardManager=");
    expect(core).not.toContain("const CardRegistry");
    expect(core).not.toContain("const Card=(()=>");
    expect(core).not.toContain("const CardMotion=");
    expect(core).not.toContain("const CardEffects=");
    expect(core).not.toContain("function flyCard");
    // CardManager carries the capabilities the old layers provided.
    expect(core).toContain("async function moveTo");
    expect(core).toContain("async function flyTransient");
    expect(core).toContain("async function triplet");
    expect(core).toContain("async function revealEl");
    expect(core).toContain("reconcile");
    // Skyjo moves REAL cards to a permanent discard pile (no transient throwaways):
    // swap/discard/triplet all route the actual card overlay onto skyjo:discard.
    expect(skyjo).toContain("flyCardToDiscard");
    expect(skyjo).toContain("clearTripletToDiscard");
    expect(skyjo).toContain("Kit.CardManager.revealEl");
    expect(skyjo).not.toContain("Kit.CardManager.flyTransient"); // no transient discards
    expect(skyjo).not.toContain("Kit.Card.move");
    expect(skyjo).not.toContain("Kit.CardEffects");
    // Skyjo uses CardManager directly for the held/transit/discard permanent cards,
    // and drives its BOARD GRID through the shared Kit.Cards.board loop (Gap A) —
    // which owns reconcile internally (CardBoard.sync), so Skyjo no longer calls
    // Kit.CardManager.reconcile itself.
    expect(skyjo).toContain("Kit.CardManager.pin");
    expect(skyjo).toContain("Kit.Cards.board('skyjo:table:'");
    expect(skyjo).not.toContain("Kit.CardManager.reconcile");
    expect(skyjo).toContain("Kit.CardManager.has");
    // Flip 7 uses CardManager for permanent card lifecycle
    expect(flip7).toContain("Kit.CardManager.get(permId)");
    expect(flip7).toContain("Kit.Cards.board"); // create/pin/reconcile/sync via the framework board wiring
    // Permanent TABLE cards are created/reconciled by syncF7Cards, never
    // destroyed directly. (Transient discard cards use a separate temp id and
    // may be destroyed — that's expected.)
    expect(flip7).not.toContain("Kit.CardManager.destroy('flip7:table:");
    expect(flip7).not.toContain('Kit.CardManager.destroy(`flip7:table:');
  });

  it("migrates built-in games to GameShell.renderTable", () => {
    expect(qwixx).toContain("GameShell.renderTable");
    expect(skyjo).toContain("GameShell.renderTable");
    expect(flip7).toContain("GameShell.renderTable");
  });

  it("exposes a consistent GameClients.act API across built-in games", () => {
    expect(qwixx).toContain("window.GameClients['qwixx'] = { render, act, inspect, unmount }");
    expect(skyjo).toContain("window.GameClients['skyjo']={render,unmount,act:clientAct}");
    expect(flip7).toContain("window.GameClients['flip7']={render,inspect,unmount,act:clientAct}");
  });

  it("provides a shared GameActions helper and uses it in scaffolded clients", () => {
    expect(core).toContain('const GameActions');
    expect(qwixx).toContain('GameActions.send');
    expect(skyjo).toContain('GameActions.send');
    expect(flip7).toContain('GameActions.send');
    expect(templateClient).toContain('GameActions.send');
    expect(scaffold).toContain('GameActions.send');
  });

  it("scaffolds games as packages with meta/server/index structure", () => {
    expect(scaffold).toContain('const gameDir = `src/games/${id}`;');
    expect(scaffold).toContain('const metaPath = `${gameDir}/meta.ts`;');
    expect(scaffold).toContain('const serverPath = `${gameDir}/server.ts`;');
    expect(scaffold).toContain('const indexPath = `${gameDir}/index.ts`;');
    expect(scaffold).toContain('const compatPath = `src/games/${id}.ts`;');
  });

  it("keeps rulebooks registered per game instead of hard-coding them in core", () => {
    expect(core).toContain('window.GameRules = window.GameRules || {}');
    expect(core).toContain('const r=window.GameRules?.[gameId]');
    expect(qwixx).toContain("window.GameRules['qwixx']");
    expect(skyjo).toContain("window.GameRules['skyjo']");
    expect(flip7).toContain("window.GameRules['flip7']");
    expect(templateClient).toContain('window.GameRules[ID]');
    expect(scaffold).toContain('window.GameRules[ID]');
  });
});

describe("Qwixx client regressions", () => {
  it("renders colored dice through explicit short-key mapping", () => {
    expect(qwixx).toContain("const COLOR_KEY");
    expect(qwixx).toContain("dice[COLOR_KEY[c]]");
    expect(qwixx).toContain("{color:'red',value:dice.r}");
    expect(qwixx).toContain("{color:'yellow',value:dice.y}");
    expect(qwixx).toContain("{color:'green',value:dice.g}");
    expect(qwixx).toContain("{color:'blue',value:dice.b}");
  });

  it("contains mark-hint logic for white dice and active-player color choices", () => {
    expect(qwixx).toContain("function markHintsFor");
    expect(qwixx).toContain("state.pendingWhiteDecisions.includes(player.seat)");
    expect(qwixx).toContain("player.seat === state.activeSeat");
    expect(qwixx).toContain("possibleColorMarks");
    expect(qwixx).toContain("recommendedMove");
    expect(qwixx).toContain("renderMiniBoard");
  });

  it("re-dispatches Qwixx after a throw so bot scheduling and status refresh resume", () => {
    expect(qwixx).toContain("dispatchView(window._renderView)");
  });
});

describe("client cross-game cleanup regressions", () => {
  it("has a shared Qwixx UI cleanup helper", () => {
    expect(networkLocal).toContain("function removeQwixxUi()");
    expect(networkLocal).toContain(".qwixx-dice-zone,.qwixx-top-mini-strip");
  });

  it("uses shell cleanup/lifecycle before game switches", () => {
    expect(core).toContain("function unmount");
    expect(core).toContain("clearGlobal()");
    expect(networkLocal).toContain("GameShell.unmount()");
  });

  it("cancels lingering local sessions and Flip7 timelines on quit", () => {
    expect(networkLocal).toContain('function resetLocalSession()');
    expect(networkLocal).toContain('resetLocalSession();resetGameUi();showScreen(\'menuScreen\')');
    expect(flip7).toContain('let lastSeq=-1, lifecycleToken=0;');
    expect(flip7).toContain('invalidateToken()');
    expect(flip7).toContain('tokenAlive(token)');
  });
});


describe("client HTML injection regressions", () => {
  it("defines and uses an HTML escaping helper for server-sourced labels", () => {
    expect(core).toContain("function esc");
    expect(networkLocal).toContain("esc(p.name)");
    expect(networkLocal).toContain("esc(r.hostName)");
    expect(networkLocal).toContain("esc(r.name)");
    expect(skyjo).toContain("esc(p.name)");
    expect(qwixx).toContain("esc(player.name)");
    expect(flip7).toContain("esc(p.name)");
  });
});

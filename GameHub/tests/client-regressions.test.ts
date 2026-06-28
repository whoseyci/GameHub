import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const core = readFileSync(new URL("../public/js/00-core.js", import.meta.url), "utf8");
const networkLocal = readFileSync(new URL("../public/js/01-network-local.js", import.meta.url), "utf8");
const bugReport = readFileSync(new URL("../public/js/00-bug-report.js", import.meta.url), "utf8");
const server = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
const localSeatEditor = readFileSync(new URL("../public/js/00-local-seat-editor.js", import.meta.url), "utf8");
const landingCss = readFileSync(new URL("../public/styles/landing.css", import.meta.url), "utf8");
const skyjo = readFileSync(new URL("../public/js/03-skyjo.js", import.meta.url), "utf8");
const qwixx = readFileSync(new URL("../public/js/02-qwixx.js", import.meta.url), "utf8");
const flip7 = readFileSync(new URL("../public/js/04-flip7.js", import.meta.url), "utf8");
const botInit = readFileSync(new URL("../public/js/05-bots-init.js", import.meta.url), "utf8");
const botDriver = readFileSync(new URL("../public/js/bots/driver.js", import.meta.url), "utf8");
const botFlip7 = readFileSync(new URL("../public/js/bots/flip7.js", import.meta.url), "utf8");
const botQwixx = readFileSync(new URL("../public/js/bots/qwixx.js", import.meta.url), "utf8");
const botSkyjo = readFileSync(new URL("../public/js/bots/skyjo.js", import.meta.url), "utf8");
const templateClient = readFileSync(new URL("../public/js/games/_template-game-client.js", import.meta.url), "utf8");
const schemaClient = readFileSync(new URL("../public/js/games/schema-game.js", import.meta.url), "utf8");
const gameModules = readFileSync(new URL("../public/js/00-game-modules.js", import.meta.url), "utf8");
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
    // Looser per-game assertions: each must expose render + act on its
    // GameClients entry. Exact object-literal pinning got brittle when
    // games added optional hooks (e.g. Skyjo's localFocusSeat for the
    // pass-and-play alternation fix).
    expect(qwixx).toMatch(/window\.GameClients\['qwixx'\]\s*=\s*\{[^}]*\brender\b[^}]*\bact\b/);
    expect(skyjo).toMatch(/window\.GameClients\['skyjo'\]\s*=\s*\{[^}]*\brender\b[^}]*\bact:\s*clientAct/);
    expect(flip7).toMatch(/window\.GameClients\['flip7'\]\s*=\s*\{[^}]*\brender\b[^}]*\bact:\s*clientAct/);
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

  it("has an in-game GitHub bug report flow with logs and screenshot capture", () => {
    expect(html).toContain('id="bugBtn"');
    expect(html).toContain('id="globalBugBtn"');
    expect(html).toContain('/js/00-bug-report.js');
    expect(bugReport).toContain('const MAX_LOG = 160');
    expect(bugReport).toContain('captureScreenshot');
    expect(bugReport).toContain('domSnapshot');
    expect(bugReport).toContain('currentLegalActions');
    expect(bugReport).toContain('cardLocationFromId');
    expect(bugReport).toContain('screenshotMeta');
    expect(bugReport).toContain('screenshotFallbackUsed');
    expect(bugReport).toContain('screenshotError');
    expect(bugReport).toContain("fetch('/api/bug-report'");
    expect(bugReport).toContain('GameActions.send');
    expect(server).toContain('GITHUB_ISSUE_TOKEN');
    expect(server).toContain('BUG_REPORT_GITHUB_TOKEN');
    expect(server).toContain('/api/bug-report/status');
    expect(server).toContain('https://api.github.com/repos/${repo}/issues');
    expect(server).toContain('Activity log (oldest → newest)');
  });

  it("does not ship the Septet schema sample as a public game tile", () => {
    const registry = readFileSync(new URL("../src/games/registry.ts", import.meta.url), "utf8");
    expect(registry).not.toContain("SeptetGame");
    expect(gameModules).not.toContain('id: "septet"');
  });

  it("removes the hero Rules button and uses clearer game glyphs", () => {
    expect(html).not.toContain("landing-rules-btn");
    expect(core).toContain("function showRulesMenu");
    expect(gameModules).toContain('icon: "cloud"');
    expect(gameModules).toContain('icon: "seven"');
  });

  it("keeps Flip 7 special-card styling through live deal animation", () => {
    expect(flip7).toContain("caption:'THE ZERO'");
    expect(flip7).toContain("caption:'UNLUCKY'");
    expect(flip7).toContain("caption:'LUCKY'");
    expect(flip7).toContain("special:card.special");
    expect(flip7).toContain("const primary=topNote||bottomNote");
  });

  it("shows game variants directly in the local seat setup flow", () => {
    expect(localSeatEditor).toContain("function renderVariantPicker");
    expect(localSeatEditor).toContain("seat-variant-block");
    expect(localSeatEditor).toContain("window._localVariantPick = variants.length ? selectedVariantId");
    expect(networkLocal).toContain("function defaultLocalVariant");
    expect(networkLocal).toContain("window.startLocalForGame = function(gameId, opts={})");
    expect(landingCss).toContain(".seat-variant-block");
  });

  it("provides a reusable face-up card inspection API", () => {
    const cards = readFileSync(new URL("../public/js/00-cards.js", import.meta.url), "utf8");
    const css = readFileSync(new URL("../public/styles/main.css", import.meta.url), "utf8");
    expect(cards).toContain("function inspectEl");
    expect(cards).toContain("Kit.Cards = { el, anchor");
    expect(cards).toContain("inspect: inspectEl");
    expect(css).toContain(".kit-card-inspect-overlay");
    expect(css).toContain(".kit-card-inspect-card.kc");
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
    expect(qwixx).toContain("renderMiniBoard");
    // The on-board move SUGGESTION ("Suggested: …") was removed by request — the
    // cell hints (markHintsFor) stay, but no recommended-move banner/helper.
    expect(qwixx).not.toContain("recommendedMove");
    expect(qwixx).not.toContain("qwixx-reco");
  });

  it("re-dispatches Qwixx after a throw so bot scheduling and status refresh resume", () => {
    expect(qwixx).toContain("dispatchView(window._renderView)");
  });
});

describe("client cross-game cleanup regressions", () => {
  it("has a shared Qwixx UI cleanup helper", () => {
    expect(networkLocal).toContain("function removeQwixxUi()");
    expect(networkLocal).toContain(".qwixx-dice-zone,.qwixx-top-mini-strip,.skyjo-action-zone");
  });

  it("uses shell cleanup/lifecycle before game switches", () => {
    expect(core).toContain("function unmount");
    expect(core).toContain("clearGlobal()");
    expect(networkLocal).toContain("GameShell.unmount()");
  });

  it("cancels lingering local sessions and Flip7 timelines on quit", () => {
    // resetLocalSession exists, quitLocal calls it + resetGameUi + back-to-menu.
    // (Phase 6 reformatted quitLocal across multiple lines; assert each part
    // separately instead of pinning a one-liner.)
    expect(networkLocal).toContain('function resetLocalSession()');
    expect(networkLocal).toMatch(/function\s+quitLocal[\s\S]{0,400}resetLocalSession\(\)/);
    expect(networkLocal).toMatch(/function\s+quitLocal[\s\S]{0,400}resetGameUi\(\)/);
    expect(networkLocal).toMatch(/function\s+quitLocal[\s\S]{0,400}showScreen\(['"]menuScreen['"]\)/);
    expect(flip7).toContain('let lastSeq=-1, lifecycleToken=0;');
    expect(flip7).toContain('invalidateToken()');
    expect(flip7).toContain('tokenAlive(token)');
  });
});


describe("schema game client (Encore) regressions", () => {
  it("rotates pass-and-play focus via localFocusSeat (roller, then next pending human)", () => {
    // Encore is a roller-then-everyone-marks game; without localFocusSeat the
    // shared-device view sticks on whoever acted first and never passes.
    expect(schemaClient).toContain("function localFocusSeat");
    expect(schemaClient).toMatch(/const client = \{[^}]*localFocusSeat[^}]*\}/);
    // it reads the engine's raw rollAndWrite state fields
    expect(schemaClient).toContain("state.pending");
    expect(schemaClient).toContain("state.active");
  });

  it("gives the active roller a pullable lever (others auto-pull) like Qwixx", () => {
    expect(schemaClient).toContain("rollerIsMine");
    expect(schemaClient).toMatch(/lever:\s*useLever/);
    expect(schemaClient).toMatch(/autoPull:\s*!useLever/);
  });

  it("renders a joker/wild tracker (8 pips, used vs available)", () => {
    expect(schemaClient).toContain("rw-jokers");
    expect(schemaClient).toContain("rw-joker-pip");
    expect(schemaClient).toContain("wildsUsed");
  });

  it("highlights cells the player can legally mark right now (smart hint)", () => {
    expect(schemaClient).toContain("function rwHintSet");
    expect(schemaClient).toContain("rw-markable");
    expect(schemaClient).toContain("rwUsableColor");
  });

  it("detects perfect-match blocks and fills them in one tap", () => {
    expect(schemaClient).toContain("function rwPerfectBlocks");
    expect(schemaClient).toContain("function rwFillBlock");
    expect(schemaClient).toContain("rw-perfect");
    // a perfect block must size-match the CHOSEN number die exactly
    expect(schemaClient).toContain("pick.sizes.includes(clump.size)");
  });

  it("shows a coloured cross on selected cells and greys out non-targets after a pick", () => {
    expect(schemaClient).toContain("rw-selcross");
    expect(schemaClient).toContain("rw-locked-out");
    // once dice are chosen, everything that isn't a legal target greys out
    expect(schemaClient).toMatch(/showHints && !sel && !block && !isHint/);
  });

  it("requires picking dice FIRST, then shows pick-gated highlights", () => {
    // highlights only appear once a colour + number die are chosen (or a run is live)
    expect(schemaClient).toContain("function rwPickResolved");
    expect(schemaClient).toContain("function rwPickColors");
    expect(schemaClient).toMatch(/showHints = interactive && \(pickComplete \|\| runActive\)/);
    // req: don't highlight clumps too small for the chosen number
    expect(schemaClient).toContain("clump.size < minNeeded");
  });

  it("auto-locks the dice pick at 2 (no select-dice button) via the slot machine", () => {
    expect(schemaClient).toContain("function pickReel");
    expect(schemaClient).toContain("auto-lock");
    // the slot SELECT phase is driven through Kit.Roller showStatic prompt/pickable
    expect(schemaClient).toMatch(/prompt: promptable \? 'SELECT'/);
    expect(schemaClient).toContain("onReelClick: pickReel");
  });

  it("passes a leverHint ('ROLL') so the roller's slot machine shows a cue", () => {
    expect(schemaClient).toContain("leverHint: 'ROLL'");
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

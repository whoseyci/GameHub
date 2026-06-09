import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const core = readFileSync(new URL("../public/js/00-core.js", import.meta.url), "utf8");
const networkLocal = readFileSync(new URL("../public/js/01-network-local.js", import.meta.url), "utf8");
const skyjo = readFileSync(new URL("../public/js/03-skyjo.js", import.meta.url), "utf8");
const qwixx = readFileSync(new URL("../public/js/02-qwixx.js", import.meta.url), "utf8");
const flip7 = readFileSync(new URL("../public/js/04-flip7.js", import.meta.url), "utf8");

describe("client module split", () => {
  it("loads frontend scripts as smaller ordered files", () => {
    for (const file of ["00-core", "01-network-local", "02-qwixx", "03-skyjo", "04-flip7", "05-bots-init"]) {
      expect(html).toContain(`/js/${file}.js`);
    }
    expect(html).toContain('/styles/main.css');
  });
});

describe("shared game shell", () => {
  it("defines shared table shell and routes game dispatch through it", () => {
    expect(core).toContain("const SeatModel");
    expect(core).toContain("const GameShell");
    expect(core).toContain("function renderTable");
    expect(networkLocal).toContain("GameShell.render(view,client)");
  });

  it("migrates built-in games to GameShell.renderTable", () => {
    expect(qwixx).toContain("GameShell.renderTable");
    expect(skyjo).toContain("GameShell.renderTable");
    expect(flip7).toContain("GameShell.renderTable");
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

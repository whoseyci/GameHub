import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
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

  it("cleans Qwixx dice UI before rendering Skyjo or Flip7", () => {
    const skyjoRender = skyjo.match(/function render\(view\)\{\n\s+removeQwixxUi\(\);\n\s+\$\('topArea'\)\.style\.display=''; \/\/ Skyjo uses/);
    expect(skyjoRender).not.toBeNull();

    const flip7Draw = flip7.match(/function draw\(view\)\{\n\s+removeQwixxUi\(\);\n\s+const s=view\.flip7/);
    expect(flip7Draw).not.toBeNull();
  });
});

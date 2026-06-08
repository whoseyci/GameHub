import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

describe("client cross-game cleanup regressions", () => {
  it("has a shared Qwixx UI cleanup helper", () => {
    expect(html).toContain("function removeQwixxUi()");
    expect(html).toContain("querySelector('.qwixx-dice-zone')");
  });

  it("cleans Qwixx dice UI before rendering Skyjo or Flip7", () => {
    const skyjoRender = html.match(/function render\(view\)\{\n\s+removeQwixxUi\(\);\n\s+\$\('topArea'\)\.style\.display=''; \/\/ Skyjo uses/);
    expect(skyjoRender).not.toBeNull();

    const flip7Draw = html.match(/function draw\(view\)\{\n\s+removeQwixxUi\(\);\n\s+const s=view\.flip7/);
    expect(flip7Draw).not.toBeNull();
  });
});

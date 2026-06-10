// game-client-parity.test.ts — closes the one cross-layer loophole for new games:
// a game registered SERVER-side must also have a matching CLIENT (GameClients
// registration, rule text, loaded script, and fallback-catalogue entry). Without
// this, the lobby would offer a game whose client breaks at runtime, with nothing
// catching it. Runs over every registered game automatically.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { GAMES } from "../src/games/registry";

const pub = (p: string) => readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8");
const core = pub("js/00-core.js");
const indexHtml = pub("js/../index.html");
// All client JS concatenated (game clients live in 02/03/04-*.js and js/games/*).
const clientJs = readdirSync(new URL("../public/js", import.meta.url))
  .filter((f) => f.endsWith(".js"))
  .map((f) => pub(`js/${f}`))
  .join("\n");

describe("server game ↔ client parity", () => {
  for (const id of Object.keys(GAMES)) {
    describe(id, () => {
      it("has a client GameClients registration", () => {
        // matches window.GameClients['id'] = ... or window.GameClients['id']={...}
        const re = new RegExp(`GameClients\\[['"]${id}['"]\\]\\s*=`);
        expect(re.test(clientJs)).toBe(true);
      });
      it("registers rule text (GameRules)", () => {
        const re = new RegExp(`GameRules\\[['"]${id}['"]\\]\\s*=`);
        expect(re.test(clientJs)).toBe(true);
      });
      it("is present in the hardcoded fallback catalogue", () => {
        const re = new RegExp(`id\\s*:\\s*['"]${id}['"]`);
        expect(re.test(core)).toBe(true);
      });
      it("its client script is loaded by index.html (or via js/games/)", () => {
        // Built-ins are 02/03/04-*.js; scaffolded games load /js/games/<id>.js.
        const loadedViaGames = indexHtml.includes(`/js/games/${id}.js`);
        // For built-ins, the GameClients registration lives in a loaded numbered file.
        const loadedScripts = [...indexHtml.matchAll(/<script\s+src="\/js\/([^"]+)"/g)].map((m) => m[1]);
        const registeredIn = loadedScripts.some((rel) => {
          try { return new RegExp(`GameClients\\[['"]${id}['"]\\]`).test(pub(`js/${rel}`)); }
          catch { return false; }
        });
        expect(loadedViaGames || registeredIn).toBe(true);
      });
    });
  }
});

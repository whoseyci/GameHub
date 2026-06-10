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
// All client JS concatenated. Built-in clients live in top-level 02/03/04-*.js;
// scaffolded clients live in js/games/<id>.js — include BOTH (recurse one level).
const topJs = readdirSync(new URL("../public/js", import.meta.url)).filter((f) => f.endsWith(".js")).map((f) => `js/${f}`);
let gamesJs: string[] = [];
try { gamesJs = readdirSync(new URL("../public/js/games", import.meta.url)).filter((f) => f.endsWith(".js")).map((f) => `js/games/${f}`); } catch { /* none */ }
const clientJs = [...topJs, ...gamesJs]
  .map((rel) => pub(rel))
  .join("\n");

describe("server game ↔ client parity", () => {
  for (const id of Object.keys(GAMES)) {
    describe(id, () => {
      // A client file registers either with a string literal (GameClients['id'])
      // or via a local `const ID='id'` + GameClients[ID] (the scaffold's style).
      const registersWith = (sym: string) => {
        const literal = new RegExp(`${sym}\\[['"]${id}['"]\\]\\s*=`);
        if (literal.test(clientJs)) return true;
        // variable form: a file that declares ID='id' AND uses ${sym}[ID]=
        const idDecl = new RegExp(`ID\\s*=\\s*['"]${id}['"]`);
        const varUse = new RegExp(`${sym}\\[ID\\]\\s*=`);
        return idDecl.test(clientJs) && varUse.test(clientJs);
      };
      it("has a client GameClients registration", () => {
        expect(registersWith("GameClients")).toBe(true);
      });
      it("registers rule text (GameRules)", () => {
        expect(registersWith("GameRules")).toBe(true);
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

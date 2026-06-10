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
let botsJs: string[] = [];
try { botsJs = readdirSync(new URL("../public/js/bots", import.meta.url)).filter((f) => f.endsWith(".js")).map((f) => `js/bots/${f}`); } catch { /* none */ }
const clientJs = [...topJs, ...gamesJs, ...botsJs]
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
      it("is present in the client catalogue bundle (single source of truth)", () => {
        // The catalogue is no longer hand-maintained in 00-core.js; it is derived
        // from the SAME registry the server uses, bundled into the browser. So a
        // registered game must appear in the generated bundle, and 00-core must
        // build `catalogue` from window.GameCatalogue (not a hardcoded array).
        const bundle = pub("js/00-game-modules.js");
        const re = new RegExp(`id\\s*:\\s*['"]${id}['"]`);
        expect(re.test(bundle)).toBe(true);
        expect(core.includes("window.GameCatalogue")).toBe(true);
      });
      it("if it advertises hasBots, a BotDriver strategy is registered + its bot script is loaded", () => {
        const hasBots = GAMES[id].meta.features?.hasBots === true;
        if (!hasBots) return; // games without bots need no strategy
        // A strategy registration: BotDriver.register('<id>', …) somewhere in client JS.
        const registered = new RegExp(`BotDriver\\.register\\(\\s*['"]${id}['"]`).test(clientJs);
        expect(registered, `hasBots=true for "${id}" but no BotDriver.register('${id}') found`).toBe(true);
        // And the bot script must actually be loaded by the page.
        const loadedScripts = [...indexHtml.matchAll(/<script\s+src="\/js\/([^"]+)"/g)].map((m) => m[1]);
        const botLoaded = loadedScripts.some((rel) => {
          try { return new RegExp(`BotDriver\\.register\\(\\s*['"]${id}['"]`).test(pub(`js/${rel}`)); }
          catch { return false; }
        });
        expect(botLoaded, `bot strategy for "${id}" exists but its script is not loaded by index.html`).toBe(true);
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

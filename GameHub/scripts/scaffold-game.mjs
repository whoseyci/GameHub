#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const m = arg.match(/^--([^=]+)=(.*)$/);
  return m ? [m[1], m[2]] : [arg, true];
}));

const id = String(args.id || '').trim();
const name = String(args.name || '').trim();
const emoji = String(args.emoji || '🧩');
const min = Number(args.min || 2);
const max = Number(args.max || 8);

if (!/^[a-z][a-z0-9_]*$/.test(id) || !name || !Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) {
  console.error('Usage: node scripts/scaffold-game.mjs --id=hearts --name="Hearts" --emoji=♥️ --min=3 --max=4');
  console.error('id must match /^[a-z][a-z0-9_]*$/');
  process.exit(1);
}

const pascal = id.split('_').map((s) => s[0].toUpperCase() + s.slice(1)).join('');
const tsPath = `src/games/${id}.ts`;
const clientPath = `public/js/games/${id}.js`;
const testPath = `tests/${id}.test.ts`;
for (const path of [tsPath, clientPath, testPath]) {
  if (existsSync(path)) throw new Error(`${path} already exists`);
  mkdirSync(dirname(path), { recursive: true });
}

writeFileSync(tsPath, `import type { GameModule, GameView } from "./types";\nimport { makeSeed, type RngStateHolder } from "../rng";\n\ninterface ${pascal}Player { name: string; score: number; }\ninterface ${pascal}State extends RngStateHolder {\n  schemaVersion: number;\n  players: ${pascal}Player[];\n  phase: "PLAY" | "GAME_OVER";\n  current: number;\n  log: unknown[];\n}\n\nexport const ${pascal}: GameModule = {\n  meta: {\n    id: "${id}",\n    name: "${name}",\n    minPlayers: ${min},\n    maxPlayers: ${max},\n    description: "TODO: describe ${name}.",\n    emoji: "${emoji}",\n  },\n\n  create(names: string[]): ${pascal}State {\n    return {\n      schemaVersion: 1,\n      rngState: makeSeed(),\n      players: names.map((name) => ({ name, score: 0 })),\n      phase: "PLAY",\n      current: 0,\n      log: [],\n    };\n  },\n\n  applyAction(state: ${pascal}State, seat: number, msg: any): void {\n    if (state.phase !== "PLAY") return;\n    if (seat !== state.current) return;\n    if (msg.action !== "example") return;\n    state.log.push({ seat, action: msg.action });\n    state.current = (state.current + 1) % state.players.length;\n  },\n\n  viewFor(state: ${pascal}State, seat: number): GameView {\n    return {\n      game: "${id}",\n      phase: state.phase,\n      over: state.phase === "GAME_OVER",\n      yourSeat: seat,\n      ${id}: {\n        current: state.current,\n        players: state.players.map((p, seat) => ({ seat, name: p.name, score: p.score })),\n      },\n    };\n  },\n\n  isOver(state: ${pascal}State): boolean { return state.phase === "GAME_OVER"; },\n};\n`);

writeFileSync(clientPath, `(function(){\n  const ID = '${id}';\n\n  function act(action, extra = {}) {\n    const msg = { action, ...extra };\n    if (mode === 'local') localAct(window._renderView?.yourSeat ?? 0, msg);\n    else net.send({ type: 'action', ...msg });\n  }\n\n  function render(view) {\n    removeQwixxUi();\n    $('topArea').style.display = 'none';\n    $('miniBoardsContainer').innerHTML = '';\n    const s = view[ID];\n    $('mainBoardsContainer').innerHTML = '<div class="player-board"><div class="player-title">${emoji} ${name}</div><div class="muted">TODO: render game state.</div><button class="btn" onclick="window.GameClients[\\'' + ID + '\\'].act(\\'example\\')">Example action</button></div>';\n    $('statusBar').textContent = view.yourSeat < 0 ? 'Spectating' : (s.current === view.yourSeat ? 'Your turn' : 'Waiting…');\n    if (view.summary && !summaryShown) showSummary(view);\n  }\n\n  window.GameClients[ID] = { render, act };\n})();\n`);

writeFileSync(testPath, `import { describe, expect, it } from "vitest";\nimport { ${pascal} } from "../src/games/${id}";\n\ndescribe("${name}", () => {\n  it("creates serializable state and views", () => {\n    const state = ${pascal}.create(["A", "B"${min > 2 ? ', "C"'.repeat(min - 2) : ''}]);\n    expect(JSON.parse(JSON.stringify(state))).toEqual(state);\n    expect(${pascal}.viewFor(state, 0).game).toBe("${id}");\n    expect(${pascal}.viewFor(state, -1).yourSeat).toBe(-1);\n  });\n});\n`);

let registry = readFileSync('src/games/registry.ts', 'utf8');
registry = registry.replace('import { Qwixx } from "./qwixx";\n', `import { Qwixx } from "./qwixx";\nimport { ${pascal} } from "./${id}";\n`);
registry = registry.replace('  [Qwixx.meta.id]: Qwixx,\n};', `  [Qwixx.meta.id]: Qwixx,\n  [${pascal}.meta.id]: ${pascal},\n};`);
writeFileSync('src/games/registry.ts', registry);

let html = readFileSync('public/index.html', 'utf8');
const script = `<script src="/js/games/${id}.js"></script>\n`;
if (!html.includes(script)) html = html.replace('<script src="/js/05-bots-init.js"></script>', `${script}<script src="/js/05-bots-init.js"></script>`);
writeFileSync('public/index.html', html);

console.log(`Scaffolded ${name} (${id}). Next:`);
console.log(`  1. Implement rules in ${tsPath}`);
console.log(`  2. Implement UI in ${clientPath}`);
console.log(`  3. Expand tests in ${testPath}`);
console.log('  4. Run npm run validate');

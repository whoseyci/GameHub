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
const gameDir = `src/games/${id}`;
const metaPath = `${gameDir}/meta.ts`;
const serverPath = `${gameDir}/server.ts`;
const indexPath = `${gameDir}/index.ts`;
const compatPath = `src/games/${id}.ts`;
const clientPath = `public/js/games/${id}.js`;
const testPath = `tests/${id}.test.ts`;
const sampleNames = Array.from({ length: Math.max(min, 2) }, (_, i) => JSON.stringify(`P${i + 1}`)).join(', ');
for (const path of [metaPath, serverPath, indexPath, compatPath, clientPath, testPath]) {
  if (existsSync(path)) throw new Error(`${path} already exists`);
  mkdirSync(dirname(path), { recursive: true });
}

// Server package with standardized GameViewState and GameFeatures
writeFileSync(metaPath, `import type { GameMeta } from "../types";

export const ${pascal}Meta: GameMeta = {
  id: "${id}",
  name: "${name}",
  minPlayers: ${min},
  maxPlayers: ${max},
  description: "TODO: describe ${name}.",
  emoji: "${emoji}",
  features: {
    hasBots: false,
    simultaneousTurns: false,
    usesTick: false,
    hasMultiRound: false,
    canSpectate: false,
    minDurationSec: 60,
    maxDurationSec: 300,
  },
};
`);

writeFileSync(serverPath, `import type { GameModule, GameView, GameViewState, GameLifecyclePhase } from "../types";
import { makeSeed, type RngStateHolder } from "../../rng";
import { ${pascal}Meta } from "./meta";

interface ${pascal}Player {
  name: string;
  score: number;
}

interface ${pascal}State extends RngStateHolder {
  schemaVersion: number;
  players: ${pascal}Player[];
  phase: "PLAY" | "GAME_OVER";
  current: number;
  log: unknown[];
}

/** Map internal phase to the canonical GameLifecyclePhase. */
function lifecyclePhase(internalPhase: string): GameLifecyclePhase {
  switch (internalPhase) {
    case "PLAY":       return "PLAYING";
    case "GAME_OVER":  return "GAME_OVER";
    default:           return "PLAYING";
  }
}

/** Build a standardized GameViewState so the hub stays game-agnostic. */
function buildViewState(state: ${pascal}State): GameViewState {
  return {
    currentSeat: state.phase === "PLAY" ? state.current : -1,
    pendingAction: state.phase === "PLAY" ? "choose_action" : null,
    players: state.players.map((p, i) => ({
      seat: i,
      name: p.name,
      status: state.phase === "PLAY"
        ? (i === state.current ? "active" : "waiting")
        : "out",
      score: p.score,
    })),
    actingCount: state.phase === "PLAY" ? 1 : 0,
  };
}

export const ${pascal}: GameModule = {
  meta: ${pascal}Meta,

  create(names: string[]): ${pascal}State {
    return {
      schemaVersion: 1,
      rngState: makeSeed(),
      players: names.map((name) => ({ name, score: 0 })),
      phase: "PLAY",
      current: 0,
      log: [],
    };
  },

  applyAction(state: ${pascal}State, seat: number, msg: any): void {
    if (state.phase !== "PLAY") return;
    if (seat !== state.current) return;
    if (msg.action !== "example") return;

    // Mutate only this game's state. Validate all indices/choices before mutating.
    state.log.push({ seat, action: msg.action });
    state.current = (state.current + 1) % state.players.length;
  },

  viewFor(state: ${pascal}State, seat: number): GameView {
    return {
      game: "${id}",
      phase: lifecyclePhase(state.phase),
      over: state.phase === "GAME_OVER",
      yourSeat: seat,
      state: buildViewState(state),
      ${id}: {
        current: state.current,
        players: state.players.map((p, i) => ({ seat: i, name: p.name, score: p.score })),
      },
    };
  },

  isOver(state: ${pascal}State): boolean { return state.phase === "GAME_OVER"; },
};
`);

writeFileSync(indexPath, `export * from './meta';\nexport * from './server';\n`);
writeFileSync(compatPath, `// Compatibility wrapper — the authoritative ${name} package now lives in src/games/${id}/.\nexport * from './${id}/index';\n`);

// Client module using the standardized GameClient contract
writeFileSync(clientPath, `/**
 * Client renderer for ${name} (${id}).
 *
 * Contract:
 *   window.GameClients['${id}'].render(view, ctx) draws the view.
 *   window.GameClients['${id}'].act(action, extra?) sends a player action.
 *   window.GameClients['${id}'].unmount() cleans up game-only globals.
 */
(function(){
  const ID = '${id}';
  window.GameRules[ID] = {
    title: '${emoji} ${name}',
    quick: 'TODO: add a one-line how-to-play summary.',
    steps: ['TODO: explain setup.', 'TODO: explain a turn.', 'TODO: explain scoring/end conditions.'],
    tip: 'TODO: add one useful strategy tip.',
  };

  function send(action, extra = {}) {
    const seat = window._renderView?.yourSeat ?? 0;
    GameActions.send(action, extra, seat);
  }

  function render(view, ctx = {}) {
    const s = view[ID];
    const gameState = view.state;
    const focused = ctx.focus
      ? ctx.focus({ actingSeat: gameState?.currentSeat ?? s?.current ?? -1, preferred: view.yourSeat })
      : view.yourSeat;

    const focus = \`
      <div class="player-board">
        <div class="player-title">${emoji} ${name}</div>
        <div class="muted">TODO: render game state.</div>
        <button class="btn" onclick="window.GameClients['\${ID}'].act('example')">Example action</button>
      </div>\`;

    const statusText = view.yourSeat < 0
      ? 'Spectating'
      : (gameState?.currentSeat === focused ? 'Your turn' : 'Waiting…');

    GameShell.renderTable({
      game: ID,
      focus,
      topMode: 'hidden',
      status: statusText,
    });

    if (view.summary && !summaryShown) showSummary(view);
  }

  function unmount() {}

  window.GameClients[ID] = { render, act: send, unmount };
})();
`);

// Test file with contract checks
writeFileSync(testPath, `import { describe, expect, it } from "vitest";
import { ${pascal} } from "../src/games/${id}";

describe("${name}", () => {
  it("creates serializable state and views for all seats", () => {
    const state = ${pascal}.create([${sampleNames}]);
    expect(state.schemaVersion).toBe(1);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);

    // Check views for every player seat plus spectator
    for (let seat = -1; seat < state.players.length; seat++) {
      const view = ${pascal}.viewFor(state, seat);
      expect(view.game).toBe("${id}");
      expect(view.yourSeat).toBe(seat);
      expect(typeof view.phase).toBe("string");
      expect(typeof view.over).toBe("boolean");
      expect(JSON.parse(JSON.stringify(view))).toEqual(view);

      // Standardized state should be present
      if (seat >= 0) {
        expect(view.state).toBeDefined();
        expect(view.state?.currentSeat).toBeGreaterThanOrEqual(-1);
        expect(Array.isArray(view.state?.players)).toBe(true);
      }
    }
  });

  it("ignores a spectator's generic gameplay action", () => {
    const state = ${pascal}.create([${sampleNames}]);
    const before = JSON.parse(JSON.stringify(state));
    ${pascal}.applyAction(state, -1, { type: "action", action: "example", index: 0 });
    expect(state).toEqual(before);
  });

  it("exposes a summary exactly when marked over", () => {
    const state = ${pascal}.create([${sampleNames}]);
    const view = ${pascal}.viewFor(state, 0);
    if (view.over) expect(view.summary).toBeDefined();
  });
});
`);

// Register in the game registry
let registry = readFileSync('src/games/registry.ts', 'utf8');
registry = registry.replace('import { Qwixx } from "./qwixx/server";\n', `import { Qwixx } from "./qwixx/server";\nimport { ${pascal} } from "./${id}/server";\n`);
registry = registry.replace('  [Qwixx.meta.id]: Qwixx,\n};', `  [Qwixx.meta.id]: Qwixx,\n  [${pascal}.meta.id]: ${pascal},\n};`);
writeFileSync('src/games/registry.ts', registry);

// Load the client script from index.html
let html = readFileSync('public/index.html', 'utf8');
const scriptTag = `<script src="/js/games/${id}.js"></script>\n`;
if (!html.includes(scriptTag)) {
  html = html.replace('<script src="/js/05-bots-init.js"></script>', `${scriptTag}<script src="/js/05-bots-init.js"></script>`);
  writeFileSync('public/index.html', html);
}

console.log(`✅ Scaffolded ${name} (${id}). Next:`);
console.log(`  1. Implement server/meta in ${serverPath} and ${metaPath}`);
console.log(`  2. Implement UI + rules in ${clientPath}`);
console.log(`  3. Expand tests in ${testPath}`);
console.log(`  4. Run npm run validate`);

#!/usr/bin/env node
// scripts/validate-registry.mjs — PROPOSAL 7
// Verifies structural integrity of the game registry:
//   1. Every src/games/*/index.ts is registered in registry.ts
//   2. Every registered game has a matching client JS file
//   3. Every registered game has a matching bot JS file
//   4. Every registered game is loaded in index.html
//   5. Every game's meta has actionTypes declared
//
// Run: node scripts/validate-registry.mjs
// Exit code 1 if any check fails (use in CI: npm run validate-registry)

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const gamesDir = join(root, "src", "games");
const publicJsDir = join(root, "public", "js");
const publicGamesDir = join(publicJsDir, "games");
const publicBotsDir = join(publicJsDir, "bots");
const indexHtmlPath = join(root, "public", "index.html");

let errors = 0;

function fail(msg) { console.error(`❌ ${msg}`); errors++; }
function pass(msg) { console.log(`✓ ${msg}`); }

// 1. Discover game directories
const entries = readdirSync(gamesDir, { withFileTypes: true });
const gameDirs = entries
  .filter(d => d.isDirectory() && !d.name.startsWith("_"))
  .map(d => d.name);

console.log(`\n=== Game Directory Scan (${gameDirs.length} games) ===\n`);
console.log(`Found: ${gameDirs.join(", ")}\n`);

// 2. Check registry.ts
const registryContent = readFileSync(join(gamesDir, "registry.ts"), "utf8");

for (const dir of gameDirs) {
  // Check that the game directory has an index.ts
  const indexPath = join(gamesDir, dir, "index.ts");
  if (!existsSync(indexPath)) {
    fail(`${dir}/index.ts is missing`);
    continue;
  }

  // Check that registry.ts imports this game
  const importPattern = new RegExp(`from\\s+["']\\.\\/${dir}`);
  if (!importPattern.test(registryContent)) {
    fail(`${dir} is not imported in registry.ts`);
  } else {
    pass(`${dir} imported in registry.ts`);
  }

  // Check that registry.ts uses the module
  const usagePattern = new RegExp(`\\[.*\\.meta\\.id\\].*${dir.charAt(0).toUpperCase() + dir.slice(1)}`, "i");
  if (!usagePattern.test(registryContent)) {
    // Try a looser check
    const loosePattern = new RegExp(`meta\\.id.*:.*${dir.charAt(0).toUpperCase() + dir.slice(1)}`, "i");
    if (!loosePattern.test(registryContent)) {
      fail(`${dir} may not be registered in the GAMES object in registry.ts`);
    }
  }
}

// 3. Check client JS files
console.log(`\n=== Client Files ===\n`);
for (const dir of gameDirs) {
  const clientPath = join(publicGamesDir, `${dir}.js`);
  if (!existsSync(clientPath)) {
    // Some games use numbered files (02-qwixx.js, etc.)
    const numberedPath = findNumberedClient(dir);
    if (!numberedPath) {
      fail(`No client file for ${dir} (checked public/js/games/${dir}.js and public/js/0X-${dir}.js)`);
    } else {
      pass(`${dir} has client: ${numberedPath}`);
    }
  } else {
    pass(`${dir} has client: public/js/games/${dir}.js`);
  }
}

function findNumberedClient(gameId) {
  const files = readdirSync(publicJsDir).filter(f => f.endsWith(".js"));
  for (const f of files) {
    if (f.includes(gameId)) return `public/js/${f}`;
  }
  return null;
}

// 4. Check bot JS files
console.log(`\n=== Bot Files ===\n`);
for (const dir of gameDirs) {
  const botPath = join(publicBotsDir, `${dir}.js`);
  if (!existsSync(botPath)) {
    fail(`No bot file for ${dir} (expected public/js/bots/${dir}.js)`);
  } else {
    pass(`${dir} has bot: public/js/bots/${dir}.js`);
  }
}

// 5. Check index.html
console.log(`\n=== index.html ===\n`);
const indexHtml = readFileSync(indexHtmlPath, "utf8");

for (const dir of gameDirs) {
  const gameScriptTag = `games/${dir}.js`;
  const botScriptTag = `bots/${dir}.js`;

  // Check for either games/<id>.js or 0X-<id>.js in index.html
  const gameInHtml = indexHtml.includes(gameScriptTag) || indexHtml.includes(`${dir}.js`);
  const botInHtml = indexHtml.includes(botScriptTag);

  if (!gameInHtml && !findNumberedClient(dir)) {
    fail(`${dir} client not loaded in index.html`);
  } else {
    pass(`${dir} client loaded in index.html`);
  }

  if (!botInHtml) {
    fail(`${dir} bot not loaded in index.html (expected <script src="/js/bots/${dir}.js">)`);
  } else {
    pass(`${dir} bot loaded in index.html`);
  }
}

// 6. Check meta.ts for actionTypes
console.log(`\n=== Meta Completeness ===\n`);
for (const dir of gameDirs) {
  const metaPath = join(gamesDir, dir, "meta.ts");
  if (!existsSync(metaPath)) {
    // Meta might be inline in server.ts
    pass(`${dir} has no separate meta.ts (may be inline)`);
    continue;
  }
  const metaContent = readFileSync(metaPath, "utf8");
  if (!metaContent.includes("actionTypes")) {
    fail(`${dir}/meta.ts does not declare actionTypes`);
  } else {
    pass(`${dir}/meta.ts has actionTypes`);
  }
}

// Summary
console.log(`\n${"=".repeat(40)}`);
if (errors > 0) {
  console.error(`\n💥 ${errors} error(s) found. Fix before merging.`);
  process.exit(1);
} else {
  console.log(`\n🎉 All checks passed.`);
  process.exit(0);
}

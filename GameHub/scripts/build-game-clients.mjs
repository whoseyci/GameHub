#!/usr/bin/env node
// scripts/build-game-clients.mjs — PROPOSAL 8
// Builds per-game client bundles for tree-shaking and lazy loading.
//
// Instead of loading ALL game clients on every page visit, this script
// creates individual bundles:
//   public/js/games/skyjo.bundle.js     ← skyjo client + skyjo bot
//   public/js/games/flip7.bundle.js     ← flip7 client + flip7 bot
//   ...etc
//
// The hub shell (00-core + 00-cards + 01-network-local + bots/driver + 05-bots-init)
// is bundled into public/js/hub.js.
//
// index.html dynamically loads only the needed game bundle after the player
// selects a game.
//
// Run: node scripts/build-game-clients.mjs
//      node scripts/build-game-clients.mjs --watch

import { build } from "esbuild";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const publicDir = join(root, "public", "js");
const args = process.argv.slice(2);

const GAMES = ["skyjo", "qwixx", "flip7", "schotten"];

async function buildAll() {
  // Build hub shell bundle
  console.log("Building hub shell...");
  await build({
    entryPoints: [
      join(publicDir, "00-core.js"),
      join(publicDir, "00-cards.js"),
      join(publicDir, "01-network-local.js"),
    ],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    outfile: join(publicDir, "hub.js"),
    // Don't tree-shake aggressively — these are IIFEs with side effects
    treeShaking: false,
    logLevel: "info",
  });

  // Build per-game bundles (client + bot)
  for (const gameId of GAMES) {
    console.log(`Building ${gameId} bundle...`);

    // Collect entry points for this game
    const entries = [];

    // Client file: could be in games/<id>.js or 0X-<id>.js
    const gameClientPath = join(publicDir, "games", `${gameId}.js`);
    const files = readdirSync(publicDir).filter(f => f.endsWith(".js") && f.includes(gameId));
    if (files.length > 0) {
      entries.push(join(publicDir, files[0]));
    }

    // Bot file
    const botPath = join(publicDir, "bots", `${gameId}.js`);
    entries.push(botPath);

    if (entries.length === 0) {
      console.warn(`⚠️  No entry points for ${gameId}`);
      continue;
    }

    await build({
      entryPoints: entries,
      bundle: true,
      format: "iife",
      platform: "browser",
      target: ["es2020"],
      outfile: join(publicDir, "games", `${gameId}.bundle.js`),
      treeShaking: false,
      logLevel: "info",
    });
  }

  console.log("\n✅ All game bundles built.");
}

if (args.includes("--watch")) {
  console.log("Watch mode not yet implemented for game-client bundles. Use --watch on build:client-games instead.");
  process.exit(1);
} else {
  buildAll().catch(e => { console.error(e); process.exit(1); });
}

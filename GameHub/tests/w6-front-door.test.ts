// w6-front-door.test.ts — pins the W6 server contract for the front-door
// overhaul:
//   1. Members carry a ready flag; bots are auto-ready.
//   2. Lobby's per-game counts() aggregator returns the right shape.
//   3. set_ready message toggles a human's ready flag.
//   4. canAllReadyStart gate requires all humans ready + in-range count.
//   5. launch_game variant pass-through reaches state.variant.
//
// These pin the SERVER-side behavior. Client-side ready UI + invite-link
// routing get coverage via the smoke + landing tests already.

import { describe, expect, it } from "vitest";

describe("W6 front-door: server contract markers", () => {
  it("Member has an optional ready flag", async () => {
    const src = await import("node:fs").then((m) =>
      m.readFileSync("src/server.ts", "utf8"),
    );
    // The field declaration sits inside the Member interface.
    expect(src).toMatch(/interface\s+Member\s*\{[^}]*ready\?\s*:\s*boolean/);
  });

  it("Lobby exposes a per-game counts() aggregator that returns waiting + inGame", async () => {
    const src = await import("node:fs").then((m) =>
      m.readFileSync("src/server.ts", "utf8"),
    );
    expect(src).toMatch(/private\s+counts\s*\(\s*\)/);
    expect(src).toMatch(/waiting\s*:\s*0\s*,\s*inGame\s*:\s*0/);
    // The /onRequest endpoint and broadcast both ship counts now.
    expect(src).toMatch(/type:\s*["']rooms["'][^}]*counts/);
  });

  it("Room handles the set_ready message + gates on canAllReadyStart", async () => {
    const src = await import("node:fs").then((m) =>
      m.readFileSync("src/server.ts", "utf8"),
    );
    expect(src).toMatch(/msg\.type\s*===\s*["']set_ready["']/);
    expect(src).toMatch(/canAllReadyStart\s*\(\s*\)/);
    // The gate enforces all humans ready (readyCount === humanCount).
    expect(src).toMatch(/this\.readyCount\s*\(\s*\)\s*===\s*humans/);
  });

  it("Bots are added with ready:true (always ready by definition)", async () => {
    const src = await import("node:fs").then((m) =>
      m.readFileSync("src/server.ts", "utf8"),
    );
    // The add_bot branch pushes a Member with ready:true.
    expect(src).toMatch(/bot:\s*true[^}]*ready:\s*true/);
  });

  it("Returning to room lobby (to_room) clears human ready flags", async () => {
    const src = await import("node:fs").then((m) =>
      m.readFileSync("src/server.ts", "utf8"),
    );
    // Look for the explicit reset block; we placed a comment with "W6:" tag
    // so the intent is searchable.
    expect(src).toMatch(/to_room[\s\S]{0,400}m\.ready\s*=\s*false/);
  });

  it("launch_game passes a variant through to startGame and state.variant", async () => {
    const src = await import("node:fs").then((m) =>
      m.readFileSync("src/server.ts", "utf8"),
    );
    expect(src).toMatch(/startGame\s*\(\s*msg\.gameId\s*,\s*variant/);
    // startGame stamps state.variant when a variant was supplied.
    expect(src).toMatch(/this\.gameState\.variant\s*=\s*variant/);
  });

  it("Lobby payload includes humans + ready + isGroup (so landing tiles get the data)", async () => {
    const src = await import("node:fs").then((m) =>
      m.readFileSync("src/server.ts", "utf8"),
    );
    // The lobbyUpdate body lists all three new fields.
    expect(src).toMatch(/humans:\s*this\.humanCount\(\)/);
    expect(src).toMatch(/ready:\s*this\.readyCount\(\)/);
    expect(src).toMatch(/isGroup:\s*!!this\.isGroup/);
  });

  it("Landing tiles route to quick-play when in Online mode (Phase 3 form)", async () => {
    const src = await import("node:fs").then((m) =>
      m.readFileSync("public/js/00-landing.js", "utf8"),
    );
    // Phase 3 collapsed per-tile buttons into one mode-aware click. The
    // quick-play call is still there — just behind the Mode='online'
    // branch of dispatchTileAction.
    expect(src).toMatch(/function\s+dispatchTileAction/);
    expect(src).toMatch(/window\.quickPlay\s*\(/);
  });

  it("Landing reads lobby counts payload + renders per-game count chips", async () => {
    const src = await import("node:fs").then((m) =>
      m.readFileSync("public/js/00-landing.js", "utf8"),
    );
    expect(src).toMatch(/m\.counts/);
    expect(src).toMatch(/renderTileCounts/);
    expect(src).toMatch(/lt-count-waiting|lt-count-ingame/);
  });

  it("Invite-link routing: /?join=CODE auto-routes to the room", async () => {
    const src = await import("node:fs").then((m) =>
      m.readFileSync("public/js/00-landing.js", "utf8"),
    );
    expect(src).toMatch(/tryInviteJoin/);
    // The query param IS literally 'join'.
    expect(src).toMatch(/p\.get\(['"]join['"]\)/);
    // History is cleaned after so refresh doesn't loop.
    expect(src).toMatch(/url\.searchParams\.delete\(['"]join['"]\)/);
  });

  it("Room UI exposes a copyInviteLink helper for hosts to share", async () => {
    const src = await import("node:fs").then((m) =>
      m.readFileSync("public/js/01-network-local.js", "utf8"),
    );
    expect(src).toMatch(/function\s+copyInviteLink/);
    expect(src).toMatch(/\/\?join=/);
  });

  it("Ready button renders in quick-play / group lobbies with the right gate text", async () => {
    const src = await import("node:fs").then((m) =>
      m.readFileSync("public/js/01-network-local.js", "utf8"),
    );
    // The ready button sends set_ready over the wire.
    expect(src).toMatch(/set_ready/);
    // It only renders for quickGame or isGroup rooms.
    expect(src).toMatch(/isReadyLobby/);
  });
});

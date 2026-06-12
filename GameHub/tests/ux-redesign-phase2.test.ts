// ux-redesign-phase2.test.ts — pins the Phase 2 contract:
//   1. OnlineSession module exists with the documented surface.
//   2. Lobby socket lifecycle is OnlineSession's responsibility (not
//      landing.js's anymore — old startStatsSocket is gone).
//   3. Mode integration: opens on 'online', closes on 'local' (when not
//      in a room).
//   4. 60s idle close timer.
//   5. Script loads in the right order.
//
// Runtime verification (mode flip actually triggers open) lives in
// scripts/smoke-landing.mjs.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("UX redesign Phase 2 — OnlineSession surface", () => {
  const src = read("public/js/00-online-session.js");

  it("exposes window.OnlineSession with the documented API", () => {
    expect(src).toMatch(/window\.OnlineSession\s*=\s*\{[\s\S]*openLobby[\s\S]*closeLobby[\s\S]*enterRoom[\s\S]*leaveRoom[\s\S]*onLobbyMessage[\s\S]*state:/);
  });

  it("subscribes to Mode.onChange to drive lobby lifecycle", () => {
    expect(src).toMatch(/window\.Mode\.onChange\s*\(\s*onModeChange/);
    expect(src).toMatch(/next\s*===\s*['"]online['"][\s\S]{0,80}openLobby/);
    expect(src).toMatch(/next\s*===\s*['"]local['"][\s\S]{0,200}closeLobby/);
  });

  it("lobby auto-close is gated on 60s of silence AND no active room", () => {
    expect(src).toMatch(/LOBBY_IDLE_MS\s*=\s*60_?000/);
    expect(src).toMatch(/window\.net.*\.room[\s\S]{0,200}armIdleClose|window\.net.*\.room[\s\S]{0,200}return/);
  });

  it("probes for PartyServer before opening (avoids 200-handshake errors)", () => {
    expect(src).toMatch(/fetch\(['"]\/parties\/lobby\/public-lobby['"]/);
    expect(src).toMatch(/content-type[\s\S]{0,80}text\/html/);
  });

  it("enterRoom funnel delegates to existing connectRoom (backwards-compatible)", () => {
    expect(src).toMatch(/function\s+enterRoom[\s\S]*window\.connectRoom\(code,\s*opts\)/);
  });
});

describe("UX redesign Phase 2 — landing no longer owns the lobby socket", () => {
  const src = read("public/js/00-landing.js");

  it("startStatsSocket / probePartyServer are gone (moved to OnlineSession)", () => {
    expect(src).not.toMatch(/function\s+startStatsSocket/);
    expect(src).not.toMatch(/function\s+probePartyServer/);
    expect(src).not.toMatch(/new\s+WebSocket\s*\(/);
  });

  it("subscribes via OnlineSession.onLobbyMessage instead", () => {
    expect(src).toMatch(/OnlineSession\.onLobbyMessage/);
    expect(src).toMatch(/function\s+handleLobbyMessage/);
  });

  it("does NOT patch showScreen to open/close the lobby socket anymore", () => {
    // The old patch wrapped showScreen and closed lobbyWs on screen change.
    // OnlineSession owns lifecycle now; landing just renders.
    expect(src).not.toMatch(/lobbyWs\.close\(\)/);
  });
});

describe("UX redesign Phase 2 — script load order", () => {
  const html = read("public/index.html");
  // Match the actual <script src=> tags, not bare path references in
  // documentation comments earlier in the file.
  const scriptIdx = (path: string) => {
    const m = html.indexOf(`<script src="${path}"`);
    return m;
  };

  it("00-online-session.js loads AFTER 00-mode.js (needs Mode.onChange)", () => {
    const idxMode = scriptIdx('/js/00-mode.js');
    const idxSession = scriptIdx('/js/00-online-session.js');
    expect(idxMode).toBeGreaterThan(-1);
    expect(idxSession).toBeGreaterThan(idxMode);
  });

  it("00-online-session.js loads BEFORE 00-landing.js (so landing's subscribe finds OnlineSession)", () => {
    const idxSession = scriptIdx('/js/00-online-session.js');
    const idxLanding = scriptIdx('/js/00-landing.js');
    expect(idxSession).toBeGreaterThan(-1);
    expect(idxLanding).toBeGreaterThan(idxSession);
  });
});

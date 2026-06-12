// tests/identity.test.ts — friend-code derivation + recent-players LRU contract.
//
// 00-identity.js is browser-only (touches window/localStorage), so we mount it
// in a minimal jsdom and exercise the public window.Identity API.

import { describe, expect, it, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadIdentity() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://gamehub.test/",
    runScripts: "dangerously",
  });
  const w = dom.window;
  // Minimal localStorage already provided by JSDOM. Inject the script.
  const code = readFileSync(join(process.cwd(), "public/js/00-identity.js"), "utf8");
  const s = w.document.createElement("script");
  s.textContent = code;
  w.document.body.appendChild(s);
  return w.Identity as any;
}

describe("Identity", () => {
  it("creates a stable pid + friend code on first load", () => {
    const I = loadIdentity();
    expect(I.pid).toMatch(/^p_/);
    expect(I.friendCode).toMatch(/^[A-Z]{3,4}-[A-Z0-9]{3}$/);
  });

  it("friend code is deterministic for a given pid", () => {
    const I = loadIdentity();
    expect(I._deriveFriendCode("p_test_abc123")).toBe(I._deriveFriendCode("p_test_abc123"));
    expect(I._deriveFriendCode("p_test_abc123")).not.toBe(I._deriveFriendCode("p_test_zyx987"));
  });

  it("recordEncounter inserts, dedupes by pid, and bumps lastSeen", async () => {
    const I = loadIdentity();
    I.recordEncounter({ pid: "p_alice", name: "Alice" });
    I.recordEncounter({ pid: "p_bob",   name: "Bob"   });
    expect(I.getRecents().map((r: any) => r.name)).toEqual(["Bob", "Alice"]);
    // Bumping Alice should move her to the front.
    await new Promise((r) => setTimeout(r, 5));
    I.recordEncounter({ pid: "p_alice", name: "Alice" });
    expect(I.getRecents()[0].name).toBe("Alice");
  });

  it("ignores self-encounters", () => {
    const I = loadIdentity();
    I.recordEncounter({ pid: I.pid, name: "Me" });
    expect(I.getRecents()).toHaveLength(0);
  });

  it("recordGameResult updates per-game W/L for known recents only", () => {
    const I = loadIdentity();
    I.recordEncounter({ pid: "p_bob", name: "Bob" });
    I.recordGameResult({
      gameId: "skyjo",
      winners: [0],
      players: [
        { seat: 0, pid: I.pid },     // I won
        { seat: 1, pid: "p_bob" },   // Bob lost
        { seat: 2, pid: "p_charlie" }, // unknown — must be ignored
      ],
    });
    const bob = I.getRecents().find((r: any) => r.pid === "p_bob");
    expect(bob.games.skyjo).toEqual({ w: 1, l: 0 });
    expect(I.getRecents().find((r: any) => r.pid === "p_charlie")).toBeUndefined();
  });

  it("ties / multi-winner games leave the W/L counter unchanged", () => {
    const I = loadIdentity();
    I.recordEncounter({ pid: "p_bob", name: "Bob" });
    I.recordGameResult({
      gameId: "qwixx",
      winners: [0, 1], // both won — counts as draw
      players: [
        { seat: 0, pid: I.pid },
        { seat: 1, pid: "p_bob" },
      ],
    });
    expect(I.getRecents()[0].games?.qwixx).toBeUndefined();
  });

  it("forgetRecent removes one; clearRecents wipes all", () => {
    const I = loadIdentity();
    I.recordEncounter({ pid: "p_a", name: "A" });
    I.recordEncounter({ pid: "p_b", name: "B" });
    I.forgetRecent("p_a");
    expect(I.getRecents().map((r: any) => r.pid)).toEqual(["p_b"]);
    I.clearRecents();
    expect(I.getRecents()).toHaveLength(0);
  });

  it("LRU caps recents at 24 entries", () => {
    const I = loadIdentity();
    for (let i = 0; i < 40; i++) I.recordEncounter({ pid: `p_${i}`, name: `N${i}` });
    expect(I.getRecents()).toHaveLength(24);
    // Newest should be first.
    expect(I.getRecents()[0].pid).toBe("p_39");
  });

  it("summarizeRecent renders a W-L · last-seen string", () => {
    const I = loadIdentity();
    I.recordEncounter({ pid: "p_x", name: "X" });
    I.recordGameResult({
      gameId: "skyjo",
      winners: [1],
      players: [{ seat: 0, pid: I.pid }, { seat: 1, pid: "p_x" }],
    });
    const s = I.summarizeRecent(I.getRecents()[0]);
    expect(s).toMatch(/0–1/);
    expect(s).toMatch(/just now/);
  });
});

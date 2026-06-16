// social.test.ts — pins the client Social layer (chat panel + reaction FX).
//
// 00-social.js renders chat, floats reaction emojis, and gates the buttons to
// online play. jsdom has no real layout/animation, so we assert DOM/state
// behaviour and the public API contract.

import { describe, expect, it, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function mount() {
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <button id="chatBtn"></button>
      <button id="reactBtn" class="hidden"></button>
      <div id="reactionFxLayer"></div>
    </body></html>`,
    { url: "https://gamehub.test/", runScripts: "dangerously", pretendToBeVisual: true }
  );
  const win: any = dom.window;
  win.matchMedia = () => ({ matches: false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, dispatchEvent(){ return false; } });
  // a fake net so sends don't throw
  win.net = { send: (o: any) => { (win.__sent ||= []).push(o); return true; }, ws: { readyState: 1 } };
  win.getPid = () => "p_test";
  // Kit.Emotes (00-emotes.js) is a dependency of the emote rendering. It needs a
  // global `Kit`; 00-cards/00-core define it in the app, but for this focused
  // test we provide a minimal Kit before loading the emote + social modules.
  win.Kit = win.Kit || {};
  for (const f of ["public/js/00-emotes.js", "public/js/00-social.js"]) {
    const code = readFileSync(join(process.cwd(), f), "utf8");
    const s = win.document.createElement("script");
    s.textContent = code;
    win.document.body.appendChild(s);
  }
  return win;
}

let win: any;
beforeEach(() => { win = mount(); });

describe("Social — API + behaviour", () => {
  it("exposes the public API", () => {
    for (const k of ["handleNet", "toggleChat", "toggleReactions", "sendReaction", "setActive", "reset", "REACTIONS"]) {
      expect(win.Social[k]).toBeDefined();
    }
    expect(Array.isArray(win.Social.REACTIONS)).toBe(true);
  });

  it("renders an incoming chat message into the panel", () => {
    win.Social.handleNet({ type: "chat", seat: 1, name: "Bob", text: "gg wp", ts: Date.now() });
    const msgs = win.document.querySelectorAll(".social-chat-msg");
    expect(msgs.length).toBe(1);
    expect(msgs[0].textContent).toContain("Bob");
    expect(msgs[0].textContent).toContain("gg wp");
  });

  it("escapes HTML in chat (no injection)", () => {
    win.Social.handleNet({ type: "chat", seat: 0, name: "<x>", text: "<img src=x>", ts: 1 });
    const row = win.document.querySelector(".social-chat-msg");
    expect(row.querySelector("img")).toBeNull();         // not parsed as a tag
    expect(row.innerHTML).toContain("&lt;img");
  });

  it("seeds chat history from hello (without consuming hello)", () => {
    const consumed = win.Social.handleNet({ type: "hello", chat: [
      { seat: 0, name: "A", text: "hi", ts: 1 }, { seat: 1, name: "B", text: "yo", ts: 2 },
    ]});
    expect(consumed).toBe(false);                          // hello flows on to other handlers
    expect(win.document.querySelectorAll(".social-chat-msg").length).toBe(2);
  });

  it("spawns a self-contained animated EMOTION character (no emoji bubble) into the FX layer", () => {
    win.Social.handleNet({ type: "react", seat: 2, name: "Cara", emoji: "furious", ts: 1 });
    const actor = win.document.querySelector("#reactionFxLayer .emote-actor");
    expect(actor).not.toBeNull();
    expect(actor!.querySelector(".emote-stage")).not.toBeNull();    // ring/stage
    const char = actor!.querySelector("svg.emo-char");
    expect(char).not.toBeNull();                                    // the character SVG
    expect(char!.classList.contains("emo-rage")).toBe(true);        // furious signature anim
    expect(actor!.querySelector(".emote-glyph")).toBeNull();        // NO emoji bubble anymore
    expect(actor!.textContent).toContain("Cara");                   // who emoted
  });

  it("Social.emote() fires a LOCAL emotion character without sending over the wire (for bots)", () => {
    win.__sent = [];
    win.Social.emote("party", "Botley", 1);
    const actor = win.document.querySelector("#reactionFxLayer .emote-actor");
    expect(actor).not.toBeNull();
    expect(actor!.querySelector("svg.emo-party")).not.toBeNull();
    expect((win.__sent || []).filter((o: any) => o.type === "react").length).toBe(0);
  });

  it("Kit.Emotes exposes the cast + a contextual event→mood mapper", () => {
    expect(typeof win.Kit.Emotes.svg).toBe("function");
    expect(win.Kit.Emotes.has("furious")).toBe(true);
    expect(win.Kit.Emotes.list().length).toBeGreaterThanOrEqual(10);
    // Flip 7 bust → a furious character, attributed to the busting seat.
    const hit = win.Kit.Emotes.fromEvent("flip7", { type: "bust", player: 3 });
    expect(hit.mood).toBe("furious");
    expect(hit.seat).toBe(3);
    // Flip 7 (the bonus) → party.
    expect(win.Kit.Emotes.fromEvent("flip7", { type: "flip7", player: 0 }).mood).toBe("party");
    // CRITICAL: it must match the NORMALIZED event shape Flip 7 actually emits
    // (type:"effect.bust", seat in `actor`, original name in `legacy`) — this was
    // the bug where auto-emotes silently never fired.
    const norm = win.Kit.Emotes.fromEvent("flip7", { type: "effect.bust", actor: 2, legacy: "bust" });
    expect(norm.mood).toBe("furious");
    expect(norm.seat).toBe(2);
  });

  it("sendReaction emits a react message and is cooldown-limited", () => {
    win.Social.sendReaction("🔥");
    win.Social.sendReaction("🔥");   // immediate 2nd → blocked by cooldown
    const reacts = (win.__sent || []).filter((o: any) => o.type === "react");
    expect(reacts.length).toBe(1);
    expect(reacts[0].emoji).toBe("🔥");
    expect(reacts[0].pid).toBe("p_test");
  });

  it("setActive(false) hides the buttons; setActive(true) shows them", () => {
    win.Social.setActive(true);
    expect(win.document.getElementById("chatBtn").classList.contains("hidden")).toBe(false);
    expect(win.document.getElementById("reactBtn").classList.contains("hidden")).toBe(false);
    win.Social.setActive(false);
    expect(win.document.getElementById("chatBtn").classList.contains("hidden")).toBe(true);
  });

  it("unread badge appears for messages received while chat is closed, clears on open", () => {
    win.Social.handleNet({ type: "chat", seat: 0, name: "A", text: "1", ts: 1 });
    expect(win.document.querySelector("#chatBtn .social-unread")).not.toBeNull();
    win.Social.toggleChat(true);
    expect(win.document.querySelector("#chatBtn .social-unread")).toBeNull();
  });
});

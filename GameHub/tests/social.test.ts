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
  const code = readFileSync(join(process.cwd(), "public/js/00-social.js"), "utf8");
  const s = win.document.createElement("script");
  s.textContent = code;
  win.document.body.appendChild(s);
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

  it("spawns an animated character emote (mascot + bubble) into the FX layer", () => {
    win.Social.handleNet({ type: "react", seat: 2, name: "Cara", emoji: "🎉", ts: 1 });
    const actor = win.document.querySelector("#reactionFxLayer .emote-actor");
    expect(actor).not.toBeNull();
    expect(actor!.querySelector(".emote-mascot")).not.toBeNull();   // the character
    expect(actor!.querySelector(".emote-bubble")).not.toBeNull();   // speech bubble
    expect(actor!.querySelector(".emote-glyph")!.textContent).toContain("🎉");
    expect(actor!.textContent).toContain("Cara");                   // who emoted
  });

  it("Social.emote() fires a LOCAL character emote without sending over the wire (for bots)", () => {
    win.__sent = [];
    win.Social.emote("🔥", "Botley", 1);
    expect(win.document.querySelectorAll("#reactionFxLayer .emote-actor").length).toBeGreaterThan(0);
    expect((win.__sent || []).filter((o: any) => o.type === "react").length).toBe(0);
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

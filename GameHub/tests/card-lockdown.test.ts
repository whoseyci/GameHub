// card-lockdown.test.ts — keep the card system WATER-TIGHT.
//
// The whole point of Kit.Cards is that there is ONE card visual + ONE geometry +
// ONE animation path. These guards make it hard to silently drift back to bespoke,
// inconsistent cards: a game must build cards through the framework, must not invent
// its own card geometry, and must not inject raw HTML into a card face.
//
// Scope: per-GAME client files (public/js/games/*.js) — the place new games are
// written. The framework itself (00-cards.js / 00-core.js) and the older built-in
// clients (02/03/04-*.js) are exempt where noted, because they predate this and are
// covered by their own regression suites; new games have no such excuse.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8");

// All scaffold-style game clients (the path new games take).
let gameFiles: string[] = [];
try {
  gameFiles = readdirSync(new URL("../public/js/games", import.meta.url))
    .filter((f) => f.endsWith(".js") && !f.startsWith("_"))
    .map((f) => `js/games/${f}`);
} catch { /* none */ }

describe("card system lockdown (water-tight)", () => {
  it("the framework defines the ONE canonical geometry + shared back", () => {
    const css = read("styles/main.css");
    expect(css).toContain("--kc-radius:");
    expect(css).toContain("--kc-aspect:");
    expect(css).toContain(".kc.kc-back");
    // corners are locked in EVERY state (idle + flying) so a card can never become
    // a pointy rectangle mid-flight.
    expect(css).toContain(".kit-card-registered.kc,.kit-card-moving.kc{border-radius:var(--kc-radius)!important");
  });

  it("the card spec renderer is text-only (no HTML injection into a card face)", () => {
    const cards = read("js/00-cards.js");
    expect(cards).toContain("ce.textContent = String(c.text)");
    // The content path must not use innerHTML — that would let raw markup into a card.
    expect(cards).not.toMatch(/\.innerHTML\s*=\s*(c\.|spec\.)/);
  });

  for (const rel of gameFiles) {
    const src = read(rel);
    const name = rel.split("/").pop();
    describe(name, () => {
      it("builds cards through Kit.Cards (no bespoke card element)", () => {
        // A game that renders cards must use the framework. (Games with no cards are
        // exempt — they simply won't reference Kit.Cards and won't trip the guards.)
        const usesCards = /Kit\.Cards\./.test(src);
        const looksCardy = /card/i.test(src);
        if (!looksCardy) return;
        expect(usesCards, `${name} renders cards but never calls Kit.Cards.*`).toBe(true);
      });
      it("does not invent its own card geometry (width/height/border-radius on a card class)", () => {
        // No new game should set raw card dimensions or corner radius — geometry is
        // owned by .kc. (We look for the tell-tale: a class literally named *card
        // getting width/height/border-radius inline.)
        expect(src).not.toMatch(/style\.(width|height|borderRadius)\s*=\s*['"][^'"]*(px|rem|em)/);
      });
      it("does not inject HTML into a card via innerHTML", () => {
        // Card faces are declared as specs; raw innerHTML on a card element is the
        // drift we forbid. (innerHTML on NON-card scaffolding like score rails is fine,
        // so we only flag innerHTML that assigns into a variable named like a card.)
        expect(src).not.toMatch(/\bcard\w*\.innerHTML\s*=/i);
      });
    });
  }
});

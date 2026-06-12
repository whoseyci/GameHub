// ux-redesign-phase3.test.ts — pins the Phase 3 contract:
//   1. Tiles are <button> elements (whole tile is one click target).
//   2. Only secondary control on a tile is the "?" rules badge.
//   3. dispatchTileAction branches on Mode.get():
//        local  → instantBotPlay(gameId)
//        online → quickPlay(gameId)
//   4. CTA chip label updates when Mode changes (Mode.onChange subscriber).
//   5. The old data-act-based per-tile buttons (quick/bot/rules) are gone.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("UX redesign Phase 3 — landing tile shape + mode-aware click", () => {
  const landing = read("public/js/00-landing.js");

  it("tiles are <button> elements with data-game", () => {
    expect(landing).toMatch(/<button\s+class="landing-tile"\s+data-game="\$\{esc\(g\.id\)\}"/);
  });

  it("removed the old per-tile data-act buttons (Play Online / vs Bot / Rules)", () => {
    expect(landing).not.toMatch(/data-act="quick"/);
    expect(landing).not.toMatch(/data-act="bot"/);
    expect(landing).not.toMatch(/data-act="rules"/);
    // The lt-actions container is gone too.
    expect(landing).not.toMatch(/class="lt-actions"/);
  });

  it("tile has a CTA chip (mode-aware label) + a small rules badge", () => {
    expect(landing).toMatch(/class="lt-cta"\s+data-cta-for="\$\{esc\(g\.id\)\}"/);
    expect(landing).toMatch(/class="lt-rules"\s+data-rules-for="\$\{esc\(g\.id\)\}"/);
  });

  it("dispatchTileAction branches on Mode.get()", () => {
    expect(landing).toMatch(/function\s+dispatchTileAction[\s\S]*window\.Mode[\s\S]*===\s*['"]online['"][\s\S]*window\.quickPlay/);
    expect(landing).toMatch(/function\s+dispatchTileAction[\s\S]*instantBotPlay/);
  });

  it("repaintCtas subscribes to Mode.onChange so the CTA label updates live", () => {
    expect(landing).toMatch(/function\s+repaintCtas/);
    expect(landing).toMatch(/window\.Mode\.onChange\(repaintCtas\)/);
    // Online → "Quick Play", Local → "vs Bot".
    expect(landing).toMatch(/Quick Play/);
    expect(landing).toMatch(/vs Bot/);
  });

  it("rules badge click is handled BEFORE the tile click and does not bubble", () => {
    expect(landing).toMatch(/data-rules-for/);
    expect(landing).toMatch(/stopPropagation/);
  });
});

describe("UX redesign Phase 3 — CSS contract", () => {
  const css = read("public/styles/landing.css");

  it(".landing-tile is the click target (button reset + appearance:none)", () => {
    expect(css).toMatch(/\.landing-tile\s*\{[\s\S]*?appearance:\s*none/);
  });

  it(".lt-cta has pointer-events:none so it never swallows the tile click", () => {
    expect(css).toMatch(/\.landing-tile\s+\.lt-cta\s*\{[\s\S]*?pointer-events:\s*none/);
  });

  it(".lt-rules is absolutely positioned (top-right of the tile)", () => {
    expect(css).toMatch(/\.landing-tile\s+\.lt-rules\s*\{[\s\S]*?position:\s*absolute/);
  });

  it("the old .lt-actions / .ltbtn rules are GONE", () => {
    expect(css).not.toMatch(/\.landing-tile\s+\.lt-actions/);
    expect(css).not.toMatch(/\.ltbtn/);
  });
});

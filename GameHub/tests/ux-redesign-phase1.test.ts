// ux-redesign-phase1.test.ts — pins the Phase 1 contract:
//   1. #modeHeader exists in index.html with Local / Online toggle + Group btn.
//   2. 00-mode.js exposes window.Mode { get, set, onChange }.
//   3. Mode defaults to 'local' on first visit; persists to gh.mode.
//   4. Mode header hides when active screen is gameScreen (body.in-game).
//   5. GroupPicker module exists with open/close/toggle/createNew/join/rejoin.
//   6. Script loads after 00-core.js and 00-identity.js.
//
// These are source-marker AND DOM-shape tests. End-to-end (mode persistence,
// header hide-in-game) lives in the existing JSDOM landing smoke.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("UX redesign Phase 1 — header DOM", () => {
  const html = read("public/index.html");

  it("has a #modeHeader element with role=banner", () => {
    expect(html).toMatch(/<div\s+id="modeHeader"\s+class="mode-header"\s+role="banner"/);
  });

  it("header contains a Local / Online toggle (radio-style)", () => {
    expect(html).toMatch(/id="modeBtnLocal"[^>]*onclick="Mode\.set\('local'\)"/);
    expect(html).toMatch(/id="modeBtnOnline"[^>]*onclick="Mode\.set\('online'\)"/);
    // Default selected = Local.
    expect(html).toMatch(/id="modeBtnLocal"[^>]*aria-selected="true"/);
  });

  it("header contains a Group button + dropdown picker", () => {
    expect(html).toMatch(/id="groupBtn"[^>]*onclick="GroupPicker\.toggle\(\)"/);
    expect(html).toMatch(/<div\s+id="groupPicker"\s+class="group-picker hidden"/);
    expect(html).toMatch(/GroupPicker\.createNew/);
    expect(html).toMatch(/GroupPicker\.joinByCode/);
    expect(html).toMatch(/id="groupPickerRecents"/);
  });

  it("00-mode.js loads after 00-core.js (needs showScreen) and after 00-icons.js", () => {
    const idxCore = html.indexOf('/js/00-core.js');
    const idxIcons = html.indexOf('/js/00-icons.js');
    const idxMode = html.indexOf('/js/00-mode.js');
    expect(idxCore).toBeGreaterThan(-1);
    expect(idxIcons).toBeGreaterThan(-1);
    expect(idxMode).toBeGreaterThan(-1);
    expect(idxMode).toBeGreaterThan(idxCore);
    expect(idxMode).toBeGreaterThan(idxIcons);
  });
});

describe("UX redesign Phase 1 — Mode module surface", () => {
  const src = read("public/js/00-mode.js");

  it("exposes window.Mode with get / set / onChange", () => {
    expect(src).toMatch(/window\.Mode\s*=\s*\{[\s\S]*get:\s*\(\)\s*=>\s*current[\s\S]*set,[\s\S]*onChange:/);
  });

  it("persists mode to localStorage under gh.mode", () => {
    expect(src).toMatch(/STORE_KEY\s*=\s*['"]gh\.mode['"]/);
    expect(src).toMatch(/localStorage\.setItem\(STORE_KEY/);
    expect(src).toMatch(/localStorage\.getItem\(STORE_KEY\)/);
  });

  it("defaults to 'local' (the low-friction mode)", () => {
    expect(src).toMatch(/return\s+VALID\.has\(v\)\s*\?\s*v\s*:\s*['"]local['"]/);
  });

  it("hides the header when the active screen is gameScreen", () => {
    expect(src).toMatch(/screenId\s*===\s*['"]gameScreen['"]/);
    expect(src).toMatch(/classList\.toggle\(['"]in-game['"]/);
    expect(src).toMatch(/header\.classList\.toggle\(['"]hidden['"]/);
  });

  it("syncs across tabs via the storage event", () => {
    expect(src).toMatch(/addEventListener\(['"]storage['"]/);
  });
});

describe("UX redesign Phase 1 — GroupPicker module surface", () => {
  const src = read("public/js/00-mode.js");

  it("exposes window.GroupPicker with open/close/toggle/createNew/joinByCode/rejoin", () => {
    expect(src).toMatch(/window\.GroupPicker\s*=\s*\{\s*open,\s*close,\s*toggle,\s*createNew,\s*joinByCode,\s*rejoin\s*\}/);
  });

  it("createNew defers to window.hostGroup (from 01-network-local.js)", () => {
    expect(src).toMatch(/function\s+createNew\s*\([^)]*\)\s*\{[\s\S]*window\.hostGroup/);
  });

  it("renderRecents pulls from Identity.getRecentGroups", () => {
    expect(src).toMatch(/Identity\.getRecentGroups/);
  });

  it("joinByCode validates the code shape before connecting", () => {
    expect(src).toMatch(/SAFE\s*=\s*\/\^\[A-Z0-9_-\]\{1,64\}\$\//);
  });
});

describe("UX redesign Phase 1 — header CSS contract", () => {
  const css = read("public/styles/landing.css");

  it("mode header is position:fixed at the top", () => {
    expect(css).toMatch(/\.mode-header\s*\{[\s\S]*?position:\s*fixed[\s\S]*?top:\s*0/);
  });

  it("body.in-game hides the mode header", () => {
    expect(css).toMatch(/body\.in-game\s+\.mode-header\s*\{\s*display:\s*none/);
  });

  it("non-game screens push down by --mode-header-h so they don't underlap", () => {
    expect(css).toMatch(/--mode-header-h:\s*\d+px/);
    expect(css).toMatch(/body:not\(\.in-game\)[\s\S]*padding-top:\s*calc\(var\(--mode-header-h\)/);
  });
});

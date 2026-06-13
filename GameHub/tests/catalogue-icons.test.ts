// catalogue-icons.test.ts — pins the catalogue icon contract:
//   • Every game in the public catalogue declares a Phosphor icon name
//     via meta.icon (the new field added in the catalogue-emoji
//     bugfix). The hub UI prefers icons over emojis to satisfy the W5
//     no-emoji-in-UI principle.
//   • Each declared icon name is one the Kit.Icon library actually
//     ships (otherwise Kit.Icon.forGame falls back to the raw emoji
//     and the user sees it again).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GAME_CATALOGUE } from "../src/games/registry";

const ICONS_SRC = readFileSync("public/js/00-icons.js", "utf8");

// Extract every icon name from the PATHS map in 00-icons.js. Tolerant
// regex: matches 'name': '<path…>'.
const declaredIcons = new Set(
  [...ICONS_SRC.matchAll(/^\s*'([a-z0-9-]+)'\s*:\s*'</gm)].map((m) => m[1]),
);

describe("catalogue icons", () => {
  it("Kit.Icon ships > 30 icons (sanity)", () => {
    expect(declaredIcons.size).toBeGreaterThan(30);
  });

  for (const g of GAME_CATALOGUE) {
    it(`${g.id}: declares a Phosphor icon (no UI emoji)`, () => {
      const meta: any = g;
      expect(meta.icon, `${g.id} has no meta.icon — hub UI will fall back to the raw emoji`)
        .toBeTruthy();
    });

    it(`${g.id}: declared icon "${(g as any).icon}" exists in Kit.Icon.PATHS`, () => {
      const meta: any = g;
      if (!meta.icon) return; // already failed above
      expect(declaredIcons.has(meta.icon),
        `${g.id}.icon="${meta.icon}" not in Kit.Icon — fix the meta or add the icon`)
        .toBe(true);
    });
  }

  it("Kit.Icon.forGame helper is implemented + prefers icon over emoji", () => {
    expect(ICONS_SRC).toMatch(/Icon\.forGame\s*=/);
    expect(ICONS_SRC).toMatch(/gMeta\.icon\s*&&\s*PATHS\[gMeta\.icon\]/);
  });
});

// no-ui-emojis.test.ts — CI guard for Round-1 W5 emoji→icon migration.
//
// After the migration, no emoji should appear in UI control surfaces. The
// allowed exceptions are:
//   1) GameRules.title / quick / steps / tip — those are prose rulebook
//      copy where game-identity glyphs help quick-scan.
//   2) Per-game card-face glyphs (Flip 7's ❄ / ♥) — those ARE the cards.
//      We allow them only inside string literals that match a guard
//      pattern (text:'❄ or text:'♥ or color:'#...♥ etc).
//   3) CSS dingbats like ✦ used as decorative "card back" glyphs.
//   4) Comment characters (// ❌) and similar markdown.
//
// Anything else triggers a failure with the offending line so the author
// knows exactly where to swap in Kit.Icon.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Match colour-pictograph emoji + the most common pictographic symbols.
// Carefully exclude plain Unicode dingbats that are legitimate typography
// (not emoji): ✕ (U+2715), ✓ (U+2713), ✦ (U+2726), ✦ (U+2726), ❄ (U+2744),
// ♥ (U+2665), etc. Pictographic emoji proper live in 1F300+, 1F900+, and
// the colourful subset of 2600-26FF. We explicitly allow the dingbat
// range 2700-27BF where most "geometric marks" live, because the only
// emoji in there (✉ ✊ ✋) are not used in this codebase.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{1F1E6}-\u{1F1FF}\u{2614}-\u{2615}\u{2648}-\u{2653}\u{267F}\u{2693}\u{26A1}\u{26AA}-\u{26AB}\u{26BD}-\u{26BE}\u{26C4}-\u{26C5}\u{26CE}\u{26D4}\u{26EA}\u{26F2}-\u{26F3}\u{26F5}\u{26FA}\u{26FD}]/u;

// Files to scan: every browser-shipped surface (HTML/CSS/JS in public/).
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, out);
    else if (/\.(html|css|js)$/.test(name)) out.push(full);
  }
  return out;
}

// Allowlist:
//   • lines mentioning GameRules / window.GameRules / 'title:' inside the
//     rules block (game-identity glyph allowed)
//   • lines containing the exact Flip 7 card-face spec markers
//   • lines that are comments (start with // or /* or are inside a block comment)
//   • CSS lines using ✦ as content (decorative)
function isAllowlisted(line: string, path: string): boolean {
  const trimmed = line.trim();
  // Comments: // anything, /* anything, * anything, --- markdown
  if (trimmed.startsWith('//')) return true;
  if (trimmed.startsWith('/*')) return true;
  if (trimmed.startsWith('*')) return true;
  // GameRules prose (title/quick/steps/tip)
  if (/GameRules\b|window\.GameRules\b/.test(line)) return true;
  if (/(title|quick|tip)\s*:\s*['"]/.test(line) && path.endsWith('.js')) return true;
  // Flip 7 card-face glyphs in spec strings: text:'❄' or text:'♥' or color:'#...'
  if (/text:\s*['"][\u2660-\u2667\u2700-\u27BF\u2600-\u26FF]['"]/.test(line)) return true;
  if (/['"]\\u2744\b/.test(line) || /['"]\\u2665\b/.test(line)) return true;
  // Flip 7 inline status spans with the freeze/heart suit glyphs
  if (/color:\s*#[0-9a-fA-F]{3,6}['"];?>?[\u2660-\u2667\u2700-\u27BF]/.test(line)) return true;
  if (/['">][\u2744\u2665]<\/span>/.test(line)) return true;
  // ✦ dingbat in CSS content rules
  if (/content\s*:\s*['"]\u2726['"]/.test(line)) return true;
  // _template stub
  if (path.includes('_template')) return true;
  // Social reactions: 00-social.js's whole purpose is animated reaction EMOJIS —
  // they are the feature's content/payload, not UI icons standing in for an icon.
  // The reaction-picker BUTTON in index.html likewise shows an emoji face on
  // purpose (it's a "send a reaction" affordance), as does its title text.
  if (path.endsWith('00-social.js')) return true;
  if (/id="reactBtn"/.test(line)) return true;
  return false;
}

describe("no UI emojis (Round-1 W5 contract)", () => {
  const root = join(process.cwd(), 'public');
  const files = walk(root);
  for (const file of files) {
    it(`${file.replace(process.cwd() + '/', '')}: contains no UI emojis`, () => {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');
      const offenders: string[] = [];
      lines.forEach((line, i) => {
        if (!EMOJI_RE.test(line)) return;
        if (isAllowlisted(line, file)) return;
        offenders.push(`  line ${i + 1}: ${line.trim().slice(0, 120)}`);
      });
      expect(offenders, `${file} has UI emojis (use Kit.Icon instead):\n${offenders.join('\n')}`).toEqual([]);
    });
  }
});

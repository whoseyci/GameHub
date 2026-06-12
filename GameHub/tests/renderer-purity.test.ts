// renderer-purity.test.ts — make "client-side rule duplication" a CI failure.
//
// After the API-11 migration, every interactive affordance in every game's
// renderer (drop targets, tap-tos, button availability) reads from server-
// emitted view.state.legal (or module.legalActions for pass-and-play). The
// renderer should NEVER re-derive "is this move legal?" from phase / current
// seat / pendingAction primitives — that's exactly the drift class we just
// removed.
//
// This test grep-blocks suspicious patterns in public/js/games/*.js and the
// per-game renderer files (02-qwixx.js / 03-skyjo.js / 04-flip7.js). Patterns
// that exist for LEGITIMATE reasons (AI hints, animation routing, display
// strings) are explicitly allow-listed below.
//
// To migrate a new pattern: add it to BANNED_PATTERNS with a short message.
// To allow a legitimate occurrence: add a // [renderer-purity-ok: reason]
// comment on the same line.
//
// This is a "make the wrong thing hard" guard, not a perfect static analyser.
// The TRUE source of truth is whether the renderer reads view.state.legal
// (or module.legalActions) for its affordance decisions — which it now does.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RENDERER_FILES = [
  "public/js/02-qwixx.js",
  "public/js/03-skyjo.js",
  "public/js/04-flip7.js",
  ...(() => {
    try {
      return readdirSync(join(process.cwd(), "public/js/games"))
        .filter((f) => f.endsWith(".js") && !f.startsWith("_template"))
        .map((f) => `public/js/games/${f}`);
    } catch { return []; }
  })(),
];

// Patterns that signal a renderer re-encoding rules. Each entry:
//   regex     — the suspicious shape
//   message   — what the author should do instead
//
// The patterns are TIGHT — we'd rather miss a few cases than block legitimate
// UI judgement calls. The test fails only when a clear rule re-derivation
// appears without a // [renderer-purity-ok: reason] suppression.
const BANNED_PATTERNS: Array<{ regex: RegExp; message: string }> = [
  {
    // "onclick = something that depends on state.phase === 'PLAY'/'FINAL_TURNS'"
    // — that's deciding tap availability from rules, not from legality hints.
    regex: /onclick[^}]*\b(s|state|view)\.(phase|turnAction|pendingAction|currentPlayer|current)\s*===/,
    message: "Decide tap availability from view.state.legal (or module.legalActions for local), not from phase/turnAction/currentPlayer.",
  },
  {
    // 'canX = ... condition involving multiple rule primitives ...' is a smell.
    regex: /\bcan[A-Z]\w*\s*=\s*[^;]*\b(s|state|view)\.(phase|turnAction|pendingAction)\b[^;]*&&[^;]*\b(s|state|view)\.(currentPlayer|current|active\w*)\b/,
    message: "Compute affordance availability from view.state.legal, not from a hand-coded conjunction of rule primitives.",
  },
  // Note: we do NOT ban canMarkIndex / canPlaceAny / canClaim — those exist on
  // the SERVER and may also be exposed in client bundles for legitimate display
  // compute (Qwixx's recommendedMove AI hint). The test fires only when the
  // renderer wires them into INTERACTIVE handlers without going through legal.
];

function stripped(src: string): string {
  // Remove // comments and /* */ comments so suppression markers are real
  // (and so a banned regex inside a comment is ignored).
  let out = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return out
    .split("\n")
    .map((line) => {
      const ok = /\/\/\s*\[renderer-purity-ok\b/.test(line);
      // Strip line comments AFTER the suppression-check so the marker survives.
      return ok ? "" : line.replace(/\/\/.*$/, "");
    })
    .join("\n");
}

describe("renderer purity (API-11 enforcement)", () => {
  for (const rel of RENDERER_FILES) {
    it(`${rel}: no client-side rule duplication in interactive paths`, () => {
      const raw = readFileSync(join(process.cwd(), rel), "utf8");
      const src = stripped(raw);
      const violations: string[] = [];
      for (const { regex, message } of BANNED_PATTERNS) {
        const m = src.match(regex);
        if (m) {
          // Find the original line for a useful error.
          const idx = raw.indexOf(m[0]);
          const lineNo = idx >= 0 ? raw.slice(0, idx).split("\n").length : 0;
          violations.push(`  line ${lineNo}: ${m[0].slice(0, 100)}\n    → ${message}`);
        }
      }
      expect(violations, `${rel} has rule-duplication smells:\n${violations.join("\n")}`).toEqual([]);
    });
  }
});

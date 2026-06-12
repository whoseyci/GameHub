// view-shape.test.ts — pins the canonical view shape every game must follow.
//
// Two namespaces, never mixed:
//   • view.state.*         → standardized hub fields (currentSeat, players[],
//                            pendingAction, focusSeat, autoAdvanceMs, legal?)
//                            consumed by the BotDriver, the tick scheduler,
//                            and the shared turn/focus UI.
//   • view[meta.id].*      → the game's PRIVATE shape, only its own client
//                            renderer touches it.
//
// Why this matters: the field report (ADDING_A_GAME_FIELD_REPORT.md, F7)
// found that three different conventions had grown (view.state vs view.skyjo
// vs view.flip7) and the hub had per-game special cases. Locking the contract
// here means the bot driver / scheduler stay game-agnostic, no future game
// can drift, and the optional API-8 `legal[]` field has a single canonical
// home (view.state.legal).

import { describe, expect, it } from "vitest";
import { GAMES } from "../src/games/registry";
import type { GameModule } from "../src/games/types";

function namesFor(g: GameModule): string[] {
  return Array.from({ length: Math.max(2, g.meta.minPlayers) }, (_, i) => `P${i + 1}`);
}

const HUB_RESERVED_KEYS = new Set([
  "game", "phase", "over", "yourSeat",
  "state", "summary",
  // Replay capture / hub messaging:
  "_isReplay",
]);

describe("view shape (canonical hub contract)", () => {
  for (const game of Object.values(GAMES)) {
    describe(game.meta.id, () => {
      const state = game.create(namesFor(game));

      it("publishes view.state with the standardized hub fields", () => {
        const v = game.viewFor(state, 0);
        expect(v.state, "view.state is required").toBeDefined();
        const s = v.state!;
        expect(typeof s.currentSeat).toBe("number");
        expect(Array.isArray(s.players)).toBe(true);
        // Each player entry must carry seat + name + status + score (the
        // BotDriver, focus model and recent-players social graph all read
        // these without knowing the game).
        for (const p of s.players) {
          expect(typeof p.seat).toBe("number");
          expect(typeof p.name).toBe("string");
          expect(typeof p.status).toBe("string");
          expect(typeof p.score).toBe("number");
        }
      });

      it("namespaces its private data under view[meta.id] (no rogue top-level keys)", () => {
        const v = game.viewFor(state, 0) as Record<string, unknown>;
        const ownKey = game.meta.id;
        // The game's private slice must exist (this is what its renderer reads).
        // Schotten uses 'schotten', skyjo 'skyjo', etc — never a different bag.
        expect(v[ownKey], `view.${ownKey} should exist`).toBeDefined();
        // Any OTHER key not in HUB_RESERVED_KEYS and not == own id is a leak.
        const leaks = Object.keys(v).filter(
          (k) => k !== ownKey && !HUB_RESERVED_KEYS.has(k),
        );
        expect(leaks, `${game.meta.id} leaks non-namespaced keys: ${leaks.join(", ")}`).toEqual([]);
      });

      it("the same view shape is returned for spectators (-1) and a seated viewer", () => {
        const sp = game.viewFor(state, -1) as Record<string, unknown>;
        const me = game.viewFor(state, 0) as Record<string, unknown>;
        const k = (o: Record<string, unknown>) => Object.keys(o).sort().join(",");
        expect(k(sp), "spectator/viewer key sets must match").toBe(k(me));
      });
    });
  }
});

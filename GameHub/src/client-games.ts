// client-games.ts — browser bundle entry for the SHARED rules engine.
//
// This is the heart of "one rules engine, everywhere" (shared-API #2). The exact
// same server `GameModule`s that run authoritatively inside the Durable Object are
// bundled here and exposed on `window` so the browser can run them too for:
//   • OFFLINE local play (single device) — no server round-trip needed.
//   • A single source of truth for game rules — the old per-game client "local
//     engine" copies (~120 LOC each) are deleted; there is no second rulebook to
//     drift out of sync.
//
// Built by scripts/build-client-games.mjs into public/js/00-game-modules.js, which
// index.html loads BEFORE the per-game client renderers. The renderers read the
// view shape that `module.viewFor(state, seat)` produces — the very same shape the
// online flow already delivers — so local and online play are pixel-identical.

import { GAMES, GAME_CATALOGUE } from "./games/registry";
import type { GameModule } from "./games/types";

/**
 * Generic local-play adapter: wraps a server GameModule in the small contract
 * that public/js/01-network-local.js expects from `window.LocalEngines[id](names)`:
 *
 *   { apply(seat, msg), next(), actor(), viewFor(seat) }
 *
 * It also drives the server tick/completeTick loop locally, so games with a
 * deferred resolution (e.g. Skyjo's "turn_end_delay") auto-advance offline exactly
 * as they do online — without each client re-implementing that timer.
 */
function makeLocalEngine(module: GameModule, names: string[], variant?: string) {
  let state = module.create(names, variant);

  function currentSeat(): number {
    try {
      const v = module.viewFor(state, -1);
      const cs = v.state?.currentSeat ?? 0;
      if (cs >= 0) return cs;
      // Simultaneous-turn games (e.g. Qwixx white phase) report currentSeat = -1
      // because no single seat "owns" the turn. The local UI still needs a concrete
      // seat to focus. Prefer the game's explicit focusSeat hint (the "roller"), so
      // focus follows whose turn it is to lead — NOT just the first pending seat
      // (which was always seat 0, so the display never rotated to the other player).
      const fs = v.state?.focusSeat;
      if (typeof fs === "number" && fs >= 0) return fs;
      const active = v.state?.players?.find((p) => p.status === "active");
      return active ? active.seat : 0;
    } catch {
      return 0;
    }
  }

  // After any mutation, ask the module whether it scheduled a deferred step. If
  // so, run completeTick() after the delay and re-render — mirroring the hub's
  // alarm-driven tick scheduler, but on the local device.
  function pumpTick() {
    if (!module.tick || !module.completeTick) return;
    let delay: number | null = null;
    try {
      delay = module.tick(state);
    } catch {
      delay = null;
    }
    if (delay == null) return;
    setTimeout(() => {
      try {
        module.completeTick!(state);
      } catch {
        /* ignore */
      }
      const render = (window as any).renderLocal;
      if (typeof render === "function") render();
      // A completeTick may itself schedule the next tick (chained resolutions).
      pumpTick();
    }, Math.max(0, delay));
  }

  return {
    apply(seat: number, msg: any) {
      try {
        module.applyAction(state, seat, msg);
      } catch (e) {
        console.warn(`[LocalEngine ${module.meta.id}] applyAction failed:`, e);
      }
      pumpTick();
    },
    next() {
      // "Next round / play again" is a normal action in the GameModule contract;
      // the hub routes it the same way (server.ts → applyAction next_round).
      try {
        module.applyAction(state, 0, { action: "next_round" });
      } catch (e) {
        console.warn(`[LocalEngine ${module.meta.id}] next_round failed:`, e);
      }
    },
    actor() {
      return currentSeat();
    },
    viewFor(seat: number) {
      const v: any = module.viewFor(state, seat);
      // API-8 parity with the server: when the module opts in to legalActions,
      // auto-attach hints to view.state.legal for the requesting seat. Lets
      // OFFLINE pass-and-play surfaces (drop targets, claimable stones, etc.)
      // light up from server-emitted rules — no client-side duplication.
      try {
        if (seat >= 0 && module.legalActions && v && v.state) {
          const legal = module.legalActions(state, seat) || [];
          v.state.legal = Array.isArray(legal) ? legal.slice(0, 256) : [];
        }
      } catch (e) {
        console.warn(`[LocalEngine ${module.meta.id}] legalActions threw:`, e);
        if (v && v.state) v.state.legal = [];
      }
      return v;
    },
    // Exposed for tests / bot self-play harnesses.
    _module: module,
    _state: () => state,
  };
}

declare global {
  interface Window {
    GameModules: Record<string, GameModule>;
    GameCatalogue: typeof GAME_CATALOGUE;
    LocalEngines: Record<string, (names: string[]) => any>;
    makeLocalEngine: typeof makeLocalEngine;
  }
}

// Expose the authoritative modules + catalogue to the browser.
window.GameModules = GAMES;
window.GameCatalogue = GAME_CATALOGUE;
window.makeLocalEngine = makeLocalEngine;

// Auto-register a generic LocalEngine for EVERY game in the registry. A per-game
// client file may still override window.LocalEngines[id] if it needs bespoke
// offline behaviour, but the default now comes straight from the shared rules.
window.LocalEngines = window.LocalEngines || {};
for (const id of Object.keys(GAMES)) {
  window.LocalEngines[id] = (names: string[], variant?: string) => makeLocalEngine(GAMES[id], names, variant);
}

export { makeLocalEngine };

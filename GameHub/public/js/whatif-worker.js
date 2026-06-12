/* whatif-worker.js — Web Worker that simulates N random-legal playouts from
 * a given state and reports per-seat win probability.
 *
 * Loaded via:  new Worker('/js/whatif-worker.js')
 *
 * Message in:  { type:'run', gameId, state, simCount?, maxDepth? }
 * Message out: { type:'progress', done, total }            (every ~10%)
 *              { type:'done', winRates:number[], plays:number, draws:number }
 *              { type:'error', message:string }
 *
 * The worker imports the same GameModules bundle the main thread uses, so
 * "playout" runs the real engine rules — no per-game branches here.
 */
(function () {
  'use strict';

  // Pull in the shared bundle. importScripts is the standard Web Worker mechanism.
  try { importScripts('/js/00-game-modules.js'); }
  catch (e) { postMessage({ type: 'error', message: 'failed to load game modules: ' + (e.message || e) }); return; }

  const GAMES = self.GameModules; // window.GameModules in main thread, self.GameModules here.

  function pickLegal(mod, state, seat) {
    if (typeof mod.legalActions !== 'function') return null;
    let legal;
    try { legal = mod.legalActions(state, seat) || []; }
    catch { legal = []; }
    if (!legal.length) return null;
    return legal[Math.floor(Math.random() * legal.length)];
  }

  function currentSeats(mod, state) {
    try {
      const v = mod.viewFor(state, -1);
      const cs = v?.state?.currentSeat ?? -1;
      if (cs >= 0) return [cs];
      // Simultaneous-turn games: every seat reporting status:active.
      const arr = v?.state?.players || [];
      const out = arr.filter((p) => p?.status === 'active').map((p) => p.seat);
      return out.length ? out : [];
    } catch { return []; }
  }

  function singlePlayout(mod, initialState, maxDepth) {
    const state = JSON.parse(JSON.stringify(initialState));
    let depth = 0;
    while (!mod.isOver(state) && depth < maxDepth) {
      const seats = currentSeats(mod, state);
      let moved = false;
      for (const s of seats) {
        const a = pickLegal(mod, state, s);
        if (!a) continue;
        try { mod.applyAction(state, s, a); moved = true; }
        catch { /* skip */ }
        if (mod.isOver(state)) break;
      }
      // Drain ticks (server completeTick is normally driven by alarm).
      if (mod.tick && mod.completeTick) {
        let safety = 50;
        while (safety-- > 0) {
          const delay = (() => { try { return mod.tick(state); } catch { return null; }})();
          if (delay == null) break;
          try { mod.completeTick(state); } catch { break; }
        }
      }
      if (!moved) {
        // No seat could move and we're not over — likely a deadlock. Force exit
        // and treat as a draw for the rollout (won't influence win-rates much
        // when amortised over many sims).
        break;
      }
      depth++;
    }
    if (!mod.isOver(state)) return { winners: [], steps: depth };
    let winners = [];
    try {
      const v = mod.viewFor(state, -1);
      winners = v?.summary?.winners || [];
    } catch {}
    return { winners, steps: depth };
  }

  self.onmessage = (e) => {
    const m = e.data || {};
    if (m.type !== 'run') return;
    const mod = GAMES[m.gameId];
    if (!mod) { postMessage({ type: 'error', message: `unknown game ${m.gameId}` }); return; }
    if (!mod.legalActions) {
      postMessage({ type: 'error', message: `${m.gameId} doesn't implement legalActions — what-if needs API-8` });
      return;
    }
    const simCount = Math.max(1, Math.min(2000, m.simCount | 0 || 100));
    const maxDepth = Math.max(10, Math.min(2000, m.maxDepth | 0 || 300));
    const view0 = mod.viewFor(m.state, -1);
    const seatCount = view0?.state?.players?.length || 2;
    const wins = new Array(seatCount).fill(0);
    let draws = 0;
    let totalSteps = 0;
    const t0 = Date.now();
    for (let i = 0; i < simCount; i++) {
      const r = singlePlayout(mod, m.state, maxDepth);
      totalSteps += r.steps;
      if (r.winners.length === 0) draws++;
      else if (r.winners.length === 1) wins[r.winners[0]]++;
      else { for (const w of r.winners) wins[w] += 1 / r.winners.length; } // tie split
      if ((i + 1) % Math.max(1, Math.floor(simCount / 10)) === 0) {
        postMessage({ type: 'progress', done: i + 1, total: simCount });
      }
      // Yield occasionally so the worker doesn't peg the CPU forever.
      if (Date.now() - t0 > 8000) break; // 8s hard cap — for huge games
    }
    const winRates = wins.map((w) => w / simCount);
    postMessage({ type: 'done', winRates, plays: simCount, draws, avgSteps: Math.round(totalSteps / Math.max(1, simCount)) });
  };
})();

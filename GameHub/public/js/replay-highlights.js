/* replay-highlights.js — find "frames of interest" in a captured replay.
 *
 * Pure client-side analysis: rehydrates the game module state at every frame
 * and scores transitions by score swings, lead changes, climactic moves, and
 * (when a game implements it) game-specific signals via module.scoreFrame?().
 *
 * Output is a sorted, deduplicated list of highlights:
 *   { frame, kind, score, seat, label }
 *
 * The replay player uses these to:
 *   1) render orange dots on the scrubber timeline
 *   2) "next highlight ⏭" / "previous highlight ⏮" hotkeys
 *   3) auto-generated narration on the share card
 *
 * Generic (no per-game branches) so every game inherits the feature day-one.
 * Per-game enrichments are an OPTIONAL module hook described at the bottom.
 */
(function () {
  'use strict';

  /** A single highlight. `score` is "narrative interest" 0..1, higher = bigger.
   *  `kind` is a short tag the UI can colour or icon-ify. */
  // @typedef {{ frame:number, kind:string, score:number, seat?:number, label:string }} Highlight

  /**
   * @param {object} bundle  ReplayBundle from /api/replay/...
   * @param {object} [opts]
   * @param {number} [opts.max]   max highlights returned (default 8)
   * @param {function} [opts.onProgress]  (done,total) progress callback
   * @returns {Highlight[]}  sorted descending by score
   */
  function analyze(bundle, opts) {
    opts = opts || {};
    const max = Math.max(1, opts.max | 0 || 8);
    if (!bundle || !bundle.gameId || !Array.isArray(bundle.actions)) return [];
    const mod = window.GameModules?.[bundle.gameId];
    if (!mod) return [];

    // Replay frame-by-frame, snapshotting per-seat scores at each step.
    const N = bundle.actions.length;
    const state = JSON.parse(JSON.stringify(bundle.initialState));
    const seatNames = (bundle.names || []).slice();
    const seatCount = seatNames.length;
    const seatScores = new Array(N + 1);
    seatScores[0] = readScores(mod, state, seatCount);
    for (let i = 0; i < N; i++) {
      const a = bundle.actions[i];
      try {
        if (a && a.msg && a.msg.action === '__tick__') mod.completeTick?.(state);
        else mod.applyAction(state, (a.seat | 0), a.msg);
      } catch { /* keep going; replay tolerant */ }
      seatScores[i + 1] = readScores(mod, state, seatCount);
      if (opts.onProgress && (i & 7) === 0) opts.onProgress(i + 1, N);
    }

    const highlights = /** @type {Highlight[]} */ ([]);

    // ── Heuristic 1: per-frame score swing ─────────────────────────────
    // For each frame, max |Δscore_seat|. Big swings are interesting.
    for (let i = 1; i <= N; i++) {
      let bestSeat = -1, bestDelta = 0;
      for (let s = 0; s < seatCount; s++) {
        const d = seatScores[i][s] - seatScores[i - 1][s];
        if (Math.abs(d) > Math.abs(bestDelta)) { bestDelta = d; bestSeat = s; }
      }
      if (Math.abs(bestDelta) >= 4) {
        const verb = bestDelta > 0 ? 'gained' : 'lost';
        // Negative score in Skyjo is *good*, so "lost X points" can be a brag.
        // Keep the label neutral: "Δ ±X".
        highlights.push({
          frame: i,
          kind: bestDelta > 0 ? 'gain' : 'loss',
          score: Math.min(1, Math.abs(bestDelta) / 25),
          seat: bestSeat,
          label: `${seatNames[bestSeat] || `Seat ${bestSeat}`} ${verb} ${Math.abs(bestDelta)}`,
        });
      }
    }

    // ── Heuristic 2: lead changes ──────────────────────────────────────
    // Track who leads (lowest score wins in Skyjo, highest elsewhere — let the
    // module hint via meta.scoring; default to "higher is better"). Whenever
    // the leader changes, flag it.
    const higherIsBetter = mod.meta?.scoring !== 'lower-is-better';
    const leaderAt = (i) => {
      const arr = seatScores[i];
      let best = higherIsBetter ? -Infinity : Infinity, leader = -1;
      for (let s = 0; s < seatCount; s++) {
        if ((higherIsBetter && arr[s] > best) || (!higherIsBetter && arr[s] < best)) {
          best = arr[s]; leader = s;
        }
      }
      return leader;
    };
    let prevLeader = leaderAt(0);
    for (let i = 1; i <= N; i++) {
      const l = leaderAt(i);
      if (l !== prevLeader && prevLeader >= 0 && l >= 0) {
        highlights.push({
          frame: i,
          kind: 'lead',
          score: 0.6,
          seat: l,
          label: `${seatNames[l] || `Seat ${l}`} takes the lead`,
        });
        prevLeader = l;
      }
    }

    // ── Heuristic 3: game-ending move ──────────────────────────────────
    // The action that flipped isOver from false → true is the climax.
    // We re-check by replaying — already done above; check the last action.
    if (N > 0) {
      const clone = JSON.parse(JSON.stringify(bundle.initialState));
      for (let i = 0; i < N - 1; i++) {
        const a = bundle.actions[i];
        try {
          if (a?.msg?.action === '__tick__') mod.completeTick?.(clone);
          else mod.applyAction(clone, a.seat | 0, a.msg);
        } catch {}
      }
      const wasOver = mod.isOver(clone);
      const aLast = bundle.actions[N - 1];
      try {
        if (aLast?.msg?.action === '__tick__') mod.completeTick?.(clone);
        else mod.applyAction(clone, aLast.seat | 0, aLast.msg);
      } catch {}
      if (!wasOver && mod.isOver(clone)) {
        const winners = bundle.finalSummary?.winners || [];
        const wName = winners.map((s) => seatNames[s] || `Seat ${s}`).join(' & ') || 'someone';
        highlights.push({
          frame: N,
          kind: 'win',
          score: 1.0,
          seat: winners[0],
          label: `${wName} ${winners.length > 1 ? 'win' : 'wins'}!`,
        });
      }
    }

    // ── Heuristic 4 (OPTIONAL per-game): module.scoreFrame ─────────────
    // A game module MAY export scoreFrame(state, lastAction) → { kind, score,
    // seat, label } | null  to surface game-specific climaxes (Skyjo's
    // triplet, Flip 7's FLIP 7!, Schotten's stone claim). Generic for now.

    // Dedupe (same frame + same kind) by keeping the higher-scored one.
    highlights.sort((a, b) => a.frame - b.frame);
    const dedup = [];
    const seen = new Map();
    for (const h of highlights) {
      const k = `${h.frame}:${h.kind}`;
      if (seen.has(k)) {
        const prev = dedup[seen.get(k)];
        if (h.score > prev.score) dedup[seen.get(k)] = h;
      } else { seen.set(k, dedup.length); dedup.push(h); }
    }

    // Top-N by score, then re-sort by frame for timeline display.
    dedup.sort((a, b) => b.score - a.score);
    const top = dedup.slice(0, max);
    top.sort((a, b) => a.frame - b.frame);
    return top;
  }

  function readScores(mod, state, seatCount) {
    try {
      // Prefer view.state.players[*].score (canonical).
      const v = mod.viewFor(state, -1);
      const arr = v?.state?.players;
      if (Array.isArray(arr)) {
        const out = new Array(seatCount).fill(0);
        for (const p of arr) if (typeof p.seat === 'number') out[p.seat] = Number(p.score) || 0;
        return out;
      }
    } catch {}
    return new Array(seatCount).fill(0);
  }

  window.Kit = window.Kit || {};
  window.Kit.Highlights = { analyze };
})();

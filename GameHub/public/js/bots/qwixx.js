/**
 * Qwixx bot strategies — registered with BotDriver.
 * 
 * Easy: random valid marks
 * Medium: prefers marking earlier numbers (fewer opportunities wasted)
 * Hard: lookahead-based scoring using quadratic mark rewards
 */
const QwixxBots = (() => {
  const SCORE_BY_MARKS = [0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78];
  const COLORS = ["red", "yellow", "green", "blue"];

  function lastMark(row) { return row.marks.length ? Math.max(...row.marks) : -1; }
  function diceSig(s) {
    const d = s.dice || { w: [0, 0], r: 0, y: 0, g: 0, b: 0 };
    return `${s.round}|${s.activeSeat}|${d.w.join(',')}|${d.r}|${d.y}|${d.g}|${d.b}`;
  }
  function diceRevealed(s) {
    return window._qwixxDiceSig === diceSig(s);
  }

  function validMarks(view, seat) {
    const s = view.state || view.qwixx;
    const p = s.allPlayers[seat];
    if (!p) return [];
    const valids = [];
    const isAct = s.activeSeat === seat;

    for (const c of COLORS) {
      if (s.locked.includes(c)) continue;
      const row = p.rows[c];
      if (!row) continue;
      const last = lastMark(row);
      const endIdx = row.nums.length - 1;

      if (s.phase === "WHITE_PHASE") {
        const wSum = s.dice.w[0] + s.dice.w[1];
        for (let i = last + 1; i <= endIdx; i++) {
          if (row.nums[i] === wSum) {
            if (i === endIdx && row.marks.length < 5) continue;
            valids.push({ c, i, use: "white" });
          }
        }
      } else if (s.phase === "COLOR_PHASE" && isAct) {
        const cKey = c[0];
        if (s.dice[cKey] > 0) {
          const sum1 = s.dice.w[0] + s.dice[cKey];
          const sum2 = s.dice.w[1] + s.dice[cKey];
          for (let i = last + 1; i <= endIdx; i++) {
            if (row.nums[i] === sum1 || row.nums[i] === sum2) {
              if (i === endIdx && row.marks.length < 5) continue;
              valids.push({ c, i, use: "color" });
            }
          }
        }
      }
    }
    return valids;
  }

  function scoreRow(row) {
    let m = row.marks.length;
    if (row.marks.includes(row.nums.length - 1)) m++;
    return SCORE_BY_MARKS[Math.min(m, SCORE_BY_MARKS.length - 1)];
  }

  function marginalGain(row, newIndex) {
    if (row.marks.includes(newIndex)) return 0;
    const currentScore = scoreRow(row);
    // Simulate adding this mark
    const simulatedMarks = [...row.marks, newIndex].sort((a, b) => a - b);
    const simulatedRow = { ...row, marks: simulatedMarks };
    const newScore = scoreRow(simulatedRow);
    return newScore - currentScore;
  }

  function easyChoose(view, seat) {
    const s = view.state || view.qwixx;
    const valids = validMarks(view, seat);
    if (valids.length > 0) {
      const best = valids[Math.floor(Math.random() * valids.length)];
      return { action: "mark", c: best.c, i: best.i, use: best.use };
    }
    return s.phase === "WHITE_PHASE" ? { action: "skip" } : { action: "finishTurn" };
  }

  function mediumChoose(view, seat) {
    const valids = validMarks(view, seat);
    if (valids.length > 0) {
      // Prefer marking earlier numbers (more conservative play)
      const best = valids.reduce((a, b) => (b.i < a.i ? b : a), valids[0]);
      return { action: "mark", c: best.c, i: best.i, use: best.use };
    }
    const s = view.state || view.qwixx;
    return s.phase === "WHITE_PHASE" ? { action: "skip" } : { action: "finishTurn" };
  }

  function hardChoose(view, seat) {
    const valids = validMarks(view, seat);
    if (valids.length > 0) {
      // Lookahead: prefer marks with higher marginal score gain
      const s = view.state || view.qwixx;
      const p = s.allPlayers[seat];
      const best = valids.reduce((a, b) => {
        const gainA = marginalGain(p.rows[a.c], a.i);
        const gainB = marginalGain(p.rows[b.c], b.i);
        return gainB > gainA ? b : a;
      }, valids[0]);
      return { action: "mark", c: best.c, i: best.i, use: best.use };
    }
    const s = view.state || view.qwixx;
    return s.phase === "WHITE_PHASE" ? { action: "skip" } : { action: "finishTurn" };
  }

  // ---- BotDriver Registration ----
  BotDriver.register("qwixx", {
    choose(view, seat, difficulty) {
      const s = view.state || view.qwixx;
      if (!s || !diceRevealed(s)) return null;

      // White phase: all active players decide simultaneously
      if (s.phase === "WHITE_PHASE") {
        if (!s.pendingWhiteDecisions.includes(seat)) return null;
        if (difficulty === "easy") return easyChoose(view, seat);
        if (difficulty === "hard") return hardChoose(view, seat);
        return mediumChoose(view, seat);
      }

      // Color phase: only active player decides
      if (s.phase === "COLOR_PHASE") {
        if (s.activeSeat !== seat) return null;
        if (difficulty === "easy") return easyChoose(view, seat);
        if (difficulty === "hard") return hardChoose(view, seat);
        return mediumChoose(view, seat);
      }

      return null;
    },

    needsBot(view) {
      const s = view.state || view.qwixx;
      if (!s || !diceRevealed(s)) return false;
      if (s.phase === "WHITE_PHASE" && s.pendingWhiteDecisions.length > 0) return true;
      if (s.phase === "COLOR_PHASE" && s.activeSeat >= 0) return true;
      return false;
    },

    getActingSeat(view) {
      const s = view.state || view.qwixx;
      if (!s || !diceRevealed(s)) return -1;
      if (s.phase === "WHITE_PHASE") {
        // Return first bot that still needs to decide
        const bots = window._currentBots || [];
        for (const b of bots) {
          if (s.pendingWhiteDecisions.includes(b.seat)) return b.seat;
        }
      }
      if (s.phase === "COLOR_PHASE") return s.activeSeat;
      return -1;
    }
  });

  return { easyChoose, mediumChoose, hardChoose, validMarks };
})();

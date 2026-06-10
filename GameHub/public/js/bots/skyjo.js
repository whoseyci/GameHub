/**
 * Skyjo bot strategies — registered with BotDriver.
 * 
 * Easy: random valid moves
 * Medium: simple heuristics (take low discards, swap worst cards)
 * Hard: trained feature-based policy with column/triplet awareness
 */
const SkyjoBots = (() => {
  // ---- Helpers ----
  function rint(n) { return Math.floor(Math.random() * n); }
  function hidden(p) { return p.board.map((c, i) => !c.revealed && !c.cleared ? i : -1).filter(i => i >= 0); }
  function revealed(p) { return p.board.map((c, i) => c.revealed && !c.cleared ? i : -1).filter(i => i >= 0); }
  function col(idx) { return [idx % 4, (idx % 4) + 4, (idx % 4) + 8]; }
  function visibleScore(p) { return p.board.filter(c => c.revealed && !c.cleared).reduce((a, c) => a + c.value, 0); }
  
  // ---- Easy Bot ----
  function easyChoose(view) {
    const s = view.skyjo;
    const me = s.currentPlayer;
    const p = s.players[me];
    
    if (s.phase === 'REVEAL') {
      const hid = hidden(p);
      return { action: s.tiebreakerPlayers?.length ? 'tiebreaker' : 'reveal', index: hid[rint(hid.length)] };
    }
    
    if (s.turnAction === null) {
      return Math.random() < 0.5 ? { action: 'draw_deck' } : { action: 'take_discard' };
    }
    
    if (s.turnAction === 'deck') {
      if (s.myDrawnCard == null) return { action: 'discard_drawn' };
      const hid = hidden(p);
      return hid.length ? { action: 'swap', index: hid[rint(hid.length)] } : { action: 'discard_drawn' };
    }
    
    if (s.turnAction === 'discard' || s.turnAction === 'must_reveal') {
      const hid = hidden(p);
      const rev = revealed(p);
      const candidates = [...rev, ...hid];
      return { action: s.turnAction === 'must_reveal' ? 'reveal_after_discard' : 'swap', index: candidates[rint(candidates.length)] };
    }
    
    return null;
  }
  
  // ---- Medium Bot ----
  const MED_P = [3, 5, 2, 2]; // [thrTakeDiscard, thrBeat, deckSwapMargin, lockLow]
  
  function mediumChoose(view) {
    const s = view.skyjo;
    const me = s.currentPlayer;
    const p = s.players[me];
    const P = MED_P;
    
    if (s.phase === 'REVEAL') {
      const hid = hidden(p);
      return { action: s.tiebreakerPlayers?.length ? 'tiebreaker' : 'reveal', index: hid[rint(hid.length)] };
    }
    
    const revVals = revealed(p).map(i => p.board[i].value);
    const worst = revVals.length ? Math.max(...revVals) : -99;
    const worstIdx = p.board.findIndex(c => c.revealed && !c.cleared && c.value === worst);
    const hid = hidden(p);
    
    if (s.turnAction === null) {
      const dt = s.discardTop;
      const take = dt != null && (dt <= P[0] || (worst - dt) >= P[1]);
      return take ? { action: 'take_discard' } : { action: 'draw_deck' };
    }
    
    const drawn = s.myDrawnCard;
    if (s.turnAction === 'deck') {
      if (drawn == null) return { action: 'discard_drawn' };
      if (worstIdx >= 0 && drawn < worst - P[2]) return { action: 'swap', index: worstIdx };
      if (drawn <= P[3] && hid.length) return { action: 'swap', index: hid[rint(hid.length)] };
      return { action: 'discard_drawn' };
    }
    
    if (s.turnAction === 'discard') {
      if (worstIdx >= 0 && drawn < worst) return { action: 'swap', index: worstIdx };
      return { action: 'swap', index: hid.length ? hid[rint(hid.length)] : 0 };
    }
    
    if (s.turnAction === 'must_reveal') {
      return { action: 'reveal_after_discard', index: hid[rint(hid.length)] };
    }
    
    return null;
  }
  
  // ---- Hard Bot (trained policy) ----
  // V3 uploaded strategy-policy tuned by player-count buckets
  const SKYJO_U2 = [7.444, 1.726, 2.616, 1.505, 6.745, 1.604];
  const SKYJO_U4 = [7.783, 1.212, 3.783, 1.384, 5.841, 1.816];
  const SKYJO_U6 = [6.153, 1.281, 4.075, 0.824, 6.178, 2.09];
  // V4 solo board-efficiency policy
  const SKYJO_SOLO4 = [2.378, 4.014, 4.331, 0.545, 4.536, 2.491, 2.225, 3.738, 0.933, 2.367, 0.599, 7.451, -0.752, 4.416, 0.846];
  const SKYJO_SOLO6 = [0.226, 3.681, 4.473, 1.26, 3.561, 3.644, 1.055, 3.053, 0.92, 2.271, 0.443, 7.775, 0.702, 4.319, 1.951, -1.058, 0.989, -0.089, 0.764, 0.681];
  
  function tripletGain(p, idx, val) {
    const others = col(idx % 4).filter(i => i !== idx).map(i => p.board[i]);
    if (others.every(c => c.revealed && !c.cleared && c.value === val)) {
      return Math.max(-6, val + others[0].value + others[1].value);
    }
    const matches = others.filter(c => c.revealed && !c.cleared && c.value === val).length;
    return matches ? 1.5 * matches : 0;
  }
  
  function completesTriplet(p, idx, val) {
    const cells = col(idx % 4).filter(i => i !== idx).map(i => p.board[i]);
    return cells.every(c => c.revealed && !c.cleared && c.value === val);
  }
  
  function revealChoice(p, P) {
    const hid = hidden(p);
    if (!hid.length) return 0;
    let best = hid[0], bestScore = -1e9;
    for (const idx of hid) {
      const revCells = col(idx % 4).map(i => p.board[i]).filter(c => c.revealed && !c.cleared);
      const colHigh = revCells.reduce((a, c) => a + Math.max(0, c.value), 0);
      const pair = revCells.length >= 2 && revCells[0].value === revCells[1].value ? 1 : 0;
      const score = colHigh - 2 * pair + Math.random() * 0.01;
      if (score > bestScore) { bestScore = score; best = idx; }
    }
    return best;
  }
  
  function bestSwap(s, me, val, P, allowHidden = true) {
    const p = s.players[me];
    const cands = [...revealed(p), ...(allowHidden ? hidden(p) : [])];
    let best = cands[0] ?? 0, bestScore = -1e9;
    
    for (const idx of cands) {
      const c = p.board[idx];
      const oldKnown = (c.revealed && !c.cleared) ? c.value : 5.2;
      const immediate = oldKnown - val;
      const tg = tripletGain(p, idx, val);
      const hiddenPenalty = c.revealed ? 0 : (P[6] || 0);
      const wouldEnd = hidden(p).length === 1 && !c.revealed;
      
      let score = immediate + (P[4] || 0) * tg - hiddenPenalty;
      if (wouldEnd) score -= (P[7] || 8);
      
      // Check for triplet completion
      if (completesTriplet(p, idx, val) && val >= (P[5] || 0)) {
        score += 20;
      }
      
      if (score > bestScore) { bestScore = score; best = idx; }
    }
    return { idx: best, score: bestScore };
  }
  
  function hardChoose(view) {
    const s = view.skyjo;
    const me = s.currentPlayer;
    const p = s.players[me];
    const playerCount = s.players.length;
    
    // Select policy based on player count
    const P = playerCount <= 2 ? SKYJO_U2 : playerCount <= 4 ? SKYJO_U4 : SKYJO_U6;
    const SP = playerCount <= 4 ? SKYJO_SOLO4 : SKYJO_SOLO6;
    
    if (s.phase === 'REVEAL') {
      return { 
        action: s.tiebreakerPlayers?.length ? 'tiebreaker' : 'reveal', 
        index: revealChoice(p, SP) 
      };
    }
    
    if (s.turnAction === null) {
      const dt = s.discardTop;
      if (dt == null) return { action: 'draw_deck' };
      
      const b = bestSwap(s, me, dt, SP, true);
      const take = dt <= P[0] || b.score >= P[1] || (revealed(p).length && dt <= Math.max(...revealed(p).map(i => p.board[i].value)) - P[2]);
      
      return take ? { action: 'take_discard' } : { action: 'draw_deck' };
    }
    
    const drawn = s.myDrawnCard;
    if (s.turnAction === 'deck') {
      if (drawn == null) return { action: 'discard_drawn' };
      
      // If very low card and no bad revealed cards, use it to reveal a hidden slot
      if (drawn <= 0 && hidden(p).length && revealed(p).every(i => p.board[i].value <= 4) && !(hidden(p).length === 1)) {
        return { action: 'swap', index: revealChoice(p, SP) };
      }
      
      const b = bestSwap(s, me, drawn, SP, true);
      const take = b.score >= P[3] || drawn <= P[0];
      return take ? { action: 'swap', index: b.idx } : { action: 'discard_drawn' };
    }
    
    if (s.turnAction === 'discard') {
      const b = bestSwap(s, me, drawn, SP, true);
      return { action: 'swap', index: b.idx };
    }
    
    if (s.turnAction === 'must_reveal') {
      return { action: 'reveal_after_discard', index: revealChoice(p, SP) };
    }
    
    return null;
  }
  
  // ---- BotDriver Strategy Registration ----
  BotDriver.register('skyjo', {
    // Observation model lives WITH the game (was hardcoded in the driver). The host
    // receives publicDrawn for deck draws and lastAction for discard takes; patch
    // the view so this bot seat sees exactly what it can legitimately observe.
    observe(view, botSeat) {
      const gv = view.skyjo;
      if (!gv) return view;
      const sg = { ...gv, currentPlayer: botSeat };
      if (sg.myDrawnCard == null && sg.turnAction === 'deck' && sg.publicDrawn != null) {
        sg.myDrawnCard = sg.publicDrawn;
      }
      if (sg.myDrawnCard == null && sg.turnAction === 'discard' && sg.lastAction && sg.lastAction.type === 'take_discard' && sg.lastAction.player === botSeat) {
        sg.myDrawnCard = sg.lastAction.value;
      }
      return { ...view, skyjo: sg };
    },
    choose(view, seat, difficulty) {
      if (difficulty === 'easy') return easyChoose(view);
      if (difficulty === 'hard') return hardChoose(view);
      return mediumChoose(view);
    },
    
    needsBot(view) {
      const gv = view.skyjo;
      if (!gv) return false;
      if (gv.turnAction === 'turn_end_delay') return false;
      if (gv.phase === 'REVEAL') return true;
      if (gv.phase === 'PLAY' || gv.phase === 'FINAL_TURNS') {
        return gv.currentPlayer >= 0;
      }
      return false;
    },
    
    getActingSeat(view) {
      const gv = view.skyjo;
      if (!gv) return -1;
      if (gv.phase === 'REVEAL') {
        if (gv.tiebreakerPlayers?.length) return gv.tiebreakerPlayers[0];
        // Find first bot that still needs to reveal
        const bots = window._currentBots || [];
        for (const b of bots) {
          const p = gv.players[b.seat];
          if (p && p.revealCount < 2) return b.seat;
        }
      }
      return gv.currentPlayer ?? -1;
    }
  });
  
  return { easyChoose, mediumChoose, hardChoose };
})();

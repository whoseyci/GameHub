/**
 * Flip 7 bot strategies — registered with BotDriver.
 * 
 * Easy: reckless hit (stays only when live < 18 or coin flip)
 * Medium: heuristic (hits when bust prob < 30% or live < 14)
 * Hard: exact EV-based policy with card-counting and threat targeting
 */
const Flip7Bots = (() => {
  // ---- Policy weights (trained via CEM self-play) ----
  
  // Hard V2 hit/stay: linear policy
  const FLIP7_W = [1.2192,-4.6204,-4.0534,2.0874,6.5815,5.9684,-6.6861,-0.0642,-0.0056,-0.8209,-0.1052,0.3775,0.0651,-0.6054,-0.1983];
  
  // Hard EV-based weights by player count
  const FLIP7_EV2 = [-0.0164,0.0027,0.0493,3.4614];
  const FLIP7_EV4 = [-0.0197,0.0375,0.1339,3.5668];
  const FLIP7_EV6 = [-0.1253,0.0464,0.0475,5.2227];
  
  // ---- Observation-correct bust probability ----
  
  function bustProb(gv, me) {
    const p = gv.players[me];
    if (!p.nums.length) return 0;
    // Count copies of each held value already visible across ALL tables
    const seen = {};
    for (const q of gv.players) {
      for (const n of q.nums) { seen[n] = (seen[n] || 0) + 1; }
      if (q.bustCard != null) seen[q.bustCard] = (seen[q.bustCard] || 0) + 1;
    }
    let dupesLeft = 0;
    for (const n of new Set(p.nums)) {
      const copiesTotal = (n === 0 ? 1 : n);
      const left = Math.max(0, copiesTotal - (seen[n] || 0));
      dupesLeft += left;
    }
    const deck = Math.max(1, gv.deckCount || 1);
    return Math.min(1, dupesLeft / deck);
  }
  
  // ---- Feature extraction ----
  
  function features(gv, me) {
    const p = gv.players[me];
    const bp = bustProb(gv, me);
    const u = p.unique;
    const others = gv.players.filter((_, i) => i !== me);
    const bestOppBanked = Math.max(...others.map(o => o.banked));
    const bestOppLive = Math.max(...others.map(o => o.live));
    const active = gv.players.filter(q => q.status === 'active').length;
    const stayed = gv.players.filter(q => q.status === 'stayed').length;
    const leaderGap = p.banked - bestOppBanked;
    return [
      1, bp, p.live / 40, u / 7, p.second ? 1 : 0, (7 - u) / 7,
      bp * p.live / 40, p.banked / 200, (200 - p.banked) / 200,
      leaderGap / 200, bestOppBanked / 200, bestOppLive / 40,
      active / gv.players.length, stayed / gv.players.length,
      bp * Math.max(0, 200 - p.banked) / 200,
    ];
  }
  
  // ---- EV calculation ----
  
  function fullCounts(variant = 'standard') {
    const m = { 0: 1 };
    if (variant === 'vengeance') {
      for (let v = 1; v <= 13; v++) m[v] = v;
      for (const k of ['-2','-4','-6','-8','-10','div2']) m[k] = 1;
      for (const k of ['just1more','swap','steal','discard','flip4']) m[k] = 2;
      return m;
    }
    for (let v = 1; v <= 12; v++) m[v] = v;
    for (const k of ['+2','+4','+6','+8','+10','x2']) m[k] = 1;
    for (const k of ['freeze','flip3','second']) m[k] = 3;
    return m;
  }
  
  function dec(m, k) { if (m[k] != null) m[k] = Math.max(0, m[k] - 1); }
  
  function remaining(gv) {
    const m = fullCounts(gv.variant || 'standard');
    for (const p of gv.players) {
      for (const n of p.nums) dec(m, String(n));
      for (const md of p.mods) dec(m, md);
      if (p.second) dec(m, 'second');
      if (p.bustCard != null) dec(m, String(p.bustCard));
    }
    return m;
  }
  
  function modAdd(p) { let a = 0; for (const md of p.mods) if (md[0] === '+') a += parseInt(md.slice(1)); return a; }
  function hasX2(p) { return p.mods.includes('x2'); }
  function bankedValue(p) {
    let s = p.nums.reduce((a, b) => a + b, 0);
    if (hasX2(p)) s *= 2;
    s += modAdd(p);
    if (new Set(p.nums).size >= 7) s += 15;
    return s;
  }
  
  function evHitValue(gv, me) {
    const p = gv.players[me];
    const held = new Set(p.nums);
    const m = remaining(gv);
    let total = 0;
    for (const k in m) total += m[k];
    if (total <= 0) total = 1;
    
    const x2 = hasX2(p) ? 2 : 1;
    const add = modAdd(p);
    const cur = p.nums.reduce((a, b) => a + b, 0);
    const uniq = held.size;
    
    let ev = 0;
    for (const k in m) {
      const c = m[k];
      if (c <= 0) continue;
      const pr = c / total;
      let out;
      const asNum = Number(k);
      const isNum = k === '0' || (Number.isInteger(asNum) && asNum >= 1 && asNum <= 12);
      
      if (isNum) {
        const v = k === '0' ? 0 : asNum;
        if (held.has(v)) {
          out = p.second ? cur * x2 + add : 0;
        } else {
          let base = (cur + v) * x2 + add;
          if (uniq + 1 >= 7) base += 15;
          out = base;
        }
      } else if (k === 'x2') {
        out = cur * 2 + add;
      } else if (k[0] === '+') {
        out = cur * x2 + add + parseInt(k.slice(1));
      } else {
        out = cur * x2 + add + (k === 'second' ? 2 : 0);
      }
      ev += pr * out;
    }
    return ev;
  }
  
  // ---- Decision functions ----
  
  function evHit(gv, me) {
    const P = gv.players.length <= 2 ? FLIP7_EV2 : gv.players.length <= 4 ? FLIP7_EV4 : FLIP7_EV6;
    const p = gv.players[me];
    let ev = evHitValue(gv, me);
    if (p.second) ev += P[3];
    const stay = bankedValue(p);
    const others = gv.players.filter((_, i) => i !== me);
    const bestOpp = Math.min(...others.map(o => o.banked));
    const behind = p.banked - bestOpp;
    let mult = 1 + P[0];
    if (behind > 15) mult -= P[1];
    if (behind < -15) mult += P[2];
    return ev > stay * mult || stay === 0;
  }
  
  function heuristicHit(p, bp) {
    return bp < 0.30 || p.live < 14;
  }
  
  function recklessHit(p) {
    return p.live < 18 || Math.random() < 0.5;
  }
  
  function legalTarget(gv, target) {
    const legal = gv?._legal || [];
    const hit = legal.find(a => a.action === 'target' && a.target === target);
    return hit ? JSON.parse(JSON.stringify(hit)) : { action: 'target', target };
  }

  function chooseTarget(gv, me, difficulty) {
    const pa = gv.pendingAction;
    const vengeance = gv.variant === 'vengeance';
    const others = gv.players.map((_, i) => i).filter(i => i !== me && (vengeance ? gv.players[i].status !== 'busted' : gv.players[i].status === 'active'));
    if (!others.length) return legalTarget(gv, me);
    
    if (difficulty === 'hard') {
      if (pa?.kind === 'give_second') {
        const elig = others.filter(i => !gv.players[i].second);
        const pool = elig.length ? elig : others;
        return legalTarget(gv, pool.reduce((a, b) =>
          (gv.players[b].banked + gv.players[b].live) < (gv.players[a].banked + gv.players[a].live) ? b : a
        , pool[0]));
      }
      if (pa?.kind === 'freeze' || pa?.kind === 'discard' || pa?.kind === 'just1more') {
        return legalTarget(gv, others.reduce((a, b) => {
          const sa = -gv.players[a].live + 0.12 * gv.players[a].banked;
          const sb = -gv.players[b].live + 0.12 * gv.players[b].banked;
          return sb > sa ? b : a;
        }, others[0]));
      }
      if (pa?.kind === 'flip3' || pa?.kind === 'flip4') {
        const score = i => {
          const q = gv.players[i];
          const bp = bustProb(gv, i);
          const count = pa.kind === 'flip4' ? 4 : 3;
          const bustN = 1 - Math.pow(1 - bp, count);
          return bustN * (20 + q.live) + 4 * q.unique + (q.second ? -12 : 0) + 0.03 * q.banked;
        };
        return legalTarget(gv, others.reduce((a, b) => score(b) > score(a) ? b : a, others[0]));
      }
      if (pa?.kind === 'steal' || pa?.kind === 'swap') {
         // Target the player with the best card
         return legalTarget(gv, others.reduce((a, b) => gv.players[b].live > gv.players[a].live ? b : a, others[0]));
      }
    }
    if (pa?.kind === 'modifier') {
      return legalTarget(gv, others.reduce((a, b) => (gv.players[b].banked + gv.players[b].live) > (gv.players[a].banked + gv.players[a].live) ? b : a, others[0]));
    }
    if (pa?.kind === 'give_second') return legalTarget(gv, others[0]);
    return legalTarget(gv, others.reduce((a, b) => gv.players[b].live > gv.players[a].live ? b : a, others[0]));
  }
  
  // ---- Main choose function ----
  
  function choose(view, difficulty, seat = null) {
    const s = view.flip7;
    s._legal = view?.state?.legal || [];
    const me = seat != null ? seat : (s.pendingAction ? s.pendingAction.from : s.current);
    const p = s.players[me];
    
    // Handle pending action targeting
    if (s.pendingAction) {
      const pa = s.pendingAction;
      if (pa.from === me) {
        return chooseTarget(s, me, difficulty);
      }
    }
    
    // Hit/Stay decision
    const bp = bustProb(s, me);
    let hit;
    if (difficulty === 'hard') hit = evHit(s, me);
    else if (difficulty === 'easy') hit = recklessHit(p);
    else hit = heuristicHit(p, bp);
    
    return hit ? { action: 'hit' } : { action: 'stay' };
  }
  
  // ---- BotDriver Registration ----
  BotDriver.register('flip7', {
    choose(view, seat, difficulty) {
      return choose(view, difficulty, seat);
    },
    
    needsBot(view) {
      const gv = view.flip7;
      if (!gv) return false;
      if (gv.phase === 'PLAY' && !gv.pendingAction) return true;
      if (gv.pendingAction && gv.pendingAction.from >= 0) return true;
      return false;
    },
    
    getActingSeat(view) {
      const gv = view.flip7;
      if (!gv) return -1;
      if (gv.pendingAction) return gv.pendingAction.from;
      if (gv.phase === 'PLAY') return gv.current;
      return -1;
    }
  });
  
  return { choose, bustProb, evHitValue };
})();

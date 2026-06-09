/* ====================== BOTS ======================
   Bots "think" on the host's client (online) or the local device (offline) so the
   server spends ~0 compute. Easy/Medium are heuristics; Hard uses compact
   self-play-trained feature policies plus game-specific tactical heuristics.
   Interface: Bots.choose(gameId, view, difficulty) -> action msg (or null).
   ================================================================= */
const Bots=(()=>{
  function rint(n){return Math.floor(Math.random()*n);}

  /* ===== Trained policies (learned via self-play CEM in /training) ===== */
  // Flip 7 hard legacy V2 hit/stay: linear policy over V2 observation features.
  const FLIP7_W=[1.2192,-4.6204,-4.0534,2.0874,6.5815,5.9684,-6.6861,-0.0642,-0.0056,-0.8209,-0.1052,0.3775,0.0651,-0.6054,-0.1983];
  // Flip 7 hard v13: uploaded exact-EV/card-counting hit-stay with our threat targeting.
  const FLIP7_EV2=[-0.0164,0.0027,0.0493,3.4614];
  const FLIP7_EV4=[-0.0197,0.0375,0.1339,3.5668];
  const FLIP7_EV6=[-0.1253,0.0464,0.0475,5.2227];
  // Skyjo legacy turn params: [thrTakeDiscard, thrBeat, thrSwapMargin, thrLockLow].
  const SKYJO_P=[1.962,8.261,1.71,2.796];
  // Skyjo hard V2: column/triplet/end-risk scorer trained in /research.
  // [lowKeep, takeScore, beatWorst, deckSwapScore, tripletWeight, unused, hiddenPenalty, endRisk]
  const SKYJO_V2=[3.763,2.727,2.81,3.792,2.268,-0.705,0.663,8.267];
  // Skyjo hard V3: uploaded strategy-policy tuned by player-count buckets.
  // [keepThreshold, takeDiscardMax, beatMargin, lockLowMax, closeAheadMargin, tripletMinVal]
  const SKYJO_U2=[7.444,1.726,2.616,1.505,6.745,1.604];
  const SKYJO_U4=[7.783,1.212,3.783,1.384,5.841,1.816];
  const SKYJO_U6=[6.153,1.281,4.075,0.824,6.178,2.09];
  // Skyjo hard V4: solo board-efficiency policy fine-tuned in multiplayer.
  // [lowKeep,takeScore,beatWorst,deckSwapScore,tripletW,pairW,hiddenPenalty,revealSpreadW,revealHighW,revealPairPenalty,turnPenalty,highDiscard]
  // Bucketed polish: <=4p and >=5p prefer slightly different risk/tempo.
  const SKYJO_SOLO4=[2.378,4.014,4.331,0.545,4.536,2.491,2.225,3.738,0.933,2.367,0.599,7.451,-0.752,4.416,0.846];
  const SKYJO_SOLO6=[0.226,3.681,4.473,1.26,3.561,3.644,1.055,3.053,0.92,2.271,0.443,7.775,0.702,4.319,1.951,-1.058,0.989,-0.089,0.764,0.681];

  /* ---------- FLIP 7 ---------- */
  // Estimate true bust probability from the view. We know our own numbers; the
  // remaining-deck duplicate count is estimated from how many copies of each held
  // value are unseen across all tables, divided by the (known) deckCount.
  function flip7BustProb(gv,me){
    const p=gv.players[me];
    if(!p.nums.length)return 0;
    // count copies of each held value already visible on ALL tables (incl. busts)
    const seen={};
    for(const q of gv.players){ for(const n of q.nums){seen[n]=(seen[n]||0)+1;} if(q.bustCard!=null)seen[q.bustCard]=(seen[q.bustCard]||0)+1; }
    let dupesLeft=0;
    for(const n of new Set(p.nums)){ const copiesTotal=(n===0?1:n); const left=Math.max(0,copiesTotal-(seen[n]||0)); dupesLeft+=left; }
    const deck=Math.max(1, gv.deckCount||1);
    return Math.min(1, dupesLeft/deck);
  }
  function flip7Features(gv,me){
    const p=gv.players[me];
    const bp=flip7BustProb(gv,me);
    const u=p.unique;
    const others=gv.players.filter((_,i)=>i!==me);
    const bestOppBanked=Math.max(...others.map(o=>o.banked));
    const bestOppLive=Math.max(...others.map(o=>o.live));
    const active=gv.players.filter(q=>q.status==='active').length;
    const stayed=gv.players.filter(q=>q.status==='stayed').length;
    const leaderGap=p.banked-bestOppBanked;
    return [
      1,
      bp,
      p.live/40,
      u/7,
      p.second?1:0,
      (7-u)/7,
      bp*p.live/40,
      p.banked/200,
      (200-p.banked)/200,
      leaderGap/200,
      bestOppBanked/200,
      bestOppLive/40,
      active/gv.players.length,
      stayed/gv.players.length,
      bp*Math.max(0,200-p.banked)/200,
    ];
  }
  function flip7Hit(gv,me){const f=flip7Features(gv,me);let z=0;for(let i=0;i<FLIP7_W.length;i++)z+=FLIP7_W[i]*(f[i]||0);return z>0;}
  function f7FullCounts(){const m={0:1};for(let v=1;v<=12;v++)m[v]=v;for(const k of ['+2','+4','+6','+8','+10','x2'])m[k]=1;for(const k of ['freeze','flip3','second'])m[k]=3;return m;}
  function f7Dec(m,k){if(m[k]!=null)m[k]=Math.max(0,m[k]-1);}
  function f7Remaining(gv){const m=f7FullCounts();for(const p of gv.players){for(const n of p.nums)f7Dec(m,String(n));for(const md of p.mods)f7Dec(m,md);if(p.second)f7Dec(m,'second');if(p.bustCard!=null)f7Dec(m,String(p.bustCard));}return m;}
  function f7ModAdd(p){let a=0;for(const md of p.mods)if(md[0]==='+')a+=parseInt(md.slice(1));return a;}
  function f7HasX2(p){return p.mods.includes('x2');}
  function f7BankedValue(p){let s=p.nums.reduce((a,b)=>a+b,0);if(f7HasX2(p))s*=2;s+=f7ModAdd(p);if(new Set(p.nums).size>=7)s+=15;return s;}
  function flip7EvHitValue(gv,me){const p=gv.players[me],held=new Set(p.nums),m=f7Remaining(gv);let total=0;for(const k in m)total+=m[k];if(total<=0)total=1;const x2=f7HasX2(p)?2:1,add=f7ModAdd(p),cur=p.nums.reduce((a,b)=>a+b,0),uniq=held.size;let ev=0;for(const k in m){const c=m[k];if(c<=0)continue;const pr=c/total;let out;const asNum=Number(k),isNum=k==='0'||(Number.isInteger(asNum)&&asNum>=1&&asNum<=12);if(isNum){const v=k==='0'?0:asNum;if(held.has(v)){out=p.second?cur*x2+add:0;}else{let base=(cur+v)*x2+add;if(uniq+1>=7)base+=15;out=base;}}else if(k==='x2')out=cur*2+add;else if(k[0]==='+')out=cur*x2+add+parseInt(k.slice(1));else out=cur*x2+add+(k==='second'?2:0);ev+=pr*out;}return ev;}
  function flip7EvHit(gv,me){const P=gv.players.length<=2?FLIP7_EV2:gv.players.length<=4?FLIP7_EV4:FLIP7_EV6;const p=gv.players[me];let ev=flip7EvHitValue(gv,me);if(p.second)ev+=P[3];const stay=f7BankedValue(p);const others=gv.players.filter((_,i)=>i!==me);const bestOpp=Math.min(...others.map(o=>o.banked));const behind=p.banked-bestOpp;let mult=1+P[0];if(behind>15)mult-=P[1];if(behind<-15)mult+=P[2];return ev>stay*mult||stay===0;}
  function flip7HeuristicHit(p,bp){return bp<0.30||p.live<14;}      // Medium
  function flip7RecklessHit(p){return p.live<20;}                    // Easy

  function flip7Choose(view,diff){
    const s=view.flip7, me=s.current, p=s.players[me];
    if(s.pendingAction && s.pendingAction.from===me){
      const k=s.pendingAction.kind;
      const others=s.players.map((q,i)=>i).filter(i=>i!==me&&s.players[i].status==='active');
      let target=me;
      if(others.length){
        if(diff==='hard'){
          if(k==='give_second'){
            // Forced to give away a Second Chance: give it to the lowest-threat
            // active opponent who doesn't already have one if possible.
            const elig=others.filter(i=>!s.players[i].second);
            const pool=elig.length?elig:others;
            target=pool.reduce((a,b)=>(s.players[b].banked+s.players[b].live)<(s.players[a].banked+s.players[a].live)?b:a,pool[0]);
          }else if(k==='freeze'){
            // Freeze denies future upside but locks current live points. Prefer
            // freezing a low-live leader/threat, not the biggest live score.
            target=others.reduce((a,b)=>{
              const sa=-s.players[a].live+0.12*s.players[a].banked;
              const sb=-s.players[b].live+0.12*s.players[b].banked;
              return sb>sa?b:a;
            },others[0]);
          }else{
            // Flip Three: attack high bust-risk / high live / no-second targets.
            const score=i=>{const q=s.players[i],bp=flip7BustProb(s,i),bust3=1-Math.pow(1-bp,3);return bust3*(20+q.live)+4*q.unique+(q.second?-12:0)+0.03*q.banked;};
            target=others.reduce((a,b)=>score(b)>score(a)?b:a,others[0]);
          }
        }else{
          if(k==='give_second')target=others[0];
          else if(k==='freeze') target=others.reduce((a,b)=>s.players[b].live>s.players[a].live?b:a,others[0]);
          else target=others.reduce((a,b)=>s.players[b].unique>s.players[a].unique?b:a,others[0]);
        }
      }
      return {action:'target',target};
    }
    const bp=flip7BustProb(s,me);
    let hit;
    if(diff==='hard') hit=flip7EvHit(s,me);
    else if(diff==='easy') hit=(p.live<18||Math.random()<0.5);
    else hit=flip7HeuristicHit(p,bp);   // medium
    return hit?{action:'hit'}:{action:'stay'};
  }

  
  /* ---------- QWIXX ---------- */
  function qwixxValidMarks(p, s, isColorPhase) {
     const valids = [];
     const isAct = s.activeSeat === s.viewerSeat;
     ['red', 'yellow', 'green', 'blue'].forEach(c => {
         if (s.locked.includes(c)) return;
         const row = p.rows[c];
         const last = row.marks.length > 0 ? row.marks[row.marks.length - 1] : -1;
         const endIdx = row.nums.length - 1;
         if (!isColorPhase) {
            const wSum = s.dice.w[0] + s.dice.w[1];
            for (let i = last + 1; i <= endIdx; i++) {
                if (row.nums[i] === wSum) {
                   if (i === endIdx && row.marks.length < 5) continue;
                   valids.push({ c, i });
                }
            }
         } else if (isAct) {
            const cKey = c[0];
            if (s.dice[cKey] > 0) {
               const sum1 = s.dice.w[0] + s.dice[cKey];
               const sum2 = s.dice.w[1] + s.dice[cKey];
               for (let i = last + 1; i <= endIdx; i++) {
                   if (row.nums[i] === sum1 || row.nums[i] === sum2) {
                      if (i === endIdx && row.marks.length < 5) continue;
                      valids.push({ c, i });
                   }
               }
            }
         }
     });
     return valids;
  }
  function qwixxChoose(view, diff) {
     const s = view.state;
     const me = view.yourSeat;
     const p = s.allPlayers[me];
     
     if (s.phase === "WHITE_PHASE") {
        if (!s.pendingWhiteDecisions.includes(me)) return null;
        const valids = qwixxValidMarks(p, s, false);
        if (valids.length > 0) {
           // pick one that wastes the fewest numbers, or randomly
           const best = valids.reduce((a, b) => (b.i < a.i ? b : a), valids[0]);
           return { action: 'mark', c: best.c, i: best.i };
        }
        return { action: 'skip' };
     } else if (s.phase === "COLOR_PHASE") {
        if (s.activeSeat !== me) return null;
        const valids = qwixxValidMarks(p, s, true);
        if (valids.length > 0) {
           const best = valids.reduce((a, b) => (b.i < a.i ? b : a), valids[0]);
           return { action: 'mark', c: best.c, i: best.i };
        }
        return { action: 'finishTurn' };
     }
     return null;
  }

  /* ---------- SKYJO ---------- */
  function skyHidden(p){return p.board.map((c,i)=>!c.revealed&&!c.cleared?i:-1).filter(i=>i>=0);}
  function skyRevealed(p){return p.board.map((c,i)=>c.revealed&&!c.cleared?i:-1).filter(i=>i>=0);}
  function skyCol(col){return [col,col+4,col+8];}
  function skyVisibleScore(p){return p.board.filter(c=>c.revealed&&!c.cleared).reduce((a,c)=>a+c.value,0);}
  function skyTripletGain(p,idx,val){
    const others=skyCol(idx%4).filter(i=>i!==idx).map(i=>p.board[i]);
    if(others.every(c=>c.revealed&&!c.cleared&&c.value===val))return Math.max(-6,val+others[0].value+others[1].value);
    const matches=others.filter(c=>c.revealed&&!c.cleared&&c.value===val).length;
    return matches?1.5*matches:0;
  }
  function skyEndRisk(s,me,P){
    const mine=skyVisibleScore(s.players[me]);
    const bestOpp=Math.min(...s.players.map((p,i)=>i===me?Infinity:skyVisibleScore(p)+skyHidden(p).length*2.5));
    return mine<=bestOpp?0:P[7];
  }
  function skyRevealChoice(s,me,P){
    const p=s.players[me],hid=skyHidden(p); if(!hid.length)return 0;
    let best=hid[0],bestScore=-1e9;
    for(const idx of hid){
      const rev=skyCol(idx%4).map(i=>p.board[i]).filter(c=>c.revealed&&!c.cleared);
      const colHigh=rev.reduce((a,c)=>a+Math.max(0,c.value),0);
      const pair=rev.length>=2&&rev[0].value===rev[1].value?1:0;
      const score=colHigh-2*pair+Math.random()*0.01;
      if(score>bestScore){bestScore=score;best=idx;}
    }
    return best;
  }
  function skyBestSwap(s,me,val,P,allowHidden=true){
    const p=s.players[me],cands=[...skyRevealed(p),...(allowHidden?skyHidden(p):[])];
    let best=cands[0]??0,bestScore=-1e9;
    for(const idx of cands){
      const c=p.board[idx],oldKnown=(c.revealed&&!c.cleared)?c.value:5.2;
      const immediate=oldKnown-val, tg=skyTripletGain(p,idx,val), hiddenPenalty=c.revealed?0:P[6];
      const wouldEnd=skyHidden(p).length===1&&!c.revealed;
      const score=immediate+P[4]*tg-hiddenPenalty-(wouldEnd?skyEndRisk(s,me,P):0);
      if(score>bestScore){bestScore=score;best=idx;}
    }
    return {idx:best,score:bestScore};
  }
  function skyjoChooseV2(view){
    const s=view.skyjo, me=s.currentPlayer, p=s.players[me], P=SKYJO_V2;
    if(s.phase==='REVEAL')return {action:(s.tiebreakerPlayers&&s.tiebreakerPlayers.length)?'tiebreaker':'reveal',index:skyRevealChoice(s,me,P)};
    const revealed=skyRevealed(p), worst=revealed.length?Math.max(...revealed.map(i=>p.board[i].value)):-99, ta=s.turnAction;
    if(ta===null){const dt=s.discardTop;if(dt==null)return {action:'draw_deck'};const best=skyBestSwap(s,me,dt,P,true);return (dt<=P[0]||best.score>=P[1]||(worst-dt)>=P[2])?{action:'take_discard'}:{action:'draw_deck'};}
    const drawn=s.myDrawnCard;
    if(ta==='deck'){if(drawn==null)return {action:'discard_drawn'};const best=skyBestSwap(s,me,drawn,P,true);return (best.score>=P[3]||drawn<=P[0])?{action:'swap',index:best.idx}:{action:'discard_drawn'};}
    if(ta==='discard'){const best=skyBestSwap(s,me,drawn,P,true);return {action:'swap',index:best.idx};}
    if(ta==='must_reveal')return {action:'reveal_after_discard',index:skyRevealChoice(s,me,P)};
    return null;
  }
  function skyWorst(p){const rv=skyRevealed(p);if(!rv.length)return {idx:-1,val:-99};let idx=rv[0],val=p.board[idx].value;for(const i of rv)if(p.board[i].value>val){idx=i;val=p.board[i].value;}return {idx,val};}
  function skyCompletesUpload(p,idx,val){const cells=skyCol(idx%4).filter(i=>i!==idx).map(i=>p.board[i]);return cells.every(c=>c.revealed&&!c.cleared&&c.value===val);}
  function skyAheadUpload(s,me,margin){const mine=skyVisibleScore(s.players[me]);const bestOpp=Math.min(...s.players.map((p,i)=>i===me?Infinity:skyVisibleScore(p)));return mine<=bestOpp-margin;}
  function skyPlaceUpload(s,me,val,P){
    const p=s.players[me],hid=skyHidden(p),w=skyWorst(p);
    const open=p.board.map((c,i)=>!c.cleared?i:-1).filter(i=>i>=0);
    for(const bi of open)if(skyCompletesUpload(p,bi,val)&&val>=P[5])return {action:'swap',index:bi};
    if(w.idx>=0&&val<w.val-P[2])return {action:'swap',index:w.idx};
    if(val<=P[3]&&hid.length){if(hid.length===1&&!skyAheadUpload(s,me,P[4]))return null;return {action:'swap',index:hid[0]};}
    if(w.idx>=0&&val<w.val)return {action:'swap',index:w.idx};
    return null;
  }
  function skyjoChooseUpload(view){
    const s=view.skyjo,me=s.currentPlayer,p=s.players[me],P=s.players.length<=2?SKYJO_U2:s.players.length<=4?SKYJO_U4:SKYJO_U6;
    const hid=skyHidden(p);
    if(s.phase==='REVEAL')return {action:(s.tiebreakerPlayers&&s.tiebreakerPlayers.length)?'tiebreaker':'reveal',index:hid[rint(hid.length)]};
    if(s.turnAction===null){
      const dt=s.discardTop,w=skyWorst(p);
      let useful=false;
      if(dt!=null){
        useful=dt<=P[1]||(w.val-dt)>=P[2]||p.board.some((c,i)=>!c.cleared&&skyCompletesUpload(p,i,dt)&&dt>=P[5]);
      }
      return useful?{action:'take_discard'}:{action:'draw_deck'};
    }
    const drawn=s.myDrawnCard;
    if(s.turnAction==='deck'){
      if(drawn==null)return {action:'discard_drawn'};
      if(drawn>=P[0]){
        for(let i=0;i<p.board.length;i++)if(!p.board[i].cleared&&skyCompletesUpload(p,i,drawn)&&drawn>=P[5])return {action:'swap',index:i};
        if(hid.length)return {action:'discard_drawn'};
      }
      const a=skyPlaceUpload(s,me,drawn,P); if(a)return a;
      const w=skyWorst(p); return hid.length?{action:'discard_drawn'}:{action:'swap',index:w.idx>=0?w.idx:0};
    }
    if(s.turnAction==='discard'){
      const a=skyPlaceUpload(s,me,drawn,P); if(a)return a;
      const w=skyWorst(p); return {action:'swap',index:w.idx>=0?w.idx:(hid[0]??0)};
    }
    if(s.turnAction==='must_reveal')return {action:'reveal_after_discard',index:hid[rint(hid.length)]};
    return null;
  }
  function skyTripSolo(p,idx,val){
    const cells=skyCol(idx%4).filter(i=>i!==idx).map(i=>p.board[i]);
    if(cells.every(c=>c.revealed&&!c.cleared&&c.value===val))return Math.max(-8,val+cells[0].value+cells[1].value);
    return cells.filter(c=>c.revealed&&!c.cleared&&c.value===val).length;
  }
  function skyEndRiskSolo(s,me){
    if(s.players.length<=1)return 0;
    const mine=skyVisibleScore(s.players[me]);
    const best=Math.min(...s.players.map((p,i)=>i===me?Infinity:skyVisibleScore(p)+skyHidden(p).length*2.5));
    return mine<=best?0:8;
  }
  function skyPrevSupply(s,me,val){
    if(s.players.length<=1)return 0;
    const prev=s.players[(me-1+s.players.length)%s.players.length],w=skyWorst(prev).val;
    let has=0;for(const i of skyRevealed(prev))if(prev.board[i].value===val)has++;
    const high=Math.max(0,(val-4)/8);
    return (has?0.5*has:0)+(w===val?1:0)+high*(w>=val?0.5:0);
  }
  function skyNextDanger(s,me){
    if(s.players.length<=1)return 0;
    const nx=s.players[(me+1)%s.players.length];
    return Math.max(0,(20-skyVisibleScore(nx))/20)+(12-skyHidden(nx).length)/12;
  }
  function skyNextFeed(s,me,val,P){
    if(s.players.length<=1)return 0;
    const nx=s.players[(me+1)%s.players.length];let trip=0;
    for(let c=0;c<4;c++){const rev=skyCol(c).map(i=>nx.board[i]).filter(x=>x.revealed&&!x.cleared);if(rev.length>=2&&rev[0].value===rev[1].value&&rev[0].value===val)trip=1;}
    const improve=Math.max(0,skyWorst(nx).val-val)/12;
    return (P[15]||0)*trip+(P[16]||0)*improve+(P[17]||0)*skyNextDanger(s,me)*(trip+improve>0?1:0);
  }
  function skyAnchorValue(s,me,idx,oldVal){
    const p=s.players[me];
    const same=skyCol(idx%4).filter(i=>i!==idx).map(i=>p.board[i]).filter(c=>c.revealed&&!c.cleared&&c.value===oldVal).length;
    return same*(1+skyPrevSupply(s,me,oldVal));
  }
  function skyBestSwapSolo(s,me,val,P){
    const p=s.players[me],cands=[...skyRevealed(p),...skyHidden(p)],w=skyWorst(p);
    let best=cands[0]??0,bestScore=-1e9;
    for(const idx of cands){
      const c=p.board[idx],oldKnown=(c.revealed&&!c.cleared)?c.value:5.2;
      const tg=skyTripSolo(p,idx,val),complete=(tg!==0&&Math.abs(tg)>1)?tg:0,pair=(tg>0&&tg<=2)?tg:0;
      const wouldEnd=skyHidden(p).length===1&&!c.revealed;
      const lowHidden=(!c.revealed&&val<=P[12]&&w.val<=P[13]&&!wouldEnd)?P[14]:0;
      const supply=(P[18]||0)*skyPrevSupply(s,me,val)*(pair>0?1:0);
      const preserve=(c.revealed&&!c.cleared)?(P[19]||0)*skyAnchorValue(s,me,idx,c.value):0;
      const score=(oldKnown-val)+P[4]*complete+P[5]*pair-(c.revealed?0:P[6])+lowHidden+supply-preserve-(wouldEnd?skyEndRiskSolo(s,me):0);
      if(score>bestScore){bestScore=score;best=idx;}
    }
    return {idx:best,score:bestScore};
  }
  function skyRevealSolo(s,me,P){
    const p=s.players[me],hid=skyHidden(p); if(!hid.length)return 0;
    let best=hid[0],bestScore=-1e9;
    for(const idx of hid){
      const rev=skyCol(idx%4).map(i=>p.board[i]).filter(c=>c.revealed&&!c.cleared);
      const score=P[7]*(rev.length===0?1:0)+P[8]*rev.reduce((a,c)=>a+Math.max(0,c.value),0)-P[9]*(rev.length>=2&&rev[0].value===rev[1].value?1:0)+Math.random()*0.01;
      if(score>bestScore){bestScore=score;best=idx;}
    }
    return best;
  }
  function skyjoChooseSolo(view){
    const s=view.skyjo,me=s.currentPlayer,p=s.players[me],P=s.players.length<=4?SKYJO_SOLO4:SKYJO_SOLO6,hid=skyHidden(p);
    if(s.phase==='REVEAL')return {action:(s.tiebreakerPlayers&&s.tiebreakerPlayers.length)?'tiebreaker':'reveal',index:skyRevealSolo(s,me,P)};
    const w=skyWorst(p);
    if(s.turnAction===null){const dt=s.discardTop;if(dt==null)return {action:'draw_deck'};const b=skyBestSwapSolo(s,me,dt,P);return (dt<=P[0]||b.score>=P[1]||(w.val-dt)>=P[2])?{action:'take_discard'}:{action:'draw_deck'};}
    const val=s.myDrawnCard;
    if(s.turnAction==='deck'){
      if(val==null)return {action:'discard_drawn'};
      const w=skyWorst(p);
      // Human/solo insight: very low deck draws should often be used to remove
      // unknown risk, not only to polish an already-good visible board. If there
      // is no genuinely bad revealed card, lock the low card into a hidden slot.
      if(val<=0&&hid.length&&w.val<=(P[12]??4.5)&&!(hid.length===1&&skyEndRiskSolo(s,me))){
        return {action:'swap',index:skyRevealSolo(s,me,P)};
      }
      const b=skyBestSwapSolo(s,me,val,P),feed=skyNextFeed(s,me,val,P);
      if(val>=P[11]&&b.score+feed<P[1]+2&&hid.length)return {action:'discard_drawn'};
      return (b.score+feed>=P[3]||val<=P[0])?{action:'swap',index:b.idx}:{action:'discard_drawn'};
    }
    if(s.turnAction==='discard'){const b=skyBestSwapSolo(s,me,val,P);return {action:'swap',index:b.idx};}
    if(s.turnAction==='must_reveal')return {action:'reveal_after_discard',index:skyRevealSolo(s,me,P)};
    return null;
  }
  function skyjoChoose(view,diff){
    if(diff==='hard')return skyjoChooseSolo(view);
    const s=view.skyjo, me=s.currentPlayer, p=s.players[me];
    if(s.phase==='REVEAL'){
      const idxs=p.board.map((c,i)=>i).filter(i=>!p.board[i].revealed&&!p.board[i].cleared);
      return {action:(s.tiebreakerPlayers&&s.tiebreakerPlayers.length)?'tiebreaker':'reveal',index:idxs[rint(idxs.length)]};
    }
    const P = diff==='easy'?[6,2,0,4] : [3,5,2,2];
    const revealed=p.board.filter(c=>c.revealed&&!c.cleared).map(c=>c.value);
    const worst=revealed.length?Math.max(...revealed):-99;
    const worstIdx=p.board.findIndex(c=>c.revealed&&!c.cleared&&c.value===worst);
    const hidden=p.board.map((c,i)=>i).filter(i=>!p.board[i].revealed&&!p.board[i].cleared);
    const ta=s.turnAction;
    if(ta===null){
      const dt=s.discardTop;
      const take=dt!=null&&(dt<=P[0]||(worst-dt)>=P[1]);
      return take?{action:'take_discard'}:{action:'draw_deck'};
    }
    const drawn=s.myDrawnCard;
    if(ta==='deck'){
      if(drawn!=null){
        if(worstIdx>=0 && drawn<worst-P[2]) return {action:'swap',index:worstIdx};
        if(drawn<=P[3] && hidden.length) return {action:'swap',index:hidden[rint(hidden.length)]};
        return {action:'discard_drawn'};
      }
      return {action:'discard_drawn'};
    }
    if(ta==='discard'){
      if(worstIdx>=0 && drawn<worst) return {action:'swap',index:worstIdx};
      return {action:'swap',index:hidden.length?hidden[rint(hidden.length)]:0};
    }
    if(ta==='must_reveal') return {action:'reveal_after_discard',index:hidden[rint(hidden.length)]};
    return null;
  }

  return {
    choose(gameId,view,diff){
      try{
        if(gameId==='skyjo')return skyjoChoose(view,diff);
        if(gameId==='qwixx')return qwixxChoose(view,diff);
        if(gameId==='flip7')return flip7Choose(view,diff);
      }catch(e){console.warn('bot error',e);}
      return null;
    }
  };
})();

/* ====================== BOT DRIVER ======================
   On each render, if the acting seat is a bot AND we are responsible for it
   (host online, or local), schedule its move after a human-like delay.
   ================================================================= */
let _botTimer=null, _botBusy=false;
function botSeatsFromView(view){
  // online: server sends `view._bots` via the game msg (attached in handleNet)
  return window._currentBots||[];
}
function maybeRunBot(view){
  if(_botBusy)return;
  const gid=view.game;
  const gv = gid === 'qwixx' ? view.state : view[gid];
  if(!gv)return;
  // who must act?
  let actingSeat=-1, pendingFrom=-1;
  if(gid==='skyjo'){
    if(gv.turnAction==='turn_end_delay')return; // mid turn-transition; wait
    if(gv.phase==='REVEAL'){ // any bot that still needs to flip
      actingSeat=-1; // handled below for all bots
    } else if(gv.phase==='PLAY'||gv.phase==='FINAL_TURNS'){ actingSeat=gv.currentPlayer; }
  } else if(gid==='flip7'){
    if(gv.pendingAction) pendingFrom=gv.pendingAction.from;
    else if(gv.phase==='PLAY') actingSeat=gv.current;
  } else if(gid==='qwixx'){
    if(gv.phase==='COLOR_PHASE') actingSeat=gv.activeSeat;
  }
  const bots=botSeatsFromView(view); if(!bots.length)return;
  const iAmDriver = (mode==='local') || net.isHost;
  if(!iAmDriver)return;

  // Parallel bot phases: Skyjo REVEAL and Qwixx WHITE_PHASE
  if(gid==='skyjo' && gv.phase==='REVEAL'){
    for(const b of bots){const p=gv.players[b.seat]; if(p.revealCount<2){scheduleBot(view,b,b.seat);return;}}
    return;
  }
  if(gid==='qwixx' && gv.phase==='WHITE_PHASE'){
    for(const b of bots){if(gv.pendingWhiteDecisions.includes(b.seat)){scheduleBot(view,b,b.seat);return;}}
    return;
  }
  const targetSeat = pendingFrom>=0?pendingFrom:actingSeat;
  if(targetSeat<0)return;
  const b=bots.find(x=>x.seat===targetSeat);
  if(b)scheduleBot(view,b,targetSeat);
}
function scheduleBot(view,bot,seat){
  if(_botTimer)return;
  _botBusy=true;
  const think = bot.difficulty==='hard'?700:bot.difficulty==='easy'?450:600;
  _botTimer=setTimeout(()=>{
    _botTimer=null;
    const v=window._renderView||view;
    const gid=v.game;
    // recompute "current" so we act on fresh state
    const gv=v[gid];
    // Build a view object the bot expects (currentPlayer/current = seat).
    // Online views are personalized for the HOST seat, but the host drives bot
    // seats. Skyjo deck draws are public (`publicDrawn`), while discard takes can
    // be recovered from `lastAction`; without this patch online bots would see
    // `myDrawnCard=null` and discard every deck draw, including negatives.
    let vv=v;
    if(gid==='skyjo'){
      const sg={...gv,currentPlayer:seat};
      if(sg.myDrawnCard==null && sg.turnAction==='deck' && sg.publicDrawn!=null) sg.myDrawnCard=sg.publicDrawn;
      if(sg.myDrawnCard==null && sg.turnAction==='discard' && sg.lastAction&&sg.lastAction.type==='take_discard'&&sg.lastAction.player===seat) sg.myDrawnCard=sg.lastAction.value;
      vv={...v,skyjo:sg};
    }
    const msg=Bots.choose(gid,vv,bot.difficulty);
    _botBusy=false;
    if(!msg){return;}
    if(mode==='local'){ localAct(seat,msg); }
    else { net.send({type:'action',botSeat:seat,...msg}); }
  },think+Math.random()*250);
}

/* ====================== INIT ====================== */
{const v=$('verStamp');if(v)v.textContent='build '+BUILD_VERSION;}
renderTiles('quickTiles',quickPlay); // quick play: no size filter (matchmaking fills the room)
renderLocalSeats();
refreshLocalTiles();
if(typeof syncOnlinePrimaryName==='function'){syncOnlinePrimaryName();renderOnlineDevicePlayers();}
if(SFX.muted){const b=$('soundBtn');if(b){b.textContent='🔇';b.classList.add('off');}}
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('investigateOverlay').classList.add('hidden');});

/**
 * Schotten Totten bot strategies — registered with BotDriver.
 *   Easy:   place a random card on a random legal stone; claim only obvious wins.
 *   Medium: place to build/extend the strongest formation; claim when winning.
 *   Hard:   medium + prefers stones it can actually win, avoids feeding the opponent.
 *
 * The driver calls choose() repeatedly for the same acting seat until the turn
 * passes, so we return one sub-action at a time: place → (claim*) → end.
 */
const SchottenBots = (() => {
  const COLORS = ['red','orange','yellow','green','blue','purple'];

  function score(cards){
    const sum=cards.reduce((a,c)=>a+c.v,0);
    if(cards.length<3)return [1,sum];
    const vals=cards.map(c=>c.v).sort((a,b)=>a-b);
    const sameColor=cards.every(c=>c.c===cards[0].c);
    const run=vals[0]+1===vals[1]&&vals[1]+1===vals[2];
    const trips=vals[0]===vals[1]&&vals[1]===vals[2];
    let rank=1;if(run&&sameColor)rank=5;else if(trips)rank=4;else if(sameColor)rank=3;else if(run)rank=2;
    return [rank,sum];
  }
  const cmp=(a,b)=>a[0]!==b[0]?a[0]-b[0]:a[1]-b[1];

  // Stones this bot can legally claim right now (server validates again).
  function claimable(s, seat){
    const out=[];
    s.stones.forEach((st,i)=>{
      if(st.claimedBy>=0)return;
      const mine=st.sides[seat];
      if(mine.length<3)return;
      const ms=score(mine), theirs=st.sides[1-seat];
      if(theirs.length>=3){ if(cmp(ms,score(theirs))>0) out.push(i); }
      // (early-claim proof is left to the server; easy/medium claim only completed wins)
    });
    return out;
  }

  // Score the value of placing card on a given stone side (higher = better).
  function placementValue(side, card){
    const after=[...side,card];
    if(after.length>3) return -1e9;
    const sc=score(after);
    // weight rank heavily, then sum; bonus for completing a formation.
    return sc[0]*100 + sc[1] + (after.length===3?20:0);
  }

  function legalPlacements(s, seat){
    const out=[];
    const hand=s.players[seat].hand||[];
    s.stones.forEach((st,si)=>{
      if(st.claimedBy>=0||st.sides[seat].length>=3)return;
      hand.forEach((card,hi)=>out.push({hi,si,card,val:placementValue(st.sides[seat],card)}));
    });
    return out;
  }

  function chooseFor(view, seat, difficulty){
    const s=view.schotten;
    if(!s||view.over)return null;
    // 1) If we've placed this turn, claim any winning stones, then end.
    if(s.placedThisTurn){
      const wins=claimable(s,seat);
      if(wins.length) return { action:'claim', target:wins[0] };
      return { action:'end' };
    }
    // 2) Otherwise place a card.
    const opts=legalPlacements(s,seat);
    if(!opts.length) return { action:'end' }; // nothing to place (shouldn't happen)
    if(difficulty==='easy'){
      const r=opts[Math.floor(Math.random()*opts.length)];
      return { action:'place', index:r.hi, target:r.si };
    }
    // medium/hard: pick the highest-value placement. Hard subtracts a penalty for
    // placing on a stone we're already losing (don't feed a lost stone).
    const adjusted=opts.map((o)=>{
      let v=o.val;
      if(difficulty==='hard'){
        const st=s.stones[o.si], theirs=st.sides[1-seat];
        if(theirs.length>=3 && cmp(score(theirs),score([...st.sides[seat],o.card]))>0) v-=15;
      }
      return {...o,v};
    });
    adjusted.sort((a,b)=>b.v-a.v);
    const best=adjusted[0];
    return { action:'place', index:best.hi, target:best.si };
  }

  BotDriver.register('schotten', {
    choose(view, seat, difficulty){ return chooseFor(view, seat, difficulty); },
    needsBot(view){ const s=view.schotten; return !!s && !view.over; },
    getActingSeat(view){ const s=view.schotten; return (s && !view.over) ? s.current : -1; },
  });

  return { chooseFor };
})();

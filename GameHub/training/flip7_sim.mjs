// flip7_sim.mjs — headless Flip 7 simulator for RL training (mirrors src/games/flip7.ts).
// Exposes a clean engine + feature extractor + policy interface.

export function buildDeck(){
  const d=[]; d.push({k:'num',v:0});
  for(let n=1;n<=12;n++)for(let i=0;i<n;i++)d.push({k:'num',v:n});
  for(const m of['+2','+4','+6','+8','+10','x2'])d.push({k:'mod',v:m});
  for(const a of['freeze','flip3','second'])for(let i=0;i<3;i++)d.push({k:'act',v:a});
  shuffle(d); return d;
}
function shuffle(d){for(let i=d.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[d[i],d[j]]=[d[j],d[i]];}}
function np(name,banked){return{name,nums:[],mods:[],second:false,status:'active',bustCard:null,banked:banked||0,roundScore:0};}

export class Sim{
  constructor(n){this.s=this.fresh(n);}
  fresh(n){const s={players:[...Array(n)].map((_,i)=>np('P'+i,0)),deck:buildDeck(),discard:[],current:0,phase:'PLAY',round:1,pending:null,f3:0,f3t:-1};
    for(let i=0;i<n;i++){let c=this.draw(s),g=0;while(c.k==='act'&&g++<200){s.deck.unshift(c);shuffle(s.deck);c=this.draw(s);}this.place(s,i,c);}
    s.current=this.firstActive(s,0);return s;}
  nextRound(){const s=this.s;const banked=s.players.map(p=>p.banked);const ns=this.fresh(s.players.length);ns.players.forEach((p,i)=>p.banked=banked[i]);ns.round=s.round+1;this.s=ns;}
  draw(s){if(!s.deck.length){s.deck=s.discard;s.discard=[];shuffle(s.deck);}return s.deck.pop();}
  firstActive(s,from){for(let k=0;k<s.players.length;k++){const i=(from+k)%s.players.length;if(s.players[i].status==='active')return i;}return from;}
  activeCount(s){return s.players.filter(p=>p.status==='active').length;}
  activeOthers(s,ex){return s.players.map((p,i)=>i).filter(i=>i!==ex&&s.players[i].status==='active');}
  uniq(p){return new Set(p.nums).size;}
  place(s,pi,c){const p=s.players[pi];if(c.k==='num'){if(!p.nums.includes(c.v))p.nums.push(c.v);}else if(c.k==='mod')p.mods.push(c.v);else if(c.v==='second')p.second=true;}
  // true bust probability before next draw
  bustProb(pi){const p=this.s.players[pi];const tot=this.s.deck.length||1;let d=0;for(const c of this.s.deck)if(c.k==='num'&&p.nums.includes(c.v))d++;return d/tot;}
  apply(pi,c,f3){const p=this.s.players[pi],s=this.s;
    if(c.k==='num'){const n=c.v;if(p.nums.includes(n)){if(p.second){p.second=false;s.discard.push(c);return'ok';}p.status='busted';p.bustCard=n;return'bust';}p.nums.push(n);p.nums.sort((a,b)=>a-b);if(this.uniq(p)>=7){p.status='stayed';return'flip7';}return'ok';}
    if(c.k==='mod'){p.mods.push(c.v);return'ok';}
    const a=c.v;if(a==='second'){if(!p.second){p.second=true;return'ok';}const o=this.activeOthers(s,pi).filter(i=>!s.players[i].second);if(!o.length){s.discard.push(c);return'ok';}s.players[o[0]].second=true;return'ok';}
    // freeze/flip3
    const o=this.activeOthers(s,pi);if(!o.length){this.resolve(pi,a,pi);return'ok';}
    s.pending={kind:a,from:pi};return'action';}
  resolve(from,kind,target){const s=this.s;s.pending=null;const tp=s.players[target];
    if(kind==='freeze'){if(tp.status==='active')tp.status='stayed';return;}
    s.f3=3;s.f3t=target;this.runF3();}
  runF3(){const s=this.s;while(s.f3>0){const t=s.f3t,tp=s.players[t];if(!tp||tp.status!=='active')break;s.f3--;const r=this.apply(t,this.draw(s),true);if(r==='bust'||r==='flip7')break;if(r==='action'){const pa=s.pending;if(pa){if(pa.kind!=='give_second')this.resolve(pa.from,pa.kind,pa.from);else s.pending=null;}}}s.f3=0;s.f3t=-1;}
  advance(){const s=this.s;if(this.activeCount(s)===0){this.score();return;}s.current=this.firstActive(s,(s.current+1)%s.players.length);}
  score(){const s=this.s;for(const p of s.players){if(p.status==='busted'){p.roundScore=0;continue;}const u=this.uniq(p);let b=p.nums.reduce((a,x)=>a+x,0);if(p.mods.includes('x2'))b*=2;for(const m of p.mods)if(m[0]==='+')b+=parseInt(m.slice(1));if(u>=7)b+=15;p.roundScore=b;p.banked+=b;}s.pending=null;s.f3=0;s.f3t=-1;s.phase=s.players.some(p=>p.banked>=200)?'GAME_OVER':'ROUND_END';}
  // turn action helpers
  hit(pi){const s=this.s;const r=this.apply(pi,this.draw(s));if(r==='action')return'action';this.advance();return r;}
  stay(pi){const s=this.s;s.players[pi].status='stayed';this.advance();}
  // resolve a pending action (target choice) with a simple policy: freeze top opp, flip3 the riskiest opp
  autoTarget(){const s=this.s;const pa=s.pending;if(!pa)return;const o=this.activeOthers(s,pa.from);if(!o.length){this.resolve(pa.from,pa.kind,pa.from);this.advance();return;}let t;if(pa.kind==='freeze')t=o.reduce((a,b)=>s.players[b].roundScore+this.live(s.players[b])>this.live(s.players[a])?b:a,o[0]);else t=o.reduce((a,b)=>this.uniq(s.players[b])>this.uniq(s.players[a])?b:a,o[0]);this.resolve(pa.from,pa.kind,t);this.advance();}
  live(p){if(p.status==='busted')return 0;let b=p.nums.reduce((a,x)=>a+x,0);if(p.mods.includes('x2'))b*=2;for(const m of p.mods)if(m[0]==='+')b+=parseInt(m.slice(1));if(new Set(p.nums).size>=7)b+=15;return b;}
}

// Feature vector for the hit/stay decision (normalized-ish).
export function features(sim,pi){
  const p=sim.s.players[pi];
  const live=sim.live(p);
  const u=sim.uniq(p);
  const bp=sim.bustProb(pi);
  return [
    1,                 // bias
    bp,                // true bust probability (key signal)
    live/40,           // current score (normalized)
    u/7,               // progress toward flip7
    p.second?1:0,      // safety net held
    (7-u)/7,           // unique cards still needed
    bp*live/40,        // interaction: risk × value at stake
  ];
}
// Linear policy: hit if dot(weights,features) > 0
export function policyHit(weights,feat){
  let s=0;for(let i=0;i<weights.length;i++)s+=weights[i]*feat[i];return s>0;
}

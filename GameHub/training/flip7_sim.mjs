// flip7_sim.mjs — headless Flip 7 simulator for RL/research.
// Mirrors src/games/flip7.ts, but adds seeded RNG and observation-correct features.
import { makeRng, shuffleInPlace } from './rng.mjs';

export function buildDeck(rng=Math.random){
  const d=[]; d.push({k:'num',v:0});
  for(let n=1;n<=12;n++)for(let i=0;i<n;i++)d.push({k:'num',v:n});
  for(const m of['+2','+4','+6','+8','+10','x2'])d.push({k:'mod',v:m});
  for(const a of['freeze','flip3','second'])for(let i=0;i<3;i++)d.push({k:'act',v:a});
  return shuffleInPlace(d,rng);
}
function np(name,banked){return{name,nums:[],mods:[],second:false,status:'active',bustCard:null,banked:banked||0,roundScore:0};}

export class Sim{
  constructor(n,opts={}){
    this.rng = opts.rng || (opts.seed!=null ? makeRng(opts.seed) : Math.random);
    this.s=this.fresh(n);
  }
  fresh(n){const s={players:[...Array(n)].map((_,i)=>np('P'+i,0)),deck:buildDeck(this.rng),discard:[],current:0,phase:'PLAY',round:1,pending:null,f3:0,f3t:-1};
    for(let i=0;i<n;i++){let c=this.draw(s),g=0;while(c.k==='act'&&g++<200){s.deck.unshift(c);shuffleInPlace(s.deck,this.rng);c=this.draw(s);}this.place(s,i,c);}
    s.current=this.firstActive(s,0);return s;}
  nextRound(){const s=this.s;const banked=s.players.map(p=>p.banked);const ns=this.fresh(s.players.length);ns.players.forEach((p,i)=>p.banked=banked[i]);ns.round=s.round+1;this.s=ns;}
  draw(s){if(!s.deck.length){s.deck=s.discard;s.discard=[];shuffleInPlace(s.deck,this.rng);}return s.deck.pop();}
  firstActive(s,from){for(let k=0;k<s.players.length;k++){const i=(from+k)%s.players.length;if(s.players[i].status==='active')return i;}return from;}
  activeCount(s){return s.players.filter(p=>p.status==='active').length;}
  activeOthers(s,ex){return s.players.map((p,i)=>i).filter(i=>i!==ex&&s.players[i].status==='active');}
  uniq(p){return new Set(p.nums).size;}
  place(s,pi,c){const p=s.players[pi];if(c.k==='num'){if(!p.nums.includes(c.v))p.nums.push(c.v);}else if(c.k==='mod')p.mods.push(c.v);else if(c.v==='second')p.second=true;}
  // True bust probability before next draw. Useful for oracle/debug only.
  bustProb(pi){const p=this.s.players[pi];const tot=this.s.deck.length||1;let d=0;for(const c of this.s.deck)if(c.k==='num'&&p.nums.includes(c.v))d++;return d/tot;}
  // Observation-correct estimate matching the deployed browser bot: count visible
  // number cards on all tables + bust cards; divide possible duplicates by deckCount.
  obsBustProb(pi){return estimatedBustProb(this,pi);}
  apply(pi,c,f3){const p=this.s.players[pi],s=this.s;
    if(c.k==='num'){const n=c.v;if(p.nums.includes(n)){if(p.second){p.second=false;s.discard.push(c);return'ok';}p.status='busted';p.bustCard=n;return'bust';}p.nums.push(n);p.nums.sort((a,b)=>a-b);if(this.uniq(p)>=7){p.status='stayed';return'flip7';}return'ok';}
    if(c.k==='mod'){p.mods.push(c.v);return'ok';}
    const a=c.v;if(a==='second'){
      if(!p.second){p.second=true;return'ok';}
      // Mirrors src/games/flip7.ts: if you draw a duplicate Second Chance and
      // multiple eligible active opponents exist, choosing who gets it is a real
      // pending action. If only one exists, auto-pass; if none, discard.
      const o=this.activeOthers(s,pi).filter(i=>!s.players[i].second);
      if(!o.length){s.discard.push(c);return'ok';}
      if(o.length===1){s.players[o[0]].second=true;return'ok';}
      s.pending={kind:'give_second',from:pi};return'action';
    }
    // freeze/flip3
    const o=this.activeOthers(s,pi);if(!o.length){this.resolve(pi,a,pi);return'ok';}
    s.pending={kind:a,from:pi};return'action';}
  resolve(from,kind,target){const s=this.s;s.pending=null;const tp=s.players[target];
    if(kind==='give_second'){if(target!==from&&tp&&tp.status==='active'&&!tp.second)tp.second=true;return;}
    if(kind==='freeze'){if(tp.status==='active')tp.status='stayed';return;}
    s.f3=3;s.f3t=target;this.runF3();}
  runF3(){const s=this.s;while(s.f3>0){const t=s.f3t,tp=s.players[t];if(!tp||tp.status!=='active')break;s.f3--;const r=this.apply(t,this.draw(s),true);if(r==='bust'||r==='flip7')break;if(r==='action'){const pa=s.pending;if(pa){if(pa.kind==='give_second'){const o=this.activeOthers(s,pa.from).filter(i=>!s.players[i].second);s.pending=null;if(o.length)s.players[o[0]].second=true;}else this.resolve(pa.from,pa.kind,pa.from);}}}s.f3=0;s.f3t=-1;}
  advance(){const s=this.s;if(this.activeCount(s)===0){this.score();return;}s.current=this.firstActive(s,(s.current+1)%s.players.length);}
  score(){const s=this.s;for(const p of s.players){if(p.status==='busted'){p.roundScore=0;continue;}const u=this.uniq(p);let b=p.nums.reduce((a,x)=>a+x,0);if(p.mods.includes('x2'))b*=2;for(const m of p.mods)if(m[0]==='+')b+=parseInt(m.slice(1));if(u>=7)b+=15;p.roundScore=b;p.banked+=b;}s.pending=null;s.f3=0;s.f3t=-1;s.phase=s.players.some(p=>p.banked>=200)?'GAME_OVER':'ROUND_END';}
  // turn action helpers
  hit(pi){const s=this.s;const r=this.apply(pi,this.draw(s));if(r==='action')return'action';this.advance();return r;}
  stay(pi){const s=this.s;s.players[pi].status='stayed';this.advance();}
  // resolve a pending action (target choice) with a simple baseline policy.
  autoTarget(){const s=this.s;const pa=s.pending;if(!pa)return;let o=this.activeOthers(s,pa.from);if(pa.kind==='give_second')o=o.filter(i=>!s.players[i].second);if(!o.length){this.resolve(pa.from,pa.kind,pa.from);if(pa.kind!=='give_second')this.advance();return;}let t;if(pa.kind==='give_second')t=o.reduce((a,b)=>this.live(s.players[b])+s.players[b].banked<this.live(s.players[a])+s.players[a].banked?b:a,o[0]);else if(pa.kind==='freeze')t=o.reduce((a,b)=>s.players[b].roundScore+this.live(s.players[b])>this.live(s.players[a])?b:a,o[0]);else t=o.reduce((a,b)=>this.uniq(s.players[b])>this.uniq(s.players[a])?b:a,o[0]);this.resolve(pa.from,pa.kind,t);if(pa.kind!=='give_second')this.advance();}
  live(p){return liveScore(p);}
}

export function liveScore(p){
  if(p.status==='busted')return 0;
  let b=p.nums.reduce((a,x)=>a+x,0);
  if(p.mods.includes('x2'))b*=2;
  for(const m of p.mods)if(m[0]==='+')b+=parseInt(m.slice(1));
  if(new Set(p.nums).size>=7)b+=15;
  return b;
}

export function estimatedBustProb(sim,pi){
  const s=sim.s, p=s.players[pi];
  if(!p.nums.length)return 0;
  const seen={};
  for(const q of s.players){
    for(const n of q.nums)seen[n]=(seen[n]||0)+1;
    if(q.bustCard!=null)seen[q.bustCard]=(seen[q.bustCard]||0)+1;
  }
  let dupesLeft=0;
  for(const n of new Set(p.nums)){
    const copiesTotal=(n===0?1:n);
    dupesLeft += Math.max(0,copiesTotal-(seen[n]||0));
  }
  return Math.min(1,dupesLeft/Math.max(1,s.deck.length||1));
}

// Observation-correct feature vector for the hit/stay decision (matches browser info).
export function features(sim,pi){
  const p=sim.s.players[pi];
  const live=sim.live(p);
  const u=sim.uniq(p);
  const bp=estimatedBustProb(sim,pi);
  return [
    1,                 // bias
    bp,                // estimated bust probability (not privileged true deck info)
    live/40,           // current score (normalized)
    u/7,               // progress toward flip7
    p.second?1:0,      // safety net held
    (7-u)/7,           // unique cards still needed
    bp*live/40,        // interaction: risk × value at stake
  ];
}

// Privileged oracle/debug features using the true deck.
export function featuresTrue(sim,pi){
  const p=sim.s.players[pi];
  const live=sim.live(p);
  const u=sim.uniq(p);
  const bp=sim.bustProb(pi);
  return [1,bp,live/40,u/7,p.second?1:0,(7-u)/7,bp*live/40];
}

// Larger observation-correct feature vector with game context. This is intended
// for research/distillation candidates; the production browser bot can still use
// the 7-feature vector until a candidate earns promotion.
export function featuresV2(sim,pi){
  const s=sim.s, p=s.players[pi];
  const live=sim.live(p);
  const u=sim.uniq(p);
  const bp=estimatedBustProb(sim,pi);
  const others=s.players.filter((_,i)=>i!==pi);
  const bestOppBanked=Math.max(...others.map(o=>o.banked));
  const bestOppLive=Math.max(...others.map(o=>sim.live(o)));
  const active=s.players.filter(q=>q.status==='active').length;
  const stayed=s.players.filter(q=>q.status==='stayed').length;
  const leaderGap=p.banked-bestOppBanked;
  return [
    1,
    bp,
    live/40,
    u/7,
    p.second?1:0,
    (7-u)/7,
    bp*live/40,
    p.banked/200,
    (200-p.banked)/200,
    leaderGap/200,
    bestOppBanked/200,
    bestOppLive/40,
    active/s.players.length,
    stayed/s.players.length,
    bp*Math.max(0,200-p.banked)/200,
  ];
}

// Linear policy: hit if dot(weights,features) > 0
export function policyHit(weights,feat){
  let s=0;for(let i=0;i<weights.length;i++)s+=weights[i]*(feat[i]??0);return s>0;
}

// skyjo_sim.mjs — headless Skyjo simulator for RL training (mirrors src/engine.ts).
// Adds seeded RNG support for deterministic research/evaluation.
import { makeRng, shuffleInPlace } from './rng.mjs';

export function buildDeck(rng=Math.random){
  const d=[]; for(let i=0;i<5;i++)d.push(-2); for(let i=0;i<10;i++)d.push(-1); for(let i=0;i<15;i++)d.push(0);
  for(let v=1;v<=12;v++)for(let i=0;i<10;i++)d.push(v);
  return shuffleInPlace(d,rng);
}

export class Sim{
  constructor(n,opts={}){this.n=n;this.rng=opts.rng||(opts.seed!=null?makeRng(opts.seed):Math.random);this.deal();}
  deal(){this.deck=buildDeck(this.rng);this.players=[...Array(this.n)].map(()=>({board:[...Array(12)].map(()=>({v:this.deck.pop(),r:false,c:false})),round:0,total:0,rc:0}));
    this.discard=[this.deck.pop()];this.phase='REVEAL';this.cur=0;this.ender=-1;this.finalLeft=0;this.drawn=null;this.ta=null;this.pend=null;}
  nextRound(){const tot=this.players.map(p=>p.total);this.deal();this.players.forEach((p,i)=>p.total=tot[i]);}
  liveScore(p){return p.board.filter(c=>c.r&&!c.c).reduce((a,c)=>a+c.v,0);}
  // ----- reveal phase -----
  reveal(pi,ci){if(this.phase!=='REVEAL')return;const p=this.players[pi];if(p.rc>=2)return;const c=p.board[ci];if(c.r||c.c)return;c.r=true;p.rc++;
    if(this.players.every(x=>x.rc>=2))this.startPlay();}
  startPlay(){let best=-Infinity,bi=0;this.players.forEach((p,i)=>{const s=p.board.filter(c=>c.r&&!c.c).reduce((a,c)=>a+c.v,0);if(s>best){best=s;bi=i;}});this.cur=bi;this.phase='PLAY';}
  // ----- play -----
  drawDeck(pi){if(this.cur!==pi||this.ta!==null)return;if(!this.deck.length){this.deck=this.discard.slice(0,-1);this.discard=[this.discard[this.discard.length-1]];shuffleInPlace(this.deck,this.rng);}this.drawn=this.deck.pop();this.ta='deck';}
  takeDiscard(pi){if(this.cur!==pi||this.ta!==null)return;if(!this.discard.length)return;this.drawn=this.discard.pop();this.ta='discard';}
  swap(pi,bi){if(this.cur!==pi||this.ta===null||this.ta==='must')return;const p=this.players[pi],o=p.board[bi];if(o.c)return;this.discard.push(o.v);p.board[bi]={v:this.drawn,r:true,c:false};this.endTurn();}
  discardDrawn(pi){if(this.cur!==pi||this.ta!=='deck')return;this.discard.push(this.drawn);this.drawn=null;this.ta='must';}
  revealAfter(pi,bi){if(this.cur!==pi||this.ta!=='must')return;const c=this.players[pi].board[bi];if(c.r||c.c)return;c.r=true;this.endTurn();}
  triplets(pi){const p=this.players[pi];for(let col=0;col<4;col++){const ix=[col,col+4,col+8],cs=ix.map(i=>p.board[i]);if(cs.every(c=>c.r&&!c.c)&&cs[0].v===cs[1].v&&cs[1].v===cs[2].v){ix.forEach(i=>p.board[i].c=true);for(let i=0;i<3;i++)this.discard.push(cs[0].v);}}}
  endTurn(){this.triplets(this.cur);this.drawn=null;this.ta=null;
    const p=this.players[this.cur];
    if(p.board.every(c=>c.c||c.r)&&this.phase==='PLAY'){this.phase='FINAL';this.ender=this.cur;this.finalLeft=this.players.length-1;}
    if(this.phase==='FINAL'){if(this.cur!==this.ender)this.finalLeft--;if(this.finalLeft<=0){this.calc();return;}}
    this.cur=(this.cur+1)%this.players.length;}
  calc(){for(const p of this.players){for(const c of p.board)if(!c.c)c.r=true;}for(let i=0;i<this.players.length;i++)this.triplets(i);
    for(const p of this.players)p.round=p.board.filter(c=>!c.c).reduce((a,c)=>a+c.v,0);
    const e=this.players[this.ender];const mo=Math.min(...this.players.filter((_,i)=>i!==this.ender).map(o=>o.round));
    if(e.round>=mo&&e.round>0)e.round*=2;
    for(const p of this.players)p.total+=p.round;
    this.phase=this.players.some(p=>p.total>=100)?'GAME_OVER':'ROUND_END';}
}

// Feature extractor for the current Skyjo threshold policy.
export function skyjoFeatures(sim,pi){
  const p=sim.players[pi];
  const revealed=p.board.filter(c=>c.r&&!c.c).map(c=>c.v);
  const worst=revealed.length?Math.max(...revealed):-99;
  const hidden=p.board.filter(c=>!c.r&&!c.c).length;
  return {worst,hidden,drawn:sim.drawn,discardTop:sim.discard[sim.discard.length-1]};
}

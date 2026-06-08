// train_skyjo.mjs — self-play training of a parameterized Skyjo policy via CEM.
// Params: [thrTakeDiscard, thrBeat, thrSwapMargin, thrLockLow]
import { Sim, skyjoFeatures } from './skyjo_sim.mjs';
import { makeRng } from './rng.mjs';
import fs from 'fs';

// Reveal-phase policy: flip two random hidden cards (same for everyone).
function doReveal(sim,pi,rng){const p=sim.players[pi];const hid=p.board.map((c,i)=>i).filter(i=>!p.board[i].r&&!p.board[i].c);sim.reveal(pi,hid[Math.floor(rng()*hid.length)]);}

// Parameterized turn policy.
function turn(sim,pi,P,rng){
  const f=skyjoFeatures(sim,pi);
  if(sim.ta===null){
    const dt=f.discardTop;
    const take = dt!=null && (dt<=P[0] || (f.worst-dt)>=P[1]);
    if(take)sim.takeDiscard(pi); else sim.drawDeck(pi);
    return;
  }
  const drawn=sim.drawn;
  const p=sim.players[pi];
  const worstIdx=p.board.findIndex(c=>c.r&&!c.c&&c.v===f.worst);
  if(sim.ta==='deck'){
    if(worstIdx>=0 && drawn<f.worst-P[2]){sim.swap(pi,worstIdx);return;}
    if(drawn<=P[3]){const hid=p.board.map((c,i)=>i).filter(i=>!p.board[i].r&&!p.board[i].c);if(hid.length){sim.swap(pi,hid[Math.floor(rng()*hid.length)]);return;}}
    sim.discardDrawn(pi);return;
  }
  if(sim.ta==='discard'){
    if(worstIdx>=0 && drawn<f.worst){sim.swap(pi,worstIdx);return;}
    const hid=p.board.map((c,i)=>i).filter(i=>!p.board[i].r&&!p.board[i].c);
    sim.swap(pi,hid.length?hid[Math.floor(rng()*hid.length)]:0);return;
  }
  if(sim.ta==='must'){const hid=p.board.map((c,i)=>i).filter(i=>!p.board[i].r&&!p.board[i].c);sim.revealAfter(pi,hid[Math.floor(rng()*hid.length)]);}
}

const HEUR=[3,5,2,2]; // sensible baseline params

function playGame(paramsBySeat,seed){
  const n=paramsBySeat.length;const rng=makeRng(`${seed}:policy`);const sim=new Sim(n,{seed:`${seed}:deck`});let g=0;
  while(g++<8000){
    if(sim.phase==='REVEAL'){for(let i=0;i<n;i++)if(sim.players[i].rc<2){doReveal(sim,i,rng);} if(sim.phase==='REVEAL')continue;}
    if(sim.phase==='ROUND_END'){if(sim.players.some(p=>p.total>=100))break;sim.nextRound();continue;}
    if(sim.phase==='GAME_OVER')break;
    if(sim.phase==='PLAY'||sim.phase==='FINAL'){turn(sim,sim.cur,paramsBySeat[sim.cur],rng);}
  }
  // winner = lowest total
  const mn=Math.min(...sim.players.map(p=>p.total));
  return sim.players.findIndex(p=>p.total===mn);
}

function rotateArr(arr,k){const n=arr.length;return arr.map((_,i)=>arr[(i-k+n)%n]);}
function fitness(P,games,baseSeed){
  let wins=0,total=0,margin=0;
  const base=[P,HEUR,HEUR,HEUR];
  for(let g=0;g<games;g++){
    for(let r=0;r<base.length;r++){
      const seats=rotateArr(base,r);
      const candidateSeat=seats.indexOf(P);
      const winner=playGame(seats,`${baseSeed}:game${g}:r${r}`);
      // Replay is not stored, so only win-rate for now; seat rotation is the unlock.
      if(winner===candidateSeat)wins++;
      total++;
    }
  }
  return wins/total;
}

function randn(rng){let u=0,v=0;while(!u)u=rng();while(!v)v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
function clampP(P){return [Math.max(-2,Math.min(6,P[0])),Math.max(0,Math.min(10,P[1])),Math.max(-1,Math.min(6,P[2])),Math.max(-2,Math.min(6,P[3]))];}
function train({iters=24,pop=50,elite=10,games=120,seed='skyjo-cem'}={}){
  const rng=makeRng(seed);
  let mean=[3,5,2,2],std=[2,3,2,2],best=null,bf=-1;
  for(let it=0;it<iters;it++){
    const s=[];for(let i=0;i<pop;i++){const P=clampP(mean.map((m,d)=>m+std[d]*randn(rng)));s.push({P,f:fitness(P,games,`${seed}:it${it}:sample${i}`)});}
    s.sort((a,b)=>b.f-a.f);const top=s.slice(0,elite);
    if(top[0].f>bf){bf=top[0].f;best=top[0].P.slice();}
    for(let d=0;d<4;d++){const v=top.map(t=>t.P[d]);const m=v.reduce((a,b)=>a+b,0)/v.length;const sd=Math.sqrt(v.reduce((a,b)=>a+(b-m)*(b-m),0)/v.length)+0.05;mean[d]=m;std[d]=Math.max(0.2,sd*0.9);}
    console.log(`iter ${it+1}/${iters} eliteWin=${(top[0].f*100).toFixed(1)}% meanWin=${(s.reduce((a,b)=>a+b.f,0)/pop*100).toFixed(1)}% mean=[${mean.map(x=>x.toFixed(1))}]`);
  }
  return {best,bf};
}

const t0=Date.now();
const seed=process.env.SEED||'skyjo-cem';
const res=train({iters:Number(process.env.ITERS)||22,pop:Number(process.env.POP)||50,elite:Number(process.env.ELITE)||10,games:Number(process.env.GAMES)||120,seed});
console.log('done',((Date.now()-t0)/1000).toFixed(0)+'s bestFit',(res.bf*100).toFixed(1)+'%');
const rounded=res.best.map(x=>+x.toFixed(3));
console.log('PARAMS_SKYJO='+JSON.stringify(rounded));
const out=process.env.OUT || new URL('./skyjo_params.json',import.meta.url);
fs.writeFileSync(out,JSON.stringify(rounded));
console.log('wrote',String(out));

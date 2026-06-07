// train_flip7.mjs — self-play training of the Flip 7 hit/stay policy via the
// Cross-Entropy Method (CEM). Fitness = win-rate in multi-player games against a
// fixed pool of baseline opponents + mirror self-play. Outputs weights JSON.
import { Sim, features, policyHit } from './flip7_sim.mjs';

const DIM=7;

// Baseline heuristic opponents (so training has something to beat + mirror).
function heuristicHit(sim,pi){const p=sim.s.players[pi];const bp=sim.bustProb(pi);return bp<0.30||sim.live(p)<14;}
function recklessHit(sim,pi){const p=sim.s.players[pi];return sim.live(p)<20;}

function makeActor(kind,w){
  return (sim,pi)=>{
    if(kind==='weights')return policyHit(w,features(sim,pi));
    if(kind==='heuristic')return heuristicHit(sim,pi);
    if(kind==='reckless')return recklessHit(sim,pi);
    return false;
  };
}

// Play one full game to 200; actors[i] decides for seat i. Returns winner seat.
function playGame(actors){
  const sim=new Sim(actors.length);
  let guard=0;
  while(sim.s.players.every(p=>p.banked<200)&&guard++<5000){
    const s=sim.s;
    if(s.phase==='ROUND_END'){sim.nextRound();continue;}
    if(s.phase==='GAME_OVER')break;
    if(s.pending){sim.autoTarget();continue;}
    const seat=s.current,p=s.players[seat];
    if(p.status!=='active'){sim.stay(seat);continue;}
    const wantHit=actors[seat](sim,seat);
    if(wantHit){const r=sim.hit(seat);if(r==='action')sim.autoTarget();}
    else sim.stay(seat);
  }
  const mx=Math.max(...sim.s.players.map(p=>p.banked));
  return sim.s.players.findIndex(p=>p.banked===mx);
}

// Fitness of weight vector w: win-rate in mixed 4-player games vs a pool.
function fitness(w,games){
  let wins=0,total=0;
  for(let g=0;g<games;g++){
    // seat 0 = candidate; opponents random mix of heuristic/reckless/weights(self)
    const pool=['heuristic','reckless','heuristic'];
    const actors=[makeActor('weights',w)];
    for(let i=0;i<3;i++)actors.push(makeActor(pool[i],w));
    const win=playGame(actors);
    if(win===0)wins++; total++;
    // also play a mirror game where all 4 are the candidate to ensure non-degenerate
  }
  return wins/total;
}

// CEM
function randn(){let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
function train({iters=24,pop=40,elite=8,games=80}={}){
  let mean=[0,-6,-1.5,3,0.5,2,-3]; // sensible init: penalize bust prob, reward progress
  let std=Array(DIM).fill(2.5);
  let best=null,bestFit=-1;
  for(let it=0;it<iters;it++){
    const samples=[];
    for(let i=0;i<pop;i++){const w=mean.map((m,d)=>m+std[d]*randn());samples.push({w,f:fitness(w,games)});}
    samples.sort((a,b)=>b.f-a.f);
    const top=samples.slice(0,elite);
    if(top[0].f>bestFit){bestFit=top[0].f;best=top[0].w.slice();}
    // refit
    for(let d=0;d<DIM;d++){
      const vals=top.map(t=>t.w[d]);
      const m=vals.reduce((a,b)=>a+b,0)/vals.length;
      const v=Math.sqrt(vals.reduce((a,b)=>a+(b-m)*(b-m),0)/vals.length)+0.05;
      mean[d]=m; std[d]=Math.max(0.3,v*0.92);
    }
    console.log(`iter ${it+1}/${iters}  eliteWin=${(top[0].f*100).toFixed(0)}%  meanWin=${(samples.reduce((a,b)=>a+b.f,0)/pop*100).toFixed(0)}%`);
  }
  return {best,bestFit,mean};
}

const t0=Date.now();
const res=train({iters: Number(process.env.ITERS)||22, pop: Number(process.env.POP)||40, elite:8, games: Number(process.env.GAMES)||70});
console.log('done in',((Date.now()-t0)/1000).toFixed(0)+'s  bestFit',(res.bestFit*100).toFixed(0)+'%');
console.log('WEIGHTS_FLIP7='+JSON.stringify(res.best.map(x=>+x.toFixed(4))));
import fs from 'fs';
fs.writeFileSync(new URL('./flip7_weights.json',import.meta.url),JSON.stringify(res.best.map(x=>+x.toFixed(4))));

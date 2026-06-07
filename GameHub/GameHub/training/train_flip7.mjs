// train_flip7.mjs — CEM training of the Flip 7 hit/stay policy.
// Important: features are observation-correct (match deployed browser bot), not
// privileged true-deck probabilities. Use small runs first, then promote only
// after research/eval_flip7.mjs says the candidate beats current hard reliably.
import { Sim, features, policyHit, estimatedBustProb } from './flip7_sim.mjs';
import { makeRng } from './rng.mjs';
import fs from 'fs';

const DIM=7;

// Baseline heuristic opponents matching the browser bot as closely as possible.
function heuristicHit(sim,pi){const p=sim.s.players[pi];const bp=estimatedBustProb(sim,pi);return bp<0.30||sim.live(p)<14;}
function recklessHit(sim,pi,rng){const p=sim.s.players[pi];return sim.live(p)<18||rng()<0.5;}

function makeActor(kind,w,rng){
  return (sim,pi)=>{
    if(kind==='weights')return policyHit(w,features(sim,pi));
    if(kind==='heuristic')return heuristicHit(sim,pi);
    if(kind==='reckless')return recklessHit(sim,pi,rng);
    return false;
  };
}

// Play one full game to 200; actors[i] decides for seat i. Returns winner seat.
function playGame(actors,seed){
  const sim=new Sim(actors.length,{seed:`${seed}:deck`});
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

// Fitness of weight vector w: win-rate in mixed 4-player games vs a fixed pool.
function fitness(w,games,baseSeed){
  let wins=0,total=0;
  for(let g=0;g<games;g++){
    const rng=makeRng(`${baseSeed}:policy:${g}`);
    const pool=['heuristic','reckless','heuristic'];
    const actors=[makeActor('weights',w,rng)];
    for(let i=0;i<3;i++)actors.push(makeActor(pool[i],w,rng));
    const win=playGame(actors,`${baseSeed}:game:${g}`);
    if(win===0)wins++; total++;
  }
  return wins/total;
}

// CEM
function randn(rng){let u=0,v=0;while(!u)u=rng();while(!v)v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
function train({iters=24,pop=40,elite=8,games=80,seed='flip7-cem'}={}){
  const rng=makeRng(seed);
  let mean=[0,-6,-1.5,3,0.5,2,-3]; // sensible init: penalize bust prob, reward progress
  let std=Array(DIM).fill(2.5);
  let best=null,bestFit=-1;
  for(let it=0;it<iters;it++){
    const samples=[];
    for(let i=0;i<pop;i++){
      const w=mean.map((m,d)=>m+std[d]*randn(rng));
      samples.push({w,f:fitness(w,games,`${seed}:it${it}:sample${i}`)});
    }
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
    console.log(`iter ${it+1}/${iters}  eliteWin=${(top[0].f*100).toFixed(1)}%  meanWin=${(samples.reduce((a,b)=>a+b.f,0)/pop*100).toFixed(1)}%  mean=[${mean.map(x=>x.toFixed(2)).join(',')}]`);
  }
  return {best,bestFit,mean};
}

const t0=Date.now();
const seed=process.env.SEED||'flip7-cem';
const res=train({iters: Number(process.env.ITERS)||22, pop: Number(process.env.POP)||40, elite:Number(process.env.ELITE)||8, games: Number(process.env.GAMES)||70, seed});
console.log('done in',((Date.now()-t0)/1000).toFixed(0)+'s  bestFit',(res.bestFit*100).toFixed(1)+'%');
const rounded=res.best.map(x=>+x.toFixed(4));
console.log('WEIGHTS_FLIP7='+JSON.stringify(rounded));
const out=process.env.OUT || new URL('./flip7_weights.json',import.meta.url);
fs.writeFileSync(out,JSON.stringify(rounded));
console.log('wrote',String(out));

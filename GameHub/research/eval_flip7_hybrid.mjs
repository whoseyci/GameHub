#!/usr/bin/env node
// eval_flip7_hybrid.mjs — compare Flip7 EV/hybrid policies vs production.
import fs from 'fs';
import { shouldHit as evHit, chooseTarget as evUploadTarget } from '/home/user/uploads/flip7_ev.mjs';
import { Sim, features, featuresV2, policyHit, estimatedBustProb } from '../training/flip7_sim.mjs';
import { makeRng } from '../training/rng.mjs';
function args(){const out={};for(let i=2;i<process.argv.length;i++){const a=process.argv[i];if(a.startsWith('--')){const k=a.slice(2);const v=process.argv[i+1]&&!process.argv[i+1].startsWith('--')?process.argv[++i]:true;out[k]=v;}}return out;}
const A=args(), games=Number(A.games||1000), seed=String(A.seed||'f7-hybrid'), np=Number(A.n||4);
const PROD=JSON.parse(fs.readFileSync('training/flip7_weights_v2.json','utf8'));
const V1=JSON.parse(fs.readFileSync('training/flip7_weights.json','utf8'));
function rotateArr(arr,k){const n=arr.length;return arr.map((_,i)=>arr[(i-k+n)%n]);}
function live(sim,i){return sim.live(sim.s.players[i]);}
function legal(sim,from,kind){let o=sim.activeOthers(sim.s,from);if(kind==='give_second')o=o.filter(i=>!sim.s.players[i].second);return o.length?o:[from];}
function threat(sim,from,kind){const s=sim.s,o=legal(sim,from,kind);if(o.length===1)return o[0];if(kind==='give_second')return o.reduce((a,b)=>(s.players[b].banked+live(sim,b))<(s.players[a].banked+live(sim,a))?b:a,o[0]);if(kind==='freeze')return o.reduce((a,b)=>{const sa=-live(sim,a)+0.12*s.players[a].banked,sb=-live(sim,b)+0.12*s.players[b].banked;return sb>sa?b:a;},o[0]);return o.reduce((a,b)=>{const sc=i=>{const p=s.players[i],bp=sim.obsBustProb(i),b3=1-Math.pow(1-bp,3);return b3*(20+live(sim,i))+4*sim.uniq(p)+(p.second?-12:0)+0.03*p.banked;};return sc(b)>sc(a)?b:a;},o[0]);}
function hit(kind,sim,seat,rng,P){const p=sim.s.players[seat];if(kind==='prod')return policyHit(PROD,featuresV2(sim,seat));if(kind==='legacy')return policyHit(V1,features(sim,seat));if(kind==='ev' || kind==='evThreat')return evHit(sim,seat,P);if(kind==='medium')return estimatedBustProb(sim,seat)<0.30||live(sim,seat)<14;if(kind==='easy')return live(sim,seat)<18||rng()<0.5;return false;}
function target(kind,sim,from,paKind){if(kind==='ev')return evUploadTarget(sim,from,paKind);return threat(sim,from,paKind);}
function resolve(sim,kinds){const pa=sim.s.pending;if(!pa)return;const t=target(kinds[pa.from],sim,pa.from,pa.kind);sim.resolve(pa.from,pa.kind,t);if(pa.kind!=='give_second')sim.advance();}
function play(kinds,runSeed){const P=JSON.parse(fs.readFileSync(`/home/user/uploads/flip7_ev_n${np<=2?2:np<=4?4:6}.json`,'utf8')).P;const sim=new Sim(kinds.length,{seed:`${runSeed}:deck`});const rngs=kinds.map((_,i)=>makeRng(`${runSeed}:p:${i}`));let guard=0;while(sim.s.players.every(p=>p.banked<200)&&guard++<5000){const s=sim.s;if(s.phase==='ROUND_END'){sim.nextRound();continue;}if(s.phase==='GAME_OVER')break;if(s.pending){resolve(sim,kinds);continue;}const seat=s.current,p=s.players[seat];if(p.status!=='active'){sim.stay(seat);continue;}if(hit(kinds[seat],sim,seat,rngs[seat],P))sim.hit(seat);else sim.stay(seat);}const scores=sim.s.players.map(p=>p.banked),mx=Math.max(...scores),winner=scores.findIndex(x=>x===mx);return kinds[winner];}
function fillers(count){const arr=['medium','easy','medium','easy','medium','easy'];return arr.slice(0,Math.max(0,count));}function evalPool(labels){const base=[...labels,...fillers(np-labels.length)].slice(0,np);const rows=[];for(let g=0;g<games;g++){for(let r=0;r<base.length;r++){const kinds=rotateArr(base,r);rows.push(play(kinds,`${seed}:np${np}:g${g}:r${r}:${labels.join('-')}`));}}const wins={};for(const x of rows)wins[x]=(wins[x]||0)+1;return{base,games:rows.length,wins,winRates:Object.fromEntries(Object.entries(wins).map(([k,v])=>[k,v/rows.length]))};}
const results=[evalPool(['evThreat','prod']),evalPool(['ev','prod'])];
console.log(JSON.stringify({kind:'flip7-hybrid-eval',seed,np,gamesPerBase:games,results},null,2));
fs.writeFileSync(`research/runs/${new Date().toISOString().replace(/[:.]/g,'-')}_flip7_hybrid_eval.json`,JSON.stringify({seed,np,gamesPerBase:games,results},null,2));

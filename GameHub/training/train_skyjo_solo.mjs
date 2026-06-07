// train_skyjo_solo.mjs — solo board-efficiency pretraining + multiplayer fine-tuning
// for a Skyjo policy inspired by human strategy:
//   - take low cards
//   - discard high cards and reveal across columns early
//   - preserve/complete 1-2 triplet opportunities
//   - avoid closing unless safe in multiplayer
//
// Param vector P length 12:
// [lowKeep,takeScore,beatWorst,deckSwapScore,tripletW,pairW,hiddenPenalty,
//  revealSpreadW,revealHighW,revealPairPenalty,turnPenalty,highDiscard]
import fs from 'fs';
import { Sim, skyjoFeatures } from './skyjo_sim.mjs';
import { makeRng } from './rng.mjs';
import { policy as uploadPolicy } from '/home/user/uploads/skyjo_policy.mjs';

const DIM=12;
const INIT=[3,3,2,5,3,1.5,0.6,4,1.0,2,0.35,7];
const PROD_PARAMS={
  n2:JSON.parse(fs.readFileSync('/home/user/uploads/skyjo_tuned_n2.json','utf8')).P,
  n4:JSON.parse(fs.readFileSync('/home/user/uploads/skyjo_tuned_n4.json','utf8')).P,
  n6:JSON.parse(fs.readFileSync('/home/user/uploads/skyjo_tuned_n6.json','utf8')).P,
};
function prodParams(n){return n<=2?PROD_PARAMS.n2:n<=4?PROD_PARAMS.n4:PROD_PARAMS.n6;}
function hidden(p){return p.board.map((c,i)=>!c.r&&!c.c?i:-1).filter(i=>i>=0);}
function revealed(p){return p.board.map((c,i)=>c.r&&!c.c?i:-1).filter(i=>i>=0);}
function col(c){return [c,c+4,c+8];}
function vis(p){return p.board.filter(c=>c.r&&!c.c).reduce((a,c)=>a+c.v,0);}
function totalRound(p){return p.board.filter(c=>!c.c).reduce((a,c)=>a+(c.r?c.v:0),0);}
function tripletGain(p,idx,val){const os=col(idx%4).filter(i=>i!==idx).map(i=>p.board[i]);if(os.every(c=>c.r&&!c.c&&c.v===val)){const sum=val+os[0].v+os[1].v;return Math.max(-8,sum);}const matches=os.filter(c=>c.r&&!c.c&&c.v===val).length;return matches;}
function worst(p){const r=revealed(p);if(!r.length)return{idx:-1,val:-99};let idx=r[0],val=p.board[idx].v;for(const i of r)if(p.board[i].v>val){idx=i;val=p.board[i].v;}return{idx,val};}
function bestOppEstimate(sim,me){return Math.min(...sim.players.map((p,i)=>i===me?Infinity:vis(p)+hidden(p).length*2.5));}
function endRisk(sim,me,P){if(sim.players.length<=1)return 0;return vis(sim.players[me])<=bestOppEstimate(sim,me)?0:8;}
function bestSwap(sim,me,val,P){const p=sim.players[me],cs=[...revealed(p),...hidden(p)];let bi=cs[0]??0,bs=-1e9;for(const idx of cs){const c=p.board[idx];const old=c.r&&!c.c?c.v:5.2;const tg=tripletGain(p,idx,val);const complete=tg!==0&&Math.abs(tg)>1?tg:0;const pair=tg>0&&tg<=2?tg:0;const wouldEnd=hidden(p).length===1&&!c.r;const score=(old-val)+P[4]*complete+P[5]*pair-(c.r?0:P[6])-(wouldEnd?endRisk(sim,me,P):0);if(score>bs){bs=score;bi=idx;}}return{idx:bi,score:bs};}
function revealChoice(sim,me,P,rng){const p=sim.players[me],h=hidden(p);let bi=h[0]??0,bs=-1e9;for(const idx of h){const rev=col(idx%4).map(i=>p.board[i]).filter(c=>c.r&&!c.c);const spread=rev.length===0?1:0;const high=rev.reduce((a,c)=>a+Math.max(0,c.v),0);const pair=rev.length>=2&&rev[0].v===rev[1].v?1:0;const score=P[7]*spread+P[8]*high-P[9]*pair+0.01*rng();if(score>bs){bs=score;bi=idx;}}return bi;}
function chooseSoloPolicy(sim,me,P,rng){const p=sim.players[me];if(sim.phase==='REVEAL')return{kind:'reveal',idx:revealChoice(sim,me,P,rng)};const h=hidden(p),w=worst(p);if(sim.ta===null){const dt=sim.discard[sim.discard.length-1];if(dt==null)return{kind:'draw'};const b=bestSwap(sim,me,dt,P);return(dt<=P[0]||b.score>=P[1]||(w.val-dt)>=P[2])?{kind:'take'}:{kind:'draw'};}const val=sim.drawn;if(sim.ta==='deck'){// high-card discard discipline, unless it completes a valuable triplet
  const b=bestSwap(sim,me,val,P);const completes=b.score>=P[1]+2;
  if(val>=P[11]&&!completes&&h.length)return{kind:'discard'};
  return(b.score>=P[3]||val<=P[0])?{kind:'swap',idx:b.idx}:{kind:'discard'};
}if(sim.ta==='discard'){const b=bestSwap(sim,me,val,P);return{kind:'swap',idx:b.idx};}if(sim.ta==='must')return{kind:'reveal_after',idx:revealChoice(sim,me,P,rng)};return{kind:'noop'};}
function chooseThreshold(sim,me,P,rng){const p=sim.players[me];if(sim.phase==='REVEAL'){const h=hidden(p);return{kind:'reveal',idx:h[Math.floor(rng()*h.length)]};}const f=skyjoFeatures(sim,me),h=hidden(p),wi=p.board.findIndex(c=>c.r&&!c.c&&c.v===f.worst);if(sim.ta===null){const dt=f.discardTop;return(dt!=null&&(dt<=P[0]||(f.worst-dt)>=P[1]))?{kind:'take'}:{kind:'draw'};}const d=sim.drawn;if(sim.ta==='deck'){if(wi>=0&&d<f.worst-P[2])return{kind:'swap',idx:wi};if(d<=P[3]&&h.length)return{kind:'swap',idx:h[Math.floor(rng()*h.length)]};return{kind:'discard'};}if(sim.ta==='discard'){if(wi>=0&&d<f.worst)return{kind:'swap',idx:wi};return{kind:'swap',idx:h.length?h[Math.floor(rng()*h.length)]:0};}if(sim.ta==='must')return{kind:'reveal_after',idx:h[Math.floor(rng()*h.length)]};}
function apply(sim,me,a){if(a.kind==='reveal')sim.reveal(me,a.idx);else if(a.kind==='take')sim.takeDiscard(me);else if(a.kind==='draw')sim.drawDeck(me);else if(a.kind==='swap')sim.swap(me,a.idx);else if(a.kind==='discard')sim.discardDrawn(me);else if(a.kind==='reveal_after')sim.revealAfter(me,a.idx);}
function execProd(sim){const me=sim.cur,a=uploadPolicy(sim,prodParams(sim.players.length));if(a.type==='draw_deck')sim.drawDeck(me);else if(a.type==='take_discard')sim.takeDiscard(me);else if(a.type==='swap')sim.swap(me,a.bi);else if(a.type==='discard_then_flip'){sim.discardDrawn(me);const h=hidden(sim.players[me]);sim.revealAfter(me,a.flip!=null?a.flip:h[Math.floor(Math.random()*h.length)]);}else if(a.type==='reveal')sim.revealAfter(me,a.bi);}
function playSolo(P,seed){const rng=makeRng(seed),sim=new Sim(1,{seed:`${seed}:deck`});let turns=0,guard=0;while(guard++<1000){if(sim.phase==='REVEAL'){while(sim.players[0].rc<2)apply(sim,0,chooseSoloPolicy(sim,0,P,rng));continue;}if(sim.phase==='ROUND_END'||sim.phase==='GAME_OVER')break;if(sim.phase==='PLAY'||sim.phase==='FINAL'){apply(sim,0,chooseSoloPolicy(sim,0,P,rng));turns++;}}
  const p=sim.players[0];const score=p.round||p.board.filter(c=>!c.c).reduce((a,c)=>a+c.v,0);return{score,turns,cost:score+P[10]*turns};}
function rotateArr(arr,k){const n=arr.length;return arr.map((_,i)=>arr[(i-k+n)%n]);}
function playMulti(kinds,cs,P,seed){const sim=new Sim(kinds.length,{seed:`${seed}:deck`});const rngs=kinds.map((_,i)=>makeRng(`${seed}:p:${i}`));let guard=0;while(guard++<10000){if(sim.phase==='REVEAL'){for(let i=0;i<kinds.length;i++)if(sim.players[i].rc<2){const h=hidden(sim.players[i]);sim.reveal(i,h[Math.floor(rngs[i]()*h.length)]);}if(sim.phase==='REVEAL')continue;}if(sim.phase==='ROUND_END'){if(sim.players.some(p=>p.total>=100))break;sim.nextRound();continue;}if(sim.phase==='GAME_OVER')break;if(sim.phase==='PLAY'||sim.phase==='FINAL'){const me=sim.cur,k=kinds[me];if(k==='candidate')apply(sim,me,chooseSoloPolicy(sim,me,P,rngs[me]));else if(k==='prod')execProd(sim);else apply(sim,me,chooseThreshold(sim,me,k==='easy'?[6,2,0,4]:[3,5,2,2],rngs[me]));}}
  const scores=sim.players.map(p=>p.total),mn=Math.min(...scores),winner=scores.findIndex(x=>x===mn),cand=scores[cs],bestOpp=Math.min(...scores.filter((_,i)=>i!==cs));return{win:winner===cs,margin:bestOpp-cand};}
function fitness(P,games,baseSeed,mode,opponents){if(mode==='solo'){let cost=0,sq=0;for(let g=0;g<games;g++){const r=playSolo(P,`${baseSeed}:solo:${g}`);cost+=r.cost;sq+=r.cost*r.cost;}const mean=cost/games,varr=sq/games-mean*mean;return -mean-0.05*Math.sqrt(Math.max(0,varr));}
  let wins=0,margin=0,total=0;const base=['candidate',...opponents];for(let g=0;g<games;g++){for(let r=0;r<base.length;r++){const kinds=rotateArr(base,r),cs=kinds.indexOf('candidate'),res=playMulti(kinds,cs,P,`${baseSeed}:g${g}:r${r}`);if(res.win)wins++;margin+=res.margin;total++;}}return wins/total+0.0005*(margin/total);}
function randn(rng){let u=0,v=0;while(!u)u=rng();while(!v)v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
function clamp(P){return [Math.max(-2,Math.min(8,P[0])),Math.max(-3,Math.min(12,P[1])),Math.max(-1,Math.min(8,P[2])),Math.max(-3,Math.min(12,P[3])),Math.max(-4,Math.min(10,P[4])),Math.max(-4,Math.min(8,P[5])),Math.max(0,Math.min(5,P[6])),Math.max(-4,Math.min(10,P[7])),Math.max(-2,Math.min(4,P[8])),Math.max(-4,Math.min(6,P[9])),Math.max(0,Math.min(2,P[10])),Math.max(3,Math.min(12,P[11]))];}
function train(){const seed=process.env.SEED||'skyjo-solo',mode=process.env.MODE||'solo',rng=makeRng(seed);const iters=Number(process.env.ITERS||16),pop=Number(process.env.POP||48),elite=Number(process.env.ELITE||10),games=Number(process.env.GAMES||160),opponents=(process.env.OPPONENTS||'prod,medium,easy').split(',').filter(Boolean);let mean=process.env.INIT_FILE?JSON.parse(fs.readFileSync(process.env.INIT_FILE,'utf8')):INIT.slice(),std=Array(12).fill(Number(process.env.INIT_STD||1.2)),best=mean.slice(),bf=-Infinity;console.log(`mode=${mode} opponents=${opponents.join(',')}`);for(let it=0;it<iters;it++){const ss=[];for(let i=0;i<pop;i++){const P=clamp(mean.map((m,d)=>m+std[d]*randn(rng)));ss.push({P,f:fitness(P,games,`${seed}:it${it}:s${i}`,mode,opponents)});}ss.sort((a,b)=>b.f-a.f);const top=ss.slice(0,elite);if(top[0].f>bf){bf=top[0].f;best=top[0].P.slice();}for(let d=0;d<12;d++){const vals=top.map(t=>t.P[d]),m=vals.reduce((a,b)=>a+b,0)/vals.length,sd=Math.sqrt(vals.reduce((a,b)=>a+(b-m)*(b-m),0)/vals.length)+0.05;mean[d]=m;std[d]=Math.max(0.15,sd*0.86);}console.log(`iter ${it+1}/${iters} best=${top[0].f.toFixed(3)} mean=${(ss.reduce((a,b)=>a+b.f,0)/pop).toFixed(3)} P=[${mean.map(x=>x.toFixed(2)).join(',')}]`);}const out=process.env.OUT||`research/candidates/skyjo_solo_${mode}.json`;const rounded=best.map(x=>+x.toFixed(3));fs.writeFileSync(out,JSON.stringify(rounded));console.log('BEST='+JSON.stringify(rounded));console.log('wrote',out);}
train();

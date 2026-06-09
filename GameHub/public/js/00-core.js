/* ====================================================================
   GAME HUB CLIENT
   Architecture mirrors the server:
     • Hub shell  : menu, room lobby, matchmaking, networking.
     • Card Kit   : shared visuals/anim/sound (window.Kit) — all games reuse it.
     • Game module: window.GameClients[id] renders that game's view & input.
   Adding a game on the client = add one entry to GameClients with the same
   shape as Skyjo below. The hub never needs to change.
   ==================================================================== */
const PARTYKIT_HOST = location.host; // served by the same Worker
const BUILD_VERSION = "v18-skyjo-directional-6p"; // bump on each change; shown on the menu

const $=id=>document.getElementById(id);
function showScreen(id){
  // Leaving the game screen? Tear down any body-level game widgets (Flip 7 controls/dealer)
  // so Hit/Stay etc. can never linger over a menu.
  if(id!=='gameScreen'){const f7=$('f7Controls');if(f7)f7.remove();const dw=$('f7DealerWrap');if(dw)dw.remove();}
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$(id).classList.add('active');
  if(id==='joinSetup')connectLobby();
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function toast(m,ms=2600){const t=$('toast');t.textContent=m;t.classList.remove('hidden');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.add('hidden'),ms);}
function getPid(){let p=localStorage.getItem('hub_pid');if(!p){p='p_'+Math.random().toString(36).slice(2,10)+Date.now().toString(36);localStorage.setItem('hub_pid',p);}return p;}

/* ====================== CARD KIT (shared) ====================== */
const Kit=(()=>{
  function cardColor(v){if(v<0)return'#4338ca';if(v===0)return'#0ea5e9';if(v<=4)return'#22c55e';if(v<=8)return'#eab308';return'#ef4444';}
  function floatText(boardEl,text,color){if(!boardEl)return;const f=document.createElement('div');f.className='floating-text';f.style.color=color;f.textContent=text;boardEl.appendChild(f);setTimeout(()=>f.remove(),1500);}
  function turnBanner(text,mine){const b=document.createElement('div');b.className='turn-banner';b.textContent=text;b.style.color=mine?'#10b981':'#60a5fa';document.body.appendChild(b);setTimeout(()=>b.remove(),1700);}
  // fly a card between two elements (playful arc + optional spin / mid-flight reveal)
  function flyCard(startEl,endEl,{value=null,color=null,startFaceDown=false,revealMidway=false,spin=false,duration=520,land=true}={}){
    return new Promise(res=>{
      if(!startEl||!endEl){res();return;}
      const a=startEl.getBoundingClientRect(),b=endEl.getBoundingClientRect();
      const c=document.createElement('div');
      Object.assign(c.style,{position:'fixed',top:a.top+'px',left:a.left+'px',width:a.width+'px',height:a.height+'px',zIndex:1000,borderRadius:'12px',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:'900',boxSizing:'border-box',boxShadow:'0 18px 34px rgba(0,0,0,.55)',pointerEvents:'none',transition:`top ${duration}ms var(--spring-soft),left ${duration}ms var(--spring-soft),width ${duration}ms var(--spring-soft),height ${duration}ms var(--spring-soft),transform ${duration}ms var(--spring-soft)`});
      if(startFaceDown){c.style.background='var(--card-back)';c.style.border='2px solid #818cf8';c.innerHTML='<span style="color:#c7d2fe;font-size:1.5rem">✦</span>';}
      else{c.style.background='#fff';c.style.border='2px solid #fff';c.style.color=color;c.textContent=value;c.style.fontSize=a.width>50?'2.2rem':'1.3rem';}
      document.body.appendChild(c);c.offsetHeight;
      const midX=(a.left+b.left)/2,midY=Math.min(a.top,b.top)-46;
      setTimeout(()=>{c.style.top=midY+'px';c.style.left=midX+'px';c.style.transform=(spin?'rotateZ(180deg) ':'')+'scale(1.12)';},10);
      setTimeout(()=>{c.style.top=b.top+'px';c.style.left=b.left+'px';c.style.width=b.width+'px';c.style.height=b.height+'px';c.style.transform=(spin?'rotateZ(360deg) ':'')+'scale(1)';},Math.floor(duration*0.5));
      if(startFaceDown&&revealMidway)setTimeout(()=>{c.style.background='#fff';c.style.border='2px solid #fff';c.style.color=color;c.textContent=value;c.style.fontSize='2.2rem';c.style.animation='popReveal .32s var(--spring)';},Math.floor(duration*0.42));
      setTimeout(()=>{c.remove();if(land&&endEl){endEl.classList.remove('anim-land');void endEl.offsetWidth;endEl.classList.add('anim-land');}res();},duration+40);
    });
  }
  // fly from a pile INTO the held window (face-down reveals mid-flight)
  function flyToHeld(srcEl,heldEl,{value=null,color=null,startFaceDown=false,reveal=false,duration=460}={}){
    return new Promise(res=>{
      if(!srcEl||!heldEl){res();return;}
      const a=srcEl.getBoundingClientRect(),b=heldEl.getBoundingClientRect();
      if(b.width===0){res();return;}
      const pv=heldEl.style.visibility;heldEl.style.visibility='hidden';
      const c=document.createElement('div');
      Object.assign(c.style,{position:'fixed',top:a.top+'px',left:a.left+'px',width:a.width+'px',height:a.height+'px',zIndex:1000,borderRadius:'12px',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:'900',boxSizing:'border-box',boxShadow:'0 18px 34px rgba(0,0,0,.55)',pointerEvents:'none',transition:`top ${duration}ms var(--spring-soft),left ${duration}ms var(--spring-soft),width ${duration}ms var(--spring-soft),height ${duration}ms var(--spring-soft),transform ${duration}ms var(--spring-soft)`});
      if(startFaceDown){c.style.background='var(--card-back)';c.style.border='2px solid #818cf8';c.innerHTML='<span style="color:#c7d2fe;font-size:1.6rem">✦</span>';}
      else{c.style.background='#fff';c.style.border='2px solid #fff';c.style.color=color;c.textContent=value;c.style.fontSize=a.width>50?'2.2rem':'1.4rem';}
      document.body.appendChild(c);c.offsetHeight;
      const midX=(a.left+b.left)/2,midY=Math.min(a.top,b.top)-40;
      requestAnimationFrame(()=>{c.style.top=midY+'px';c.style.left=midX+'px';c.style.transform='scale(1.08) rotateZ(-6deg)';});
      if(startFaceDown&&reveal)setTimeout(()=>{c.style.background='#fff';c.style.border='2px solid #fff';c.style.color=color;c.innerHTML='';c.textContent=value;c.style.fontSize='2.2rem';c.style.animation='popReveal .28s var(--spring)';SFX.flip();},Math.floor(duration*0.42));
      setTimeout(()=>{c.style.top=b.top+'px';c.style.left=b.left+'px';c.style.width=b.width+'px';c.style.height=b.height+'px';c.style.transform='scale(1) rotateZ(0)';},Math.floor(duration*0.5));
      setTimeout(()=>{c.remove();heldEl.style.visibility=pv||'';heldEl.classList.remove('anim-pop');void heldEl.offsetWidth;heldEl.classList.add('anim-pop');res();},duration+40);
    });
  }
  function dealCascade(){
    const cards=document.querySelectorAll('#mainBoardsContainer .board-card, #miniBoardsContainer .board-card');
    cards.forEach((c,i)=>{c.classList.remove('anim-deal');void c.offsetWidth;c.style.animationDelay=(i%12)*0.035+'s';c.classList.add('anim-deal');if(i%4===0)setTimeout(()=>SFX.deal(),(i%12)*35);setTimeout(()=>{c.style.animationDelay='';c.classList.remove('anim-deal');},700+(i%12)*40);});
  }
  const EventRunner=(()=>{
    let chain=Promise.resolve();
    function run(events,handler){
      chain=chain.then(async()=>{for(const ev of events)await handler(ev);});
      return chain;
    }
    function idle(){return chain;}
    return {run,idle};
  })();
  const CardMotion=(()=>{
    let chain=Promise.resolve();
    const locations=new Map();
    function run(step){chain=chain.then(step,step);return chain;}
    async function move(id,fromEl,toEl,opts={}){
      return run(async()=>{
        locations.set(id,{state:'moving',from:fromEl?.id||null,to:toEl?.id||null});
        await flyCard(fromEl,toEl,opts);
        locations.set(id,{state:'arrived',at:toEl?.id||null});
      });
    }
    function location(id){return locations.get(id)||null;}
    function clear(prefix=''){
      for(const k of [...locations.keys()]) if(!prefix||k.startsWith(prefix)) locations.delete(k);
    }
    function idle(){return chain;}
    return {move,location,clear,idle};
  })();
  function rollDice(container,dice,{duration=900,size=42,animate=true,originEl=null}={}){
    return new Promise(res=>{
      if(!container){res();return;}
      const colorCls={white:'white',red:'red',yellow:'yellow',green:'green',blue:'blue',r:'red',y:'yellow',g:'green',b:'blue'};
      const makeDie=(d)=>`<div class="kit-die ${colorCls[d.color]||d.color||'white'}"><b class="face front"><span>${d.value}</span></b><b class="face back"></b><b class="face right"></b><b class="face left"></b><b class="face top"></b><b class="face bottom"></b></div>`;
      if(!animate||window.matchMedia('(prefers-reduced-motion: reduce)').matches){
        container.classList.remove('rolling');
        container.innerHTML=dice.map(d=>`<div class="kit-die-static" style="--die-size:${size}px">${makeDie(d)}</div>`).join('');
        res();return;
      }
      const w=Math.max(container.clientWidth||280,size*dice.length+12),h=Math.max(container.clientHeight||64,size+18);
      container.classList.add('rolling');
      container.innerHTML='';
      const cr=container.getBoundingClientRect();
      const or=originEl?originEl.getBoundingClientRect():null;
      const ox=or?Math.max(0,Math.min(w-size,or.left+or.width/2-cr.left-size/2)):null;
      const oy=or?Math.max(0,Math.min(h-size,or.top+or.height/2-cr.top-size/2)):null;
      const bodies=dice.map((d,i)=>{
        const el=document.createElement('div');
        el.className='kit-die-phys';el.style.setProperty('--die-size',size+'px');el.innerHTML=makeDie({...d,value:'•'});container.appendChild(el);
        const targetX=8+i*(size+6);
        return {d,el,x:ox??targetX,y:oy??(2+Math.random()*8),vx:(targetX-(ox??targetX))*0.06+(Math.random()*2-1)*7,vy:-(7+Math.random()*6),r:Math.random()*360,vr:(Math.random()*2-1)*32,lastFace:0};
      });
      const start=performance.now();
      function step(now){
        const t=now-start,dt=1;
        for(const b of bodies){
          b.vy+=0.42*dt;b.x+=b.vx*dt;b.y+=b.vy*dt;b.r+=b.vr*dt;
          if(b.x<0){b.x=0;b.vx=Math.abs(b.vx)*0.72;b.vr*=-0.7;}
          if(b.x>w-size){b.x=w-size;b.vx=-Math.abs(b.vx)*0.72;b.vr*=-0.7;}
          if(b.y<0){b.y=0;b.vy=Math.abs(b.vy)*0.58;}
          if(b.y>h-size){b.y=h-size;b.vy=-Math.abs(b.vy)*0.62;b.vx*=0.86;b.vr*=0.76;}
          b.vx*=0.992;b.vy*=0.992;
          if(t<duration-170 && now-b.lastFace>70){b.lastFace=now;const sp=b.el.querySelector('span');if(sp)sp.textContent=String(1+Math.floor(Math.random()*6));}
          b.el.style.transform=`translate(${b.x}px,${b.y}px) rotateX(${b.r*1.3}deg) rotateY(${b.r*.9}deg) rotateZ(${b.r}deg)`;
        }
        if(t<duration) requestAnimationFrame(step);
        else{
          bodies.forEach((b,i)=>{const sp=b.el.querySelector('span');if(sp)sp.textContent=b.d.value;b.el.style.transition='transform .22s cubic-bezier(.2,1.4,.3,1)';b.el.style.transform=`translate(${8+i*(size+6)}px,${Math.max(0,(h-size)/2)}px) rotateX(0) rotateY(0) rotateZ(0)`;});
          setTimeout(()=>{container.classList.remove('rolling');res();},240);
        }
      }
      requestAnimationFrame(step);
    });
  }
  function confetti(){
    const cv=document.createElement('canvas');cv.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:500';cv.width=innerWidth;cv.height=innerHeight;document.body.appendChild(cv);
    const x=cv.getContext('2d'),cols=['#3b82f6','#10b981','#eab308','#ef4444','#8b5cf6','#0ea5e9','#f59e0b'],ps=[];
    const burst=ox=>{for(let i=0;i<90;i++){const an=(ox<0.5?-0.35:Math.PI+0.35)+(Math.random()-0.5)*1.1,sp=8+Math.random()*9;ps.push({x:ox*cv.width,y:cv.height*0.72,vx:Math.cos(an)*sp,vy:Math.sin(an)*sp-6,r:4+Math.random()*6,c:cols[(Math.random()*cols.length)|0],a:Math.random()*Math.PI,va:(Math.random()-0.5)*0.4});}};
    burst(0.08);burst(0.92);setTimeout(()=>{burst(0.2);burst(0.8);},350);const end=Date.now()+3800;
    (function f(){x.clearRect(0,0,cv.width,cv.height);for(const p of ps){p.vy+=0.28;p.vx*=0.99;p.x+=p.vx;p.y+=p.vy;p.a+=p.va;x.save();x.translate(p.x,p.y);x.rotate(p.a);x.fillStyle=p.c;x.fillRect(-p.r/2,-p.r/2,p.r,p.r*0.6);x.restore();}if(Date.now()<end)requestAnimationFrame(f);else cv.remove();})();
  }
  return {cardColor,floatText,turnBanner,flyCard,flyToHeld,dealCascade,EventRunner,CardMotion,rollDice,confetti};
})();

/* ====================== SOUND (arcade) ====================== */
const SFX=(()=>{
  let ctx=null,master=null,muted=localStorage.getItem('hub_muted')==='1';
  function ensure(){if(ctx)return;try{ctx=new(window.AudioContext||window.webkitAudioContext)();master=ctx.createGain();master.gain.value=0.22;master.connect(ctx.destination);}catch(e){ctx=null;}}
  function resume(){if(ctx&&ctx.state==='suspended')ctx.resume();}
  function tone({freq=440,dur=0.12,type='square',vol=1,glideTo=null,delay=0,attack=0.005,decay=0.08}={}){if(!ctx||muted)return;const t0=ctx.currentTime+delay,o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.setValueAtTime(freq,t0);if(glideTo)o.frequency.exponentialRampToValueAtTime(glideTo,t0+dur);g.gain.setValueAtTime(0.0001,t0);g.gain.exponentialRampToValueAtTime(vol,t0+attack);g.gain.exponentialRampToValueAtTime(0.0001,t0+attack+decay+dur);o.connect(g);g.connect(master);o.start(t0);o.stop(t0+attack+decay+dur+0.02);}
  function chord(fs,o={}){fs.forEach((f,i)=>tone({...o,freq:f,delay:(o.delay||0)+i*(o.spread??0.04)}));}
  const api={get muted(){return muted;},unlock(){ensure();resume();},setMuted(m){muted=m;localStorage.setItem('hub_muted',m?'1':'0');if(!m){ensure();resume();}},toggle(){api.setMuted(!muted);return muted;},
    tap(){tone({freq:520,dur:0.04,type:'triangle',vol:0.5});},draw(){tone({freq:300,glideTo:560,dur:0.14,type:'sawtooth',vol:0.6});},flip(){tone({freq:660,glideTo:880,dur:0.1,type:'square',vol:0.55});},
    reveal(){tone({freq:740,dur:0.07,type:'square',vol:0.5});tone({freq:988,dur:0.1,type:'square',vol:0.4,delay:0.05});},discard(){tone({freq:420,glideTo:200,dur:0.13,type:'sawtooth',vol:0.55});},
    swap(){tone({freq:500,glideTo:760,dur:0.1,type:'square',vol:0.5});tone({freq:760,dur:0.08,type:'triangle',vol:0.4,delay:0.07});},good(){chord([660,880,1175],{dur:0.12,type:'square',vol:0.4,spread:0.05});},
    bad(){tone({freq:300,glideTo:160,dur:0.2,type:'sawtooth',vol:0.5});},triplet(){chord([523,659,784,1047],{dur:0.16,type:'square',vol:0.45,spread:0.06});},
    yourTurn(){chord([587,880],{dur:0.14,type:'triangle',vol:0.5,spread:0.08});},lastRound(){tone({freq:880,glideTo:440,dur:0.3,type:'sawtooth',vol:0.5});},
    win(){chord([523,659,784,1047,1319],{dur:0.22,type:'square',vol:0.5,spread:0.09});},deal(){tone({freq:240+Math.random()*80,dur:0.05,type:'triangle',vol:0.35});},join(){chord([440,660],{dur:0.1,type:'triangle',vol:0.4,spread:0.06});}};
  ['pointerdown','keydown','touchstart'].forEach(ev=>window.addEventListener(ev,()=>api.unlock(),{passive:true}));
  return api;
})();
function toggleSound(){const m=SFX.toggle();const b=$('soundBtn');if(b){b.textContent=m?'🔇':'🔊';b.classList.toggle('off',m);}if(!m)SFX.tap();}

/* ====================== HUB STATE ====================== */
let mode='online';            // 'online' | 'local'
let myName='';
let catalogue=[];             // [{id,name,minPlayers,maxPlayers,description,emoji}]
let curView=null;             // last game view rendered
let prevView=null;
let animating=false,pendingView=null;
let summaryShown=false,lastRoundShown=false;

const net={ws:null,room:null,isHost:false,spectating:false,lobbyWs:null,
  send(o){if(this.ws&&this.ws.readyState===1)this.ws.send(JSON.stringify(o));}};
let _vis='public',_maxPlayers=8;
function setVis(v){_vis=v;document.querySelectorAll('#visSeg button').forEach(b=>b.classList.toggle('on',b.dataset.vis===v));}
function bumpMax(d){_maxPlayers=Math.max(2,Math.min(8,_maxPlayers+d));$('maxVal').textContent=_maxPlayers;}
function randomCode(){const w=['CREW','SKY','BLUE','STAR','MOON','FOX','PEAR','WAVE','GOLD','NEON'];$('hostRoom').value=w[Math.floor(Math.random()*w.length)]+Math.floor(Math.random()*90+10);}
function ensureName(){myName=$('onlineName').value.trim();if(!myName){myName='Player_'+Math.floor(Math.random()*1000);$('onlineName').value=myName;}return myName;}
function goOnline(){if(typeof syncOnlinePrimaryName==='function'){syncOnlinePrimaryName();renderOnlineDevicePlayers();}showScreen('onlineSetup');}

/* ====================== CATALOGUE (defaults; server confirms) ====================== */
catalogue=[
  {id:'skyjo',name:'Skyjo',minPlayers:2,maxPlayers:8,description:'Lowest score wins.',emoji:'🃏'},
  {id:'flip7',name:'Flip 7',minPlayers:2,maxPlayers:8,description:'Push your luck to 200.',emoji:'🎴'},
  {id:'qwixx',name:'Qwixx',minPlayers:2,maxPlayers:8,description:'Dice rolling strategy game.',emoji:'🎲'},
];

/* ---- Rulebooks (accessible from menu, pickers, and inside a game) ---- */
const RULES={
  skyjo:{title:'🃏 Skyjo',quick:'Get the LOWEST score.',
    steps:[
      'Each player has a 4×3 grid of face-down cards. Flip 2 to start.',
      'On your turn: take the <b>Deck</b> card or the <b>Discard</b> top, then either swap it onto your grid (discarding the old card) — or, if from the deck, discard it and flip one face-down card.',
      'Three of the same number in a column clear (count as 0).',
      'When someone reveals their whole grid, everyone else gets one last turn.',
      'Lowest total wins the round. First to 100 ends the game — lowest total wins.',
    ],
    tip:'Dump high cards, keep low/negative ones. Watch for column triplets!'},
  flip7:{title:'🎴 Flip 7',quick:'Push your luck — race to 200.',
    steps:[
      'On your turn choose <b>Hit</b> (draw a card) or <b>Stay</b> (bank your points, you’re out for the round).',
      'Number cards: there’s one 0, two 2s, three 3s … twelve 12s. Draw a <b>duplicate number → BUST</b> (score 0 this round).',
      'Get <b>7 unique numbers → Flip 7!</b> +15 bonus and the round ends instantly.',
      'Modifiers (+2…+10, ×2) boost your score; ×2 doubles numbers first, then + adds on.',
      'Action cards: <b>Freeze</b> (target banks &amp; is out), <b>Flip Three</b> (target draws 3), <b>Second Chance</b> (saves you from one bust).',
      'Round ends when all players bust/stay or someone Flip 7s. First to 200 wins.',
    ],
    tip:'High numbers are riskier (more copies in the deck). The 0 is always safe.'},
  qwixx:{title:'🎲 Qwixx',quick:'Cross off numbers left-to-right for the highest score.',
    steps:[
      'Each turn rolls two white dice and four colored dice.',
      'In the <b>White Phase</b>, everyone may cross one number equal to white + white on any row.',
      'In the <b>Color Phase</b>, only the active player may cross one number equal to one white die + the matching colored die.',
      'Numbers must always be crossed from left to right; you can skip numbers but never go back.',
      'The far-right number locks a row only after enough marks. Two locked rows or four penalties ends the game.',
      'More marks in a row score quadratically; penalties subtract points.',
    ],
    tip:'Skipping is allowed. Avoid penalties, but do not wait too long to score rows.'},
};
function openRules(gameId){
  const r=RULES[gameId];if(!r){showRulesMenu();return;}
  $('rulesBox').innerHTML=`<h2 style="margin:0 0 4px">${r.title}</h2><div class="muted" style="margin-bottom:10px">${r.quick}</div>
    <ol style="text-align:left;line-height:1.55;font-weight:600;padding-left:20px;margin:0 0 12px">${r.steps.map(s=>`<li style="margin-bottom:7px">${s}</li>`).join('')}</ol>
    <div style="background:var(--bg);border:2px solid var(--border);border-radius:12px;padding:10px;font-weight:700;text-align:left">💡 ${r.tip}</div>
    <button class="btn" style="margin-top:16px" onclick="$('rulesOverlay').classList.add('hidden')">Got it</button>`;
  $('rulesOverlay').classList.remove('hidden');
}
function showRulesMenu(){
  $('rulesBox').innerHTML=`<h2 style="margin:0 0 12px">📖 How to Play</h2>
    <div class="game-tiles">${catalogue.map(g=>`<div class="game-tile" onclick="openRules('${g.id}')"><div class="emoji">${g.emoji}</div><div class="gname">${g.name}</div></div>`).join('')}</div>
    <button class="btn secondary" style="margin-top:14px" onclick="$('rulesOverlay').classList.add('hidden')">Close</button>`;
  $('rulesOverlay').classList.remove('hidden');
}

// Tiles, with a group-size filter: games that don't fit `n` players are greyed out.
// `n` null = no filter (menus/quick play). Each tile has a ? for its rulebook.
function renderTiles(containerId,onPick,n=null){
  const el=$(containerId);
  el.innerHTML=catalogue.map(g=>{
    const fits = n==null || (n>=g.minPlayers && n<=g.maxPlayers);
    const why = n!=null && !fits ? (n<g.minPlayers?`Needs ${g.minPlayers}+`:`Max ${g.maxPlayers}`) : `${g.minPlayers}–${g.maxPlayers} players`;
    return `<div class="game-tile${fits?'':' disabled'}" data-g="${g.id}" data-fits="${fits}">
      <button class="tile-help" data-help="${g.id}" title="Rules">?</button>
      <div class="emoji">${g.emoji}</div><div class="gname">${g.name}</div>
      <div class="gdesc">${g.description}</div><div class="gsize">${why}</div></div>`;
  }).join('');
  el.querySelectorAll('.tile-help').forEach(b=>b.onclick=e=>{e.stopPropagation();openRules(b.dataset.help);});
  el.querySelectorAll('.game-tile').forEach(t=>t.onclick=()=>{ if(t.dataset.fits==='true') onPick(t.dataset.g); else toast('Not playable with this group size.'); });
}

/* -------------------- FLIP 7 client (event-timeline) -------------------- */
(function(){
  function modText(m){return m==='x2'?'×2':m;}
  const NUMCOL=['#94a3b8','#38bdf8','#22d3ee','#34d399','#4ade80','#a3e635','#facc15','#fb923c','#f97316','#ef4444','#ec4899','#d946ef','#a855f7'];
  function numFace(n){return NUMCOL[Math.max(0,Math.min(12,n))];}
  // Pacing (dramatic).
  const SPEED={cardReveal:560,flip3Gap:780,wiggleMin:350,wiggleMax:1700,actionFly:620,beat:420};
  function cardEl(kind,val,{busted=false,cause=false}={}){
    const c=document.createElement('div');c.className='f7-card';
    if(kind==='num'){c.classList.add('num');c.textContent=val;c.style.background=numFace(val);}
    else if(kind==='mod'){c.classList.add(val==='x2'?'modx2':'mod');c.textContent=modText(val);}
    else if(val==='second'){c.classList.add('second');c.innerHTML='&#9829;';c.title='Second Chance';}
    else if(val==='freeze'){c.classList.add('freeze');c.innerHTML='&#10052;';c.title='Freeze';}
    else if(val==='flip3'){c.classList.add('flip3');c.textContent='F3';c.title='Flip Three';}
    if(busted)c.classList.add('busted-card');
    if(cause){c.classList.remove('busted-card');c.classList.add('bust-cause');}
    return c;
  }

  function addF7Card(row,el,key){ el.dataset.cardKey=key; row.appendChild(el); return el; }
  function captureF7Layout(){ const m=new Map(); document.querySelectorAll('.f7-focus-board .f7-card[data-card-key]').forEach(el=>m.set(el.dataset.cardKey,el.getBoundingClientRect())); return m; }
  function animateF7Layout(before){ document.querySelectorAll('.f7-focus-board .f7-card[data-card-key]').forEach(el=>{ const a=before.get(el.dataset.cardKey); if(!a)return; const b=el.getBoundingClientRect(); const dx=a.left-b.left; if(Math.abs(dx)<3)return; el.style.transition='none'; el.style.transform=`translateX(${dx}px)`; el.offsetHeight; el.style.transition='transform .16s ease-out'; el.style.transform=''; setTimeout(()=>{el.style.transition='';},190); }); }

  function actionVfx(kind){
    const o=document.createElement('div');o.style.cssText='position:fixed;inset:0;z-index:400;pointer-events:none;display:flex;align-items:center;justify-content:center';
    const icon=document.createElement('div');
    if(kind==='freeze'){o.style.background='radial-gradient(circle,rgba(186,230,253,.5),transparent 60%)';icon.textContent='\u2744';icon.style.color='#38bdf8';}
    else{o.style.background='radial-gradient(circle,rgba(234,255,0,.45),transparent 60%)';icon.textContent='F3';icon.style.color='#fff';icon.style.fontStyle='italic';icon.style.textShadow='0 2px 8px #d4e600';}
    icon.style.cssText+=';font-size:7rem;font-weight:900;animation:popReveal .5s var(--spring)';
    o.appendChild(icon);document.body.appendChild(o);
    setTimeout(()=>{o.style.transition='opacity .3s';o.style.opacity='0';setTimeout(()=>o.remove(),300);},650);
  }
  // boards are rebuilt each render; find a player's row container
  let eventFocus=null;
  let renderCtx=null;
  function boardOf(i){return document.querySelector(`[data-f7-seat="${i}"]`);}
  function rowOf(i){const b=boardOf(i);return b?b.querySelector('.f7-row'):null;}
  function rectOf(el){return el?el.getBoundingClientRect():null;}
  function cloneCard(card){return card?{kind:card.kind,v:card.v}:card;}

  // ---- static board render from state ----
  function draw(view,ctx=renderCtx||{}){
    renderCtx=ctx;
    removeQwixxUi();
    const s=view.flip7,viewer=s.viewerSeat;
    const pending=s.pendingAction&&s.pendingAction.from===viewer;
    const focus = ctx.focus ? ctx.focus({actingSeat:s.current,eventSeat:eventFocus,preferred:viewer}) : (viewer>=0 ? viewer : s.current);
    const miniFrag=document.createDocumentFragment();
    const mainFrag=document.createDocumentFragment();
    s.players.forEach((p,i)=>{
      if(i!==focus){miniFrag.appendChild(miniDOM(s,p,i,viewer,pending));return;}
      const wrap=document.createElement('div');const busted=p.status==='busted';
      wrap.className='player-board f7-focus-board'+(s.current===i&&s.phase==='PLAY'?' active-turn':'')+(i===viewer?' me':'');
      wrap.dataset.f7Seat=i;
      if(busted)wrap.style.opacity='.85';
      const head=document.createElement('div');head.className='board-header';
      head.innerHTML='<span>'+esc(p.name)+(i===viewer?' (You)':'')+' <span class="f7-status '+esc(p.status)+'">'+esc(p.status)+'</span></span><span class="score-badge">'+(busted?'BUST':'Now: '+esc(p.live))+' \u00b7 Total: '+esc(p.banked)+'</span>';
      wrap.appendChild(head);
      const row=document.createElement('div');row.className='f7-row';
      if(!p.nums.length&&!p.mods.length&&!p.second)row.innerHTML='<span class="f7-empty">no cards yet</span>';
      p.nums.forEach(n=>addF7Card(row,cardEl('num',n,{busted}),'num-'+n));
      if(busted&&p.bustCard!=null)addF7Card(row,cardEl('num',p.bustCard,{cause:true}),'bust-'+p.bustCard);
      p.mods.forEach((m,mi)=>addF7Card(row,cardEl('mod',m,{busted}),'mod-'+mi+'-'+m));
      if(p.second)addF7Card(row,cardEl('act','second'),'second');
      (p.actionCards||[]).forEach((a,ai)=>addF7Card(row,cardEl('act',a),'act-'+ai+'-'+a));
      wrap.appendChild(row);
      const meta=document.createElement('div');meta.className='muted';meta.style.cssText='margin-top:6px;font-size:.8rem';meta.textContent=p.unique+'/7 unique';wrap.appendChild(meta);
      const canTarget=pending&&p.status==='active'&&!(s.pendingAction.kind==='give_second'&&i===viewer);
      if(canTarget){wrap.style.cursor='pointer';wrap.style.outline='2px dashed #f59e0b';wrap.onclick=()=>net.spectating?null:act(viewer,{action:'target',target:i});}
      mainFrag.appendChild(wrap);
    });
    const center=s.phase==='PLAY'?`<div id="f7DealerWrap" class="f7-dealer"><div class="pile-label">Dealer</div><div id="f7Deck" class="f7-deck"><span class="cnt">deck ${esc(s.deckCount)} · out ${esc(s.discardCount)}</span></div></div>`:'';
    GameShell.renderTable({game:'flip7',opponents:miniFrag,center,focus:mainFrag,status:'',topMode:s.phase==='PLAY'?'custom':'hidden',opponentClass:'f7-mini-strip'});
    drawControls(view);
  }

  function miniDOM(s,p,i,viewer,pending){
    const b=document.createElement('button');
    b.className='player-board f7-opponent-board'+(s.current===i?' active-turn':'')+(p.status==='busted'?' busted':'');
    b.dataset.f7Seat=i;
    b.onclick=()=>inspect(i);
    const busted=p.status==='busted';
    const head=document.createElement('div');head.className='board-header';
    head.innerHTML='<span>'+esc(p.name)+' <span class="f7-status '+esc(p.status)+'">'+esc(p.status)+'</span></span><span class="score-badge">'+(busted?'BUST':'Now: '+esc(p.live))+' · '+esc(p.banked)+'</span>';
    b.appendChild(head);
    const row=document.createElement('div');row.className='f7-row';
    if(!p.nums.length&&!p.mods.length&&!p.second)row.innerHTML='<span class="f7-empty">no cards</span>';
    p.nums.forEach(n=>addF7Card(row,cardEl('num',n,{busted}),'num-'+n));
    if(busted&&p.bustCard!=null)addF7Card(row,cardEl('num',p.bustCard,{cause:true}),'bust-'+p.bustCard);
    p.mods.forEach((m,mi)=>addF7Card(row,cardEl('mod',m,{busted}),'mod-'+mi+'-'+m));
    if(p.second)addF7Card(row,cardEl('act','second'),'second');
    (p.actionCards||[]).forEach((a,ai)=>addF7Card(row,cardEl('act',a),'act-'+ai+'-'+a));
    b.appendChild(row);
    const meta=document.createElement('div');meta.className='muted';meta.textContent=p.unique+'/7 unique';b.appendChild(meta);
    const canTarget=pending&&p.status==='active'&&!(s.pendingAction.kind==='give_second'&&i===viewer);
    if(canTarget){b.classList.add('targetable');b.onclick=()=>net.spectating?null:act(viewer,{action:'target',target:i});}
    return b;
  }


  function inspect(seat){
    const view=window._renderView;if(!view||view.game!=='flip7')return;
    const s=view.flip7,p=s.players[seat];if(!p)return;
    const seats=s.players.map((_,i)=>i).filter(i=>i!==view.flip7.viewerSeat);
    const idx=seats.indexOf(seat),prev=seats[(idx-1+seats.length)%seats.length],next=seats[(idx+1)%seats.length];
    const row=[...p.nums.map(n=>cardEl('num',n,{busted:p.status==='busted'})),...p.mods.map(m=>cardEl('mod',m,{busted:p.status==='busted'})),...(p.second?[cardEl('act','second')]:[]),...(p.actionCards||[]).map(a=>cardEl('act',a))];
    const cards=document.createElement('div');cards.className='f7-row';row.forEach(c=>cards.appendChild(c));
    const box=$('investigateBox');box.innerHTML=`<div class="inspect-head"><button class="icon-btn" onclick="window.GameClients['flip7'].inspect(${prev})">‹</button><b>${esc(p.name)} · ${esc(p.status)}</b><button class="icon-btn" onclick="window.GameClients['flip7'].inspect(${next})">›</button><button class="icon-btn" onclick="$('investigateOverlay').classList.add('hidden')">✕</button></div><div class="player-board f7-focus-board"><div class="board-header"><span>${esc(p.name)}</span><span class="score-badge">Now ${esc(p.live)} · Total ${esc(p.banked)} · ${esc(p.unique)}/7</span></div></div>`;
    box.querySelector('.player-board').appendChild(cards);
    $('investigateOverlay').classList.remove('hidden');
  }

  function drawControls(view){
    const s=view.flip7,viewer=s.viewerSeat;
    const myTurn=s.phase==='PLAY'&&s.current===viewer&&s.players[viewer]&&s.players[viewer].status==='active'&&!s.pendingAction;
    const pending=s.pendingAction&&s.pendingAction.from===viewer;
    let ctrl=$('f7Controls');if(!ctrl){ctrl=document.createElement('div');ctrl.id='f7Controls';ctrl.className='f7-controls';document.body.appendChild(ctrl);}
    ctrl.innerHTML='';
    const sb=$('statusBar');sb.style.color='var(--text)';
    if(net.spectating){sb.innerHTML='<span style="color:#f59e0b">\ud83d\udc41 Spectating \u2014 you\'ll join next round</span>';}
    else if(s.phase==='ROUND_END'||s.phase==='GAME_OVER'){
      if(mode==='local'||net.isHost)sb.innerHTML='<button class="btn" style="margin:0;padding:10px 20px" onclick="'+(mode==='local'?'localNext()':"net.send({type:'next_round'})")+'">'+(s.phase==='GAME_OVER'?(mode==='local'?'Play Again':'New Game'):'Next Round')+'</button>';
      else sb.innerHTML='<span class="muted">Waiting for host\u2026</span>';
    }
    else if(pending){
      const k=s.pendingAction.kind;
      sb.innerHTML='<span style="color:#f59e0b">'+(k==='freeze'?'\u2744 Choose who to Freeze':k==='flip3'?'\ud83d\udd03 Choose who flips 3':'\u2665 Give Second Chance to an opponent')+' (tap a player)</span>';
    }
    else if(myTurn){sb.innerHTML='<span style="color:#10b981">Your turn \u2014 Hit or Stay</span>';
      const hit=document.createElement('button');hit.className='btn green';hit.textContent='Hit';hit.onclick=()=>act(viewer,{action:'hit'});
      const stay=document.createElement('button');stay.className='btn secondary';stay.textContent='Stay';stay.onclick=()=>act(viewer,{action:'stay'});
      ctrl.appendChild(hit);ctrl.appendChild(stay);
    }
    else if(mode==='local'){const cur=s.players[s.current];
      if(s.pendingAction){const k=s.pendingAction.kind;sb.innerHTML='<span style="color:#f59e0b">'+esc(cur.name)+': '+(k==='freeze'?'Freeze \u2744':k==='flip3'?'Flip 3':'Give \u2665')+' \u2014 tap a player</span>';}
      else{sb.innerHTML='<span style="color:#10b981">'+(cur?esc(cur.name):'')+'\'s turn</span>';
        if(s.phase==='PLAY'&&cur&&cur.status==='active'){const hit=document.createElement('button');hit.className='btn green';hit.textContent='Hit';hit.onclick=()=>act(s.current,{action:'hit'});const stay=document.createElement('button');stay.className='btn secondary';stay.textContent='Stay';stay.onclick=()=>act(s.current,{action:'stay'});ctrl.appendChild(hit);ctrl.appendChild(stay);}}
    }
    else sb.textContent='Waiting for '+(s.players[s.current]?.name||'\u2026');
  }

  // ---- fly a card-like element between two points ----
  function fly(fromEl,toEl,build,dur){
    return new Promise(res=>{
      const a=rectOf(fromEl),b=rectOf(toEl);if(!a||!b){res();return;}
      const c=build();
      Object.assign(c.style,{position:'fixed',top:a.top+'px',left:a.left+'px',width:(a.width||46)+'px',height:(a.height||66)+'px',margin:0,zIndex:1000,transition:'all '+dur+'ms var(--spring-soft)',pointerEvents:'none'});
      document.body.appendChild(c);c.offsetHeight;
      const midY=Math.min(a.top,b.top)-50;
      requestAnimationFrame(()=>{c.style.top=midY+'px';c.style.left=((a.left+b.left)/2)+'px';c.style.transform='scale(1.15) rotate(-8deg)';});
      setTimeout(()=>{c.style.top=b.top+'px';c.style.left=b.left+'px';c.style.transform='scale(1) rotate(0)';},dur*0.5);
      setTimeout(()=>{c.remove();res();},dur+30);
    });
  }
  // wiggle the dealer card; duration & intensity scale with bust probability
  function wiggleReveal(prob){
    return new Promise(res=>{
      const deck=$('f7Deck');if(!deck){res();return;}
      const r=rectOf(deck);
      const c=document.createElement('div');c.className='f7-deck';
      Object.assign(c.style,{position:'fixed',top:r.top+'px',left:r.left+'px',width:r.width+'px',height:r.height+'px',zIndex:1001,transition:'transform .08s ease',pointerEvents:'none'});
      document.body.appendChild(c);
      const dur=Math.round(SPEED.wiggleMin+(SPEED.wiggleMax-SPEED.wiggleMin)*Math.min(1,prob*1.6));
      const amp=4+prob*16; const start=Date.now();
      (function tick(){const t=Date.now()-start;if(t>=dur){c.remove();res();return;}
        const f=1+(t/dur)*3; // speeds up toward the end
        c.style.transform='translateX('+(Math.sin(t/(40/f))*amp)+'px) rotate('+(Math.sin(t/(55/f))*amp*0.4)+'deg)';
        requestAnimationFrame(tick);})();
    });
  }

  function flyF7Card(fromEl,toEl,card,{duration=620,startFaceDown=false,revealMidway=false,spin=true}={}){
    return new Promise(res=>{
      const a=rectOf(fromEl),b=rectOf(toEl); if(!a||!b){res();return;}
      const c=cardEl(card?.kind||'num',card?.v??'?');
      c.classList.add('f7-flying-card');
      Object.assign(c.style,{position:'fixed',top:a.top+'px',left:a.left+'px',width:(a.width||46)+'px',height:(a.height||66)+'px',margin:0,zIndex:1000,pointerEvents:'none',transition:`top ${duration}ms var(--spring-soft),left ${duration}ms var(--spring-soft),width ${duration}ms var(--spring-soft),height ${duration}ms var(--spring-soft),transform ${duration}ms var(--spring-soft)`});
      const final={className:c.className,html:c.innerHTML,text:c.textContent,bg:c.style.background,color:c.style.color};
      if(startFaceDown){c.className='f7-card f7-fly-back';c.innerHTML='<span>✦</span>';c.textContent='✦';c.style.background='var(--card-back)';c.style.color='#c7d2fe';}
      document.body.appendChild(c);c.offsetHeight;
      const midX=(a.left+b.left)/2,midY=Math.min(a.top,b.top)-50;
      requestAnimationFrame(()=>{c.style.top=midY+'px';c.style.left=midX+'px';c.style.transform=(spin?'rotateZ(180deg) ':'')+'scale(1.14)';});
      if(startFaceDown&&revealMidway)setTimeout(()=>{c.className=final.className;c.innerHTML=final.html;c.textContent=final.text||c.textContent;c.style.background=final.bg;c.style.color=final.color;c.style.animation='popReveal .26s var(--spring)';SFX.flip();},Math.floor(duration*.42));
      setTimeout(()=>{c.style.top=b.top+'px';c.style.left=b.left+'px';c.style.width=b.width+'px';c.style.height=b.height+'px';c.style.transform=(spin?'rotateZ(360deg) ':'')+'scale(1)';},Math.floor(duration*.5));
      setTimeout(()=>{c.remove();res();},duration+45);
    });
  }

  // deal a face-down card from the deck onto a player's row, then it stays hidden
  // until the caller reveals (we just animate the travel; the rebuilt board shows the real card)
  function dealTravel(toRowEl,card,seq='x',before=null){
    return new Promise(async res=>{
      const deck=$('f7Deck');if(!deck||!toRowEl){res();return;}
      deck.classList.remove('deal');void deck.offsetWidth;deck.classList.add('deal');
      const ghost=cardEl(card?.kind||'num',card?.v??'?');
      ghost.style.visibility='hidden';
      if(card?.kind==='num'){
        const nums=[...toRowEl.querySelectorAll('.f7-card.num')];
        const firstSpecial=[...toRowEl.querySelectorAll('.f7-card:not(.num)')][0]||null;
        const after=nums.find(el=>Number(el.textContent)>Number(card.v))||firstSpecial;
        toRowEl.insertBefore(ghost,after||null);
      } else toRowEl.appendChild(ghost);
      if(before) animateF7Layout(before);
      SFX.flip();
      await flyF7Card(deck,ghost,card,{startFaceDown:true,revealMidway:true,spin:true,duration:620});
      ghost.remove();
      res();
    });
  }


  function normalizeFlip7Event(e){
    if(!e||!e.type)return e;
    if(e.type.includes('.'))return e;
    switch(e.type){
      case 'draw_start':return{type:'deck.wiggle',actor:e.player,prob:e.prob,seq:e.seq,legacy:e.type};
      case 'card':return{type:'card.deal',actor:e.player,card:e.card,flip3:!!e.flip3,seq:e.seq,legacy:e.type};
      case 'action_card':return{type:'card.deal',actor:e.player,card:{kind:'act',v:e.kind},actionKind:e.kind,actionCard:true,seq:e.seq,legacy:e.type};
      case 'play_action':return{type:'card.transfer',actor:e.from,target:e.target,card:{kind:'act',v:e.kind},actionKind:e.kind,auto:!!e.auto,seq:e.seq,legacy:e.type};
      case 'second_pass':return{type:'card.transfer',actor:e.from,target:e.to,card:{kind:'act',v:'second'},actionKind:'second',secondPass:true,auto:!!e.auto,seq:e.seq,legacy:e.type};
      case 'bust':return{type:'effect.bust',actor:e.player,value:e.value,flip3:!!e.flip3,seq:e.seq,legacy:e.type};
      case 'flip7':return{type:'effect.flip7',actor:e.player,seq:e.seq,legacy:e.type};
      case 'flip3_abandon':return{type:'effect.flip3_abandon',target:e.target,seq:e.seq,legacy:e.type};
      case 'second_used':return{type:'effect.second_used',actor:e.player,value:e.value,flip3:!!e.flip3,seq:e.seq,legacy:e.type};
      case 'second_discard':return{type:'effect.second_discard',actor:e.player,seq:e.seq,legacy:e.type};
      case 'stay':return{type:'effect.stay',actor:e.player,seq:e.seq,legacy:e.type};
      case 'freeze_done':return{type:'effect.freeze_done',target:e.target,seq:e.seq,legacy:e.type};
      case 'reshuffle':return{type:'deck.reshuffle',seq:e.seq,legacy:e.type};
      case 'await_target':return{type:'target.prompt',actor:e.from,actionKind:e.kind,seq:e.seq,legacy:e.type};
      case 'round_end':return{type:'effect.round_end',winners:e.winners,flip7:e.flip7,seq:e.seq,legacy:e.type};
      case 'game_over':return{type:'effect.game_over',winners:e.winners,flip7:e.flip7,seq:e.seq,legacy:e.type};
      default:return e;
    }
  }
  window.normalizeFlip7Event=normalizeFlip7Event;

  function cloneView(v){ return JSON.parse(JSON.stringify(v)); }
  function eventView(base, seat){ const v=cloneView(base); v.flip7.viewerSeat=seat; return v; }
  function ensureExtras(shadow){ shadow.flip7.players.forEach(p=>{ if(!p.actionCards)p.actionCards=[]; }); }
  function removeOne(arr,val){ const i=arr.indexOf(val); if(i>=0)arr.splice(i,1); }
  function addCardToShadow(p,card){
    if(!card)return;
    if(card.kind==='num'){ if(!p.nums.includes(card.v)){p.nums.push(card.v);p.nums.sort((a,b)=>a-b);} }
    else if(card.kind==='mod') p.mods.push(card.v);
    else if(card.v==='second') p.second=true;
    else p.actionCards.push(card.v);
    p.unique=new Set(p.nums).size;
    p.live=liveScore(p);
  }
  function removeCardFromShadow(p,card){
    if(!p||!card)return;
    if(card.kind==='num') removeOne(p.nums,card.v);
    else if(card.kind==='mod') removeOne(p.mods,card.v);
    else if(card.v==='second') p.second=false;
    else if(p.actionCards) removeOne(p.actionCards,card.v);
    p.unique=new Set(p.nums||[]).size;
    p.live=liveScore(p);
  }
  function liveScore(p){
    if(p.status==='busted')return 0;
    let base=(p.nums||[]).reduce((a,b)=>a+b,0);
    if((p.mods||[]).includes('x2'))base*=2;
    for(const m of (p.mods||[])) if(String(m)[0]==='+') base+=parseInt(String(m).slice(1));
    if(new Set(p.nums||[]).size>=7)base+=15;
    return base;
  }
  function applyShadowEvent(shadow,e){
    ensureExtras(shadow);
    e=normalizeFlip7Event(e);
    const p=e.actor!=null?shadow.flip7.players[e.actor]:null;
    if(e.type==='card.deal') addCardToShadow(p,e.card);
    else if(e.type==='effect.bust'&&p){ p.status='busted'; p.bustCard=e.value; p.live=0; }
    else if(e.type==='effect.second_used'&&p){ p.second=false; }
    else if(e.type==='effect.flip7'&&p){ p.status='stayed'; }
    else if(e.type==='effect.stay'&&p){ p.status='stayed'; }
    else if(e.type==='card.transfer'){
      const fp=shadow.flip7.players[e.actor];
      if(fp&&fp.actionCards) removeOne(fp.actionCards,e.actionKind||e.card?.v);
      if(e.secondPass){ const tp=shadow.flip7.players[e.target]; if(tp)tp.second=true; }
    }
    else if(e.type==='effect.freeze_done'){ const tp=shadow.flip7.players[e.target]; if(tp)tp.status='stayed'; }
    shadow.flip7.players.forEach(x=>{x.unique=new Set(x.nums||[]).size;x.live=liveScore(x);});
  }


  // ---- unified sequential event runner ----
  let lastSeq=-1;
  async function playEvents(view){
    const ev=(view.flip7.events||[]).map(normalizeFlip7Event).filter(e=>e.seq>lastSeq);
    if(!ev.length){draw(view);prevView=cloneView(view);curView=cloneView(view);maybeSummary(view);return;}
    animating=true;
    const shadow=cloneView(prevView&&prevView.flip7?prevView:view);
    shadow.flip7.viewerSeat=view.flip7.viewerSeat;
    ensureExtras(shadow);
    await Kit.EventRunner.run(ev, async(e)=>{
      lastSeq=Math.max(lastSeq,e.seq);
      await runUnifiedEvent(shadow,e,view);
    });
    if(mode==='local'&&eventFocus!=null&&view.flip7.phase==='PLAY'&&view.flip7.current!==eventFocus){Kit.turnBanner('Next: '+(view.flip7.players[view.flip7.current]?.name||'player'),false);await sleep(700);}
    eventFocus=null;
    if(mode==='local') window._f7InspectSeat=null;
    animating=false;
    draw(view);
    prevView=cloneView(view);curView=cloneView(view);
    maybeSummary(view);
    flushView();
    // In local pass-and-play, keep the acting board visible through the whole
    // animation, then switch to the next human/device actor afterwards.
    if(mode==='local'&&view.flip7.phase==='PLAY'&&!view.flip7.pendingAction&&view.flip7.current!==view.flip7.viewerSeat){
      setTimeout(()=>{ if(mode==='local'&&localGameId==='flip7') renderLocal(); }, 650);
    }
  }
  function maybeSummary(view){
    const s=view.flip7;
    if(s.phase==='ROUND_END'||s.phase==='GAME_OVER'){if(!summaryShown){summaryShown=true;showSummary(view);}const c=$('f7Controls');if(c)c.innerHTML='';}
    else{summaryShown=false;hideOverlay();}
  }
  async function runUnifiedEvent(shadow,e,finalView){
    e=normalizeFlip7Event(e);
    const focusSeat=e.actor??e.target??shadow.flip7.viewerSeat;
    if(mode==='local')eventFocus=focusSeat;
    switch(e.type){
      case 'deck.wiggle':{
        draw(shadow); SFX.draw(); await wiggleReveal(e.prob||0); break;
      }
      case 'card.deal':{
        if(mode==='local')eventFocus=e.actor;
        removeCardFromShadow(shadow.flip7.players[e.actor],e.card);
        draw(shadow);
        const row=rowOf(e.actor); if(e.flip3)await sleep(SPEED.flip3Gap*0.2);
        const before=captureF7Layout();
        await dealTravel(row,e.card,e.seq,before);
        applyShadowEvent(shadow,e);
        draw(shadow);
        await sleep(SPEED.beat*0.18);
        break;
      }
      case 'card.transfer':{
        if(mode==='local')eventFocus=e.actor;
        draw(shadow);
        const fromRow=rowOf(e.actor),toRow=rowOf(e.target);
        await flyF7Card(fromRow,toRow,e.card||{kind:'act',v:e.actionKind},{startFaceDown:false,spin:true,duration:SPEED.actionFly});
        applyShadowEvent(shadow,e);
        if(mode==='local')eventFocus=e.target;
        draw(shadow);
        if(!e.secondPass&&e.actionKind){
          actionVfx(e.actionKind); SFX[e.actionKind==='freeze'?'discard':'triplet']();
          if(e.auto)Kit.turnBanner((e.actionKind==='freeze'?'\u2744 ':'\ud83d\udd03 ')+'on self!',false);
        } else if(e.secondPass){
          SFX.flip(); if(e.auto)Kit.turnBanner('\u2665 passed',true);
        }
        await sleep(SPEED.beat*0.45);
        break;
      }
      case 'effect.bust':{
        applyShadowEvent(shadow,e);
        if(mode==='local')eventFocus=e.actor;
        draw(shadow); SFX.bad();
        const b=boardOf(e.actor); if(b){b.style.animation='shakeX .5s ease';setTimeout(()=>b&&(b.style.animation=''),520);}
        Kit.turnBanner((shadow.flip7.players[e.actor]?.name||'')+' BUST!',false);
        await sleep(SPEED.beat); break;
      }
      case 'effect.freeze_done':{
        applyShadowEvent(shadow,e); draw(shadow);
        const b=boardOf(e.target); if(b){b.style.transition='filter .3s';b.style.filter='brightness(1.4) saturate(1.4)';setTimeout(()=>b&&(b.style.filter=''),350);} await sleep(SPEED.beat*0.4); break;
      }
      case 'effect.second_used':{ applyShadowEvent(shadow,e); draw(shadow); SFX.good(); Kit.turnBanner('Second Chance!',true); await sleep(SPEED.beat); break; }
      case 'effect.flip7':{ applyShadowEvent(shadow,e); draw(shadow); SFX.win(); Kit.confetti(); Kit.turnBanner('FLIP 7! +15',true); await sleep(SPEED.beat); break; }
      case 'effect.stay':{ applyShadowEvent(shadow,e); draw(shadow); SFX.good(); break; }
      case 'effect.flip3_abandon':{ Kit.turnBanner('Flip 3 abandoned',false); await sleep(SPEED.beat*0.6); break; }
      case 'effect.second_discard':{ await sleep(SPEED.beat*0.3); break; }
      case 'deck.reshuffle':{ Kit.turnBanner('Deck reshuffled',false); await sleep(SPEED.beat); break; }
      case 'target.prompt':{ draw(shadow); await sleep(SPEED.beat*0.2); break; }
      case 'effect.round_end': case 'effect.game_over':{ await sleep(SPEED.beat*0.2); break; }
      default:{ applyShadowEvent(shadow,e); draw(shadow); }
    }
  }


  function render(view,ctx={}){
    renderCtx=ctx;
    // turn banner on turn change (only when not mid-animation start)
    if(prevView&&prevView.flip7&&view.flip7.phase==='PLAY'&&view.flip7.current!==prevView.flip7.current&&(!view.flip7.events||!view.flip7.events.length)){
      const mine=view.flip7.current===view.flip7.viewerSeat;Kit.turnBanner(mine?'Your turn!':(view.flip7.players[view.flip7.current]?.name+"'s turn"),mine);bumpStatus();if(mine)SFX.yourTurn();
    }
    playEvents(view);
  }
  function act(seat,msg){ if(mode==='local')localAct(seat,msg); else net.send({type:'action',seat,...msg}); }
  // reset the timeline cursor when (re)entering a game
  window._flip7ResetSeq=function(){lastSeq=-1;};
  function unmount(){const c=$('f7Controls');if(c)c.remove();const d=$('f7DealerWrap');if(d)d.remove();const mini=$('miniBoardsContainer');if(mini){mini.innerHTML='';mini.className='mini-boards-container';}}
  window.GameClients['flip7']={render,inspect,unmount};

  // local engine wrapper
  window.LocalEngines['flip7']=function(names){
    const E=new Flip7Engine(names);
    return {
      apply(seat,msg){E.apply(seat,msg);},
      next(){E.next();},
      actor(){return E.s.current;},
      viewFor(seat){return E.viewFor(seat);},
    };
  };
})();

/* ---- Flip 7 engine (client copy for local offline play; mirrors src/games/flip7.ts) ---- */
class Flip7Engine{
  constructor(names){this.s=this._fresh(names,names.map(()=>0));}
  static fromState(st){const e=Object.create(Flip7Engine.prototype);e.s=st;if(e.s.events==null)e.s.events=[];if(e.s.seq==null)e.s.seq=0;return e;}
  _newP(name,banked){return{name,nums:[],mods:[],second:false,status:'active',bustCard:null,banked:banked||0,roundScore:0};}
  _buildDeck(){const d=[];d.push({kind:'num',v:0});for(let n=1;n<=12;n++)for(let i=0;i<n;i++)d.push({kind:'num',v:n});for(const m of['+2','+4','+6','+8','+10','x2'])d.push({kind:'mod',v:m});for(const a of['freeze','flip3','second'])for(let i=0;i<3;i++)d.push({kind:'act',v:a});this._sh(d);return d;}
  _sh(d){for(let i=d.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[d[i],d[j]]=[d[j],d[i]];}}
  _emit(s,e){const n=window.normalizeFlip7Event?window.normalizeFlip7Event(e):e;n.seq=++s.seq;s.events.push(n);}
  _fresh(names,banked){const s={players:names.map((n,i)=>this._newP(n,banked[i]||0)),deck:this._buildDeck(),discard:[],current:0,phase:'PLAY',round:1,pendingAction:null,flip3Left:0,flip3Target:-1,events:[],seq:0};
    for(let i=0;i<s.players.length;i++){let c=this._draw(s),g=0;while(c.kind==='act'&&g++<200){s.deck.unshift(c);this._sh(s.deck);c=this._draw(s);}this._place(s,i,c);}
    s.current=this._firstActive(s,0);return s;}
  _draw(s){if(!s.deck.length){s.deck=s.discard;s.discard=[];this._sh(s.deck);this._emit(s,{type:'reshuffle'});}return s.deck.pop();}
  _firstActive(s,from){for(let k=0;k<s.players.length;k++){const i=(from+k)%s.players.length;if(s.players[i].status==='active')return i;}return from;}
  _activeCount(s){return s.players.filter(p=>p.status==='active').length;}
  _activeOthers(s,ex){return s.players.map((p,i)=>i).filter(i=>i!==ex&&s.players[i].status==='active');}
  _unique(p){return new Set(p.nums).size;}
  _bustProb(s,pi){const p=s.players[pi];const tot=s.deck.length||1;let d=0;for(const c of s.deck)if(c.kind==='num'&&p.nums.includes(c.v))d++;return d/tot;}
  _place(s,pi,card){const p=s.players[pi];if(card.kind==='num'){if(!p.nums.includes(card.v)){p.nums.push(card.v);p.nums.sort((a,b)=>a-b);}}else if(card.kind==='mod')p.mods.push(card.v);else if(card.v==='second')p.second=true;}
  _apply(s,pi,card,opts){opts=opts||{};const p=s.players[pi];
    if(card.kind==='num'){const n=card.v;if(p.nums.includes(n)){if(p.second){p.second=false;s.discard.push(card);this._emit(s,{type:'second_used',player:pi,value:n,flip3:!!opts.flip3});return'ok';}p.status='busted';p.bustCard=n;this._emit(s,{type:'bust',player:pi,value:n,flip3:!!opts.flip3});return'bust';}p.nums.push(n);p.nums.sort((a,b)=>a-b);this._emit(s,{type:'card',player:pi,card,flip3:!!opts.flip3});if(this._unique(p)>=7){p.status='stayed';this._emit(s,{type:'flip7',player:pi});return'flip7';}return'ok';}
    if(card.kind==='mod'){p.mods.push(card.v);this._emit(s,{type:'card',player:pi,card,flip3:!!opts.flip3});return'ok';}
    const a=card.v;if(a==='second'){if(!p.second){p.second=true;this._emit(s,{type:'card',player:pi,card});return'ok';}const others=this._activeOthers(s,pi).filter(i=>!s.players[i].second);if(others.length===0){s.discard.push(card);this._emit(s,{type:'second_discard',player:pi});return'ok';}if(others.length===1){s.players[others[0]].second=true;this._emit(s,{type:'second_pass',from:pi,to:others[0],auto:true});return'ok';}s.pendingAction={kind:'give_second',from:pi};this._emit(s,{type:'await_target',kind:'give_second',from:pi});return'action';}
    this._emit(s,{type:'action_card',player:pi,kind:a});const others=this._activeOthers(s,pi);if(others.length===0){this._resolve(s,pi,a,pi,true);return'ok';}s.pendingAction={kind:a,from:pi};this._emit(s,{type:'await_target',kind:a,from:pi});return'action';}
  _resolve(s,from,kind,target,auto){const tp=s.players[target];s.pendingAction=null;if(kind==='freeze'){this._emit(s,{type:'play_action',kind:'freeze',from,target,auto:!!auto});if(tp.status==='active'){tp.status='stayed';this._emit(s,{type:'freeze_done',target});}return'ok';}this._emit(s,{type:'play_action',kind:'flip3',from,target,auto:!!auto});s.flip3Left=3;s.flip3Target=target;this._runFlip3(s);return'ok';}
  _runFlip3(s){while(s.flip3Left>0){const t=s.flip3Target,tp=s.players[t];if(!tp||tp.status!=='active')break;s.flip3Left--;const r=this._apply(s,t,this._draw(s),{flip3:true});if(r==='bust'||r==='flip7'){this._emit(s,{type:'flip3_abandon',target:t});break;}if(r==='action'){const pa=s.pendingAction;if(pa){if(pa.kind==='give_second'){const o=this._activeOthers(s,pa.from).filter(i=>!s.players[i].second);s.pendingAction=null;if(o.length){s.players[o[0]].second=true;this._emit(s,{type:'second_pass',from:pa.from,to:o[0],auto:true});}else this._emit(s,{type:'second_discard',player:pa.from});}else this._resolve(s,pa.from,pa.kind,pa.from,true);}}}s.flip3Left=0;s.flip3Target=-1;}
  _advance(s){if(this._activeCount(s)===0){this._score(s);return;}s.current=this._firstActive(s,(s.current+1)%s.players.length);}
  _score(s){let f7=-1;for(const p of s.players){if(p.status==='busted'){p.roundScore=0;continue;}const u=new Set(p.nums).size;let base=p.nums.reduce((a,b)=>a+b,0);if(p.mods.includes('x2'))base*=2;for(const m of p.mods)if(m[0]==='+')base+=parseInt(m.slice(1));if(u>=7){base+=15;f7=1;}p.roundScore=base;p.banked+=base;}s.pendingAction=null;s.flip3Left=0;s.flip3Target=-1;s.phase=s.players.some(p=>p.banked>=200)?'GAME_OVER':'ROUND_END';const mx=Math.max(...s.players.map(p=>p.banked));this._emit(s,{type:s.phase==='GAME_OVER'?'game_over':'round_end',winners:s.players.map((p,i)=>p.banked===mx?i:-1).filter(i=>i>=0),flip7:f7});}
  apply(seat,msg){const s=this.s;s.events=[];if(s.phase!=='PLAY')return;
    if(s.pendingAction){const pa=s.pendingAction;if(msg.action==='target'&&pa.from===seat){const t=msg.target|0;if(!s.players[t]||s.players[t].status!=='active')return;if(pa.kind==='give_second'){if(t===seat)return;s.pendingAction=null;s.players[t].second=true;this._emit(s,{type:'second_pass',from:seat,to:t,auto:false});}else{this._resolve(s,seat,pa.kind,t);this._advance(s);}}return;}
    if(seat!==s.current||s.players[seat].status!=='active')return;
    if(msg.action==='stay'){s.players[seat].status='stayed';this._emit(s,{type:'stay',player:seat});this._advance(s);}
    else if(msg.action==='hit'){const prob=this._bustProb(s,seat);const card=this._draw(s);this._emit(s,{type:'draw_start',player:seat,prob});const r=this._apply(s,seat,card,{});if(r==='action'){return;}this._advance(s);}
  }
  next(){const s=this.s;const over=s.phase==='GAME_OVER';const ns=this._fresh(s.players.map(p=>p.name),over?s.players.map(()=>0):s.players.map(p=>p.banked));ns.seq=s.seq+1;if(!over)ns.round=s.round+1;this.s=ns;}
  viewFor(seat){const s=this.s;const over=s.phase==='GAME_OVER';let summary;if(s.phase==='ROUND_END'||s.phase==='GAME_OVER'){const mx=Math.max(...s.players.map(p=>p.banked));summary={rows:s.players.map((p,i)=>({seat:i,name:p.name,score:p.banked,delta:p.roundScore})),winners:s.players.map((p,i)=>p.banked===mx?i:-1).filter(i=>i>=0)};}
    const live=p=>{if(p.status==='busted')return 0;let b=p.nums.reduce((a,c)=>a+c,0);if(p.mods.includes('x2'))b*=2;for(const m of p.mods)if(m[0]==='+')b+=parseInt(m.slice(1));if(new Set(p.nums).size>=7)b+=15;return b;};
    return{game:'flip7',phase:s.phase,over,yourSeat:seat,summary,flip7:{round:s.round,current:s.current,phase:s.phase,pendingAction:s.pendingAction,viewerSeat:seat,deckCount:s.deck.length,discardCount:s.discard.length,seq:s.seq,events:s.events,players:s.players.map(p=>({name:p.name,nums:[...p.nums],mods:[...p.mods],second:p.second,status:p.status,bustCard:p.bustCard,banked:p.banked,unique:new Set(p.nums).size,live:live(p)}))}};}
}

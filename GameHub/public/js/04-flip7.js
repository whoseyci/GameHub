/* -------------------- FLIP 7 client (event-timeline) -------------------- */
(function(){
  window.GameRules['flip7']={title:'🎴 Flip 7',quick:'Push your luck — race to 200.',steps:['On your turn choose <b>Hit</b> (draw a card) or <b>Stay</b> (bank your points, you’re out for the round).','Number cards: there’s one 0, two 2s, three 3s … twelve 12s. Draw a <b>duplicate number → BUST</b> (score 0 this round).','Get <b>7 unique numbers → Flip 7!</b> +15 bonus and the round ends instantly.','Modifiers (+2…+10, ×2) boost your score; ×2 doubles numbers first, then + adds on.','Action cards: <b>Freeze</b> (target banks &amp; is out), <b>Flip Three</b> (target draws 3), <b>Second Chance</b> (saves you from one bust).','Round ends when all players bust/stay or someone Flip 7s. First to 200 wins.'],tip:'High numbers are riskier (more copies in the deck). The 0 is always safe.'};
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

  function addF7Card(row,el,key){
    const seat=row?.dataset?.f7Seat||'x';
    const id=`flip7:table:p${seat}:${key}`;
    const anchor=el.cloneNode(false);
    anchor.className=el.className+' registry-anchor';
    anchor.textContent=el.textContent;
    anchor.dataset.cardKey=key;anchor.dataset.cardReg=id;
    anchor.dataset.kind=el.classList.contains('num')?'num':(el.classList.contains('mod')||el.classList.contains('modx2'))?'mod':'act';
    anchor.dataset.value=el.textContent||'';
    if(el.classList.contains('second'))anchor.dataset.value='second';
    if(el.classList.contains('freeze'))anchor.dataset.value='freeze';
    if(el.classList.contains('flip3'))anchor.dataset.value='flip3';
    anchor.dataset.busted=el.classList.contains('busted-card')?'1':'';
    anchor.dataset.cause=el.classList.contains('bust-cause')?'1':'';
    row.appendChild(anchor);return anchor;
  }
  function syncF7Cards(){
    const active=[];
    document.querySelectorAll('[data-card-reg^="flip7:table:"]').forEach(anchor=>{
      const id=anchor.dataset.cardReg,kind=anchor.dataset.kind,val=kind==='num'?Number(anchor.dataset.value):anchor.dataset.value;
      active.push(id);
      if(!Kit.CardManager.has(id)){
        Kit.CardManager.create({kind,value:val},{zone:'grid',player:Number(anchor.closest('[data-f7-seat]')?.dataset?.f7Seat)||0,slot:active.length-1},{id,renderer:(face,faceUp)=>cardEl(face.kind==='num'?'num':(face.value==='second'||face.value==='freeze'||face.value==='flip3')?'act':'mod',face.value,{busted:anchor.dataset.busted==='1',cause:anchor.dataset.cause==='1'}),faceUp:true});
      }else{
        const c=Kit.CardManager.get(id);if(c)c.renderer=(face,faceUp)=>cardEl(face.kind==='num'?'num':(face.value==='second'||face.value==='freeze'||face.value==='flip3')?'act':'mod',face.value,{busted:anchor.dataset.busted==='1',cause:anchor.dataset.cause==='1'});
      }
      Kit.CardManager.pin(id,anchor,{hideAnchor:false,updateContent:true});
    });
    Kit.CardManager.reconcile('flip7:table:',active);
    requestAnimationFrame(()=>Kit.CardManager.sync());
  }
  function cmCardSlot(permId){ const c=Kit.CardManager.get(permId); return c&&c.location?c.location.slot:undefined; }
  // Animate a permanent card flying from the deck to its board slot via the
  // CardManager animation API: face-down on the deck, a Y-axis FLIP (so it lands
  // face-up & upright — no upside-down text), revealing its face edge-on midway.
  async function flyDealCard(permId,seat,slot){
    const cmCard=Kit.CardManager.get(permId);
    const deck=$('f7Deck');
    const destAnchor=document.querySelector(`[data-card-reg="${permId}"]`);
    if(!cmCard||!deck||!destAnchor)return;
    // Deck visual pulse as the card leaves the pile.
    deck.classList.remove('deal');void deck.offsetWidth;deck.classList.add('deal');
    // Start the card on the deck so the flight originates there.
    Kit.CardManager.pin(permId,deck,{hideAnchor:false,updateContent:false});
    await Kit.CardManager.moveTo(permId,destAnchor,{
      duration:620,
      arc:46,
      flip:true,            // rotateY card-flip → always lands face-up & upright
      startFaceDown:true,
      backHTML:'<div class="f7-card f7-card-back"><span style="color:#c7d2fe;font-size:1.5rem">\u2726</span></div>',
      backClass:'f7-card-back',
      revealMidway:true,
      revealAt:0.5,         // swap to the face while edge-on (mid-flip)
      onReveal:()=>SFX.flip(),
      land:true,
      toLocation:{zone:'grid',player:Number(seat)||0,slot},
    });
    // Re-pin so the permanent card tracks its live anchor after the flight.
    Kit.CardManager.pin(permId,destAnchor,{hideAnchor:false,updateContent:true});
    Kit.CardManager.sync();
  }
  function captureF7Layout(){ const m=new Map(); document.querySelectorAll('.f7-focus-board [data-card-reg]').forEach(el=>m.set(el.dataset.cardReg,el.getBoundingClientRect())); return m; }
  function animateF7Layout(before){ document.querySelectorAll('.f7-focus-board [data-card-reg]').forEach(anchor=>{ const a=before.get(anchor.dataset.cardReg); if(!a)return; const b=anchor.getBoundingClientRect(); const dx=a.left-b.left,dy=a.top-b.top; if(Math.abs(dx)+Math.abs(dy)<3)return; const card=Kit.CardManager.get(anchor.dataset.cardReg)?.overlayEl; if(!card)return; card.style.transition='none'; card.style.transform=`translate(${dx}px,${dy}px)`; card.offsetHeight; card.style.transition='transform .34s var(--spring-soft)'; requestAnimationFrame(()=>{card.style.transform='';}); setTimeout(()=>{card.style.transition='';card.style.transform='';},390); }); }

  function actionVfx(kind){
    const o=document.createElement('div');
    o.className='f7-vfx-overlay '+(kind==='freeze'?'freeze':'flip3');
    const aura=document.createElement('div');aura.className='f7-vfx-aura';
    const icon=document.createElement('div');icon.className='f7-vfx-icon';
    if(kind==='freeze'){icon.textContent='\u2744';}
    else{icon.textContent='F3';}
    aura.appendChild(icon);o.appendChild(aura);document.body.appendChild(o);
    setTimeout(()=>{o.style.transition='opacity .25s';o.style.opacity='0';setTimeout(()=>o.remove(),260);},760);
  }

  // boards are rebuilt each render; find a player's row container
  let eventFocus=null;
  let renderCtx=null;
  function boardOf(i){return document.querySelector(`[data-f7-seat="${i}"]`);}
  function rowOf(i){const b=boardOf(i);return b?b.querySelector('.f7-row'):null;}
  function rectOf(el){return el?el.getBoundingClientRect():null;}
  function cloneCard(card){return card?{kind:card.kind,v:card.v}:card;}
  function f7BackHTML(){return '<div class="f7-card f7-card-back"><span>7</span></div>';}
  function actionCardSourceEl(seat,kind){
    const row=rowOf(seat); if(!row)return null;
    const anchors=[...row.querySelectorAll('[data-card-reg]')];
    const a=anchors.find(x=>x.dataset.kind==='act'&&x.dataset.value===kind);
    return a ? (Kit.CardManager.get(a.dataset.cardReg)?.overlayEl||a) : row;
  }
  function makeActionTargetSlot(targetSeat,card){
    const row=rowOf(targetSeat); if(!row)return null;
    const ghost=cardEl(card?.kind||'act',card?.v||'flip3');
    ghost.classList.add('registry-anchor');ghost.style.visibility='hidden';
    row.appendChild(ghost);
    return ghost;
  }
  async function transferActionCard(e){
    const card=e.card||{kind:'act',v:e.actionKind};
    const fromEl=actionCardSourceEl(e.actor,e.actionKind||card.v);
    const toEl=makeActionTargetSlot(e.target,card) || rowOf(e.target) || boardOf(e.target);
    await flyF7Card(fromEl,toEl,card,{startFaceDown:false,spin:true,duration:SPEED.actionFly});
    if(toEl&&toEl.classList.contains('registry-anchor'))toEl.remove();
  }

  function renderF7PlayerCards(row,p,busted){
    const cards=Array.isArray(p.cards)?p.cards:null;
    if(cards&&cards.length){
      cards.forEach((c,idx)=>addF7Card(row,cardEl(c.kind,c.v,{busted}),c.id||('card-'+idx+'-'+c.kind+'-'+c.v)));
    }else{
      p.nums.forEach(n=>addF7Card(row,cardEl('num',n,{busted}),'num-'+n));
      p.mods.forEach((m,mi)=>addF7Card(row,cardEl('mod',m,{busted}),'mod-'+mi+'-'+m));
      if(p.second)addF7Card(row,cardEl('act','second'),'second');
      (p.actionCards||[]).forEach((a,ai)=>addF7Card(row,cardEl('act',a),'act-'+ai+'-'+a));
    }
    if(busted&&p.bustCard!=null)addF7Card(row,cardEl('num',p.bustCard,{cause:true}),'bust-'+p.bustCard);
  }

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
      const row=document.createElement('div');row.className='f7-row';row.dataset.f7Seat=i;
      if(!(p.cards&&p.cards.length)&&!p.nums.length&&!p.mods.length&&!p.second)row.innerHTML='<span class="f7-empty">no cards yet</span>';
      renderF7PlayerCards(row,p,busted);
      wrap.appendChild(row);
      const meta=document.createElement('div');meta.className='muted';meta.style.cssText='margin-top:6px;font-size:.8rem';meta.textContent=p.unique+'/7 unique';wrap.appendChild(meta);
      const canTarget=pending&&p.status==='active'&&!(s.pendingAction.kind==='give_second'&&i===viewer);
      if(canTarget){wrap.style.cursor='pointer';wrap.style.outline='2px dashed #f59e0b';wrap.onclick=()=>net.spectating?null:act(viewer,{action:'target',target:i});}
      mainFrag.appendChild(wrap);
    });
    const center=s.phase==='PLAY'?`<div id="f7DealerWrap" class="f7-dealer"><div class="pile-label">Dealer</div><div id="f7Deck" class="f7-deck"><span class="cnt">deck ${esc(s.deckCount)} · out ${esc(s.discardCount)}</span></div></div>`:'';
    GameShell.renderTable({game:'flip7',opponents:miniFrag,center,focus:mainFrag,status:'',topMode:s.phase==='PLAY'?'custom':'hidden',opponentClass:'f7-mini-strip'});
    syncF7Cards();
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
    const row=document.createElement('div');row.className='f7-row';row.dataset.f7Seat=i;
    if(!(p.cards&&p.cards.length)&&!p.nums.length&&!p.mods.length&&!p.second)row.innerHTML='<span class="f7-empty">no cards</span>';
    renderF7PlayerCards(row,p,busted);
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
    const row=(p.cards&&p.cards.length?p.cards.map(c=>cardEl(c.kind,c.v,{busted:p.status==='busted'})):[...p.nums.map(n=>cardEl('num',n,{busted:p.status==='busted'})),...p.mods.map(m=>cardEl('mod',m,{busted:p.status==='busted'})),...(p.second?[cardEl('act','second')]:[]),...(p.actionCards||[]).map(a=>cardEl('act',a))]);
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

  async function flyF7Card(fromEl,toEl,card,{duration=620,spin=true}={}){
    // Simple fly for action card transfers — not part of the permanent card system
    await Kit.Card.move('f7:fly:'+Date.now(),{from:fromEl,to:toEl,render:()=>{const el=cardEl(card?.kind||'num',card?.v??'?');el.classList.add('f7-flying-card');return el;},spin,duration,land:false,hideTarget:true});
  }


  // deal a face-down card from the deck onto a player's row, then it stays hidden
  // until the caller reveals (we just animate the travel; the rebuilt board shows the real card)



  function normalizeFlip7Event(e){
    if(!e||!e.type)return e;
    if(e.type.includes('.'))return e;
    switch(e.type){
      case 'draw_start':return{type:'deck.wiggle',actor:e.player,prob:e.prob,seq:e.seq,legacy:e.type};
      case 'card':return{type:'card.deal',actor:e.player,card:e.card,flip3:!!e.flip3,seq:e.seq,legacy:e.type};
      case 'action_card':return{type:'card.deal',actor:e.player,card:e.card||{id:'action_'+(e.seq||'x')+'_'+e.kind,kind:'act',v:e.kind},actionKind:e.kind,actionCard:true,seq:e.seq,legacy:e.type};
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

  // ── Permanent Card System: a single evolving "live view" ──
  // Per the Card System design, we no longer keep a separate "shadow" copy with
  // its own scattered mutators (addCardToShadow/removeCardFromShadow/
  // applyShadowEvent). Instead one liveView object is advanced event-by-event by
  // a single reducer (advanceLiveView), and the permanent CardManager cards are
  // the source of truth for the on-screen card overlays. This removes the
  // duplicate "what's drawn vs. what the state is" bookkeeping.
  function cloneView(v){ return JSON.parse(JSON.stringify(v)); }
  function eventView(base, seat){ const v=cloneView(base); v.flip7.viewerSeat=seat; return v; }
  function ensureExtras(lv){ lv.flip7.players.forEach(p=>{ if(!p.actionCards)p.actionCards=[]; }); }
  function removeOne(arr,val){ const i=arr.indexOf(val); if(i>=0)arr.splice(i,1); }
  function liveScore(p){
    if(p.status==='busted')return 0;
    let base=(p.nums||[]).reduce((a,b)=>a+b,0);
    if((p.mods||[]).includes('x2'))base*=2;
    for(const m of (p.mods||[])) if(String(m)[0]==='+') base+=parseInt(String(m).slice(1));
    if(new Set(p.nums||[]).size>=7)base+=15;
    return base;
  }
  function recalcAll(lv){ lv.flip7.players.forEach(x=>{x.unique=new Set(x.nums||[]).size;x.live=liveScore(x);}); }
  // Order cards the way the engine's _ordered() does (num, mod, act; numbers by
  // value) so the live view's layout matches the authoritative final view — this
  // keeps the FLIP "slide aside" shift correct and the new card's slot stable.
  function orderCards(cards){
    const rank=c=>c.kind==='num'?0:c.kind==='mod'?1:2;
    return [...cards].sort((a,b)=>{const r=rank(a)-rank(b);if(r)return r;if(a.kind==='num'&&b.kind==='num')return a.v-b.v;return String(a.v).localeCompare(String(b.v));});
  }
  // Add a freshly-dealt card to a player in the live view. We update BOTH the
  // derived arrays (nums/mods/…) AND the canonical `cards` array the renderer
  // uses — the renderer keys each anchor by card.id, so the new card must be in
  // `cards` for its permanent anchor (and the deck→slot flight) to exist.
  function addCard(p,card){
    if(!p||!card)return;
    if(card.kind==='num'){ if(!p.nums.includes(card.v)){p.nums.push(card.v);p.nums.sort((a,b)=>a-b);} }
    else if(card.kind==='mod') p.mods.push(card.v);
    else if(card.v==='second') p.second=true;
    else p.actionCards.push(card.v);
    if(Array.isArray(p.cards) && card.id){
      if(!p.cards.some(c=>c.id===card.id)) p.cards=orderCards([...p.cards,{id:card.id,kind:card.kind,v:card.v}]);
    }
  }
  function removeCard(p,card){
    if(!p||!card)return;
    if(card.kind==='num') removeOne(p.nums,card.v);
    else if(card.kind==='mod') removeOne(p.mods,card.v);
    else if(card.v==='second') p.second=false;
    else if(p.actionCards) removeOne(p.actionCards,card.v);
    if(Array.isArray(p.cards) && card.id){
      const i=p.cards.findIndex(c=>c.id===card.id);
      if(i>=0)p.cards.splice(i,1);
    }
  }
  // Single reducer: advance the live view to reflect one event. Replaces the old
  // applyShadowEvent + add/removeCardToShadow trio with one mutation point.
  function advanceLiveView(lv,e){
    ensureExtras(lv);
    e=normalizeFlip7Event(e);
    const p=e.actor!=null?lv.flip7.players[e.actor]:null;
    if(e.type==='card.deal') addCard(p,e.card);
    else if(e.type==='effect.bust'&&p){ p.status='busted'; p.bustCard=e.value; }
    else if(e.type==='effect.second_used'&&p){ p.second=false; }
    else if(e.type==='effect.flip7'&&p){ p.status='stayed'; }
    else if(e.type==='effect.stay'&&p){ p.status='stayed'; }
    else if(e.type==='card.transfer'){
      const fp=lv.flip7.players[e.actor];
      if(fp&&fp.actionCards) removeOne(fp.actionCards,e.actionKind||e.card?.v);
      if(e.secondPass){ const tp=lv.flip7.players[e.target]; if(tp)tp.second=true; }
    }
    else if(e.type==='effect.freeze_done'){ const tp=lv.flip7.players[e.target]; if(tp)tp.status='stayed'; }
    recalcAll(lv);
  }


  // ---- unified sequential event runner ----
  let lastSeq=-1, lifecycleToken=0;
  function currentToken(){ return lifecycleToken; }
  function invalidateToken(){ lifecycleToken++; }
  function tokenAlive(token){ return token===lifecycleToken && window._renderView && window._renderView.game==='flip7' && $('gameScreen')?.classList.contains('active'); }
  async function playEvents(view, token=currentToken()){
    const ev=(view.flip7.events||[]).map(normalizeFlip7Event).filter(e=>e.seq>lastSeq);
    if(!ev.length){ if(!tokenAlive(token)) return; draw(view); prevView=cloneView(view); curView=cloneView(view); maybeSummary(view); return; }
    animating=true;
    const liveView=cloneView(prevView&&prevView.flip7?prevView:view);
    liveView.flip7.viewerSeat=view.flip7.viewerSeat;
    ensureExtras(liveView);
    await Kit.EventRunner.run(ev, async(e)=>{
      if(!tokenAlive(token)) return;
      lastSeq=Math.max(lastSeq,e.seq);
      await runUnifiedEvent(liveView,e,view,token);
    });
    if(!tokenAlive(token)) { animating=false; return; }
    if(mode==='local'&&eventFocus!=null&&view.flip7.phase==='PLAY'&&view.flip7.current!==eventFocus){Kit.turnBanner('Next: '+(view.flip7.players[view.flip7.current]?.name||'player'),false);await sleep(700); if(!tokenAlive(token)) { animating=false; return; }}
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
      setTimeout(()=>{ if(tokenAlive(token) && mode==='local'&&localGameId==='flip7') renderLocal(); }, 650);
    }
  }
  function maybeSummary(view){
    const s=view.flip7;
    if(s.phase==='ROUND_END'||s.phase==='GAME_OVER'){if(!summaryShown){summaryShown=true;showSummary(view);}const c=$('f7Controls');if(c)c.innerHTML='';}
    else{summaryShown=false;hideOverlay();}
  }
  async function runUnifiedEvent(liveView,e,finalView,token=currentToken()){
    if(!tokenAlive(token)) return;
    e=normalizeFlip7Event(e);
    const focusSeat=e.actor??e.target??liveView.flip7.viewerSeat;
    if(mode==='local')eventFocus=focusSeat;
    switch(e.type){
      case 'deck.wiggle':{
        draw(liveView); SFX.draw(); await wiggleReveal(e.prob||0); break;
      }
      case 'card.deal':{
        if(mode==='local')eventFocus=e.actor;
        // Render the pre-deal frame (card not yet on the board)…
        removeCard(liveView.flip7.players[e.actor],e.card); recalcAll(liveView);
        draw(liveView);
        const row=rowOf(e.actor); if(e.flip3)await sleep(SPEED.flip3Gap*0.2); if(!tokenAlive(token)) return;
        const before=captureF7Layout();
        // ── Permanent Card System (animation API) ──
        // 1. Advance the live view (card added) + draw — syncF7Cards creates and
        //    pins the permanent CardManager card at its final board slot.
        advanceLiveView(liveView,e);
        draw(liveView);
        // 2. Smooth layout shift so existing cards slide aside to make room
        //    (the new card has no 'before' entry, so it is skipped here).
        animateF7Layout(before);
        // 3. Animate the new card deck → slot using the CardManager animation API.
        //    We pin it back onto the deck (face-down), then moveTo() flies it on
        //    an arc to its real anchor, flips face-up midway, and lands.
        const seat=row?.dataset?.f7Seat||e.actor;
        const cardKey=e.card?.id||('card-'+e.seq+'-'+(e.card?.kind||'num')+'-'+(e.card?.v??'?'));
        const permId=`flip7:table:p${seat}:${cardKey}`;
        await flyDealCard(permId,seat,cmCardSlot(permId));
        if(!tokenAlive(token)) return;
        await sleep(SPEED.beat*0.18);
        break;
      }
      case 'card.transfer':{
        if(mode==='local')eventFocus=e.actor;
        draw(liveView);
        await transferActionCard(e); if(!tokenAlive(token)) return;
        advanceLiveView(liveView,e);
        if(mode==='local')eventFocus=e.target;
        draw(liveView);
        if(!e.secondPass&&e.actionKind){
          actionVfx(e.actionKind); SFX[e.actionKind==='freeze'?'discard':'triplet']();
          if(e.auto)Kit.turnBanner((e.actionKind==='freeze'?'\u2744 ':'\ud83d\udd03 ')+'on self!',false);
        } else if(e.secondPass){
          SFX.flip(); if(e.auto)Kit.turnBanner('\u2665 passed',true);
        }
        await sleep(SPEED.beat*0.45); break;
      }
      case 'effect.bust':{
        // The engine emits `bust` WITHOUT a preceding `card` event, so the
        // duplicate card that causes the bust must be dealt here — otherwise the
        // player appears to bust before the offending card arrives. Apply the
        // busted state (which renders the bust-cause card anchor), fly that card
        // in from the deck, THEN play the bust reaction.
        if(mode==='local')eventFocus=e.actor;
        advanceLiveView(liveView,e);
        draw(liveView);
        const bustPermId=`flip7:table:p${e.actor}:bust-${e.value}`;
        await flyDealCard(bustPermId,e.actor,cmCardSlot(bustPermId));
        if(!tokenAlive(token)) return;
        SFX.bad();
        const b=boardOf(e.actor); if(b){b.style.animation='shakeX .5s ease';setTimeout(()=>b&&(b.style.animation=''),520);}
        Kit.turnBanner((liveView.flip7.players[e.actor]?.name||'')+' BUST!',false);
        await sleep(SPEED.beat); break;
      }
      case 'effect.freeze_done':{
        advanceLiveView(liveView,e); draw(liveView);
        const b=boardOf(e.target); if(b){b.style.transition='filter .3s';b.style.filter='brightness(1.4) saturate(1.4)';setTimeout(()=>b&&(b.style.filter=''),350);} await sleep(SPEED.beat*0.4); break;
      }
      case 'effect.second_used':{ advanceLiveView(liveView,e); draw(liveView); SFX.good(); Kit.turnBanner('Second Chance!',true); await sleep(SPEED.beat); break; }
      case 'effect.flip7':{ advanceLiveView(liveView,e); draw(liveView); SFX.win(); Kit.confetti(); Kit.turnBanner('FLIP 7! +15',true); await sleep(SPEED.beat); break; }
      case 'effect.stay':{ advanceLiveView(liveView,e); draw(liveView); SFX.good(); break; }
      case 'effect.flip3_abandon':{ Kit.turnBanner('Flip 3 abandoned',false); await sleep(SPEED.beat*0.6); break; }
      case 'effect.second_discard':{ await sleep(SPEED.beat*0.3); break; }
      case 'deck.reshuffle':{ Kit.turnBanner('Deck reshuffled',false); await sleep(SPEED.beat); break; }
      case 'target.prompt':{ draw(liveView); await sleep(SPEED.beat*0.2); break; }
      case 'effect.round_end': case 'effect.game_over':{ await sleep(SPEED.beat*0.2); break; }
      default:{ advanceLiveView(liveView,e); draw(liveView); }
    }
  }


  function render(view,ctx={}){
    renderCtx=ctx;
    const token=currentToken();
    // turn banner on turn change (only when not mid-animation start)
    if(prevView&&prevView.flip7&&view.flip7.phase==='PLAY'&&view.flip7.current!==prevView.flip7.current&&(!view.flip7.events||!view.flip7.events.length)){
      const mine=view.flip7.current===view.flip7.viewerSeat;Kit.turnBanner(mine?'Your turn!':(view.flip7.players[view.flip7.current]?.name+"'s turn"),mine);bumpStatus();if(mine)SFX.yourTurn();
    }
    playEvents(view, token);
  }
  function act(seat,msg){ GameActions.send(msg.action, Object.fromEntries(Object.entries(msg).filter(([k])=>k!=='action')), seat); }
  function clientAct(action, extra={}){
    const seat = window._renderView?.yourSeat ?? 0;
    GameActions.send(action, extra, seat);
  }
  // reset the timeline cursor when (re)entering a game
  window._flip7ResetSeq=function(){lastSeq=-1;invalidateToken();};
  function unmount(){invalidateToken(); const c=$('f7Controls');if(c)c.remove();const d=$('f7DealerWrap');if(d)d.remove();const mini=$('miniBoardsContainer');if(mini){mini.innerHTML='';mini.className='mini-boards-container';}}
  window.GameClients['flip7']={render,inspect,unmount,act:clientAct};

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
  _newP(name,banked){return{name,nums:[],mods:[],tableau:[],second:false,status:'active',bustCard:null,banked:banked||0,roundScore:0};}
  _buildDeck(){const d=[];let q=0;const add=(kind,v)=>d.push({id:'lf7c_'+(q++)+'_'+kind+'_'+String(v).replace(/\W/g,''),kind,v});add('num',0);for(let n=1;n<=12;n++)for(let i=0;i<n;i++)add('num',n);for(const m of['+2','+4','+6','+8','+10','x2'])add('mod',m);for(const a of['freeze','flip3','second'])for(let i=0;i<3;i++)add('act',a);this._sh(d);return d;}
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
  _remTab(p,pred){const i=p.tableau.findIndex(pred);return i>=0?p.tableau.splice(i,1)[0]:null;}
  _ordered(p){return [...(p.tableau||[])].sort((a,b)=>{const r=(a.kind==='num'?0:a.kind==='mod'?1:2)-(b.kind==='num'?0:b.kind==='mod'?1:2);if(r)return r;if(a.kind==='num'&&b.kind==='num')return a.v-b.v;return String(a.v).localeCompare(String(b.v));});}
  _place(s,pi,card){const p=s.players[pi];if(card.kind==='num'){if(!p.nums.includes(card.v)){p.nums.push(card.v);p.nums.sort((a,b)=>a-b);p.tableau.push(card);}}else if(card.kind==='mod'){p.mods.push(card.v);p.tableau.push(card);}else if(card.v==='second'){p.second=true;p.tableau.push(card);}}
  _apply(s,pi,card,opts){opts=opts||{};const p=s.players[pi];
    if(card.kind==='num'){const n=card.v;if(p.nums.includes(n)){if(p.second){p.second=false;s.discard.push(card);const used=this._remTab(p,c=>c.kind==='act'&&c.v==='second');if(used)s.discard.push(used);this._emit(s,{type:'second_used',player:pi,value:n,card:used,flip3:!!opts.flip3});return'ok';}p.status='busted';p.bustCard=n;this._emit(s,{type:'bust',player:pi,value:n,flip3:!!opts.flip3});return'bust';}p.nums.push(n);p.nums.sort((a,b)=>a-b);p.tableau.push(card);this._emit(s,{type:'card',player:pi,card,flip3:!!opts.flip3});if(this._unique(p)>=7){p.status='stayed';this._emit(s,{type:'flip7',player:pi});return'flip7';}return'ok';}
    if(card.kind==='mod'){p.mods.push(card.v);p.tableau.push(card);this._emit(s,{type:'card',player:pi,card,flip3:!!opts.flip3});return'ok';}
    const a=card.v;if(a==='second'){if(!p.second){p.second=true;p.tableau.push(card);this._emit(s,{type:'card',player:pi,card});return'ok';}const others=this._activeOthers(s,pi).filter(i=>!s.players[i].second);if(others.length===0){s.discard.push(card);this._emit(s,{type:'second_discard',player:pi});return'ok';}if(others.length===1){s.players[others[0]].second=true;s.players[others[0]].tableau.push(card);this._emit(s,{type:'second_pass',from:pi,to:others[0],card,auto:true});return'ok';}s.pendingAction={kind:'give_second',from:pi,card};this._emit(s,{type:'await_target',kind:'give_second',from:pi});return'action';}
    p.tableau.push(card);this._emit(s,{type:'action_card',player:pi,kind:a,card});const others=this._activeOthers(s,pi);if(others.length===0){this._resolve(s,pi,a,pi,true);return'ok';}s.pendingAction={kind:a,from:pi,card};this._emit(s,{type:'await_target',kind:a,from:pi});return'action';}
  _resolve(s,from,kind,target,auto){const tp=s.players[target];const actionCard=(s.pendingAction&&s.pendingAction.card)||this._remTab(s.players[from],c=>c.kind==='act'&&c.v===kind);s.pendingAction=null;if(kind==='freeze'){this._emit(s,{type:'play_action',kind:'freeze',from,target,card:actionCard,auto:!!auto});if(tp.status==='active'){tp.status='stayed';this._emit(s,{type:'freeze_done',target});}return'ok';}this._emit(s,{type:'play_action',kind:'flip3',from,target,card:actionCard,auto:!!auto});s.flip3Left=3;s.flip3Target=target;this._runFlip3(s);return'ok';}
  _runFlip3(s){while(s.flip3Left>0){const t=s.flip3Target,tp=s.players[t];if(!tp||tp.status!=='active')break;s.flip3Left--;const r=this._apply(s,t,this._draw(s),{flip3:true});if(r==='bust'||r==='flip7'){this._emit(s,{type:'flip3_abandon',target:t});break;}if(r==='action'){const pa=s.pendingAction;if(pa){if(pa.kind==='give_second'){const o=this._activeOthers(s,pa.from).filter(i=>!s.players[i].second);s.pendingAction=null;if(o.length){s.players[o[0]].second=true;if(pa.card)s.players[o[0]].tableau.push(pa.card);this._emit(s,{type:'second_pass',from:pa.from,to:o[0],card:pa.card,auto:true});}else this._emit(s,{type:'second_discard',player:pa.from});}else this._resolve(s,pa.from,pa.kind,pa.from,true);}}}s.flip3Left=0;s.flip3Target=-1;}
  _advance(s){if(this._activeCount(s)===0){this._score(s);return;}s.current=this._firstActive(s,(s.current+1)%s.players.length);}
  _score(s){let f7=-1;for(const p of s.players){if(p.status==='busted'){p.roundScore=0;continue;}const u=new Set(p.nums).size;let base=p.nums.reduce((a,b)=>a+b,0);if(p.mods.includes('x2'))base*=2;for(const m of p.mods)if(m[0]==='+')base+=parseInt(m.slice(1));if(u>=7){base+=15;f7=1;}p.roundScore=base;p.banked+=base;}s.pendingAction=null;s.flip3Left=0;s.flip3Target=-1;s.phase=s.players.some(p=>p.banked>=200)?'GAME_OVER':'ROUND_END';const mx=Math.max(...s.players.map(p=>p.banked));this._emit(s,{type:s.phase==='GAME_OVER'?'game_over':'round_end',winners:s.players.map((p,i)=>p.banked===mx?i:-1).filter(i=>i>=0),flip7:f7});}
  apply(seat,msg){const s=this.s;s.events=[];if(s.phase!=='PLAY')return;
    if(s.pendingAction){const pa=s.pendingAction;if(msg.action==='target'&&pa.from===seat){const t=msg.target|0;if(!s.players[t]||s.players[t].status!=='active')return;if(pa.kind==='give_second'){if(t===seat)return;s.pendingAction=null;s.players[t].second=true;if(pa.card)s.players[t].tableau.push(pa.card);this._emit(s,{type:'second_pass',from:seat,to:t,card:pa.card,auto:false});}else{this._resolve(s,seat,pa.kind,t);this._advance(s);}}return;}
    if(seat!==s.current||s.players[seat].status!=='active')return;
    if(msg.action==='stay'){s.players[seat].status='stayed';this._emit(s,{type:'stay',player:seat});this._advance(s);}
    else if(msg.action==='hit'){const prob=this._bustProb(s,seat);const card=this._draw(s);this._emit(s,{type:'draw_start',player:seat,prob});const r=this._apply(s,seat,card,{});if(r==='action'){return;}this._advance(s);}
  }
  next(){const s=this.s;const over=s.phase==='GAME_OVER';const ns=this._fresh(s.players.map(p=>p.name),over?s.players.map(()=>0):s.players.map(p=>p.banked));ns.seq=s.seq+1;if(!over)ns.round=s.round+1;this.s=ns;}
  viewFor(seat){const s=this.s;const over=s.phase==='GAME_OVER';let summary;if(s.phase==='ROUND_END'||s.phase==='GAME_OVER'){const mx=Math.max(...s.players.map(p=>p.banked));summary={rows:s.players.map((p,i)=>({seat:i,name:p.name,score:p.banked,delta:p.roundScore})),winners:s.players.map((p,i)=>p.banked===mx?i:-1).filter(i=>i>=0)};}
    const live=p=>{if(p.status==='busted')return 0;let b=p.nums.reduce((a,c)=>a+c,0);if(p.mods.includes('x2'))b*=2;for(const m of p.mods)if(m[0]==='+')b+=parseInt(m.slice(1));if(new Set(p.nums).size>=7)b+=15;return b;};
    return{game:'flip7',phase:s.phase,over,yourSeat:seat,summary,flip7:{round:s.round,current:s.current,phase:s.phase,pendingAction:s.pendingAction,viewerSeat:seat,deckCount:s.deck.length,discardCount:s.discard.length,seq:s.seq,events:s.events,players:s.players.map(p=>({name:p.name,nums:[...p.nums],mods:[...p.mods],second:p.second,cards:this._ordered(p).map(c=>({id:c.id,kind:c.kind,v:c.v})),status:p.status,bustCard:p.bustCard,banked:p.banked,unique:new Set(p.nums).size,live:live(p)}))}};}
}

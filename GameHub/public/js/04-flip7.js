/* -------------------- FLIP 7 client (event-timeline) — GameClientFramework migration -------------------- */
(function(){
  window.GameRules['flip7']={title:'🎴 Flip 7',quick:'Push your luck — race to 200.',steps:['On your turn choose <b>Hit</b> (draw a card) or <b>Stay</b> (bank your points, you're out for the round).','Number cards: there's one 0, two 2s, three 3s … twelve 12s. Draw a <b>duplicate number → BUST</b> (score 0 this round).','Get <b>7 unique numbers → Flip 7!</b> +15 bonus and the round ends instantly.','Modifiers (+2…+10, ×2) boost your score; ×2 doubles numbers first, then + adds on.','Action cards: <b>Freeze</b> (target banks &amp; is out), <b>Flip Three</b> (target draws 3), <b>Second Chance</b> (saves you from one bust).','Round ends when all players bust/stay or someone Flip 7s. First to 200 wins.'],tip:'High numbers are riskier (more copies in the deck). The 0 is always safe.'};
  function modText(m){return m==='x2'?'×2':m;}
  const NUMCOL=['#94a3b8','#38bdf8','#22d3ee','#34d399','#4ade80','#a3e635','#facc15','#fb923c','#f97316','#ef4444','#ec4899','#d946ef','#a855f7'];
  function numFace(n){return NUMCOL[Math.max(0,Math.min(12,n))];}
  const SPEED={cardReveal:560,flip3Gap:780,wiggleMin:350,wiggleMax:1700,actionFly:620,beat:420};
  function f7Spec(kind,val,{busted=false,cause=false}={}){
    let spec;
    if(kind==='num') spec={ bg:numFace(val), content:{ text:val, color:'#fff' } };
    else if(kind==='mod') spec= val==='x2'
      ? { bg:'#1f2937', border:'#f472b6', content:{ text:'×2', color:'#f472b6' } }
      : { bg:{gradient:['#fef3c7','#fcd34d']}, border:'#d97706', content:{ text:modText(val), color:'#7c4a03' } };
    else if(val==='second') spec={ bg:'#dc2626', border:'#ef4444', content:{ text:'♥', color:'#fbcfe8' } };
    else if(val==='freeze') spec={ bg:{gradient:['#bae6fd','#7dd3fc']}, border:'#38bdf8', content:{ text:'❄', color:'#0369a1' } };
    else if(val==='flip3')  spec={ bg:'#eaff00', border:'#d4e600', content:{ text:'F3', color:'#1a1a00', italic:true } };
    else spec={ content:{ text:val } };
    spec.zone='f7';
    const st=[]; if(busted)st.push('dim'); if(cause)st.push('shake','highlight');
    if(st.length)spec.state=st;
    return spec;
  }
  function cardEl(kind,val,opts={}){
    const c=Kit.Cards.el(f7Spec(kind,val,opts));
    if(kind!=='num'&&val) c.title = val==='second'?'Second Chance':val==='freeze'?'Freeze':val==='flip3'?'Flip Three':'';
    return c;
  }

  function addF7Card(row,kind,val,key,opts={}){
    const seat=row?.dataset?.f7Seat||'x';
    const id=`flip7:table:p${seat}:${key}`;
    const a=Kit.Cards.anchor(id, f7Spec(kind,val,opts));
    a.classList.add('registry-anchor');
    a.dataset.cardKey=key;
    a.dataset.act=String(val);
    row.appendChild(a);return a;
  }
  function syncF7Cards(){
    Kit.Cards.board('flip7:table:',{
      location:(anchor,index)=>({zone:'grid',player:Number(anchor.closest('[data-f7-seat]')?.dataset?.f7Seat)||0,slot:index}),
    });
  }
  function cmCardSlot(permId){ const c=Kit.CardManager.get(permId); return c&&c.location?c.location.slot:undefined; }
  async function flyDealCard(permId,seat,slot){
    let cmCard=Kit.CardManager.get(permId), deck=$('f7Deck');
    let destAnchor=document.querySelector(`[data-card-reg="${permId}"]`);
    for(let tries=0; (!deck||!destAnchor) && tries<3; tries++){
      await new Promise(r=>requestAnimationFrame(r));
      deck=$('f7Deck'); destAnchor=document.querySelector(`[data-card-reg="${permId}"]`);
      cmCard=Kit.CardManager.get(permId);
    }
    if(!cmCard||!destAnchor) return;
    if(!deck){ Kit.CardManager.sync(); return; }
    await Kit.Cards.deal(permId,deck,destAnchor,{
      duration:620, arc:46, onReveal:()=>SFX.flip(),
      toLocation:{zone:'grid',player:Number(seat)||0,slot},
    });
  }
  async function flyPermToDiscard(permId, face){
    const discard=$('f7Discard');
    const c=Kit.CardManager.get(permId);
    if(!discard||!c)return;
    const anchor=document.querySelector(`[data-card-reg="${permId}"]`);
    const prevVis=anchor?anchor.style.visibility:null;
    if(anchor)anchor.style.visibility='hidden';
    if(face){c.face={kind:face.kind,value:face.v};c.faceUp=true;}
    await Kit.Cards.toPile(permId,discard,{duration:480,arc:34,toLocation:{zone:'discard'}});
    Kit.CardManager.destroy(permId);
    if(anchor)anchor.style.visibility=prevVis||'';
    discard.classList.remove('land');void discard.offsetWidth;discard.classList.add('land');
  }
  function captureF7Layout(){ return Kit.CardBoard.snapshot('flip7:table:'); }
  function animateF7Layout(before){ Kit.CardBoard.playReflow(before,{duration:340}); }

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

  let eventFocus=null;
  let renderCtx=null;
  function boardOf(i){return document.querySelector(`[data-f7-seat="${i}"]`);}
  function rowOf(i){const b=boardOf(i);return b?b.querySelector('.f7-row'):null;}
  function rectOf(el){return el?el.getBoundingClientRect():null;}
  function cloneCard(card){return card?{kind:card.kind,v:card.v}:card;}
  function actionCardSourceEl(seat,kind){
    const row=rowOf(seat); if(!row)return null;
    const anchors=[...row.querySelectorAll('[data-card-reg]')];
    const a=anchors.find(x=>x.dataset.kind==='act'&&x.dataset.value===kind);
    return a ? (Kit.CardManager.get(a.dataset.cardReg)?.overlayEl||a) : row;
  }
  function actionCardPermId(seat,kind){
    const row=rowOf(seat); if(!row)return null;
    const a=[...row.querySelectorAll('[data-card-reg]')].find(x=>x.dataset.kind==='act'&&x.dataset.value===kind);
    return a&&Kit.CardManager.has(a.dataset.cardReg)?a.dataset.cardReg:null;
  }
  function makeActionTargetSlot(targetSeat,card){
    const row=rowOf(targetSeat); if(!row)return null;
    const ghost=cardEl(card?.kind||'act',card?.v||'flip3');
    ghost.classList.add('registry-anchor');ghost.style.visibility='hidden';
    const sibling=row.querySelector('.kc');
    if(sibling){ const w=getComputedStyle(sibling).getPropertyValue('--kc-w'); if(w&&w.trim()) ghost.style.setProperty('--kc-w', w.trim()); }
    row.appendChild(ghost);
    return ghost;
  }
  async function transferActionCard(e){
    const card=e.card||{kind:'act',v:e.actionKind};
    const kind=e.actionKind||card.v;
    const toEl=makeActionTargetSlot(e.target,card) || rowOf(e.target) || boardOf(e.target);
    const permId=actionCardPermId(e.actor,kind);
    if(permId){
      await Kit.CardBoard.fly(permId,{to:toEl,duration:SPEED.actionFly,spin:true,land:false,hideTarget:false,toLocation:{zone:'transit'}});
      Kit.CardManager.destroy(permId);
    }else{
      await flyF7Card(actionCardSourceEl(e.actor,kind),toEl,card,{startFaceDown:false,spin:true,duration:SPEED.actionFly});
    }
    if(toEl&&toEl.classList.contains('registry-anchor'))toEl.remove();
  }

  function renderF7PlayerCards(row,p,busted){
    const cards=Array.isArray(p.cards)?p.cards:null;
    if(cards&&cards.length){
      cards.forEach((c,idx)=>addF7Card(row,c.kind,c.v,c.id||('card-'+idx+'-'+c.kind+'-'+c.v),{busted}));
    }else{
      p.nums.forEach(n=>addF7Card(row,'num',n,'num-'+n,{busted}));
      p.mods.forEach((m,mi)=>addF7Card(row,'mod',m,'mod-'+mi+'-'+m,{busted}));
      if(p.second)addF7Card(row,'act','second','second');
      (p.actionCards||[]).forEach((a,ai)=>addF7Card(row,'act',a,'act-'+ai+'-'+a));
    }
    if(busted&&p.bustCard!=null)addF7Card(row,'num',p.bustCard,'bust-'+p.bustCard,{cause:true});
    (p.spentActions||[]).forEach((c,si)=>{const a=addF7Card(row,'act',c.v,c.id||('spent-'+si+'-'+c.v),{busted:true});a.classList.add('f7-spent');});
  }

  // ── Register with the framework ──────────────────────────────────────
  // Flip 7 is the most complex client. The framework handles card reconciliation
  // and mini boards, but the event timeline, permanent card system, and live
  // view management are deeply game-specific and remain custom.

  GameClientFramework.register('flip7', {
    cards(view) {
      // Flip 7 cards are managed by the permanent card system during animation,
      // not through the framework's reconcileCards. Return empty to avoid conflicts.
      return [];
    },
    cardSpec() { return null; },

    // Custom board rendering
    renderBoard(view) {
      const s=view.flip7,viewer=s.viewerSeat;
      const focus = viewer>=0 ? viewer : s.current;
      const wrap=document.createElement('div');
      wrap.className='player-board f7-focus-board';
      wrap.innerHTML=`<div class="muted">Flip 7 board</div>`;
      return wrap;
    },

    unmount() {
      invalidateToken();
      Kit.Controls.clear('f7Controls');
      const d=$('f7DealerWrap');if(d)d.remove();
      const mini=$('miniBoardsContainer');if(mini){mini.innerHTML='';mini.className='mini-boards-container';}
    },
  });

  // ── Full custom render: the event timeline is too specialized for the
  //    generic framework render path. We keep the original render logic
  //    and just use the framework for card identity + mini board chrome. ──

  const baseClient = window.GameClients['flip7'];

  function miniDOM(s,p,i,viewer,pending){
    const busted=p.status==='busted';
    const row=document.createElement('div');row.className='f7-row';row.dataset.f7Seat=i;
    if(!(p.cards&&p.cards.length)&&!p.nums.length&&!p.mods.length&&!p.second)row.innerHTML='<span class="f7-empty">no cards</span>';
    renderF7PlayerCards(row,p,busted);
    const canTarget=pending&&p.status==='active'&&!(s.pendingAction.kind==='give_second'&&i===viewer);
    const b=Kit.MiniBoard({
      name:p.name, badge:(busted?'BUST':'Now '+p.live)+' · '+p.banked,
      headExtra:p.status, active:s.current===i, dim:busted,
      seat:i, variant:'f7', body:row,
      onClick:()=>canTarget?(net.spectating?null:act(viewer,{action:'target',target:i})):inspect(i),
    });
    b.dataset.f7Seat=i;
    if(canTarget)b.classList.add('targetable');
    return b;
  }

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
    const top=s.discardTop;
    const discFace=top?(()=>{const kind=top.kind==='num'?'num':top.kind==='mod'?'mod':'act';const el=cardEl(kind,top.v);el.classList.add('f7-discard-card');return el.outerHTML;})():'';
    const center=s.phase==='PLAY'?`<div id="f7DealerWrap" class="f7-dealer"><div class="pile-label">Dealer</div><div class="f7-piles"><div class="f7-pile-col"><div id="f7Deck" class="f7-deck"><span class="cnt">deck ${esc(s.deckCount)}</span></div></div><div class="f7-pile-col"><div id="f7Discard" class="f7-discard${top?'':' empty'}">${discFace}<span class="cnt">discard ${esc(s.discardCount)}</span></div></div></div></div>`:'';
    GameShell.renderTable({game:'flip7',opponents:miniFrag,center,focus:mainFrag,status:'',topMode:s.phase==='PLAY'?'custom':'hidden',opponentClass:'f7-mini-strip'});
    syncF7Cards();
    drawControls(view);
  }

  function inspect(seat){
    const view=window._renderView;if(!view||view.game!=='flip7')return;
    const s=view.flip7,p=s.players[seat];if(!p)return;
    const seats=s.players.map((_,i)=>i).filter(i=>i!==view.flip7.viewerSeat);
    const idx=seats.indexOf(seat),prev=seats[(idx-1+seats.length)%seats.length],next=seats[(idx+1)%seats.length];
    const row=(p.cards&&p.cards.length?p.cards.map(c=>cardEl(c.kind,c.v,{busted:p.status==='busted'})):[...p.nums.map(n=>cardEl('num',n,{busted:p.status==='busted'})),...p.mods.map(m=>cardEl('mod',m,{busted:p.status==='busted'})),...(p.second?[cardEl('act','second')]:[]),...(p.actionCards||[]).map(a=>cardEl('act',a))]);
    const cards=document.createElement('div');cards.className='f7-row';row.forEach(c=>cards.appendChild(c));
    const box=GameShell.inspect(`<div class="inspect-head"><button class="icon-btn" onclick="window.GameClients['flip7'].inspect(${prev})">‹</button><b>${esc(p.name)} · ${esc(p.status)}</b><button class="icon-btn" onclick="window.GameClients['flip7'].inspect(${next})">›</button><button class="icon-btn" onclick="GameShell.closeInspect()">✕</button></div><div class="player-board f7-focus-board"><div class="board-header"><span>${esc(p.name)}</span><span class="score-badge">Now ${esc(p.live)} · Total ${esc(p.banked)} · ${esc(p.unique)}/7</span></div></div>`);
    box.querySelector('.player-board').appendChild(cards);
  }

  function drawControls(view){
    const s=view.flip7,viewer=s.viewerSeat;
    const myTurn=s.phase==='PLAY'&&s.current===viewer&&s.players[viewer]&&s.players[viewer].status==='active'&&!s.pendingAction;
    const pending=s.pendingAction&&s.pendingAction.from===viewer;
    const hitStay=(seat)=>Kit.Controls.set([
      {label:'Hit',kind:'green',onClick:()=>act(seat,{action:'hit'})},
      {label:'Stay',kind:'secondary',onClick:()=>act(seat,{action:'stay'})},
    ],{id:'f7Controls'});
    Kit.Controls.clear('f7Controls');
    if(net.spectating){Kit.Status.set({text:'👁 Spectating — you\'ll join next round',tone:'warn'});}
    else if(s.phase==='ROUND_END'||s.phase==='GAME_OVER'){
      if(mode==='local'||net.isHost)Kit.Status.set({button:{label:s.phase==='GAME_OVER'?(mode==='local'?'Play Again':'New Game'):'Next Round',onClick:()=>mode==='local'?localNext():net.send({type:'next_round'})}});
      else Kit.Status.set({text:'Waiting for host…',tone:'muted'});
    }
    else if(pending){
      const k=s.pendingAction.kind;
      Kit.Status.set({text:(k==='freeze'?'❄ Choose who to Freeze':k==='flip3'?'🔃 Choose who flips 3':'♥ Give Second Chance to an opponent')+' (tap a player)',tone:'warn'});
    }
    else if(myTurn){Kit.Status.set({text:'Your turn — Hit or Stay',tone:'go'});hitStay(viewer);}
    else if(mode==='local'){const cur=s.players[s.current];
      if(s.pendingAction){const k=s.pendingAction.kind;Kit.Status.set({text:esc(cur.name)+': '+(k==='freeze'?'Freeze ❄':k==='flip3'?'Flip 3':'Give ♥')+' — tap a player',tone:'warn'});}
      else{Kit.Status.set({text:(cur?cur.name:'')+'\'s turn',tone:'go'});
        if(s.phase==='PLAY'&&cur&&cur.status==='active')hitStay(s.current);}}
    else Kit.Status.set({text:'Waiting for '+(s.players[s.current]?.name||'…'),tone:'info'});
  }

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
        const f=1+(t/dur)*3;
        c.style.transform='translateX('+(Math.sin(t/(40/f))*amp)+'px) rotate('+(Math.sin(t/(55/f))*amp*0.4)+'deg)';
        requestAnimationFrame(tick);})();
    });
  }

  async function flyF7Card(fromEl,toEl,card,{duration=620,spin=true}={}){
    await Kit.CardManager.flyTransient(fromEl,toEl,{render:()=>{const el=cardEl(card?.kind||'num',card?.v??'?');el.classList.add('f7-flying-card');return el;},spin,duration,land:false});
  }

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

  // ── Permanent Card System ──
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
  function orderCards(cards){
    const rank=c=>c.kind==='num'?0:c.kind==='mod'?1:2;
    return [...cards].sort((a,b)=>{const r=rank(a)-rank(b);if(r)return r;if(a.kind==='num'&&b.kind==='num')return a.v-b.v;return String(a.v).localeCompare(String(b.v));});
  }
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

  // ── Event runner ──
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
    if(mode==='local'&&view.flip7.phase==='PLAY'&&!view.flip7.pendingAction&&view.flip7.current!==view.flip7.viewerSeat){
      setTimeout(()=>{ if(tokenAlive(token) && mode==='local'&&localGameId==='flip7') renderLocal(); }, 650);
    }
  }
  function maybeSummary(view){
    const s=view.flip7;
    if(s.phase==='ROUND_END'||s.phase==='GAME_OVER'){if(!summaryShown){summaryShown=true;showSummary(view);}Kit.Controls.clear('f7Controls');}
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
        removeCard(liveView.flip7.players[e.actor],e.card); recalcAll(liveView);
        draw(liveView);
        const row=rowOf(e.actor); if(e.flip3)await sleep(SPEED.flip3Gap*0.2); if(!tokenAlive(token)) return;
        const before=captureF7Layout();
        advanceLiveView(liveView,e);
        draw(liveView);
        animateF7Layout(before);
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
        if(mode==='local')eventFocus=e.actor;
        const bp=liveView.flip7.players[e.actor];
        const dupId=`bust-${e.value}`;
        const lp=bp; lp.cards=Array.isArray(lp.cards)?lp.cards:[];
        if(!lp.cards.some(c=>c.id===dupId)) lp.cards=orderCards([...lp.cards,{id:dupId,kind:'num',v:e.value}]);
        recalcAll(liveView);
        draw(liveView);
        const bustPermId=`flip7:table:p${e.actor}:${dupId}`;
        await flyDealCard(bustPermId,e.actor,cmCardSlot(bustPermId));
        if(!tokenAlive(token)) return;
        lp.cards=lp.cards.filter(c=>c.id!==dupId);
        advanceLiveView(liveView,e);
        draw(liveView);
        SFX.bad();
        const b=boardOf(e.actor); if(b){b.style.animation='shakeX .5s ease';setTimeout(()=>b&&(b.style.animation=''),520);}
        Kit.turnBanner((liveView.flip7.players[e.actor]?.name||'')+' BUST!',false);
        await sleep(SPEED.beat); break;
      }
      case 'effect.freeze_done':{
        advanceLiveView(liveView,e); draw(liveView);
        const b=boardOf(e.target); if(b){b.style.transition='filter .3s';b.style.filter='brightness(1.4) saturate(1.4)';setTimeout(()=>b&&(b.style.filter=''),350);} await sleep(SPEED.beat*0.4); break;
      }
      case 'effect.second_used':{
        if(mode==='local')eventFocus=e.actor;
        const sp=liveView.flip7.players[e.actor];
        SFX.good(); Kit.turnBanner('Second Chance!',true);
        const secAnchor0=document.querySelector(`[data-card-reg^="flip7:table:p${e.actor}:"][data-act="second"]`);
        const secPerm=secAnchor0?secAnchor0.dataset.cardReg:null;
        const discardEl=$('f7Discard');
        if(secPerm && Kit.CardManager.has(secPerm)){
          await flyPermToDiscard(secPerm,{kind:'act',v:'second'}); if(!tokenAlive(token)) return;
        } else {
          const fromEl=rowOf(e.actor)||boardOf(e.actor);
          if(fromEl && discardEl){ await flyF7Card(fromEl,discardEl,{kind:'act',v:'second'},{spin:true,duration:SPEED.actionFly}); if(!tokenAlive(token)) return; }
        }
        const dupId='second-dup-'+e.seq;
        sp.cards=Array.isArray(sp.cards)?sp.cards:[];
        if(!sp.cards.some(c=>c.id===dupId)) sp.cards=orderCards([...sp.cards,{id:dupId,kind:'num',v:e.value}]);
        recalcAll(liveView); draw(liveView);
        const dupPerm=`flip7:table:p${e.actor}:${dupId}`;
        await flyDealCard(dupPerm,e.actor,cmCardSlot(dupPerm)); if(!tokenAlive(token)) return;
        await sleep(SPEED.beat*0.4);
        await flyPermToDiscard(dupPerm,{kind:'num',v:e.value}); if(!tokenAlive(token)) return;
        sp.cards=(sp.cards||[]).filter(c=>c.id!==dupId && c.v!=='second');
        advanceLiveView(liveView,e);
        recalcAll(liveView);
        draw(liveView);
        await sleep(SPEED.beat*0.4); break;
      }
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

  // ── Main render entry point ──
  let prevView=null, curView=null;
  function render(view,ctx={}){
    renderCtx=ctx;
    const token=currentToken();
    if(prevView&&prevView.flip7&&view.flip7.phase==='PLAY'&&view.flip7.current!==prevView.flip7.current&&(!view.flip7.events||!view.flip7.events.length)){
      const mine=view.flip7.current===view.flip7.viewerSeat;Kit.turnBanner(mine?'Your turn!':(view.flip7.players[view.flip7.current]?.name+"'s turn"),mine);bumpStatus();if(mine)SFX.yourTurn();
    }
    playEvents(view, token);
  }
  function act(seat,msg){ GameActions.act(seat,msg); }
  function clientAct(action, extra={}){
    const seat = window._renderView?.yourSeat ?? 0;
    GameActions.send(action, extra, seat);
  }
  window._flip7ResetSeq=function(){lastSeq=-1;invalidateToken();};
  function unmount(){invalidateToken(); Kit.Controls.clear('f7Controls');const d=$('f7DealerWrap');if(d)d.remove();const mini=$('miniBoardsContainer');if(mini){mini.innerHTML='';mini.className='mini-boards-container';}}

  // Override the framework-generated client with our full custom implementation
  // Pattern kept for test compatibility
  window.GameClients['flip7']={render,inspect,unmount,act:clientAct};
})();

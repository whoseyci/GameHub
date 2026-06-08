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
  function boardOf(i){return document.querySelector(`[data-f7-seat="${i}"]`);}
  function rowOf(i){const b=boardOf(i);return b?b.querySelector('.f7-row'):null;}
  function rectOf(el){return el?el.getBoundingClientRect():null;}

  // ---- static board render from state ----
  function draw(view){
    removeQwixxUi();
    const s=view.flip7,viewer=s.viewerSeat;
    $('topArea').style.display='none';
    const mini=$('miniBoardsContainer');mini.innerHTML='';mini.classList.add('f7-mini-strip');
    // dealer pile
    let dealerWrap=$('f7DealerWrap');
    if(!dealerWrap){dealerWrap=document.createElement('div');dealerWrap.id='f7DealerWrap';dealerWrap.className='f7-dealer';
      dealerWrap.innerHTML='<div class="pile-label">Dealer</div><div id="f7Deck" class="f7-deck"><span class="cnt"></span></div>';
      $('topArea').parentNode.insertBefore(dealerWrap,$('topArea'));}
    dealerWrap.style.display=(s.phase==='PLAY')?'flex':'none';
    const cntEl=dealerWrap.querySelector('.cnt');if(cntEl)cntEl.textContent='deck '+s.deckCount+' \u00b7 out '+s.discardCount;
    const main=$('mainBoardsContainer');main.innerHTML='';
    const pending=s.pendingAction&&s.pendingAction.from===viewer;
    const focus = eventFocus!=null ? eventFocus : (window._f7InspectSeat!=null ? window._f7InspectSeat : (mode==='local' ? s.current : (viewer>=0 ? viewer : s.current)));
    s.players.forEach((p,i)=>{
      if(i!==focus){mini.appendChild(miniDOM(s,p,i,viewer,pending));return;}
      const wrap=document.createElement('div');const busted=p.status==='busted';
      wrap.className='player-board f7-focus-board'+(s.current===i&&s.phase==='PLAY'?' active-turn':'')+(i===viewer?' me':'');
      wrap.dataset.f7Seat=i;
      if(busted)wrap.style.opacity='.85';
      const head=document.createElement('div');head.className='board-header';
      head.innerHTML='<span>'+p.name+(i===viewer?' (You)':'')+' <span class="f7-status '+p.status+'">'+p.status+'</span></span><span class="score-badge">'+(busted?'BUST':'Now: '+p.live)+' \u00b7 Total: '+p.banked+'</span>';
      wrap.appendChild(head);
      const row=document.createElement('div');row.className='f7-row';
      if(!p.nums.length&&!p.mods.length&&!p.second)row.innerHTML='<span class="f7-empty">no cards yet</span>';
      p.nums.forEach(n=>row.appendChild(cardEl('num',n,{busted})));
      if(busted&&p.bustCard!=null)row.appendChild(cardEl('num',p.bustCard,{cause:true}));
      p.mods.forEach(m=>row.appendChild(cardEl('mod',m,{busted})));
      if(p.second)row.appendChild(cardEl('act','second'));
      wrap.appendChild(row);
      const meta=document.createElement('div');meta.className='muted';meta.style.cssText='margin-top:6px;font-size:.8rem';meta.textContent=p.unique+'/7 unique';wrap.appendChild(meta);
      const canTarget=pending&&p.status==='active'&&!(s.pendingAction.kind==='give_second'&&i===viewer);
      if(canTarget){wrap.style.cursor='pointer';wrap.style.outline='2px dashed #f59e0b';wrap.onclick=()=>net.spectating?null:act(viewer,{action:'target',target:i});}
      main.appendChild(wrap);
    });
    drawControls(view);
  }
  function miniDOM(s,p,i,viewer,pending){
    const b=document.createElement('button');b.className='f7-mini-board'+(s.current===i?' active':'')+(p.status==='busted'?' busted':'');
    b.onclick=()=>{window._f7InspectSeat=i;const oldView=window._renderView;if(oldView){const v=JSON.parse(JSON.stringify(oldView));v.flip7.viewerSeat=i;draw(v);}};
    const nums=p.nums.slice(0,10).map(n=>`<span class="f7-mini-card num">${n}</span>`).join('');
    const mods=p.mods.slice(0,4).map(m=>`<span class="f7-mini-card mod">${m}</span>`).join('');
    const second=p.second?'<span class="f7-mini-card act">♥</span>':'';
    b.innerHTML=`<div class="f7-mini-head"><b>${p.name}</b><span>${p.status}</span><em>${p.live}/${p.banked}</em></div><div class="f7-mini-cards">${nums}${mods}${second}</div><div class="f7-mini-bar"><span>${p.unique}/7</span><span>${p.status==='busted'?'BUST':''}</span></div>`;
    const canTarget=pending&&p.status==='active'&&!(s.pendingAction.kind==='give_second'&&i===viewer);
    if(canTarget){b.classList.add('targetable');b.onclick=()=>net.spectating?null:act(viewer,{action:'target',target:i});}
    return b;
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
      if(s.pendingAction){const k=s.pendingAction.kind;sb.innerHTML='<span style="color:#f59e0b">'+cur.name+': '+(k==='freeze'?'Freeze \u2744':k==='flip3'?'Flip 3':'Give \u2665')+' \u2014 tap a player</span>';}
      else{sb.innerHTML='<span style="color:#10b981">'+(cur?cur.name:'')+'\'s turn</span>';
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
  // deal a face-down card from the deck onto a player's row, then it stays hidden
  // until the caller reveals (we just animate the travel; the rebuilt board shows the real card)
  function dealTravel(toRowEl,card,seq='x'){
    return new Promise(async res=>{
      const deck=$('f7Deck');if(!deck||!toRowEl){res();return;}
      deck.classList.remove('deal');void deck.offsetWidth;deck.classList.add('deal');
      const ghost=cardEl(card?.kind||'num',card?.v??'?');
      toRowEl.appendChild(ghost);ghost.style.visibility='hidden';
      SFX.flip();
      await Kit.CardMotion.move('flip7:deal:'+seq,deck,ghost,{value:card?.v??'?',color:card?.kind==='num'?'#111827':card?.kind==='mod'?'#7c3aed':'#b45309',startFaceDown:true,revealMidway:true,spin:true,duration:620});
      ghost.remove();
      res();
    });
  }

  // ---- play an event timeline ----
  let lastSeq=-1;
  async function playEvents(view){
    const s=view.flip7; const ev=s.events||[];
    // only play events newer than what we've shown
    const fresh=ev.filter(e=>e.seq>lastSeq);
    if(!fresh.length){draw(view);prevView=view;curView=view;maybeSummary(view);return;}
    animating=true;
    for(const e of fresh){
      lastSeq=Math.max(lastSeq,e.seq);
      await playOne(e,view);
    }
    eventFocus=null;
    if(mode==='local') window._f7InspectSeat=null;
    animating=false;
    draw(view); // settle to authoritative state
    prevView=view;curView=view;
    maybeSummary(view);
    flushView();
  }
  function maybeSummary(view){
    const s=view.flip7;
    if(s.phase==='ROUND_END'||s.phase==='GAME_OVER'){if(!summaryShown){summaryShown=true;showSummary(view);}const c=$('f7Controls');if(c)c.innerHTML='';}
    else{summaryShown=false;hideOverlay();}
  }
  async function playOne(e,view){
    const s=view.flip7;
    switch(e.type){
      case 'draw_start':{ eventFocus=e.player; draw(view); SFX.draw(); await wiggleReveal(e.prob||0); break; }
      case 'card':{ eventFocus=e.player; draw(view); const row=rowOf(e.player); if(e.flip3)await sleep(SPEED.flip3Gap*0.2); await dealTravel(row,e.card,e.seq); break; }
      case 'bust':{ eventFocus=e.player; draw(view); SFX.bad(); const b=boardOf(e.player); if(b){b.style.animation='shakeX .5s ease';setTimeout(()=>b&&(b.style.animation=''),520);} Kit.turnBanner((s.players[e.player]?.name||'')+' BUST!',false); await sleep(SPEED.beat); break; }
      case 'flip7':{ SFX.win(); Kit.confetti(); Kit.turnBanner('FLIP 7! +15',true); await sleep(SPEED.beat); break; }
      case 'flip3_abandon':{ Kit.turnBanner('Flip 3 abandoned',false); await sleep(SPEED.beat*0.6); break; }
      case 'second_used':{ SFX.good(); Kit.turnBanner('Second Chance!',true); await sleep(SPEED.beat); break; }
      case 'stay':{ SFX.good(); break; }
      case 'action_card':{ eventFocus=e.player; draw(view); const row=rowOf(e.player); await dealTravel(row,{kind:'act',v:e.kind},e.seq); await sleep(SPEED.beat*0.2); break; }
      case 'play_action':{
        // first show the action card travelling board -> board, then apply the effect
        eventFocus=e.from; draw(view);
        const fromRow=rowOf(e.from),toRow=rowOf(e.target);
        await Kit.CardMotion.move('flip7:action:'+e.seq,fromRow,toRow,{value:e.kind,color:'#b45309',startFaceDown:false,spin:true,duration:SPEED.actionFly});
        eventFocus=e.target; draw(view);
        actionVfx(e.kind); SFX[e.kind==='freeze'?'discard':'triplet']();
        if(e.auto)Kit.turnBanner((e.kind==='freeze'?'\u2744 ':'\ud83d\udd03 ')+'on self!',false);
        await sleep(SPEED.beat*0.5); break;
      }
      case 'freeze_done':{ const b=boardOf(e.target); if(b){b.style.transition='filter .3s';b.style.filter='brightness(1.4) saturate(1.4)';setTimeout(()=>b&&(b.style.filter=''),350);} await sleep(SPEED.beat*0.4); break; }
      case 'second_pass':{ SFX.flip(); const fromRow=rowOf(e.from),toRow=rowOf(e.to); await fly(fromRow,toRow,()=>cardEl('act','second'),SPEED.actionFly); if(e.auto)Kit.turnBanner('\u2665 passed',true); await sleep(SPEED.beat*0.4); break; }
      case 'second_discard':{ await sleep(SPEED.beat*0.3); break; }
      case 'reshuffle':{ Kit.turnBanner('Deck reshuffled',false); await sleep(SPEED.beat); break; }
      default: break;
    }
  }

  function render(view){
    // turn banner on turn change (only when not mid-animation start)
    if(prevView&&prevView.flip7&&view.flip7.phase==='PLAY'&&view.flip7.current!==prevView.flip7.current&&(!view.flip7.events||!view.flip7.events.length)){
      const mine=view.flip7.current===view.flip7.viewerSeat;Kit.turnBanner(mine?'Your turn!':(view.flip7.players[view.flip7.current]?.name+"'s turn"),mine);bumpStatus();if(mine)SFX.yourTurn();
    }
    playEvents(view);
  }
  function act(seat,msg){ if(mode==='local')localAct(seat,msg); else net.send({type:'action',...msg}); }
  // reset the timeline cursor when (re)entering a game
  window._flip7ResetSeq=function(){lastSeq=-1;};
  window.GameClients['flip7']={render};

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
  _emit(s,e){e.seq=++s.seq;s.events.push(e);}
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
    return{game:'flip7',phase:s.phase,over,yourSeat:seat,summary,flip7:{round:s.round,current:s.current,phase:s.phase,pendingAction:s.pendingAction,viewerSeat:seat,deckCount:s.deck.length,discardCount:s.discard.length,seq:s.seq,events:s.events,players:s.players.map(p=>({name:p.name,nums:p.nums,mods:p.mods,second:p.second,status:p.status,bustCard:p.bustCard,banked:p.banked,unique:new Set(p.nums).size,live:live(p)}))}};}
}

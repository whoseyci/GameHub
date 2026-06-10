/* -------------------- SKYJO client -------------------- */
(function(){
  window.GameRules['skyjo']={title:'🃏 Skyjo',quick:'Get the LOWEST score.',steps:['Each player has a 4×3 grid of face-down cards. Flip 2 to start.','On your turn: take the <b>Deck</b> card or the <b>Discard</b> top, then either swap it onto your grid (discarding the old card) — or, if from the deck, discard it and flip one face-down card.','Three of the same number in a column clear (count as 0).','When someone reveals their whole grid, everyone else gets one last turn.','Lowest total wins the round. First to 100 ends the game — lowest total wins.'],tip:'Dump high cards, keep low/negative ones. Watch for column triplets!'};
  const C=Kit.cardColor;
  function boardEl(pi){return document.getElementById('main-board-'+pi)||document.getElementById('mini-board-'+pi);}
  function cardAt(pi,idx){const b=boardEl(pi);return b?b.querySelectorAll('.board-card')[idx]:null;}
  function skyjoSvg(kind,value=null,color=null){
    if(kind==='back')return `<svg class="card-svg" viewBox="0 0 100 142" aria-hidden="true"><rect x="4" y="4" width="92" height="134" rx="14" fill="url(#g)"/><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#6366f1"/><stop offset="1" stop-color="#4338ca"/></linearGradient></defs><text x="50" y="81" text-anchor="middle" font-size="42" font-weight="900" fill="#c7d2fe">✦</text></svg>`;
    return `<svg class="card-svg" viewBox="0 0 100 142" aria-hidden="true"><rect x="4" y="4" width="92" height="134" rx="14" fill="#fff"/><text x="50" y="85" text-anchor="middle" font-size="48" font-weight="900" font-family="system-ui,-apple-system,Segoe UI,sans-serif" fill="${color||'#111'}">${esc(value)}</text></svg>`;
  }
  function skyjoVisual(c){const el=document.createElement('div');if(c.cleared)el.className='board-card cleared';else if(c.revealed){el.className='board-card revealed svg-card';el.innerHTML=skyjoSvg('front',c.value,C(c.value));el.style.color=C(c.value);}else{el.className='board-card face-down svg-card';el.innerHTML=skyjoSvg('back');}return el;}
  function skyjoCardId(s,pi,ci){return `skyjo:table:r${s.round}:p${pi}:c${ci}`;}
  // The discard pile is a PERMANENT card (id 'skyjo:discard') pinned to #uiDiscard.
  // A card that goes to the discard is the REAL moving card — we fly it onto the
  // pile and rename it AS the discard's top (no transient throwaway; the previous
  // top is replaced by rename()).
  // Fly an existing managed card (by id) onto the discard pile, where it BECOMES
  // the permanent discard top. The old discard card is replaced. No clones.
  // Clear a column triplet by flying the THREE real board cards to the discard
  // pile (the last one becomes the discard top). No transient clones.
  async function clearTripletToDiscard(s,player,indices,value){
    if(boardEl(player))Kit.floatText(boardEl(player),'Triplet!','#eab308');
    SFX.triplet();
    const t=Date.now();
    // Adopt all three real board cards under moving ids, pinned at their slots.
    const moveIds=indices.map((ci,k)=>{
      const slotId=skyjoCardId(s,player,ci);
      const moveId='skyjo:trip'+k+':'+player+':'+ci+':'+t;
      const old=Kit.CardManager.get(slotId);
      Kit.CardManager.create({kind:'skyjo',value},{zone:'transit'},{id:moveId,renderer:()=>skyjoVisual({revealed:true,cleared:false,value}),faceUp:true});
      if(old&&old.anchor)Kit.CardManager.pin(moveId,old.anchor,{hideAnchor:false,updateContent:true});
      if(Kit.CardManager.has(slotId))Kit.CardManager.destroy(slotId);
      return moveId;
    });
    // 1) Shove them together into a tilted stack at the first card's anchor.
    const stackAnchor=document.querySelector(`[data-card-reg="${skyjoCardId(s,player,indices[0])}"]`)||cardAt(player,indices[0]);
    if(stackAnchor){
      await Promise.all(moveIds.map((id,k)=>k===0
        ? Promise.resolve()
        : Kit.CardManager.moveTo(id,stackAnchor,{duration:240,arc:18,land:false,hideTarget:false,toLocation:{zone:'transit'}})));
      // tilt the stacked overlays for a "gathered pile" look
      moveIds.forEach((id,k)=>{const c=Kit.CardManager.get(id);if(c&&c.overlayEl){c.overlayEl.style.zIndex=String(1000+k);c.overlayEl.style.transition='transform .15s var(--spring-soft)';c.overlayEl.style.transform=`rotate(${(k-1)*7}deg)`;}});
      await sleep(170);
    }
    // 2) Fly the whole stack to the discard together; the last becomes the top.
    const disc=$('uiDiscard');
    await Promise.all(moveIds.map((id,k)=>{
      const c=Kit.CardManager.get(id);if(c)c.renderer=()=>skyjoVisual({revealed:true,cleared:false,value});
      return Kit.CardManager.moveTo(id,disc,{duration:480,spin:true,land:false,hideTarget:true,toLocation:{zone:'discard'}});
    }));
    // Keep the top card as the permanent discard; remove the under-cards.
    moveIds.forEach((id,k)=>{ if(k===moveIds.length-1) Kit.CardManager.rename(id,'skyjo:discard',{zone:'discard'}); else if(Kit.CardManager.has(id)) Kit.CardManager.destroy(id); });
  }
  async function flyCardToDiscard(movingId,value,opts={}){
    const disc=$('uiDiscard');
    const c=Kit.CardManager.get(movingId);
    if(c)c.renderer=()=>skyjoVisual({revealed:true,cleared:false,value});
    await Kit.CardManager.moveTo(movingId,disc,{duration:opts.duration??520,spin:!!opts.spin,startFaceDown:!!opts.startFaceDown,revealMidway:!!opts.revealMidway,land:false,hideTarget:true,toLocation:{zone:'discard'}});
    // The landed card BECOMES the permanent discard top (rename — keeps the same
    // overlay, no destroy/recreate gap). Any previous top is replaced by rename().
    Kit.CardManager.rename(movingId,'skyjo:discard',{zone:'discard'});
  }
  async function revealSkyjoRegistryCard(id,value){
    const c=Kit.CardManager.get(id);
    if(!c||!c.overlayEl)return false;
    const back=skyjoVisual({revealed:false,cleared:false,value:null});
    c.overlayEl.className=back.className+' kit-card-registered';c.overlayEl.innerHTML=back.innerHTML;c.overlayEl.style.color='';
    c.overlayEl.classList.remove('anim-flip');void c.overlayEl.offsetWidth;c.overlayEl.classList.add('anim-flip');
    await sleep(210);
    c.faceUp=true;
    const front=skyjoVisual({revealed:true,cleared:false,value});
    c.overlayEl.className=front.className+' kit-card-registered anim-flip';c.overlayEl.innerHTML=front.innerHTML;c.overlayEl.style.color=C(value);
    await sleep(210);
    return true;
  }
  function syncSkyjoCards(s){const active=[];s.players.forEach((p,pi)=>p.board.forEach((c,ci)=>{const id=skyjoCardId(s,pi,ci),anchor=document.querySelector(`[data-card-reg="${id}"]`);if(anchor){active.push(id);
    // Use CardManager: create if new, update renderer + pin
    const makeRenderer=()=>()=>skyjoVisual(c);
    if(!Kit.CardManager.has(id)){
      Kit.CardManager.create({kind:'skyjo',value:c.value},{zone:'grid',player:pi,slot:ci},{id,renderer:makeRenderer(),faceUp:c.revealed});
    }else{
      const card=Kit.CardManager.get(id);if(card)card.renderer=makeRenderer();
    }
    Kit.CardManager.pin(id,anchor,{hideAnchor:false,updateContent:true});
  }}));Kit.CardManager.reconcile('skyjo:table:',active);requestAnimationFrame(()=>Kit.CardManager.sync());}

  let renderCtx=null;
  function render(view,ctx={}){
    renderCtx=ctx;
    removeQwixxUi();
    $('topArea').style.display=''; // Skyjo uses the deck/discard piles
    const piles = $('topArea').querySelector('.piles');
    if (piles) piles.style.display = 'flex';
    $('heldCardWrapper').style.display='';
    const f7=$('f7Controls');if(f7)f7.innerHTML='';const dw=$('f7DealerWrap');if(dw)dw.style.display='none';
    const s=view.skyjo; // engine state (personalized)
    const viewer=s.viewerIndex;
    const isPlay=s.phase==='PLAY'||s.phase==='FINAL_TURNS';
    const myTurn=isPlay&&s.currentPlayer===viewer&&viewer>=0;
    const ta=s.turnAction;

    // last round popup
    if(s.phase==='FINAL_TURNS'&&!lastRoundShown){lastRoundShown=true;const e=s.players[s.roundEnder]?.name||'A player';toast('🚨 LAST ROUND! '+e+' closed it out',3200);SFX.lastRound();}
    if(s.phase==='REVEAL'||s.phase==='PLAY')lastRoundShown=false;

    // turn banner
    if(isPlay&&prevView&&prevView.skyjo){
      const pv=prevView.skyjo,pPlay=pv.phase==='PLAY'||pv.phase==='FINAL_TURNS';
      if(ta===null&&(s.currentPlayer!==pv.currentPlayer||!pPlay)){const mine=s.currentPlayer===viewer;Kit.turnBanner(mine?'Your turn!':(s.players[s.currentPlayer]?.name+"'s turn"),mine);bumpStatus();if(mine)SFX.yourTurn();}
    }

    const prevForAnim=prevView?prevView.skyjo:null;
    const newAction=s.lastAction&&(!prevForAnim||JSON.stringify(prevForAnim.lastAction)!==JSON.stringify(s.lastAction));

    drawPiles(s,viewer,myTurn,ta);
    drawBoards(s,viewer);

    if(s.phase==='REVEAL'&&(!prevForAnim||prevForAnim.phase!=='REVEAL'||prevForAnim.round!==s.round))Kit.dealCascade();
    if(newAction)runAnim(s,viewer);

    if(s.phase==='ROUND_END'||s.phase==='GAME_OVER'){if(!summaryShown){summaryShown=true;showSummary(view);}}
    else{summaryShown=false;hideOverlay();}

    prevView=view;curView=view;
  }

  function drawPiles(s,viewer,myTurn,ta){
    const uiDeck=$('uiDeck'),uiDiscard=$('uiDiscard');
    $('deckCount').textContent=s.deckCount!=null?s.deckCount:'';
    uiDeck.classList.remove('pile-hint');uiDeck.onclick=null;uiDiscard.classList.remove('pile-hint');uiDiscard.onclick=null;

    // Everyone sees the deck-drawn card flipped face-up on the deck (publicDrawn).
    if(s.publicDrawn!=null&&viewer!==s.currentPlayer){uiDeck.className='card-slot revealed';uiDeck.textContent=s.publicDrawn;uiDeck.style.color=C(s.publicDrawn);uiDeck.style.borderColor='#fff';uiDeck.innerHTML=s.publicDrawn+'<span id="deckCount" class="deck-count">'+(s.deckCount||'')+'</span>';}
    else{uiDeck.className='card-slot face-down';uiDeck.style.color='';uiDeck.style.borderColor='';uiDeck.innerHTML='<span id="deckCount" class="deck-count">'+(s.deckCount||'')+'</span>';}

    if(myTurn&&ta===null){uiDeck.classList.add('pile-hint');uiDeck.onclick=()=>act(s.currentPlayer,{action:'draw_deck'});if(s.discardTop!==null){uiDiscard.classList.add('pile-hint');uiDiscard.onclick=()=>act(s.currentPlayer,{action:'take_discard'});}}
    else if(myTurn&&ta==='deck'){uiDiscard.classList.add('pile-hint');uiDiscard.onclick=()=>act(s.currentPlayer,{action:'discard_drawn'});}

    if(s.discardTop!==null){uiDiscard.className='card-slot revealed';uiDiscard.textContent=s.discardTop;uiDiscard.style.color=C(s.discardTop);uiDiscard.style.borderColor='#fff';if(myTurn&&ta==='deck')uiDiscard.classList.add('pile-hint');}
    else{uiDiscard.className='card-slot';uiDiscard.textContent='Empty';uiDiscard.style.color='';uiDiscard.style.borderColor='';}

    // held window
    const wrap=$('heldCardWrapper'),held=$('uiHeldCard');
    // skyjo:held lifecycle: created during draw animation, kept alive through
    // swap/discard animation, removed only after animation completes.
    // We must NOT remove it here — drawPiles runs BEFORE runAnim, so removing
    // would break the swap and discard_drawn fly animations.
    // Instead, we keep the wrapper visible while the registry card exists
    // (animation still pending) and hide it only after the card is cleaned up.
    if(myTurn&&(ta==='deck'||ta==='discard'||ta==='must_reveal')){
      wrap.classList.remove('hidden');
      if(ta==='must_reveal'){$('heldTextLabel').textContent='Discarded!';$('heldSubLabel').textContent='Now reveal a face-down card.';held.style.display='flex';held.textContent=s.lastAction&&s.lastAction.type==='discard_drawn'?s.lastAction.value:'';held.style.color=s.lastAction&&s.lastAction.type==='discard_drawn'?C(s.lastAction.value):'';held.style.borderColor='#fff';held.style.visibility='hidden';}
      else if(s.myDrawnCard!=null){held.style.visibility='';held.style.display='flex';held.textContent=s.myDrawnCard;held.style.color=C(s.myDrawnCard);held.style.borderColor='#fff';$('heldTextLabel').textContent=ta==='deck'?'Drew from Deck:':'Took from Discard:';$('heldSubLabel').textContent=ta==='deck'?'Tap a card to swap, or Discard to drop it.':'Tap a card to swap.';}
      else{held.style.visibility='';held.style.display='flex';held.textContent='?';held.style.color='';}
    } else {
      held.style.visibility='';
      // Only hide the wrapper when no registry card is alive — it means the
      // animation is complete (or never started).  Keeping the wrapper visible
      // while skyjo:held exists ensures the registry anchor (uiHeldCard) keeps
      // a valid layout rect for the upcoming swap/discard fly animation.
      if(!(typeof Kit!=='undefined'&&Kit.CardManager&&Kit.CardManager.has('skyjo:held'))){
        wrap.classList.add('hidden');
      }
    }

    // status bar
    const sb=$('statusBar');sb.style.color='var(--text)';
    if(net.spectating){sb.innerHTML='<span style="color:#f59e0b">👁 Spectating — you\'ll join next round</span>';}
    else if(s.phase==='REVEAL'){
      if(s.tiebreakerPlayers&&s.tiebreakerPlayers.length){const inTb=s.tiebreakerPlayers.includes(viewer);sb.textContent=mode==='local'?'Tie! Tied players flip 1 more card.':(inTb?'Tie! Flip 1 more card.':'Waiting for tiebreaker…');sb.style.color=(mode==='local'||inTb)?'var(--accent)':'var(--text)';}
      else sb.textContent=mode==='local'?'Everyone: flip 2 cards to begin.':'Flip 2 cards to begin.';
    }
    else if(s.phase==='ROUND_END'||s.phase==='GAME_OVER'){
      if(mode==='local'||net.isHost)sb.innerHTML=`<button class="btn" style="margin:0;padding:10px 20px" onclick="${mode==='local'?'localNext()':"net.send({type:'next_round'})"}">${s.phase==='GAME_OVER'?(mode==='local'?'Play Again':'New Game'):'Next Round'}</button>`;
      else sb.innerHTML='<span class="muted">Waiting for host…</span>';
    }
    else{
      if(ta==='turn_end_delay')sb.innerHTML='<span class="muted">Ending turn…</span>';
      else if(mode==='local')sb.innerHTML=`<span style="color:#10b981">${esc(s.players[s.currentPlayer].name)}'s turn!</span>`;
      else if(myTurn)sb.innerHTML='<span style="color:#10b981">Your turn!</span>';
      else sb.textContent='Waiting for '+s.players[s.currentPlayer].name+'…';
    }
  }

  function drawBoards(s,viewer){
    const ctx=renderCtx||{};
    let mainIdx=[];
    if(mode==='local'){
      const humanSeats=SeatModel.localHumanSeats();
      if(s.phase==='ROUND_END'||s.phase==='GAME_OVER')mainIdx=humanSeats.length?humanSeats:s.players.map((_,i)=>i);
      else if(s.phase==='REVEAL') mainIdx=humanSeats.length?humanSeats:[viewer>=0?viewer:0];
      else mainIdx=[ctx.focus?ctx.focus({actingSeat:s.currentPlayer,preferred:viewer}):(viewer>=0?viewer:(humanSeats[0]??s.currentPlayer??0))];
    }
    else if(viewer<0)mainIdx=[s.currentPlayer>=0?s.currentPlayer:0];
    else mainIdx=[viewer];
    const mainFrag=document.createDocumentFragment(),miniFrag=document.createDocumentFragment();
    s.players.forEach((p,pi)=>{
      const isMain=mainIdx.includes(pi);
      const interactive=(mode==='local'&&!((typeof localSeats!=='undefined')&&localSeats[pi]?.bot))||(pi===viewer);
      const dom=boardDOM(s,p,pi,isMain,interactive,viewer);
      (isMain?mainFrag:miniFrag).appendChild(dom);
    });
    GameShell.renderTable({game:'skyjo',opponents:miniFrag,focus:mainFrag,topMode:'piles',status:null});
    syncSkyjoCards(s);
  }

  function boardDOM(s,p,pi,isMain,interactive,viewer){
    const wrap=document.createElement('div');
    const active=s.currentPlayer===pi&&(s.phase==='PLAY'||s.phase==='FINAL_TURNS')&&isMain;
    wrap.className='player-board'+(isMain?'':' board-mini')+(active?' active-turn':'')+(pi===viewer&&isMain?' me':'');
    wrap.id=(isMain?'main':'mini')+'-board-'+pi;
    if(!isMain)wrap.onclick=()=>investigate(s,pi,viewer);
    const h=document.createElement('div');h.className='board-header';
    const live=p.board.filter(c=>c.revealed&&!c.cleared).reduce((a,c)=>a+c.value,0);
    h.innerHTML=`<span>${esc(p.name)}${pi===viewer?' (You)':''}</span><span class="score-badge">Now: ${esc(live)} · Total: ${esc(p.totalScore)}</span>`;
    wrap.appendChild(h);
    const grid=document.createElement('div');grid.className='board-grid';
    p.board.forEach((c,ci)=>{const card=document.createElement('div');
      card.className='board-card registry-anchor';card.dataset.cardReg=skyjoCardId(s,pi,ci);
      if(interactive&&isMain&&!c.cleared&&canClick(s,pi,ci,c,viewer)){card.classList.add('clickable');card.onclick=()=>cardClick(s,pi,ci,c);}
      grid.appendChild(card);});
    wrap.appendChild(grid);return wrap;
  }
  function canClick(s,pi,ci,c,viewer){
    if(s.phase==='REVEAL'){if(mode!=='local'&&pi!==viewer)return false;if(s.tiebreakerPlayers.length)return s.tiebreakerPlayers.includes(pi)&&!c.revealed&&!c.cleared;return s.players[pi].revealCount<2&&!c.revealed&&!c.cleared;}
    if(s.phase!=='PLAY'&&s.phase!=='FINAL_TURNS')return false;
    if(s.currentPlayer!==pi)return false;if(mode!=='local'&&pi!==viewer)return false;
    if(s.turnAction==='deck'||s.turnAction==='discard')return true;
    if(s.turnAction==='must_reveal')return !c.revealed;return false;
  }
  function cardClick(s,pi,ci,c){
    if(s.phase==='REVEAL'){act(pi,{action:s.tiebreakerPlayers.length?'tiebreaker':'reveal',index:ci});return;}
    if(s.turnAction==='deck'||s.turnAction==='discard')act(pi,{action:'swap',index:ci});
    else if(s.turnAction==='must_reveal'&&!c.revealed)act(pi,{action:'reveal_after_discard',index:ci});
  }
  // seat = which player's board was acted on (needed for local pass-and-play REVEAL,
  // where each player flips their OWN cards). Online ignores it (server uses the
  // authenticated connection's seat).
  function act(seat,msg){ GameActions.send(msg.action, Object.fromEntries(Object.entries(msg).filter(([k])=>k!=='action')), seat); }
  function clientAct(action, extra={}){
    const seat = window._renderView?.yourSeat ?? window._renderView?.skyjo?.currentPlayer ?? 0;
    GameActions.send(action, extra, seat);
  }

  async function runAnim(s,viewer){
    const a=s.lastAction;if(!a)return;
    if(a.type==='draw_deck'){ // everyone: card flips up on the deck (done in drawPiles via publicDrawn); active player also pulls into hand
      SFX.draw();
      if(a.player===viewer&&s.myDrawnCard!=null){animating=true;
        // Create a transient card for the flight
        if(!Kit.CardManager.has('skyjo:held')){
          Kit.CardManager.create({kind:'skyjo',value:s.myDrawnCard},{zone:'hand',player:viewer},{id:'skyjo:held',renderer:()=>skyjoVisual({revealed:true,cleared:false,value:s.myDrawnCard}),faceUp:true});
        }
        Kit.CardManager.pin('skyjo:held',$('uiDeck'),{hideAnchor:false,updateContent:true});
        await Kit.CardManager.moveTo('skyjo:held',$('uiHeldCard'),{duration:520,startFaceDown:true,revealMidway:true,hideTarget:true,land:false,toLocation:{zone:'hand',player:viewer}});
        // Clear the hidden state so sync() won't re-hide the held card anchor.
        Kit.CardManager.pin('skyjo:held',$('uiHeldCard'),{hideAnchor:false,updateContent:false});
        animating=false;flushView();}
      return;
    }
    if(a.type==='take_discard'){SFX.draw();if(a.player===viewer){animating=true;
      if(!Kit.CardManager.has('skyjo:held')){
        Kit.CardManager.create({kind:'skyjo',value:a.value},{zone:'hand',player:viewer},{id:'skyjo:held',renderer:()=>skyjoVisual({revealed:true,cleared:false,value:a.value}),faceUp:true});
      }
      Kit.CardManager.pin('skyjo:held',$('uiDiscard'),{hideAnchor:false,updateContent:true});
      await Kit.CardManager.moveTo('skyjo:held',$('uiHeldCard'),{duration:460,hideTarget:true,land:false,toLocation:{zone:'hand',player:viewer}});
      Kit.CardManager.pin('skyjo:held',$('uiHeldCard'),{hideAnchor:false,updateContent:false});
      animating=false;flushView();}return;}
    if(a.type==='swap'){animating=true;SFX.swap();const target=cardAt(a.player,a.index);
      // The displaced card is the REAL board card occupying this slot. Re-home its
      // permanent overlay under a moving id, fly THAT card to the discard pile
      // (where it becomes the discard top), then drop the held card into the slot.
      const slotId=skyjoCardId(s,a.player,a.index);
      const oldMovingId='skyjo:swapout:'+(a.t||Date.now());
      if(Kit.CardManager.has(slotId)){
        const old=Kit.CardManager.get(slotId);
        // Adopt the existing slot overlay under a moving id so it flies as the real card.
        Kit.CardManager.create({kind:'skyjo',value:a.oldVal},{zone:'transit'},{id:oldMovingId,renderer:()=>skyjoVisual({revealed:a.wasRevealed,cleared:false,value:a.oldVal}),faceUp:a.wasRevealed});
        if(old&&old.anchor)Kit.CardManager.pin(oldMovingId,old.anchor,{hideAnchor:false,updateContent:true});
        Kit.CardManager.destroy(slotId); // slot overlay handed off to the moving card
      }
      if(Kit.CardManager.has('skyjo:held')){
        $('uiHeldCard').style.visibility='hidden';
        const heldCard=Kit.CardManager.get('skyjo:held');
        if(heldCard)heldCard.renderer=()=>skyjoVisual({revealed:true,cleared:false,value:a.newVal});
        await Kit.CardManager.moveTo('skyjo:held',target,{duration:360,hideTarget:true,land:false,toLocation:{zone:'grid',player:a.player,slot:a.index}});
        // The held card BECOMES the slot's permanent card (rename, don't destroy) so
        // the new card stays visible immediately — not only after the discard flies.
        Kit.CardManager.rename('skyjo:held',slotId,{zone:'grid',player:a.player,slot:a.index});
      }
      if(Kit.CardManager.has(oldMovingId)) await flyCardToDiscard(oldMovingId,a.oldVal,{startFaceDown:!a.wasRevealed,revealMidway:!a.wasRevealed,spin:a.wasRevealed,duration:520});
      if(a.diff!=null&&a.diff!==0){const sg=a.diff>0?'+':'';Kit.floatText(boardEl(a.player),sg+a.diff,a.diff>0?'#10b981':'#ef4444');(a.diff>0?SFX.good:SFX.bad)();}
      // Handle chained triplet (swap triggered a column clear)
      if(a.triplet){await clearTripletToDiscard(s,a.player,a.triplet.indices,a.triplet.value);await sleep(150);}
      animating=false;flushView();return;}
    if(a.type==='discard_drawn'){animating=true;SFX.discard();
      // Hide DOM held card so only the overlay animates
      $('uiHeldCard').style.visibility='hidden';
      if(Kit.CardManager.has('skyjo:held')){
        const heldCard=Kit.CardManager.get('skyjo:held');
        if(heldCard)heldCard.renderer=()=>skyjoVisual({revealed:true,cleared:false,value:a.value});
      }
      await flyCardToDiscard('skyjo:held',a.value,{duration:520,spin:true});
      animating=false;flushView();return;}
    if(a.type==='reveal'||a.type==='reveal_after_discard'){const idx=a.card!=null?a.card:a.index,id=skyjoCardId(s,a.player,idx);SFX.reveal();if(!(await revealSkyjoRegistryCard(id,a.value))){const el=cardAt(a.player,idx);await Kit.CardManager.revealEl(el,a.value,{color:C(a.value)});}return;}
    if(a.type==='triplet'){animating=true;await clearTripletToDiscard(s,a.player,a.indices,a.value);await sleep(150);animating=false;flushView();return;}
  }
  function investigate(s,pi,viewer){
    const seats=s.players.map((_,i)=>i).filter(i=>i!==viewer);
    const idx=seats.indexOf(pi),prev=seats[(idx-1+seats.length)%seats.length],next=seats[(idx+1)%seats.length];
    const box=$('investigateBox');box.innerHTML=`<div class="inspect-head"><button class="icon-btn" onclick="window._skyjoInspect(${prev})">‹</button><b>${esc(s.players[pi].name)}</b><button class="icon-btn" onclick="window._skyjoInspect(${next})">›</button><button class="icon-btn" onclick="$('investigateOverlay').classList.add('hidden')">✕</button></div>`;
    box.appendChild(boardDOM(s,s.players[pi],pi,true,false,viewer));
    window._skyjoLastInspect={s,viewer};window._skyjoInspect=(seat)=>investigate(window._skyjoLastInspect.s,seat,window._skyjoLastInspect.viewer);
    $('investigateOverlay').classList.remove('hidden');
  }

  function unmount(){const mini=$('miniBoardsContainer');if(mini)mini.innerHTML='';}
  window.GameClients['skyjo']={render,unmount,act:clientAct};

  /* ---- Local engine wrapper for Skyjo (offline play; mirrors server module) ---- */
  // Minimal port of the engine just for local mode (no network).
  window.LocalEngines['skyjo']=function(names){
    const E=new SkyjoEngine(names);E.start();
    return {
      apply(seat,msg){
        if(msg.action==='reveal')E.revealInitial(seat,msg.index);
        else if(msg.action==='tiebreaker')E.revealTiebreaker(seat,msg.index);
        else if(msg.action==='draw_deck')E.drawDeck(seat);
        else if(msg.action==='take_discard')E.takeDiscard(seat);
        else if(msg.action==='swap')E.swap(seat,msg.index);
        else if(msg.action==='discard_drawn')E.discardDrawnCard(seat);
        else if(msg.action==='reveal_after_discard')E.revealAfterDiscard(seat,msg.index);
        // auto-complete deferred turn-end locally
        if(E.turnAction==='turn_end_delay')setTimeout(()=>{E.completeTurnEnd();renderLocal();},1200);
      },
      next(){if(E.phase==='GAME_OVER')E.newGame();else E.nextRound();},
      actor(){return E.currentPlayer;},
      viewFor(seat){const s=E.getStateFor(seat);const over=E.phase==='GAME_OVER';let summary;if(E.phase==='ROUND_END'||E.phase==='GAME_OVER'){const min=Math.min(...E.players.map(p=>p.totalScore));summary={rows:E.players.map((p,i)=>({seat:i,name:p.name,score:p.totalScore,delta:p.roundScore})),winners:E.players.map((p,i)=>p.totalScore===min?i:-1).filter(i=>i>=0)};}return{game:'skyjo',phase:E.phase,over,yourSeat:seat,summary,skyjo:s};}
    };
  };
})();

/* ---- Skyjo engine (client copy, used ONLY for local offline play) ---- */
function skyjoDeck(){const d=[];for(let i=0;i<5;i++)d.push(-2);for(let i=0;i<10;i++)d.push(-1);for(let i=0;i<15;i++)d.push(0);for(let v=1;v<=12;v++)for(let i=0;i<10;i++)d.push(v);for(let i=d.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[d[i],d[j]]=[d[j],d[i]];}return d;}
class SkyjoEngine{
  constructor(names){this.players=names.map(n=>({name:n,board:Array.from({length:12},()=>({value:0,revealed:false,cleared:false})),roundScore:0,totalScore:0,revealCount:0}));this.deck=[];this.discard=[];this.phase='REVEAL';this.round=1;this.currentPlayer=0;this.roundEnder=-1;this.finalTurnsLeft=0;this.drawnCard=null;this.turnAction=null;this.tiebreakerPlayers=[];this.lastAction=null;this.pendingTransition=null;}
  _deal(){this.deck=skyjoDeck();for(const p of this.players){for(const c of p.board){c.value=this.deck.pop();c.revealed=false;c.cleared=false;}p.revealCount=0;p.roundScore=0;}this.discard=[this.deck.pop()];this.phase='REVEAL';this.roundEnder=-1;this.finalTurnsLeft=0;this.currentPlayer=0;this.drawnCard=null;this.turnAction=null;this.tiebreakerPlayers=[];this.lastAction=null;this.pendingTransition=null;}
  start(){this._deal();} nextRound(){this.round++;this._deal();} newGame(){this.round=1;for(const p of this.players)p.totalScore=0;this._deal();}
  revealInitial(pi,ci){if(this.phase!=='REVEAL')return;const p=this.players[pi];if(p.revealCount>=2)return;const c=p.board[ci];if(c.revealed||c.cleared)return;c.revealed=true;p.revealCount++;this.lastAction={type:'reveal',player:pi,card:ci,value:c.value,t:Date.now()};if(this.players.every(pl=>pl.revealCount>=2))this._starter();}
  _starter(){const sums=this.players.map((p,i)=>({i,sum:p.board.filter(c=>c.revealed&&!c.cleared).reduce((a,c)=>a+c.value,0)}));const mx=Math.max(...sums.map(s=>s.sum));const tied=sums.filter(s=>s.sum===mx).map(s=>s.i);this.turnAction='turn_end_delay';this.pendingTransition={tied};}
  revealTiebreaker(pi,ci){if(!this.tiebreakerPlayers.includes(pi))return;const p=this.players[pi];if(p.revealCount>=2)return;const c=p.board[ci];if(c.revealed||c.cleared)return;c.revealed=true;p.revealCount++;this.lastAction={type:'reveal',player:pi,card:ci,value:c.value,t:Date.now()};if(this.tiebreakerPlayers.every(i=>this.players[i].revealCount>=2)){const sums=this.tiebreakerPlayers.map(i=>({i,sum:this.players[i].board.filter(c=>c.revealed&&!c.cleared).reduce((a,c)=>a+c.value,0)}));const mx=Math.max(...sums.map(s=>s.sum));this.turnAction='turn_end_delay';this.pendingTransition={tied:sums.filter(s=>s.sum===mx).map(s=>s.i)};}}
  drawDeck(pi){if(this.phase!=='PLAY'&&this.phase!=='FINAL_TURNS')return;if(this.currentPlayer!==pi||this.turnAction!==null)return;if(this.deck.length===0){this.deck=this.discard.slice(0,-1);this.discard=[this.discard[this.discard.length-1]];for(let i=this.deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[this.deck[i],this.deck[j]]=[this.deck[j],this.deck[i]];}}this.drawnCard=this.deck.pop();this.turnAction='deck';this.lastAction={type:'draw_deck',player:pi,t:Date.now()};}
  takeDiscard(pi){if(this.currentPlayer!==pi||this.turnAction!==null)return;if(!this.discard.length)return;this.drawnCard=this.discard.pop();this.turnAction='discard';this.lastAction={type:'take_discard',player:pi,value:this.drawnCard,t:Date.now()};}
  swap(pi,bi){if(this.currentPlayer!==pi||this.turnAction===null||this.turnAction==='must_reveal')return;const p=this.players[pi];const o=p.board[bi];if(o.cleared)return;const wasR=o.revealed,ov=o.value;this.discard.push(o.value);p.board[bi]={value:this.drawnCard,revealed:true,cleared:false};const diff=wasR?(ov-this.drawnCard):null;this.lastAction={type:'swap',player:pi,index:bi,diff,oldVal:ov,wasRevealed:wasR,t:Date.now()};this._end();}
  discardDrawnCard(pi){if(this.currentPlayer!==pi||this.turnAction!=='deck')return;const v=this.drawnCard;this.discard.push(v);this.drawnCard=null;this.turnAction='must_reveal';this.lastAction={type:'discard_drawn',player:pi,value:v,t:Date.now()};}
  revealAfterDiscard(pi,bi){if(this.currentPlayer!==pi||this.turnAction!=='must_reveal')return;const c=this.players[pi].board[bi];if(c.revealed||c.cleared)return;c.revealed=true;this.lastAction={type:'reveal_after_discard',player:pi,index:bi,value:c.value,t:Date.now()};this._end();}
  checkTriplets(pi){const p=this.players[pi];for(let col=0;col<4;col++){const ix=[col,col+4,col+8],cs=ix.map(i=>p.board[i]);if(cs.every(c=>c.revealed&&!c.cleared)&&cs[0].value===cs[1].value&&cs[1].value===cs[2].value){ix.forEach(i=>p.board[i].cleared=true);for(let i=0;i<3;i++)this.discard.push(cs[0].value);
        // Chain triplet onto swap's lastAction instead of overwriting it,
        // so both the swap animation and triplet VFX play sequentially.
        if(this.lastAction&&this.lastAction.type==='swap'){this.lastAction.triplet={value:cs[0].value,indices:ix};}
        else{this.lastAction={type:'triplet',player:pi,value:cs[0].value,indices:ix,t:Date.now()};}
      }}}
  _end(){this.checkTriplets(this.currentPlayer);this.drawnCard=null;this.turnAction='turn_end_delay';}
  completeTurnEnd(){if(this.turnAction!=='turn_end_delay')return;this.turnAction=null;if(this.pendingTransition){const tied=this.pendingTransition.tied;if(tied.length===1){this.currentPlayer=tied[0];this.phase='PLAY';this.lastAction={type:'starter',player:tied[0],t:Date.now()};this.tiebreakerPlayers=[];}else{this.tiebreakerPlayers=tied;for(const i of tied)this.players[i].revealCount=1;}this.pendingTransition=null;return;}const p=this.players[this.currentPlayer];if(p.board.every(c=>c.cleared||c.revealed)&&this.phase==='PLAY'){this.phase='FINAL_TURNS';this.roundEnder=this.currentPlayer;this.finalTurnsLeft=this.players.length-1;}if(this.phase==='FINAL_TURNS'){if(this.currentPlayer!==this.roundEnder)this.finalTurnsLeft--;if(this.finalTurnsLeft<=0){this._calc();return;}}this.currentPlayer=(this.currentPlayer+1)%this.players.length;}
  _calc(){for(const p of this.players){for(const c of p.board)if(!c.cleared)c.revealed=true;this.checkTriplets(this.players.indexOf(p));p.roundScore=p.board.filter(c=>!c.cleared).reduce((a,c)=>a+c.value,0);}const e=this.players[this.roundEnder];const mo=Math.min(...this.players.filter((_,i)=>i!==this.roundEnder).map(o=>o.roundScore));if(e.roundScore>=mo&&e.roundScore>0)e.roundScore*=2;for(const p of this.players)p.totalScore+=p.roundScore;this.phase=this.players.some(p=>p.totalScore>=100)?'GAME_OVER':'ROUND_END';}
  getStateFor(viewer){const s={phase:this.phase,round:this.round,currentPlayer:this.currentPlayer,roundEnder:this.roundEnder,finalTurnsLeft:this.finalTurnsLeft,turnAction:this.turnAction,tiebreakerPlayers:[...this.tiebreakerPlayers],lastAction:this.lastAction,deckCount:this.deck.length,discardTop:this.discard.length?this.discard[this.discard.length-1]:null,players:this.players.map(p=>({name:p.name,totalScore:p.totalScore,roundScore:p.roundScore,revealCount:p.revealCount,board:p.board.map(c=>({value:(c.revealed||c.cleared)?c.value:null,revealed:c.revealed,cleared:c.cleared}))}))};s.myDrawnCard=(this.turnAction==='deck'||this.turnAction==='discard')?this.drawnCard:null;s.publicDrawn=this.turnAction==='deck'?this.drawnCard:null;s.viewerIndex=viewer;return s;}
}

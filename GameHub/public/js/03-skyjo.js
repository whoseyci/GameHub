/* -------------------- SKYJO client -------------------- */
(function(){
  window.GameRules['skyjo']={title:'🃏 Skyjo',quick:'Get the LOWEST score.',steps:['Each player has a 4×3 grid of face-down cards. Flip 2 to start.','On your turn: take the <b>Deck</b> card or the <b>Discard</b> top, then either swap it onto your grid (discarding the old card) — or, if from the deck, discard it and flip one face-down card.','Three of the same number in a column clear (count as 0).','When someone reveals their whole grid, everyone else gets one last turn.','Lowest total wins the round. First to 100 ends the game — lowest total wins.'],tip:'Dump high cards, keep low/negative ones. Watch for column triplets!'};
  const C=Kit.cardColor;
  function boardEl(pi){return document.getElementById('main-board-'+pi)||document.getElementById('mini-board-'+pi);}
  function cardAt(pi,idx){const b=boardEl(pi);return b?b.querySelectorAll('.board-card')[idx]:null;}
  // Skyjo cards now use the unified framework card (Kit.Cards.el → .kc): one shared
  // geometry/back/sheen + the corner-lock that prevents pointy-edge flights. A Skyjo
  // card is a declarative SPEC — white face, number coloured by value (low=green …
  // high=red, negatives=indigo). The .board-card class is kept as a hook for Skyjo's
  // grid/mini-board sizing CSS.
  function skyjoSpec(c){
    if(c.cleared) return { zone:'skyjo', state:'cleared' };
    if(c.revealed) return { zone:'skyjo', bg:'#fff', border:'#fff', content:{ text:c.value, color:C(c.value) } };
    return { zone:'skyjo', faceDown:true };
  }
  function skyjoVisual(c){ return Kit.Cards.el(skyjoSpec(c)); }
  function skyjoCardId(s,pi,ci){return `skyjo:table:r${s.round}:p${pi}:c${ci}`;}
  // The discard pile is a PERMANENT card (id 'skyjo:discard') pinned to #uiDiscard.
  // A card that goes to the discard is the REAL moving card — we fly it onto the
  // pile; on landing the overlay is destroyed and #uiDiscard (rendered+made
  // clickable by drawPiles) becomes the resting discard top. A permanent overlay
  // over #uiDiscard would intercept clicks and hide the clickable anchor.
  // Fly an existing managed card (by id) onto the discard pile (no clones), then
  // hand off to the #uiDiscard DOM slot.
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
    // All cards have landed on the pile. Destroy every moving overlay and restore
    // the #uiDiscard slot's visibility so drawPiles renders a clickable discard top.
    moveIds.forEach((id)=>{ if(Kit.CardManager.has(id)) Kit.CardManager.destroy(id); });
    disc.style.visibility='';
  }
  async function flyCardToDiscard(movingId,value,opts={}){
    const disc=$('uiDiscard');
    const c=Kit.CardManager.get(movingId);
    if(c)c.renderer=()=>skyjoVisual({revealed:true,cleared:false,value});
    await Kit.CardManager.moveTo(movingId,disc,{duration:opts.duration??520,spin:!!opts.spin,startFaceDown:!!opts.startFaceDown,revealMidway:!!opts.revealMidway,land:false,hideTarget:true,toLocation:{zone:'discard'}});
    // The card has landed on the pile. Destroy the moving overlay and RESTORE the
    // #uiDiscard slot's visibility — drawPiles() renders the discard top there and
    // (crucially) keeps it clickable. A permanent overlay over #uiDiscard would
    // sit on top and the hidden anchor underneath could not receive clicks.
    Kit.CardManager.destroy(movingId);
    disc.style.visibility='';
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
  // Drive every Skyjo grid card through the shared board loop: Kit.Cards.board reads
  // all [data-card-reg^='skyjo:table:'] anchors, rebuilds each overlay from the
  // anchor's embedded skyjoSpec, reconciles away stale ids, and syncs positions —
  // the same single primitive Schotten/Flip 7 use. The location is parsed back from
  // the id (…:p<pi>:c<ci>) so the flight code's {zone:'grid',player,slot} contract
  // is preserved for column-clears / swaps / discards.
  function syncSkyjoCards(){
    Kit.Cards.board('skyjo:table:', {
      location: (a)=>{ const m=/:p(\d+):c(\d+)/.exec(a.dataset.cardReg||''); return m?{zone:'grid',player:+m[1],slot:+m[2]}:{zone:'grid'}; },
    });
  }

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

    // Turn banner is handled by Kit.Turn (called automatically by GameShell.render
    // after this function returns). Skyjo's old per-game block was equivalent.

    const prevForAnim=prevView?prevView.skyjo:null;
    const newAction=s.lastAction&&(!prevForAnim||JSON.stringify(prevForAnim.lastAction)!==JSON.stringify(s.lastAction));

    // API-11: server-emitted legality hints. Skyjo's tap-target logic
    // (which pile is tappable, which board cell is revealable, when to show
    // the held-card "discard" affordance) all read from view.state.legal —
    // no client-side phase/turnAction rule code needed.
    const hints = (typeof Kit !== 'undefined' && Kit.Cards?.legalHints) ? Kit.Cards.legalHints(view) : { byAction:{}, has:()=>false };
    drawPiles(s,viewer,myTurn,ta,hints);
    drawBoards(s,viewer,hints);

    if(s.phase==='REVEAL'&&(!prevForAnim||prevForAnim.phase!=='REVEAL'||prevForAnim.round!==s.round))Kit.dealCascade();
    if(newAction)runAnim(s,viewer);

    if(s.phase==='ROUND_END'||s.phase==='GAME_OVER'){if(!summaryShown){summaryShown=true;showSummary(view);}}
    else{summaryShown=false;hideOverlay();}

    prevView=view;curView=view;
  }

  function drawPiles(s,viewer,myTurn,ta,hints){
    const uiDeck=$('uiDeck'),uiDiscard=$('uiDiscard');
    $('deckCount').textContent=s.deckCount!=null?s.deckCount:'';
    uiDeck.classList.remove('pile-hint');uiDeck.onclick=null;uiDiscard.classList.remove('pile-hint');uiDiscard.onclick=null;

    // Everyone sees the deck-drawn card flipped face-up on the deck (publicDrawn).
    if(s.publicDrawn!=null&&viewer!==s.currentPlayer){uiDeck.className='card-slot revealed';uiDeck.textContent=s.publicDrawn;uiDeck.style.color=C(s.publicDrawn);uiDeck.style.borderColor='#fff';uiDeck.innerHTML=s.publicDrawn+'<span id="deckCount" class="deck-count">'+(s.deckCount||'')+'</span>';}
    else{uiDeck.className='card-slot face-down';uiDeck.style.color='';uiDeck.style.borderColor='';uiDeck.innerHTML='<span id="deckCount" class="deck-count">'+(s.deckCount||'')+'</span>';}

    // API-11: pile affordances come from server-emitted legality hints. No
    // client-side rule checks ("myTurn && ta===null") needed — the server
    // already knows whether draw_deck / take_discard / discard_drawn is legal.
    if(hints && hints.has('draw_deck')){
      uiDeck.classList.add('pile-hint');
      uiDeck.onclick=()=>act(s.currentPlayer,{action:'draw_deck'});
    }
    if(hints && hints.has('take_discard')){
      uiDiscard.classList.add('pile-hint');
      uiDiscard.onclick=()=>act(s.currentPlayer,{action:'take_discard'});
    }
    if(hints && hints.has('discard_drawn')){
      uiDiscard.classList.add('pile-hint');
      uiDiscard.onclick=()=>act(s.currentPlayer,{action:'discard_drawn'});
    }

    if(s.discardTop!==null){uiDiscard.className='card-slot revealed';uiDiscard.textContent=s.discardTop;uiDiscard.style.color=C(s.discardTop);uiDiscard.style.borderColor='#fff';if(hints && hints.has('discard_drawn'))uiDiscard.classList.add('pile-hint');}
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
    if(net.spectating){Kit.Status.set({text:'👁 Spectating — you\'ll join next round',tone:'warn'});}
    else if(s.phase==='REVEAL'){
      if(s.tiebreakerPlayers&&s.tiebreakerPlayers.length){const inTb=s.tiebreakerPlayers.includes(viewer);Kit.Status.set({text:mode==='local'?'Tie! Tied players flip 1 more card.':(inTb?'Tie! Flip 1 more card.':'Waiting for tiebreaker…'),tone:(mode==='local'||inTb)?'go':'info'});}
      else Kit.Status.set({text:mode==='local'?'Everyone: flip 2 cards to begin.':'Flip 2 cards to begin.',tone:'info'});
    }
    else if(s.phase==='ROUND_END'||s.phase==='GAME_OVER'){
      if(mode==='local'||net.isHost)Kit.Status.set({button:{label:s.phase==='GAME_OVER'?(mode==='local'?'Play Again':'New Game'):'Next Round',onClick:()=>mode==='local'?localNext():net.send({type:'next_round'})}});
      else Kit.Status.set({text:'Waiting for host…',tone:'muted'});
    }
    else{
      if(ta==='turn_end_delay')Kit.Status.set({text:'Ending turn…',tone:'muted'});
      else if(mode==='local')Kit.Status.set({text:`${s.players[s.currentPlayer].name}'s turn!`,tone:'go'});
      else if(myTurn)Kit.Status.set({text:'Your turn!',tone:'go'});
      else Kit.Status.set({text:'Waiting for '+s.players[s.currentPlayer].name+'…',tone:'info'});
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
    syncSkyjoCards();
  }

  function boardDOM(s,p,pi,isMain,interactive,viewer){
    const active=s.currentPlayer===pi&&(s.phase==='PLAY'||s.phase==='FINAL_TURNS')&&isMain;
    const live=p.board.filter(c=>c.revealed&&!c.cleared).reduce((a,c)=>a+c.value,0);
    // the 4×3 grid of card anchors (the overlay sync pins onto these .board-card .kc).
    const grid=document.createElement('div');grid.className='board-grid';
    p.board.forEach((c,ci)=>{
      // Framework anchor: an empty .kc placeholder carrying the canonical geometry +
      // the card's declarative spec (data-kcSpec). Kit.Cards.board() rebuilds the
      // permanent overlay from that spec — so the whole face (revealed value /
      // face-down back / cleared) is described in ONE place (skyjoSpec) and the
      // shared board loop owns create/pin/reconcile/sync (no bespoke loop).
      const card=Kit.Cards.anchor(skyjoCardId(s,pi,ci), skyjoSpec(c), {placeholder:true});
      card.classList.add('kc-zone-skyjo','board-card','registry-anchor');
      if(interactive&&isMain&&!c.cleared&&canClick(s,pi,ci,c,viewer)){card.classList.add('clickable');card.onclick=()=>cardClick(s,pi,ci,c);}
      grid.appendChild(card);});

    // MINI/opponent board → shared Kit.MiniBoard (frame + header + inspect click).
    // The card grid is the body. We keep id='mini-board-N' so boardEl() can find it.
    if(!isMain){
      const mb=Kit.MiniBoard({
        name:p.name+(pi===viewer?' (You)':''), badge:'Now '+live+' · '+p.totalScore,
        you:pi===viewer, seat:pi, variant:'skyjo', body:grid,
        onClick:()=>investigate(s,pi,viewer),
      });
      mb.id='mini-board-'+pi;
      mb.classList.add('board-mini'); // keep the legacy Skyjo mini SIZING selectors working
      return mb;
    }
    // MAIN (focused) board — the big interactive panel, unchanged structure.
    const wrap=document.createElement('div');
    wrap.className='player-board'+(active?' active-turn':'')+(pi===viewer?' me':'');
    wrap.id='main-board-'+pi;
    const h=document.createElement('div');h.className='board-header';
    h.innerHTML=`<span>${esc(p.name)}${pi===viewer?' (You)':''}</span><span class="score-badge">Now: ${esc(live)} · Total: ${esc(p.totalScore)}</span>`;
    wrap.appendChild(h);wrap.appendChild(grid);return wrap;
  }
  function canClick(s,pi,ci,c,viewer){
    // API-11: defer to server-emitted legality. For ONLINE play, view.state.legal
    // is already populated by the server for the viewer's seat — that's all we need
    // (you can never click an opponent's board). For LOCAL pass-and-play, we can't
    // rely on view.state.legal alone (it's for the viewer's seat), so we query the
    // pure legalActions() function on the live engine state. Same rule authority,
    // no duplication.
    if(mode!=='local'&&pi!==viewer)return false;
    const view=window._renderView;
    const mod=window.GameModules?.skyjo;
    // Prefer the precomputed hints (online); fall back to live legalActions
    // for the seat in question (local pass-and-play).
    let legal;
    if (pi === viewer && view?.state?.legal) {
      legal = view.state.legal;
    } else if (mod?.legalActions) {
      try { legal = mod.legalActions(s, pi) || []; } catch { legal = []; }
    } else {
      legal = [];
    }
    return legal.some(a =>
      (a.action === 'reveal' || a.action === 'reveal_after_discard' || a.action === 'swap' || a.action === 'tiebreaker')
      && a.index === ci
    );
  }
  function cardClick(s,pi,ci,c){
    // Find the matching legal action for THIS cell and replay it.
    // The server has already enumerated every action `pi` could take —
    // we just pick the one that matches (ci, plus the right action verb).
    const view=window._renderView;
    const mod=window.GameModules?.skyjo;
    let legal;
    if (pi === view?.yourSeat && view?.state?.legal) legal = view.state.legal;
    else if (mod?.legalActions) { try { legal = mod.legalActions(s, pi) || []; } catch { legal = []; } }
    else legal = [];
    // Prefer reveal_after_discard > swap > tiebreaker > reveal (the order
    // ensures we pick the specific action the engine expects in each phase).
    const ORDER = ['reveal_after_discard','swap','tiebreaker','reveal'];
    const match = ORDER.map(a => legal.find(x => x.action === a && x.index === ci)).find(Boolean);
    if (match) act(pi, match);
  }
  // seat = which player's board was acted on (needed for local pass-and-play REVEAL,
  // where each player flips their OWN cards). Online ignores it (server uses the
  // authenticated connection's seat).
  function act(seat,msg){ GameActions.act(seat,msg); } // delegates to shared helper (L4)
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
        // The held card has landed in the slot. Hand off to the REAL board card:
        // destroy the held overlay and immediately (re)create + pin the slot's
        // permanent card from engine state, so the new value (number included) is
        // visible the instant it lands — not only after the discard flies.
        Kit.CardManager.destroy('skyjo:held');
        target.style.visibility='';
        syncSkyjoCards();
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
    const box=GameShell.inspect(`<div class="inspect-head"><button class="icon-btn" onclick="window._skyjoInspect(${prev})">‹</button><b>${esc(s.players[pi].name)}</b><button class="icon-btn" onclick="window._skyjoInspect(${next})">›</button><button class="icon-btn" onclick="GameShell.closeInspect()">✕</button></div>`);
    box.appendChild(staticBoard(s,s.players[pi],pi,viewer));
    window._skyjoLastInspect={s,viewer};window._skyjoInspect=(seat)=>investigate(window._skyjoLastInspect.s,seat,window._skyjoLastInspect.viewer);
  }
  // A self-contained STATIC board for the popup: real .kc face cards rendered inline
  // (NOT CardManager overlays — those are fixed-positioned over the live table and
  // would not appear inside this modal). This is why the popup used to show no cards.
  function staticBoard(s,p,pi,viewer){
    const wrap=document.createElement('div');wrap.className='player-board';
    const h=document.createElement('div');h.className='board-header';
    const live=p.board.filter(c=>c.revealed&&!c.cleared).reduce((a,c)=>a+c.value,0);
    h.innerHTML=`<span>${esc(p.name)}${pi===viewer?' (You)':''}</span><span class="score-badge">Now: ${esc(live)} · Total: ${esc(p.totalScore)}</span>`;
    wrap.appendChild(h);
    const grid=document.createElement('div');grid.className='board-grid';
    p.board.forEach(c=>{const face=Kit.Cards.el(skyjoSpec(c));face.classList.add('board-card');grid.appendChild(face);});
    wrap.appendChild(grid);return wrap;
  }

  function unmount(){const mini=$('miniBoardsContainer');if(mini)mini.innerHTML='';}
  window.GameClients['skyjo']={render,unmount,act:clientAct};

})();

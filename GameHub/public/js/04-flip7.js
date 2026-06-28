/* -------------------- FLIP 7 client (event-timeline) -------------------- */
(function(){
  window.GameRules['flip7']={title:'🎴 Flip 7',quick:'Push your luck — race to 200.',steps:['Choose <b>Hit</b> to draw or <b>Stay</b> to stop taking voluntary cards for the round.','Standard deck: numbers 0–12, positive modifiers, Freeze, Flip Three, and Second Chance. Duplicate number → BUST.','<b>With a Vengeance</b>: standalone 108-card deck with numbers through 13, negative modifiers, ÷2, Zero, Lucky 13, Unlucky 7, and take-that actions.','In Vengeance, staying does <b>not</b> make you safe: non-busted stayed players can still receive modifiers and action effects until the round ends.','Get <b>7 unique numbers → Flip 7!</b> +15 bonus and the round ends instantly.','First player to 200+ at the end of a round wins.'],tip:'High numbers are riskier because more copies exist. In Vengeance, Zero scores 0 unless you Flip 7.'};
  function modText(m){return m==='x2'?'×2':m==='div2'?'÷2':m;}
  const NUMCOL=['#94a3b8','#38bdf8','#22d3ee','#34d399','#4ade80','#a3e635','#facc15','#fb923c','#f97316','#ef4444','#ec4899','#d946ef','#a855f7','#14b8a6'];
  function numFace(n){return NUMCOL[Math.max(0,Math.min(13,Number(n)||0))];}
  // Pacing (dramatic).
  const SPEED={cardReveal:560,flip3Gap:780,wiggleMin:350,wiggleMax:1700,actionFly:620,beat:420};
  let f7SwapPick=null;
  // Flip 7 cards now use the unified framework card (Kit.Cards.el → .kc): one shared
  // geometry/back/sheen + the corner-lock that prevents pointy-edge flights. Flip 7
  // theming (number colours, mod gold, action glyphs) is expressed as a declarative
  // SPEC; the legacy .f7-card classes are kept as hooks for Flip7-specific states
  // (busted/bust-cause) and the existing animation/mini-board CSS.
  // A Flip 7 card as a STRICT declarative spec (tokens only — no raw classes).
  // Theming = bg/border/content tokens; sizing context = zone:'f7'; states via tokens.
  const F7_WORDS=['ZERO','ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE','TEN','ELEVEN','TWELVE','THIRTEEN'];
  const F7_CREAM={gradient:['#fff9df','#f0dfaa'],angle:155};
  function f7Art({bg=F7_CREAM,border='#1e1b4b',accent='#c2410c',muted='rgba(30,27,75,.48)',emblem='',content='',caption='',topNote='',bottomNote='',contentColor='#1e1b4b',contentSize='.46',captionColor='rgba(30,27,75,.68)',captionBg='rgba(255,247,210,.82)',captionPos='bottom',captionSize=null}){
    return { bg, border, borderWidth:'thick', accentColor:accent, mutedColor:muted, sideGlyph:'◖', emblem,
      topNote, bottomNote, caption, captionColor, captionBg, captionPos, captionSize,
      content:{ text:content, color:contentColor, size:`calc(var(--kc-w,56px)*${contentSize})`, weight:1000, shadow:true }
    };
  }
  function f7NumberSpec(val,{special=null}={}){
    const n=Number(val)||0;
    const color=numFace(n);
    if(special==='zero') return f7Art({bg:{gradient:['#fff7ad','#7dd3fc','#c084fc','#f0abfc'],angle:135},border:'#0891b2',accent:'#a855f7',emblem:'0',content:'0',caption:'RAINBOW ZERO',bottomNote:'UNLESS YOU FLIP 7',contentColor:'#7c3aed',contentSize:'.58',captionColor:'#0f766e',captionBg:'rgba(255,255,255,.75)'});
    if(special==='unlucky7') return f7Art({bg:{gradient:['#d1d5db','#9ca3af'],angle:155},border:'#374151',accent:'#4b5563',emblem:'7',content:'7',caption:'UNLUCKY SEVEN',bottomNote:'DISCARD ALL OTHER CARDS',contentColor:'#1f2937',contentSize:'.58',captionColor:'#111827',captionBg:'rgba(229,231,235,.82)',muted:'rgba(31,41,55,.55)'});
    if(special==='lucky13') return f7Art({bg:{gradient:['#fff7ad','#86efac','#7dd3fc','#c084fc','#f0abfc'],angle:135},border:'#16a34a',accent:'#a855f7',emblem:'13',content:'13',caption:'LUCKY THIRTEEN',bottomNote:'MAY HAVE ONE OTHER 13',contentColor:'#7c3aed',contentSize:'.52',captionColor:'#15803d',captionBg:'rgba(255,255,255,.78)'});
    return f7Art({bg:F7_CREAM,border:'#1e1b4b',accent:color,emblem:String(val),content:val,caption:F7_WORDS[n]||String(val),contentColor:color,contentSize:n>=10?'.52':'.62'});
  }
  function f7Action(title,{bg=F7_CREAM,border='#1e1b4b',accent='#c2410c',emblem='',topNote='PLAY ON ANY PLAYER',bottomNote=''}){
    return f7Art({bg,border,accent,emblem,topNote,bottomNote,content:'',caption:title,captionPos:'center',captionSize:`calc(var(--kc-w,56px)*${title.length>9?'.15':'.18'})`,captionBg:'rgba(255,249,223,.88)',captionColor:'#1e1b4b',muted:'rgba(30,27,75,.36)'});
  }
  function f7Spec(kind,val,{busted=false,cause=false,special=null}={}){
    let spec;
    if(kind==='num') spec=f7NumberSpec(val,{special});
    else if(kind==='mod') spec= val==='x2'
      ? f7Art({bg:{gradient:['#fff9df','#f3d6ef'],angle:155},border:'#831843',accent:'#db2777',emblem:'×2',content:'×2',caption:'DOUBLE',bottomNote:'THE SUM OF NUMBER CARDS',contentColor:'#be185d',contentSize:'.46'})
      : val==='div2'
        ? f7Art({bg:{gradient:['#fff9df','#f8d98b'],angle:155},border:'#92400e',accent:'#d97706',emblem:'÷2',content:'÷2',caption:'DIVIDE',bottomNote:'THE SUM OF NUMBER CARDS',contentColor:'#92400e',contentSize:'.46'})
        : String(val).startsWith('-')
          ? f7Art({bg:{gradient:['#f3a066','#bd3d2c'],angle:155},border:'#7f1d1d',accent:'#fee2e2',emblem:'−',topNote:'PLAY ON ANY PLAYER',content:modText(val),caption:'MODIFIER',bottomNote:'THE SUM OF NUMBER CARDS',contentColor:'#7f1d1d',contentSize:'.48',captionColor:'rgba(127,29,29,.66)',captionBg:'rgba(255,247,210,.72)',muted:'rgba(127,29,29,.48)'})
          : f7Art({bg:{gradient:['#fff9df','#fcd34d'],angle:155},border:'#d97706',accent:'#f59e0b',emblem:'+',content:modText(val),caption:'BONUS',bottomNote:'ADD TO YOUR SCORE',contentColor:'#92400e',contentSize:'.46'});
    else if(val==='second') spec=f7Action('SECOND\nCHANCE',{bg:{gradient:['#fff9df','#fecaca'],angle:155},border:'#991b1b',accent:'#dc2626',emblem:'♥',topNote:'KEEP UNTIL NEEDED',bottomNote:'DISCARD WITH DUPLICATE'});
    else if(val==='freeze') spec=f7Action('FREEZE',{bg:{gradient:['#fff9df','#bae6fd'],angle:155},border:'#0369a1',accent:'#38bdf8',emblem:'❄',bottomNote:'TARGET STAYS'});
    else if(val==='flip3')  spec=f7Action('FLIP\nTHREE',{bg:{gradient:['#fff9df','#fef08a'],angle:155},border:'#a16207',accent:'#eab308',emblem:'3',bottomNote:'TARGET DRAWS 3'});
    else if(val==='flip4')  spec=f7Action('FLIP\nFOUR',{bg:{gradient:['#fff9df','#fef08a'],angle:155},border:'#a16207',accent:'#eab308',emblem:'4',bottomNote:'TARGET DRAWS 4'});
    else if(val==='steal') spec=f7Action('STEAL',{bg:{gradient:['#fff9df','#d8b4fe'],angle:155},border:'#5b21b6',accent:'#7c3aed',emblem:'$',bottomNote:'TAKE A FACE-UP CARD'});
    else if(val==='swap') spec=f7Action('SWAP',{bg:{gradient:['#fff9df','#fed7aa'],angle:155},border:'#b45309',accent:'#f59e0b',emblem:'↔',bottomNote:'TWO FACE-UP CARDS'});
    else if(val==='discard') spec=f7Action('DISCARD',{bg:{gradient:['#fff9df','#c4b5fd'],angle:155},border:'#6d28d9',accent:'#8b5cf6',emblem:'×',topNote:'FORCE ANY PLAYER',bottomNote:'DISCARD A CARD'});
    else if(val==='just1more') spec=f7Action('JUST ONE\nMORE',{bg:{gradient:['#fff9df','#f9a8d4'],angle:155},border:'#9d174d',accent:'#ec4899',emblem:'+1',bottomNote:'DRAW 1 THEN STAY'});
    else spec={ content:{ text:val } };
    spec.zone='f7';
    const st=[]; if(busted)st.push('dim'); if(cause)st.push('shake','highlight');
    if(st.length)spec.state=st;
    return spec;
  }
  function cardEl(kind,val,opts={}){
    const c=Kit.Cards.el(f7Spec(kind,val,opts));
    if(opts.special) c.title = opts.special==='zero'?'Zero':opts.special==='unlucky7'?'Unlucky 7':opts.special==='lucky13'?'Lucky 13':'';
    else if(kind!=='num'&&val) c.title = val==='second'?'Second Chance':val==='freeze'?'Freeze':val==='flip3'?'Flip Three':val==='flip4'?'Flip Four':val==='steal'?'Steal':val==='swap'?'Swap':val==='discard'?'Discard':val==='just1more'?'Just One More':val==='div2'?'Divide by 2':String(val);
    return c;
  }

  // Mount a card on a player's row as a framework ANCHOR: it carries the declarative
  // spec, so Kit.Cards.board() rebuilds the overlay from the anchor alone — no
  // per-game data-kind/value re-encoding, no bespoke renderer.
  function addF7Card(row,kind,val,key,opts={}){
    const seat=row?.dataset?.f7Seat||'x';
    const id=`flip7:table:p${seat}:${key}`;
    const a=Kit.Cards.anchor(id, f7Spec(kind,val,opts));
    a.classList.add('registry-anchor');
    a.dataset.cardKey=key;
    // stamp the card's value so handlers can find e.g. the Second Chance card on a
    // board regardless of its tableau id (anchors carry no face attr otherwise).
    a.dataset.act=String(val);
    if(opts.special)a.dataset.special=String(opts.special);
    row.appendChild(a);return a;
  }
  function syncF7Cards(){
    Kit.Cards.board('flip7:table:',{
      location:(anchor,index)=>({zone:'grid',player:Number(anchor.closest('[data-f7-seat]')?.dataset?.f7Seat)||0,slot:index}),
    });
  }
  function wireF7PendingCards(view){
    const s=view&&view.flip7, viewer=s&&s.viewerSeat;
    const pa=s&&s.pendingAction;
    const legal=(view?.yourSeat===viewer&&view?.state?.legal)||[];
    document.querySelectorAll('.f7-card-target,.f7-card-selected').forEach(el=>el.classList.remove('f7-card-target','f7-card-selected'));
    if(!pa||pa.from!==viewer||!legal.length){f7SwapPick=null;return;}
    const kind=pa.kind;
    const cardIdFor=(seat,id)=>`flip7:table:p${seat}:${id}`;
    const findAnchor=(seat,id)=>document.querySelector(`[data-card-reg="${cardIdFor(seat,id)}"]`);
    const mark=(seat,id,cls,handler)=>{
      const el=findAnchor(seat,id); if(!el)return;
      const ov=Kit.CardManager?.get?.(cardIdFor(seat,id))?.overlayEl;
      el.classList.add(cls); if(ov)ov.classList.add(cls);
      el.onclick=handler;
    };
    if(kind==='swap'){
      const ownIds=new Set(legal.map(a=>a.cardId2).filter(Boolean));
      if(f7SwapPick&&!ownIds.has(f7SwapPick))f7SwapPick=null;
      ownIds.forEach(id=>mark(viewer,id,f7SwapPick===id?'f7-card-selected':'f7-card-target',(ev)=>{ev.stopPropagation();f7SwapPick=f7SwapPick===id?null:id;draw(window._renderView);}));
      legal.forEach(a=>mark(a.target,a.cardId,'f7-card-target',(ev)=>{ev.stopPropagation();let own=f7SwapPick;if(!own&&ownIds.size===1)own=[...ownIds][0];if(!own){if(typeof toast==='function')toast('Pick one of your cards first.');return;}const match=legal.find(x=>x.target===a.target&&x.cardId===a.cardId&&x.cardId2===own);if(match){f7SwapPick=null;act(viewer,{action:'target',target:match.target,cardId:match.cardId,cardId2:match.cardId2});}}));
      return;
    }
    if(kind==='steal'||kind==='discard'){
      legal.forEach(a=>{if(!a.cardId)return;mark(a.target,a.cardId,'f7-card-target',(ev)=>{ev.stopPropagation();act(viewer,{action:'target',target:a.target,cardId:a.cardId});});});
    }
  }
  function cmCardSlot(permId){ const c=Kit.CardManager.get(permId); return c&&c.location?c.location.slot:undefined; }
  // Animate a permanent card flying from the deck to its board slot via the
  // CardManager animation API: face-down on the deck, a Y-axis FLIP (so it lands
  // face-up & upright — no upside-down text), revealing its face edge-on midway.
  async function flyDealCard(permId,seat,slot){
    // The destination anchor / deck may not be in the DOM the very first frame after
    // a re-render (esp. the first deal on entering a game) — previously this bailed
    // silently, so the deck wiggled but the card never flew. Wait a frame or two for
    // them to exist before giving up.
    let cmCard=Kit.CardManager.get(permId), deck=$('f7Deck');
    let destAnchor=document.querySelector(`[data-card-reg="${permId}"]`);
    for(let tries=0; (!deck||!destAnchor) && tries<3; tries++){
      await new Promise(r=>requestAnimationFrame(r));
      deck=$('f7Deck'); destAnchor=document.querySelector(`[data-card-reg="${permId}"]`);
      cmCard=Kit.CardManager.get(permId);
    }
    if(!cmCard||!destAnchor) return;               // card genuinely not on board — nothing to fly
    if(!deck){ Kit.CardManager.sync(); return; }    // no deck to fly FROM: just settle the card in place
    // The canonical deal flight (Kit.Cards.deal): deck → slot, face-down with a
    // mid-flip reveal, card-sized source, canonical geometry the whole way.
    await Kit.Cards.deal(permId,deck,destAnchor,{
      duration:620, arc:46, onReveal:()=>SFX.flip(),
      toLocation:{zone:'grid',player:Number(seat)||0,slot},
    });
  }
  // Fly an EXISTING permanent card from its board slot to the discard pile, then
  // remove it (it's logically in the pile). We move the REAL card — no transient
  // clone — so no duplicate flashes on the board. The caller must remove the card
  // from liveView.cards (so reconcile() won't recreate it) BEFORE calling this.
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
  // Card-row reflow (a new card pushes siblings over): now uses the shared fly API
  // primitive Kit.CardBoard.snapshot/playReflow instead of hand-rolled getBoundingClientRect math.
  function captureF7Layout(){ return Kit.CardBoard.snapshot('flip7:table:'); }
  function animateF7Layout(before){ Kit.CardBoard.playReflow(before,{duration:340}); }

  function actionVfx(kind){
    const o=document.createElement('div');
    const kinds={
      freeze: { cls:'freeze', icon:'\u2744' },
      flip3:  { cls:'flip3',  icon:'F3' },
      flip4:  { cls:'flip3',  icon:'F4' },
      steal:  { cls:'steal',  icon:'S' },
      swap:   { cls:'swap',   icon:'W' },
      discard: { cls:'discard', icon:'D' },
      just1more: { cls:'just1more', icon:'+1' }
    };
    const info=kinds[kind]||{cls:'flip3',icon:'?'};
    o.className='f7-vfx-overlay '+info.cls;
    const aura=document.createElement('div');aura.className='f7-vfx-aura';
    const icon=document.createElement('div');icon.className='f7-vfx-icon';
    icon.textContent=info.icon;
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
  function actionCardSourceEl(seat,kind){
    const row=rowOf(seat); if(!row)return null;
    const anchors=[...row.querySelectorAll('[data-card-reg]')];
    const a=anchors.find(x=>x.dataset.kind==='act'&&x.dataset.value===kind);
    return a ? (Kit.CardManager.get(a.dataset.cardReg)?.overlayEl||a) : row;
  }
  // The permanent CardManager id of an action card sitting on a player's board.
  function actionCardPermId(seat,kind){
    const row=rowOf(seat); if(!row)return null;
    const a=[...row.querySelectorAll('[data-card-reg]')].find(x=>x.dataset.kind==='act'&&x.dataset.value===kind);
    return a&&Kit.CardManager.has(a.dataset.cardReg)?a.dataset.cardReg:null;
  }
  function makeActionTargetSlot(targetSeat,card){
    const row=rowOf(targetSeat); if(!row)return null;
    const ghost=cardEl(card?.kind||'act',card?.v||'flip3',{special:card?.special});
    ghost.classList.add('registry-anchor');ghost.style.visibility='hidden';
    // Match the destination row's card width so the flight lands at a real card size
    // (and never reads a stretched flex box → no "wide pill"). The aspect-lock in the
    // fly API is the safety net; this keeps the target geometry correct too.
    const sibling=row.querySelector('.kc');
    if(sibling){ const w=getComputedStyle(sibling).getPropertyValue('--kc-w'); if(w&&w.trim()) ghost.style.setProperty('--kc-w', w.trim()); }
    row.appendChild(ghost);
    return ghost;
  }
  async function transferActionCard(e){
    const card=e.card||{kind:'act',v:e.actionKind};
    const kind=e.actionKind||card.v;
    const toEl=makeActionTargetSlot(e.target,card) || rowOf(e.target) || boardOf(e.target);
    // Prefer moving the REAL action-card overlay from the actor's board (a
    // permanent CardManager card); it's "played" into the target, then destroyed.
    const permId=actionCardPermId(e.actor,kind);
    if(permId){
      // Route through the unified fly API (Kit.CardBoard.fly) — same flight Schotten
      // uses. No fromEl/fromRect → it flies the REAL card from its current overlay
      // position (the actor's board) to the target slot, then we destroy it.
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
      cards.forEach((c,idx)=>addF7Card(row,c.kind,c.v,c.id||('card-'+idx+'-'+c.kind+'-'+c.v),{busted,special:c.special}));
    }else{
      p.nums.forEach(n=>addF7Card(row,'num',n,'num-'+n,{busted}));
      p.mods.forEach((m,mi)=>addF7Card(row,'mod',m,'mod-'+mi+'-'+m,{busted}));
      if(p.second)addF7Card(row,'act','second','second');
      (p.actionCards||[]).forEach((a,ai)=>addF7Card(row,'act',a,'act-'+ai+'-'+a));
    }
    if(busted&&p.bustCard!=null)addF7Card(row,'num',p.bustCard,'bust-'+p.bustCard,{cause:true});
    // SPENT action cards (freeze/flip3 played ON this player) stay on their board,
    // dimmed, so it's clear what was used on them. (Authoritative: view spentActions.)
    (p.spentActions||[]).forEach((c,si)=>{const a=addF7Card(row,'act',c.v,c.id||('spent-'+si+'-'+c.v),{busted:true});a.classList.add('f7-spent');});
  }

  // ---- static board render from state ----
  function draw(view,ctx=renderCtx||{}){
    renderCtx=ctx;
    removeQwixxUi();
    // Layout: pure CSS Flexbox now (see #gameScreen.active rules in
    // main.css). No per-render solver call needed.
    const s=view.flip7,viewer=s.viewerSeat;
    const pending=s.pendingAction&&s.pendingAction.from===viewer;
    const focus = ctx.focus ? ctx.focus({actingSeat:s.current,eventSeat:eventFocus,preferred:viewer}) : (viewer>=0 ? viewer : s.current);
    const miniFrag=document.createDocumentFragment();
    const mainFrag=document.createDocumentFragment();
    s.players.forEach((p,i)=>{
      if(i!==focus){miniFrag.appendChild(miniDOM(s,p,i,viewer,pending,view));return;}
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
      // API-11: server-emitted legality decides if this player is a valid
      // target for the viewer's pending action.
      const viewerLegal=(view?.yourSeat===viewer && view?.state?.legal) ? view.state.legal : [];
      const canTarget=viewerLegal.some(a=>a.action==='target'&&a.target===i);
      const cardTargetOnly=viewerLegal.some(a=>a.action==='target'&&a.target===i&&a.cardId);
      if(canTarget){wrap.style.cursor='pointer';wrap.style.outline='2px dashed #f59e0b';if(!cardTargetOnly)wrap.onclick=()=>net.spectating?null:act(viewer,{action:'target',target:i});}
      mainFrag.appendChild(wrap);
    });
    const top=s.discardTop;
    // Render the discard's top card as a REAL card (same cardEl component as on
    // the board / in flight), so a card's design does NOT change when it lands on
    // the pile. kindFor maps the stored {kind,v} to cardEl's kind argument.
    const discFace=top?(()=>{const kind=top.kind==='num'?'num':top.kind==='mod'?'mod':'act';const el=cardEl(kind,top.v,{special:top.special});el.classList.add('f7-discard-card');return el.outerHTML;})():'';
    const center=s.phase==='PLAY'?`<div id="f7DealerWrap" class="f7-dealer"><div class="pile-label">Dealer</div><div class="f7-piles"><div class="f7-pile-col"><div id="f7Deck" class="f7-deck"><span class="cnt">deck ${esc(s.deckCount)}</span></div></div><div class="f7-pile-col"><div id="f7Discard" class="f7-discard${top?'':' empty'}">${discFace}<span class="cnt">discard ${esc(s.discardCount)}</span></div></div></div></div>`:'';
    GameShell.renderTable({game:'flip7',opponents:miniFrag,center,focus:mainFrag,status:'',topMode:s.phase==='PLAY'?'custom':'hidden',opponentClass:'f7-mini-strip'});
    syncF7Cards();
    wireF7PendingCards(view);
    drawControls(view);
  }

  function miniDOM(s,p,i,viewer,pending,view){
    const busted=p.status==='busted';
    // BODY = the cards row (must keep .f7-row + data-f7Seat so syncF7Cards pins the
    // permanent card overlays onto it). The shared Kit.MiniBoard provides the frame,
    // active/busted states, header (name+status badge) and the inspect click.
    const row=document.createElement('div');row.className='f7-row';row.dataset.f7Seat=i;
    if(!(p.cards&&p.cards.length)&&!p.nums.length&&!p.mods.length&&!p.second)row.innerHTML='<span class="f7-empty">no cards</span>';
    renderF7PlayerCards(row,p,busted);
    // API-11: server-emitted legality (same as the main board path).
    const viewerLegal=(view?.yourSeat===viewer && view?.state?.legal) ? view.state.legal : [];
    const canTarget=viewerLegal.some(a=>a.action==='target'&&a.target===i);
    // W1: essentials manifest — banked score is the strategic anchor, live
    // round-points is the tactical pressure, unique-count is how close they
    // are to FLIP 7 (round-ending). Status pill ('busted' / 'stayed' /
    // 'active') gives at-a-glance state across all tiers above xs.
    const pulse = busted ? 'bust' : (s.current===i && p.status==='active' ? 'live' : null);
    const b=Kit.MiniBoard({
      name: p.name,
      active: s.current===i,
      dim: busted,
      seat: i, variant: 'f7',
      pulse,
      status: p.status && p.status !== 'active' ? p.status : (s.current===i ? 'turn' : null),
      essentials: [
        { label: 'Banked', value: p.banked },
        { label: busted ? 'Bust' : 'Now', value: busted ? 0 : p.live },
        { label: 'Unique', value: `${p.unique}/7` },
      ],
      body: row,
      onClick: () => {
        const cardTargetOnly=viewerLegal.some(a=>a.action==='target'&&a.target===i&&a.cardId);
        return canTarget && !cardTargetOnly ? (net.spectating ? null : act(viewer,{action:'target',target:i})) : inspect(i);
      },
    });
    b.dataset.f7Seat=i;                 // wrapper also carries the seat (board lookups)
    if(canTarget)b.classList.add('targetable');
    return b;
  }


  function inspect(seat){
    const view=window._renderView;if(!view||view.game!=='flip7')return;
    const s=view.flip7,p=s.players[seat];if(!p)return;
    const seats=s.players.map((_,i)=>i).filter(i=>i!==view.flip7.viewerSeat);
    const idx=seats.indexOf(seat),prev=seats[(idx-1+seats.length)%seats.length],next=seats[(idx+1)%seats.length];
    const row=(p.cards&&p.cards.length?p.cards.map(c=>cardEl(c.kind,c.v,{busted:p.status==='busted',special:c.special})):[...p.nums.map(n=>cardEl('num',n,{busted:p.status==='busted'})),...p.mods.map(m=>cardEl('mod',m,{busted:p.status==='busted'})),...(p.second?[cardEl('act','second')]:[]),...(p.actionCards||[]).map(a=>cardEl('act',a))]);
    const cards=document.createElement('div');cards.className='f7-row';row.forEach(c=>cards.appendChild(c));
    const box=GameShell.inspect(`<div class="inspect-head"><button class="icon-btn" onclick="window.GameClients['flip7'].inspect(${prev})">‹</button><b>${esc(p.name)} · ${esc(p.status)}</b><button class="icon-btn" onclick="window.GameClients['flip7'].inspect(${next})">›</button><button class="icon-btn" onclick="GameShell.closeInspect()">${Kit.Icon.html('x',{size:14})}</button></div><div class="player-board f7-focus-board"><div class="board-header"><span>${esc(p.name)}</span><span class="score-badge">Now ${esc(p.live)} · Total ${esc(p.banked)} · ${esc(p.unique)}/7</span></div></div>`);
    box.querySelector('.player-board').appendChild(cards);
  }

  // API-11: legality-driven controls. Hit/Stay/target affordances come from
  // view.state.legal (online) or module.legalActions() (local pass-and-play).
  // The display-text choices (banner / status text) remain UI judgement calls.
  function f7LegalFor(view, seat){
    if (seat === view?.yourSeat && view?.state?.legal) return view.state.legal;
    const mod = window.GameModules?.flip7;
    if (!mod?.legalActions) return [];
    try { return mod.legalActions(view.flip7, seat) || []; } catch { return []; }
  }

  function drawControls(view){
    const s=view.flip7,viewer=s.viewerSeat;
    const pending=s.pendingAction&&s.pendingAction.from===viewer;
    const hitStay=(seat)=>{
      const legal=f7LegalFor(view, seat);
      const canHit=legal.some(a=>a.action==='hit');
      const canStay=legal.some(a=>a.action==='stay');
      Kit.Controls.set([
        ...(canHit?[{label:'Hit',kind:'green',onClick:()=>act(seat,{action:'hit'})}]:[]),
        ...(canStay?[{label:'Stay',kind:'secondary',onClick:()=>act(seat,{action:'stay'})}]:[]),
      ],{id:'f7Controls'});
    };
    Kit.Controls.clear('f7Controls');
    if(net.spectating){Kit.Status.set({html:Kit.Icon.html('eye',{size:14})+'Spectating — you\'ll join next round',tone:'warn'});}
    else if(s.phase==='ROUND_END'||s.phase==='GAME_OVER'){
      if(mode==='local'||net.isHost)Kit.Status.set({button:{label:s.phase==='GAME_OVER'?(mode==='local'?'Play Again':'New Game'):'Next Round',onClick:()=>mode==='local'?localNext():net.send({type:'next_round'})}});
      else Kit.Status.set({text:'Waiting for host…',tone:'muted'});
    }
    else if(pending){
      const k=s.pendingAction.kind;
      const iconMap={freeze:'<span style="color:#7dd3fc">❄</span>',flip3:Kit.Icon.html('sparkle',{size:14,cls:'kit-icon-inline'}),flip4:'<b>F4</b>',give_second:'<span style="color:#fbcfe8">♥</span>',modifier:'<b>±</b>',steal:'<b>S</b>',swap:'<b>W</b>',discard:'<b>D</b>',just1more:'<b>+1</b>'};
      const labelMap={freeze:'Choose who to Freeze',flip3:'Choose who flips 3',flip4:'Choose who flips 4',give_second:'Give Second Chance to an opponent',modifier:'Choose who receives the modifier',steal:'Choose who to steal from',swap:'Choose who to swap with',discard:'Choose who discards a card',just1more:'Choose who takes Just One More'};
      Kit.Status.set({html: (iconMap[k]||'') + (labelMap[k]||'Choose a target') + ' (tap a player)', tone:'warn'});
    }
    else {
      // Are hit/stay legal for the viewer? (Replaces the old myTurn check.)
      const viewerLegal=f7LegalFor(view, viewer);
      const myHitStay=viewerLegal.some(a=>a.action==='hit'||a.action==='stay');
      if (myHitStay) {
        Kit.Status.set({text:'Your turn — Hit or Stay',tone:'go'});
        hitStay(viewer);
      } else if (mode==='local'){
        const cur=s.players[s.current];
        if(s.pendingAction){
          const k=s.pendingAction.kind;
          const verbMap={freeze:'Freeze <span style="color:#7dd3fc">❄</span>',flip3:'Flip 3 '+Kit.Icon.html('sparkle',{size:12}),flip4:'Flip 4',give_second:'Give <span style="color:#fbcfe8">♥</span>',modifier:'Play modifier',steal:'Steal',swap:'Swap',discard:'Discard',just1more:'Just One More'};
          Kit.Status.set({html:esc(cur.name)+': '+(verbMap[k]||'Choose')+' — tap a player',tone:'warn'});
        } else {
          Kit.Status.set({text:(cur?cur.name:'')+'\'s turn',tone:'go'});
          // Pass-and-play: query legal for whoever's turn it is on the device.
          const curLegal=f7LegalFor(view, s.current);
          if (curLegal.some(a=>a.action==='hit'||a.action==='stay')) hitStay(s.current);
        }
      } else {
        Kit.Status.set({text:'Waiting for '+(s.players[s.current]?.name||'…'),tone:'info'});
      }
    }
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
    // Action-card transfer (board → board): a transient one-off fly via the
    // unified CardManager API (same clean, uniform-scale flight as everything).
    await Kit.CardManager.flyTransient(fromEl,toEl,{render:()=>{const el=cardEl(card?.kind||'num',card?.v??'?');el.classList.add('f7-flying-card');return el;},spin,duration,land:false});
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
      case 'unlucky7':return{type:'effect.unlucky7',actor:e.player,seq:e.seq,legacy:e.type};
      case 'discarded':return{type:'effect.discarded',actor:e.player,seq:e.seq,legacy:e.type};
      case 'stolen':return{type:'effect.stolen',from:e.from,to:e.to,card:e.card,seq:e.seq,legacy:e.type};
      case 'swapped':return{type:'effect.swapped',p1:e.p1,p2:e.p2,c1:e.c1,c2:e.c2,seq:e.seq,legacy:e.type};
      case 'flip3_abandon':return{type:'effect.flip3_abandon',target:e.target,seq:e.seq,legacy:e.type};
      case 'second_used':return{type:'effect.second_used',actor:e.player,value:e.value,flip3:!!e.flip3,seq:e.seq,legacy:e.type};
      case 'second_discard':return{type:'effect.second_discard',actor:e.player,seq:e.seq,legacy:e.type};
      case 'stay':return{type:'effect.stay',actor:e.player,seq:e.seq,legacy:e.type};
      case 'freeze_done':return{type:'effect.freeze_done',target:e.target,seq:e.seq,legacy:e.type};
      case 'vengeance_penalty':return{type:'effect.vengeance_penalty',target:e.target,points:e.points,seq:e.seq,legacy:e.type};
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
  function liveScore(p,variant='standard'){
    if(p.status==='busted')return 0;
    const unique=new Set(p.nums||[]).size;
    let base=(p.nums||[]).reduce((a,b)=>a+b,0);
    if(variant==='vengeance'&&(p.nums||[]).includes(0)&&unique<7)return 0;
    if((p.mods||[]).includes('x2'))base*=2;
    if((p.mods||[]).includes('div2'))base=Math.floor(base/2);
    for(const m of (p.mods||[])){
      const s=String(m);
      if(s[0]==='+') base+=parseInt(s.slice(1));
      else if(s[0]==='-') base-=parseInt(s.slice(1));
    }
    if(base<0)base=0;
    if(unique>=7)base+=15;
    return base;
  }
  function recalcAll(lv){ const variant=lv?.flip7?.variant||'standard'; lv.flip7.players.forEach(x=>{x.unique=new Set(x.nums||[]).size;x.live=liveScore(x,variant);}); }
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
    if(card.kind==='num'){ if(card.special==='lucky13'||!p.nums.includes(card.v)){p.nums.push(card.v);p.nums.sort((a,b)=>a-b);} }
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
    else if(e.type==='effect.unlucky7'&&p){ p.nums=[7]; p.mods=[]; p.second=false; p.hasLucky13=false; if(p.cards) p.cards=p.cards.filter(c=>c.id===e.card?.id); }
    else if(e.type==='effect.discarded'&&p){ removeCard(p,e.card); }
    else if(e.type==='effect.action_fizzle'&&p){ removeCard(p,e.card); }
    else if(e.type==='effect.stolen'){ const fp=lv.flip7.players[e.from]; const tp=lv.flip7.players[e.to]; if(fp) removeCard(fp,e.card); if(tp) addCard(tp,e.card); }
    else if(e.type==='effect.swapped'){ const p1=lv.flip7.players[e.p1]; const p2=lv.flip7.players[e.p2]; if(p1){ removeCard(p1,e.c1); addCard(p1,e.c2); } if(p2){ removeCard(p2,e.c2); addCard(p2,e.c1); } }
    else if(e.type==='effect.stay'&&p){ p.status='stayed'; }
    else if(e.type==='card.transfer'){
      const fp=lv.flip7.players[e.actor];
      if(fp&&e.card) removeCard(fp,e.card);
      if(fp&&fp.actionCards) removeOne(fp.actionCards,e.actionKind||e.card?.v);
      const tp=lv.flip7.players[e.target];
      if(e.secondPass){ if(tp)tp.second=true; }
      else if(tp&&e.card&&e.card.kind==='mod') addCard(tp,e.card);
      // freeze/flip3 spent marker on the target comes from the authoritative view's
      // spentActions (server), so no client-side bookkeeping needed here.
    }
    else if(e.type==='effect.vengeance_penalty'){
      const tp=lv.flip7.players[e.target];
      if(tp) tp.banked = Math.max(0, tp.banked - e.points);
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
          // Self-targeted action banner: use the card glyph for freeze (❄ in
          // sky-blue, matching the freeze-card face) and a "sparkle" icon for
          // flip3. We don't go through Kit.Icon here because turnBanner takes
          // a plain string; the suit glyph reads as part of the card's voice.
          if(e.auto)Kit.turnBanner((e.actionKind==='freeze'?'\u2744 ':'+3 ')+'on self!',false);
        } else if(e.secondPass){
          // Second-chance card uses the same heart glyph as the card face.
          SFX.flip(); if(e.auto)Kit.turnBanner('\u2665 passed',true);
        }
        await sleep(SPEED.beat*0.45); break;
      }
      case 'effect.bust':{
        // The engine emits `bust` WITHOUT a preceding `card` event. Deal the
        // offending duplicate FIRST (player still shown active) so it visibly
        // LANDS on the board, and only THEN apply the busted state + reaction.
        if(mode==='local')eventFocus=e.actor;
        const bp=liveView.flip7.players[e.actor];
        // Temporarily add the duplicate as a normal card so it gets a real anchor
        // and flies in like any deal. We tag it bust-{value} for a stable id.
        const dupId=`bust-${e.value}`;
        const lp=bp; lp.cards=Array.isArray(lp.cards)?lp.cards:[];
        if(!lp.cards.some(c=>c.id===dupId)) lp.cards=orderCards([...lp.cards,{id:dupId,kind:'num',v:e.value}]);
        recalcAll(liveView);
        draw(liveView);
        const bustPermId=`flip7:table:p${e.actor}:${dupId}`;
        await flyDealCard(bustPermId,e.actor,cmCardSlot(bustPermId));
        if(!tokenAlive(token)) return;
        // Remove the temp card from cards before busting: the busted render adds
        // the same card via its own bust-cause branch (same id), so leaving it in
        // `cards` would create a duplicate anchor. reconcile keeps the overlay.
        lp.cards=lp.cards.filter(c=>c.id!==dupId);
        // NOW apply the bust: mark busted, render busted visuals + the bust-cause
        // highlight, shake, banner.
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
        // Engine emits second_used with NO preceding card event. We: (1) FIRST fly the
        // consumed Second Chance card (still on the board from the previous render) to
        // the discard — captured before any redraw, while its overlay still exists;
        // (2) deal the offending duplicate IN so the player sees what triggered it;
        // (3) fly that duplicate to discard too. All REAL permanent cards (no clones).
        if(mode==='local')eventFocus=e.actor;
        const sp=liveView.flip7.players[e.actor];
        SFX.good(); Kit.turnBanner('Second Chance!',true);
        // (1) discard the Second Chance card NOW. Prefer the REAL on-board card if its
        //     overlay is still live; otherwise (the engine already consumed it before
        //     this event, so it's gone from the board) fly a one-off representation
        //     FROM the player's board TO the discard — it's leaving the screen anyway.
        const secAnchor0=document.querySelector(`[data-card-reg^="flip7:table:p${e.actor}:"][data-act="second"]`);
        const secPerm=secAnchor0?secAnchor0.dataset.cardReg:null;
        const discardEl=$('f7Discard');
        if(secPerm && Kit.CardManager.has(secPerm)){
          await flyPermToDiscard(secPerm,{kind:'act',v:'second'}); if(!tokenAlive(token)) return;
        } else {
          const fromEl=rowOf(e.actor)||boardOf(e.actor);
          if(fromEl && discardEl){ await flyF7Card(fromEl,discardEl,{kind:'act',v:'second'},{spin:true,duration:SPEED.actionFly}); if(!tokenAlive(token)) return; }
        }
        // (2) deal the duplicate in as a temporary card on the board.
        const dupId='second-dup-'+e.seq;
        sp.cards=Array.isArray(sp.cards)?sp.cards:[];
        if(!sp.cards.some(c=>c.id===dupId)) sp.cards=orderCards([...sp.cards,{id:dupId,kind:'num',v:e.value}]);
        recalcAll(liveView); draw(liveView);
        const dupPerm=`flip7:table:p${e.actor}:${dupId}`;
        await flyDealCard(dupPerm,e.actor,cmCardSlot(dupPerm)); if(!tokenAlive(token)) return;
        await sleep(SPEED.beat*0.4);
        // (3) discard the duplicate too.
        await flyPermToDiscard(dupPerm,{kind:'num',v:e.value}); if(!tokenAlive(token)) return;
        // apply authoritative state (p.second=false) + clean the temp card.
        sp.cards=(sp.cards||[]).filter(c=>c.id!==dupId && c.v!=='second');
        advanceLiveView(liveView,e);
        recalcAll(liveView);
        draw(liveView);
        await sleep(SPEED.beat*0.4); break;
      }
      case 'effect.flip7':{ advanceLiveView(liveView,e); draw(liveView); SFX.win(); Kit.confetti(); Kit.turnBanner('FLIP 7! +15',true); await sleep(SPEED.beat); break; }
      case 'effect.unlucky7':{
        advanceLiveView(liveView,e); draw(liveView); SFX.bad();
        Kit.turnBanner('UNLUCKY 7! Board wiped!',false);
        const b=boardOf(e.actor); if(b){b.style.animation='shakeX .5s ease';}
        await sleep(SPEED.beat); break;
      }
      case 'effect.discarded':{
        if(mode==='local')eventFocus=e.actor;
        advanceLiveView(liveView,e); draw(liveView); SFX.discard();
        Kit.turnBanner('Card discarded!',false);
        await sleep(SPEED.beat*0.5); break;
      }
      case 'effect.stolen':{
        if(mode==='local')eventFocus=e.from;
        draw(liveView);
        const fromEl=rowOf(e.from); const toEl=rowOf(e.to);
        if(fromEl&&toEl) await flyF7Card(fromEl,toEl,e.card,{duration:SPEED.actionFly});
        advanceLiveView(liveView,e); draw(liveView); SFX.good();
        Kit.turnBanner('Card stolen!',true);
        await sleep(SPEED.beat*0.5); break;
      }
      case 'effect.swapped':{
        if(mode==='local')eventFocus=e.p1;
        draw(liveView);
        const p1El=rowOf(e.p1); const p2El=rowOf(e.p2);
        if(p1El&&p2El){
          flyF7Card(p1El,p2El,e.c1,{duration:SPEED.actionFly});
          await flyF7Card(p2El,p1El,e.c2,{duration:SPEED.actionFly});
        }
        advanceLiveView(liveView,e); draw(liveView); SFX.swap();
        Kit.turnBanner('Cards swapped!',true);
        await sleep(SPEED.beat*0.5); break;
      }
      case 'effect.stay':{ advanceLiveView(liveView,e); draw(liveView); SFX.good(); break; }
      case 'effect.flip3_abandon':{ Kit.turnBanner('Flip 3 abandoned',false); await sleep(SPEED.beat*0.6); break; }
      case 'effect.second_discard':{ await sleep(SPEED.beat*0.3); break; }
      case 'effect.action_fizzle':{ advanceLiveView(liveView,e); draw(liveView); Kit.turnBanner('No valid target — discarded',false); await sleep(SPEED.beat*0.4); break; }
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
      // Turn banner is now handled by Kit.Turn (called automatically by
      // GameShell.render). Flip 7 keeps just the event-list short-circuit
      // since it has more nuanced banner control during animation pipelines.
    }
    playEvents(view, token);
  }
  function act(seat,msg){ GameActions.act(seat,msg); } // delegates to shared helper (L4)
  function clientAct(action, extra={}){
    const seat = window._renderView?.yourSeat ?? 0;
    GameActions.send(action, extra, seat);
  }
  // reset the timeline cursor when (re)entering a game
  window._flip7ResetSeq=function(){lastSeq=-1;invalidateToken();};
  function unmount(){invalidateToken(); Kit.Controls.clear('f7Controls');const d=$('f7DealerWrap');if(d)d.remove();const mini=$('miniBoardsContainer');if(mini){mini.innerHTML='';mini.className='mini-boards-container';}}
  window.GameClients['flip7']={render,inspect,unmount,act:clientAct};

})();

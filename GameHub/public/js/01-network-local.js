/* ====================== NETWORK ====================== */
function wsUrl(party,room){const p=location.protocol==='https:'?'wss':'ws';return `${p}://${PARTYKIT_HOST}/parties/${party}/${encodeURIComponent(room)}`;}
let _joinAttempt=null; // remembers join params so we can roll quick-play shards on "full"
let onlineDevicePlayers=[];
function getSeatPid(i){let p=localStorage.getItem('hub_pid_'+i);if(!p){p='p_'+Math.random().toString(36).slice(2,10)+Date.now().toString(36)+'_'+i;localStorage.setItem('hub_pid_'+i,p);}return p;}
function syncOnlinePrimaryName(){const n=($('onlineName')?.value||'').trim();if(!onlineDevicePlayers.length)onlineDevicePlayers=[{name:n||'Player'}];else onlineDevicePlayers[0].name=n||onlineDevicePlayers[0].name||'Player';}
function onlineSeatsPayload(){syncOnlinePrimaryName();return onlineDevicePlayers.map((p,i)=>({pid:getSeatPid(i),name:(p.name||('Player '+(i+1))).slice(0,20)}));}
function renderOnlineDevicePlayers(){syncOnlinePrimaryName();const box=$('onlineDevicePlayers');if(!box)return;box.innerHTML=onlineDevicePlayers.map((p,i)=>`<div style="display:flex;gap:6px;align-items:center;margin-bottom:5px"><input class="input" style="margin:0;padding:8px" value="${p.name.replace(/"/g,'&quot;')}" ${i===0?'placeholder="Main player"':'placeholder="Same-device player"'} oninput="onlineDevicePlayers[${i}].name=this.value; if(${i}===0)$('onlineName').value=this.value"><button class="icon-btn" ${i===0?'disabled style="opacity:.3"':''} onclick="onlineDevicePlayers.splice(${i},1);renderOnlineDevicePlayers()">✕</button></div>`).join('');}
function addOnlineDevicePlayer(){syncOnlinePrimaryName();if(onlineDevicePlayers.length>=8)return;onlineDevicePlayers.push({name:'Player '+(onlineDevicePlayers.length+1)});renderOnlineDevicePlayers();}
function connectRoom(code,{isPublic=false,quickGame=null,maxPlayers=8,shard=null}={}){
  mode='online';net.room=code;net.isHost=false;net.spectating=false;
  _joinAttempt={code,isPublic,quickGame,maxPlayers,shard};
  if(net.ws){try{net.ws.close();}catch(e){}}
  resetGameUi();
  const ws=new WebSocket(wsUrl('room',code));net.ws=ws;
  ws.onopen=()=>ws.send(JSON.stringify({type:'join',pid:getPid(),name:myName,seats:onlineSeatsPayload(),isPublic,quickGame,maxPlayers}));
  ws.onmessage=ev=>{let m;try{m=JSON.parse(ev.data);}catch(e){return;}handleNet(m);};
  ws.onerror=()=>toast('Connection error');
}
function hostRoom(){ensureName();const c=$('hostRoom').value.trim().toUpperCase();if(!c)return toast('Enter a room code');connectRoom(c,{isPublic:_vis==='public',maxPlayers:_maxPlayers});}
function joinByCode(){ensureName();const c=$('joinRoom').value.trim().toUpperCase();if(!c)return toast('Enter a room code');connectRoom(c,{});}
function joinPublic(code){ensureName();connectRoom(code,{});}
// Quick Play uses sharded room codes: quick-<game>-1, -2, … On "full" we roll to
// the next shard so players pool together until a room fills, then overflow opens a new one.
function quickPlay(gameId,shard=1){ensureName();connectRoom('quick-'+gameId+'-'+shard,{isPublic:true,quickGame:gameId,shard});}

function handleNet(m){
  if(m.type==='hello')return;
  if(m.type==='error'){toast(m.message);return;}
  if(m.type==='room_full'){
    if(_joinAttempt&&_joinAttempt.shard){ // quick play: try the next shard
      const next=_joinAttempt.shard+1;
      if(next<=20){toast('Room full — finding another table…',1800);quickPlay(_joinAttempt.quickGame,next);return;}
    }
    toast('That room is full.');leaveOnline();return;
  }
  if(m.type==='spectating'){net.spectating=true;toast('👁 '+m.message,3600);return;}
  if(m.type==='room'){
    net.isHost=m.isHost;net.spectating=false;
    if(m.catalogue&&m.catalogue.length)catalogue=m.catalogue;
    renderRoom(m);
    showScreen('roomScreen');
    return;
  }
  if(m.type==='game'){
    net.isHost=m.isHost;net.spectating=(m.view.yourSeat<0);
    window._currentBots=m.bots||[];   // bot seats the host must drive
    window._controlledSeats=m.controlledSeats||[];
    window._controlledViews=m.views||[];
    $('gameRoomTag').textContent=net.room||'';$('gameRoomTag').classList.toggle('hidden',!net.room);
    $('spectateTag').classList.toggle('hidden',!net.spectating);
    if(!$('gameScreen').classList.contains('active'))showScreen('gameScreen');
    dispatchView(m.view);
    return;
  }
}
let _botDiff='medium';
function setBotDiff(d){_botDiff=d;document.querySelectorAll('#botDiffSeg button').forEach(b=>b.classList.toggle('on',b.dataset.d===d));}
function addBot(){net.send({type:'add_bot',difficulty:_botDiff});}
function removeBot(){net.send({type:'remove_bot'});}
function renderRoom(m){
  $('roomCode').textContent=m.code;
  $('roomVis').textContent=(m.quickGame?'⚡ Quick Play · ':'')+(m.isPublic?'🌍 Public room':'🔒 Private room');
  $('roomMembers').innerHTML=m.members.map(p=>`<span class="chip"${p.bot?' style="background:#312e81;color:#c7d2fe"':''}>${p.name}${p.id===getPid()?' (You)':''}${p.bot?' · '+(p.difficulty||'med'):''}</span>`).join('')||'<span class="muted">Just you so far…</span>';
  $('hostArea').classList.toggle('hidden',!m.isHost);
  $('guestArea').classList.toggle('hidden',m.isHost);
  // bot controls (host only)
  let botBox=$('botBox');
  if(m.isHost){
    if(!botBox){botBox=document.createElement('div');botBox.id='botBox';botBox.style.cssText='margin:12px 0';
      $('roomMembers').parentNode.appendChild(botBox);}
    const nBots=m.members.filter(x=>x.bot).length;
    const full=m.members.length>=(m.maxPlayers||8);
    botBox.innerHTML=`<div class="seg" id="botDiffSeg" style="margin-bottom:8px">
        <button data-d="easy" class="${_botDiff==='easy'?'on':''}" onclick="setBotDiff('easy')">😊 Easy</button>
        <button data-d="medium" class="${_botDiff==='medium'?'on':''}" onclick="setBotDiff('medium')">🙂 Medium</button>
        <button data-d="hard" class="${_botDiff==='hard'?'on':''}" onclick="setBotDiff('hard')">🤖 Hard</button>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn secondary" style="margin:0" onclick="addBot()" ${full?'disabled':''}>+ Add Bot</button>
        ${nBots?`<button class="btn secondary" style="margin:0" onclick="removeBot()">− Remove Bot</button>`:''}
      </div>`;
  } else if(botBox){ botBox.remove(); }
  if(m.isHost) renderTiles('hostTiles',gid=>net.send({type:'launch_game',gameId:gid}), m.members.length);
}
function leaveOnline(){if(net.ws){try{net.ws.close();}catch(e){}net.ws=null;}net.room=null;net.isHost=false;net.spectating=false;window._currentBots=[];resetGameUi();showScreen('onlineSetup');}
function leaveGameToRoom(){ // back arrow in game
  if(mode==='local'){ if(confirm('Leave the game?')){ resetGameUi(); showScreen('menuScreen'); } return; }
  if(net.isHost){ if(confirm('Return everyone to the room lobby?')) net.send({type:'to_room'}); }
  else { if(confirm('Leave the game?')) leaveOnline(); }
}

/* public room browser */
function connectLobby(){
  if(net.lobbyWs){try{net.lobbyWs.close();}catch(e){}}
  const ws=new WebSocket(wsUrl('lobby','public-lobby'));net.lobbyWs=ws;
  ws.onmessage=ev=>{let m;try{m=JSON.parse(ev.data);}catch(e){return;}if(m.type==='rooms')renderPublic(m.rooms);};
  ws.onerror=()=>{$('publicList').innerHTML='<div class="muted">Public list unavailable.</div>';};
}
function gameName(id){const g=catalogue.find(g=>g.id===id);return g?g.emoji+' '+g.name:(id||'game');}
function renderPublic(rooms){
  const el=$('publicList');
  if(!rooms||!rooms.length){el.innerHTML='<div class="muted">No open public rooms right now.</div>';return;}
  el.innerHTML=rooms.map(r=>{
    const live=r.inGame,label=live?'Spectate':'Join';
    const status=live?'<span style="color:#f59e0b">🎮 '+gameName(r.gameId)+'</span>':(r.gameId?'<span style="color:#10b981">⚡ '+gameName(r.gameId)+' lobby</span>':'<span style="color:#10b981">⏳ Waiting</span>');
    return `<div class="room-row"><div><div class="rc">${r.code.replace(/^quick-/,'⚡ ')}</div><div class="rm">${r.hostName} · ${r.players}/${r.maxPlayers} · ${status}</div></div><button onclick="joinPublic('${r.code.replace(/'/g,"")}')">${label}</button></div>`;
  }).join('');
}

/* ====================== GAME VIEW DISPATCH ====================== */
// Hub hands the view to the right game client. Adding a game = add a client here.
function dispatchView(view){
  const client=window.GameClients[view.game];
  if(!client){toast('Unknown game: '+view.game);return;}
  window._renderView=view;
  if(animating){pendingView=view;return;}
  GameShell.render(view,client);
  maybeRunBot(view); // drive bot seats if we're responsible
}
function flushView(){if(pendingView){const v=pendingView;pendingView=null;dispatchView(v);}}
function removeQwixxUi(){const top=$('topArea');if(!top)return;top.querySelectorAll('.qwixx-dice-zone,.qwixx-top-mini-strip').forEach(el=>el.remove());}
function resetGameUi(){curView=null;prevView=null;animating=false;pendingView=null;summaryShown=false;lastRoundShown=false;$('overlay').classList.add('hidden');$('overlay').style.opacity='';GameShell.unmount();$('topArea').style.display='';const piles=$('topArea').querySelector('.piles');if(piles)piles.style.display='flex';$('heldCardWrapper').style.display='';if(window._flip7ResetSeq)window._flip7ResetSeq();}
function hideOverlay(){const o=$('overlay');if(o.classList.contains('hidden'))return;o.style.opacity='0';setTimeout(()=>{o.classList.add('hidden');o.style.opacity='';},220);}
function bumpStatus(){const sb=$('statusBar');sb.classList.remove('bump');void sb.offsetWidth;sb.classList.add('bump');}

/* shared end-of-game/round summary (used by any game that sets view.summary) */
function showSummary(view){
  const sm=view.summary;if(!sm)return;
  const overlay=$('overlay'),box=$('overlayBox');
  const isOver=view.over;
  const hasDelta=sm.rows.some(r=>r.delta!=null);
  const head=`<tr><th>Player</th>${hasDelta?'<th>Round</th>':''}<th>Total</th></tr>`;
  const rows=sm.rows.map(r=>{const w=isOver&&sm.winners.includes(r.seat);const d=r.delta!=null?`<td>${r.delta>=0?'+':''}${r.delta}</td>`:'';return `<tr class="${w?'winner-row':''}"><td>${r.name}${w?' <span class="crown">🏆</span>':''}</td>${d}<td>${r.score}</td></tr>`;}).join('');
  const wn=sm.winners.map(i=>{const r=sm.rows.find(x=>x.seat===i);return r?r.name:'';}).join(' & ');
  let foot=isOver?`<div style="font-size:1.4rem;font-weight:900;margin:16px 0;color:#10b981"><span class="crown">🏆</span> ${wn} ${sm.winners.length>1?'win':'wins'}!</div>`:'';
  let btns;
  if(mode==='local'){btns=isOver?`<button class="btn green" onclick="localNext()">Play Again</button><button class="btn secondary" onclick="quitLocal()">Menu</button>`:`<button class="btn" onclick="localNext()">Next Round</button>`;}
  else if(net.isHost){btns=`<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">${isOver?`<button class="btn green" onclick="net.send({type:'next_round'})">New Game</button><button class="btn secondary" onclick="net.send({type:'to_room'})">Back to Room</button>`:`<button class="btn" onclick="net.send({type:'next_round'})">Next Round</button>`}</div>`;}
  else btns='<div class="muted">Waiting for host…</div>';
  box.innerHTML=`<h2 style="margin:0 0 6px;font-size:1.8rem">${isOver?'Game Over!':'Round Complete'}</h2><table class="score-table">${head}${rows}</table>${foot}<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">${btns}</div>`;
  overlay.classList.remove('hidden');overlay.style.opacity='';
  if(isOver){Kit.confetti();SFX.win();}else SFX.good();
}

/* ====================== LOCAL PLAY (offline, single-device) ====================== */
let localEngine=null,localGameId=null,localActor=0;
let _localPick='skyjo';
/* Local seats: array of {name, bot, difficulty}. Rendered as rows. */
let localSeats=[{name:'Player 1',bot:false},{name:'Player 2',bot:false}];
let _localBotDiff='medium';
function setLocalBotDiff(d){_localBotDiff=d;document.querySelectorAll('#localBotDiff button').forEach(b=>b.classList.toggle('on',b.dataset.d===d));}
function renderLocalSeats(){
  const box=$('localPlayers');box.innerHTML='';
  localSeats.forEach((seat,i)=>{
    const row=document.createElement('div');row.style.cssText='display:flex;gap:6px;align-items:center;margin-bottom:6px';
    const inp=document.createElement('input');inp.type='text';inp.className='input';inp.style.margin='0';inp.value=seat.name;
    inp.disabled=!!seat.bot;inp.oninput=()=>{localSeats[i].name=inp.value;};
    if(seat.bot)inp.style.opacity='.7';
    const del=document.createElement('button');del.className='icon-btn';del.textContent='✕';del.onclick=()=>{localSeats.splice(i,1);renderLocalSeats();refreshLocalTiles();};
    row.appendChild(inp);if(localSeats.length>2||seat.bot)row.appendChild(del);
    box.appendChild(row);
  });
}
function localCount(){return localSeats.length;}
function addLocalBot(){if(localSeats.length>=8)return;const names=['Botley','Chip','Ada','Turing','Pixel','Nova'];const n=localSeats.filter(s=>s.bot).length;localSeats.push({name:(names[n]||'Bot')+' 🤖',bot:true,difficulty:_localBotDiff});renderLocalSeats();refreshLocalTiles();}
function refreshLocalTiles(){
  renderTiles('localTiles',gid=>{_localPick=gid;markLocalPick();},localCount());
  markLocalPick();
}
function markLocalPick(){document.querySelectorAll('#localTiles .game-tile').forEach(t=>{t.style.borderColor=(t.dataset.g===_localPick&&t.dataset.fits==='true')?'var(--accent)':'';});}
function addLocalPlayer(){if(localSeats.length>=8)return;localSeats.push({name:'Player '+(localSeats.length+1),bot:false});renderLocalSeats();refreshLocalTiles();}
function startLocalGame(){
  const seats=localSeats.map(s=>({name:(s.name||'').trim()||(s.bot?'Bot':'Player'),bot:s.bot,difficulty:s.difficulty}));
  const names=seats.map(s=>s.name);
  const g=catalogue.find(x=>x.id===_localPick);
  if(g&&(names.length<g.minPlayers||names.length>g.maxPlayers))return toast(`${g.name} needs ${g.minPlayers}–${g.maxPlayers} players.`);
  if(names.length<2)return toast('Need at least 2 players');
  if(!window.LocalEngines[_localPick])return toast('That game is online-only for now.');
  mode='local';localGameId=_localPick;localEngine=window.LocalEngines[_localPick](names);
  // bot seats the local device will drive
  window._currentBots=seats.map((s,i)=>s.bot?{seat:i,difficulty:s.difficulty||'medium'}:null).filter(Boolean);
  window._controlledSeats=seats.map((s,i)=>!s.bot?i:-1).filter(i=>i>=0);
  resetGameUi();showScreen('gameScreen');$('gameRoomTag').classList.add('hidden');$('spectateTag').classList.add('hidden');
  renderLocal();
}
function isLocalBotSeat(seat){return !!localSeats[seat]?.bot;}
function firstLocalHumanSeat(){const i=localSeats.findIndex(s=>!s.bot);return i>=0?i:0;}
function localDisplaySeat(preferred=null){
  const actor=localEngine.actor();
  if(preferred!=null&&!isLocalBotSeat(preferred))return preferred;
  if(actor!=null&&!isLocalBotSeat(actor))return actor;
  return firstLocalHumanSeat();
}
function renderLocal(){const v=localEngine.viewFor(localDisplaySeat());window._controlledSeats=SeatModel.localHumanSeats();dispatchView(v);}
function localAct(seat,msg){
  localEngine.apply(seat,msg);
  // Human same-device seats keep focus for their own event timelines. Bots are
  // treated like another device: they may act, but the local UI remains on a
  // human-controlled board.
  const displaySeat=localDisplaySeat(seat);
  const actedView=localEngine.viewFor(displaySeat);
  const gameState=actedView&&actedView[actedView.game];
  if(gameState&&Array.isArray(gameState.events)&&gameState.events.length){dispatchView(actedView);return;}
  renderLocal();
}
function localNext(){localEngine.next();resetGameUi();renderLocal();}
function quitLocal(){window._currentBots=[];resetGameUi();showScreen('menuScreen');}

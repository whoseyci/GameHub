/* ====================== NETWORK ====================== */
function wsUrl(party,room){const p=location.protocol==='https:'?'wss':'ws';return `${p}://${PARTYKIT_HOST}/parties/${party}/${encodeURIComponent(room)}`;}
let _joinAttempt=null; // remembers join params so we can roll quick-play shards on "full"
let onlineDevicePlayers=[];
function getSeatPid(i){let p=localStorage.getItem('hub_pid_'+i);if(!p){p='p_'+Math.random().toString(36).slice(2,10)+Date.now().toString(36)+'_'+i;localStorage.setItem('hub_pid_'+i,p);}return p;}
function syncOnlinePrimaryName(){const n=($('onlineName')?.value||'').trim();if(!onlineDevicePlayers.length)onlineDevicePlayers=[{name:n||'Player'}];else onlineDevicePlayers[0].name=n||onlineDevicePlayers[0].name||'Player';}
function onlineSeatsPayload(){syncOnlinePrimaryName();return onlineDevicePlayers.map((p,i)=>({pid:getSeatPid(i),name:(p.name||('Player '+(i+1))).slice(0,20)}));}
function renderOnlineDevicePlayers(){syncOnlinePrimaryName();const box=$('onlineDevicePlayers');if(!box)return;box.innerHTML=onlineDevicePlayers.map((p,i)=>`<div style="display:flex;gap:6px;align-items:center;margin-bottom:5px"><input class="input" style="margin:0;padding:8px" value="${p.name.replace(/"/g,'&quot;')}" ${i===0?'placeholder="Main player"':'placeholder="Same-device player"'} oninput="onlineDevicePlayers[${i}].name=this.value; if(${i}===0)$('onlineName').value=this.value"><button class="icon-btn" ${i===0?'disabled style="opacity:.3"':''} onclick="onlineDevicePlayers.splice(${i},1);renderOnlineDevicePlayers()">${Kit.Icon.html('x',{size:14})}</button></div>`).join('');}
function addOnlineDevicePlayer(){syncOnlinePrimaryName();if(onlineDevicePlayers.length>=8)return;onlineDevicePlayers.push({name:'Player '+(onlineDevicePlayers.length+1)});renderOnlineDevicePlayers();}
function connectRoom(code,{isPublic=false,isGroup=false,quickGame=null,maxPlayers=8,shard=null,variant=null}={}){
  const resolvedGroup = isGroup || String(code||'').toUpperCase().startsWith('GROUP-');
  mode='online';net.room=code;net.isHost=false;net.spectating=false;
  window.mode = mode;
  _joinAttempt={code,isPublic,isGroup:resolvedGroup,quickGame,maxPlayers,shard,variant};
  if(net.ws){try{net.ws.close();}catch(e){}}
  resetGameUi();
  const ws=new WebSocket(wsUrl('room',code));net.ws=ws;
  ws.onopen=()=>ws.send(JSON.stringify({type:'join',pid:getPid(),name:myName,seats:onlineSeatsPayload(),isPublic,isGroup:resolvedGroup,quickGame,maxPlayers,variant}));
  ws.onmessage=ev=>{let m;try{m=JSON.parse(ev.data);}catch(e){return;}handleNet(m);};
  ws.onerror=()=>toast('Connection error');
}
function hostRoom(){ensureName();const c=$('hostRoom').value.trim().toUpperCase();if(!c)return toast('Enter a room code');connectRoom(c,{isPublic:_vis==='public',maxPlayers:_maxPlayers});}
function joinByCode(){ensureName();const c=$('joinRoom').value.trim().toUpperCase();if(!c)return toast('Enter a room code');connectRoom(c,{});}
function joinPublic(code){ensureName();connectRoom(code,{});}
// Quick Play uses sharded room codes: quick-<game>-1, -2, … On "full" we roll to
// the next shard so players pool together until a room fills, then overflow opens a new one.
function quickPlay(gameId,shard=1){
  ensureName();
  const g = (catalogue||[]).find(x=>x.id===gameId);
  const variants = g?.variants || g?.features?.variants;
  if(variants && variants.length > 1){
    openVariantPicker(gameId, variants, (vid) => {
      connectRoom('quick-'+gameId+'-'+shard,{isPublic:true,quickGame:gameId,shard,variant:vid});
    });
    return;
  }
  connectRoom('quick-'+gameId+'-'+shard,{isPublic:true,quickGame:gameId,shard});
}
// W6 part 2: spin up a persistent GROUP room. Group room codes are
// "group-<6char>" (uppercased). The host hops in via connectRoom with
// isGroup=true so the server stamps the room as a group on the first join.
function hostGroup(){
  ensureName();
  const code='GROUP-'+Math.random().toString(36).slice(2,8).toUpperCase();
  // Groups are by definition discoverable + ready-gated; the server forces
  // isPublic=true when a room flips into a group, but we also send it on
  // the initial join so the very first member never sees a stale state.
  connectRoom(code,{isPublic:true,isGroup:true,maxPlayers:8});
}
// W6 part 2: host-only toggle that flips an existing room into (or out of)
// a persistent group. Server enforces the host + between-games rule, but
// we also gate the button so it never even renders for non-hosts or mid-game.
function toggleGroupRoom(makeGroup){ net.send({type:'set_group',isGroup:!!makeGroup}); }

// W6: invite-link helper. Copies "${origin}/?join=${roomCode}" to the
// clipboard so the host can paste it anywhere. The landing page boots,
// sees ?join=CODE and auto-joins (see public/js/00-landing.js).
function copyInviteLink(){
  if(!net.room) return;
  const url=location.origin+'/?join='+encodeURIComponent(net.room);
  const btn=$('inviteBtn'); const original=btn?btn.innerHTML:'';
  const finish=(ok)=>{
    if(btn){
      btn.innerHTML='';
      btn.appendChild(Kit.Icon(ok?'check':'x',{size:18}));
      setTimeout(()=>{ btn.innerHTML=original; },1400);
    }
    toast(ok?'Invite link copied':'Copy failed',1400);
  };
  if(navigator.clipboard?.writeText){
    navigator.clipboard.writeText(url).then(()=>finish(true),()=>finish(false));
  } else {
    try { const ta=document.createElement('textarea');ta.value=url;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);finish(true); }
    catch { finish(false); }
  }
}

function handleNet(m){
  // Social layer (chat / reactions). It also peeks at `hello` for chat history.
  if(window.Social){ const consumed=Social.handleNet(m); if(consumed) return; }
  if(m.type==='hello')return;
  if(m.type==='error'){toast(m.message);return;}
  // Structured action rejection (Proposal 10): surface why a move was ignored.
  if(m.type==='action_rejected'){toast(m.reason||'Move not allowed.',2200);return;}
  if(m.type==='room_full'){
    if(_joinAttempt&&_joinAttempt.shard){ // quick play: try the next shard
      const next=_joinAttempt.shard+1;
      if(next<=20){
        toast('Room full — finding another table…',1800);
        if(_joinAttempt.variant) connectRoom('quick-'+_joinAttempt.quickGame+'-'+next,{isPublic:true,quickGame:_joinAttempt.quickGame,shard:next,variant:_joinAttempt.variant});
        else quickPlay(_joinAttempt.quickGame,next);
        return;
      }
    }
    toast('That room is full.');leaveOnline();return;
  }
  if(m.type==='spectating'){net.spectating=true;toast(m.message,3600);return;}
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
    // Shareable replay handle (server pushes it with every game broadcast).
    window._currentReplay={ roomCode:m.roomCode||net.room||'', id:m.replayId||null };
    // Seat → identity map so the client knows who's at the table.
    window._currentSeats=m.seats||[];
    // Identity: record everyone (non-bot) we're playing with as a "recent".
    if(window.Identity && Array.isArray(m.seats)){
      for(const s of m.seats){ if(!s.bot && s.pid && s.name) Identity.recordEncounter({pid:s.pid,name:s.name}); }
    }
    // Identity: when the game ends and we have a summary, lock in head-to-head AND ELO.
    const wasOver = !!(window._lastFinalGame && window._lastFinalGame.game===m.view.game && window._lastFinalGame.over);
    if(window.Identity && m.view.over && m.view.summary && Array.isArray(m.view.summary.winners) && !wasOver){
      const players = (m.seats||[]).map(s=>({seat:s.seat,pid:s.pid}));
      Identity.recordGameResult({ gameId: m.view.game, winners: m.view.summary.winners, players });
      // Unlock #3: ELO update. Stored under Identity.elo[gameId]; surfaced on
      // the menu. Skips automatically if we weren't a player (spectator) since
      // Identity.updateElo() returns null when our pid isn't in the field.
      try { Identity.updateElo({ gameId: m.view.game, winners: m.view.summary.winners, players }); } catch {}
    }
    window._lastFinalGame = { game:m.view.game, over:!!m.view.over };
    $('gameRoomTag').textContent=net.room||'';$('gameRoomTag').classList.toggle('hidden',!net.room);
    $('spectateTag').classList.toggle('hidden',!net.spectating);
    if(!$('gameScreen').classList.contains('active'))showScreen('gameScreen');
    // Online play → chat + reactions available (pass-and-play is one device).
    if(window.Social) Social.setActive(true);
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
  // Visibility line: icon + text via innerHTML (Kit.Icon returns SVG strings).
  // W6 part 2: visibility line now also flags group rooms separately so the
  // user knows this room sticks around between games.
  $('roomVis').innerHTML=
    (m.quickGame?Kit.Icon.html('rocket',{size:12,cls:'kit-icon-inline'})+'Quick Play &middot; ':'')
    +(m.isGroup?Kit.Icon.html('users',{size:12,cls:'kit-icon-inline'})+'Group &middot; ':'')
    +(m.isPublic?Kit.Icon.html('globe',{size:12,cls:'kit-icon-inline'})+'Public room':Kit.Icon.html('lock',{size:12,cls:'kit-icon-inline'})+'Private room');
  // Identity: record every human in the room as a "recent" so they appear on
  // the menu next time. Bots and ourselves are skipped inside recordEncounter.
  if(window.Identity){ for(const p of (m.members||[])){ if(!p.bot && p.id && p.name) Identity.recordEncounter({pid:p.id,name:p.name}); } }
  // W6 part 2: if this is a persistent group room, remember the code so the
  // user can re-join from the menu's "Recent groups" chip row next time.
  // We DON'T record quick-play shards (they're ephemeral and the code is
  // a synthetic prefix nobody types).
  if(window.Identity && m.isGroup && m.code && !String(m.code).startsWith('quick-')){
    const host = (m.members||[]).find(p=>p.id===(m.hostId||''))?.name;
    Identity.recordGroup({ code:m.code, hostName:host });
  }
  // W6: render members with a ready check pip when in a quick-play / group
  // lobby (anywhere ready-gating matters). Plain chips for custom rooms.
  const isReadyLobby = !!(m.quickGame || m.isGroup);
  $('roomMembers').innerHTML=m.members.map(p=>{
    const ready = p.bot || !!p.ready;
    const readyMark = isReadyLobby
      ? (ready
          ? '<span class="ready-pip on" title="Ready">'+Kit.Icon.html('check',{size:11})+'</span>'
          : '<span class="ready-pip" title="Not ready">'+Kit.Icon.html('spinner',{size:11,cls:'kit-icon-spinner'})+'</span>')
      : '';
    const botStyle = p.bot?' style="background:#312e81;color:#c7d2fe"':'';
    return `<span class="chip"${botStyle}>${readyMark}${esc(p.name)}${p.id===getPid()?' (You)':''}${p.bot?' · '+esc(p.difficulty||'med'):''}</span>`;
  }).join('')||'<span class="muted">Just you so far…</span>';
  // W6: ready button — visible in quick-play / group lobbies for the current
  // viewer. Stays prominent until everyone's ready (server then auto-starts).
  let readyBox=$('readyBox');
  if(isReadyLobby){
    if(!readyBox){
      readyBox=document.createElement('div');readyBox.id='readyBox';readyBox.style.cssText='margin:10px 0;display:flex;align-items:center;gap:10px;justify-content:center;flex-wrap:wrap';
      $('roomMembers').parentNode.appendChild(readyBox);
    }
    const me = (m.members||[]).find(p=>p.id===getPid());
    const iAmReady = !!(me && me.ready);
    const humans = (m.members||[]).filter(p=>!p.bot).length;
    const readyHumans = (m.members||[]).filter(p=>!p.bot && p.ready).length;
    const need = m.quickGame
      ? Math.max(2, (window.GameCatalogue||[]).find(g=>g.id===m.quickGame)?.minPlayers || 2)
      : 2;
    const gateText = humans < need
      ? `Waiting for ${need - humans} more · ${readyHumans}/${humans} ready`
      : `${readyHumans}/${humans} ready — game starts when all ready`;
    readyBox.innerHTML = `
      <button class="btn ${iAmReady?'secondary':'green'}" style="margin:0;flex:0 0 auto;display:inline-flex;align-items:center;gap:6px"
              onclick="net.send({type:'set_ready',ready:${!iAmReady}})">
        ${iAmReady ? Kit.Icon.html('check',{size:14})+'Ready' : Kit.Icon.html('play',{size:14})+"I'm ready"}
      </button>
      <span class="muted" style="font-size:.85rem">${gateText}</span>
    `;
  } else if(readyBox){ readyBox.remove(); }

  // W6 part 2: "Convert to group" toggle. Host-only, only outside a game
  // (server enforces too). Quick-play rooms can't be converted — they're
  // ephemeral by design; spinning up a fresh group makes more sense there.
  let groupBox=$('groupBox');
  if(m.isHost && !m.quickGame){
    if(!groupBox){
      groupBox=document.createElement('div');
      groupBox.id='groupBox';
      groupBox.style.cssText='margin:8px 0;text-align:center';
      $('roomMembers').parentNode.appendChild(groupBox);
    }
    if(m.isGroup){
      groupBox.innerHTML = `<span class="muted" style="font-size:.85rem;display:inline-flex;align-items:center;gap:6px">${Kit.Icon.html('users',{size:13,cls:'kit-icon-inline'})}Persistent group · stays open between games</span>
        <button class="btn secondary" style="margin:6px 0 0;display:inline-flex;align-items:center;gap:6px" onclick="toggleGroupRoom(false)">${Kit.Icon.html('x',{size:13})}Disband group</button>`;
    } else {
      groupBox.innerHTML = `<button class="btn secondary" style="margin:0;display:inline-flex;align-items:center;gap:6px" onclick="toggleGroupRoom(true)">${Kit.Icon.html('users',{size:14})}Convert to group</button>
        <div class="muted" style="font-size:.75rem;margin-top:4px">Keeps everyone together across multiple games</div>`;
    }
  } else if(groupBox){ groupBox.remove(); }

  // Phase 5: in a quick-play room, EVERYONE (host or guest) sees the
  // queued-game banner — there's no "host picks a game" decision. In a
  // group/custom room, only the host sees the picker; guests see the
  // "Waiting for the host to choose…" message.
  const showHostArea = m.quickGame || m.isHost;
  const showGuestArea = !m.isHost && !m.quickGame;
  $('hostArea').classList.toggle('hidden', !showHostArea);
  $('guestArea').classList.toggle('hidden', !showGuestArea);
  // Hide the "Choose a game" heading inside the locked quick-play view —
  // the banner replaces it.
  const hostHeading = $('hostHeading');
  if (hostHeading) hostHeading.style.display = m.quickGame ? 'none' : '';
  // bot controls (host only)
  let botBox=$('botBox');
  if(m.isHost){
    if(!botBox){botBox=document.createElement('div');botBox.id='botBox';botBox.style.cssText='margin:12px 0';
      $('roomMembers').parentNode.appendChild(botBox);}
    const nBots=m.members.filter(x=>x.bot).length;
    const full=m.members.length>=(m.maxPlayers||8);
    botBox.innerHTML=`<div class="seg" id="botDiffSeg" style="margin-bottom:8px">
        <button data-d="easy" class="${_botDiff==='easy'?'on':''}" onclick="setBotDiff('easy')">${Kit.Icon.html('smile',{size:14,cls:'kit-icon-inline'})}Easy</button>
        <button data-d="medium" class="${_botDiff==='medium'?'on':''}" onclick="setBotDiff('medium')">${Kit.Icon.html('happy',{size:14,cls:'kit-icon-inline'})}Medium</button>
        <button data-d="hard" class="${_botDiff==='hard'?'on':''}" onclick="setBotDiff('hard')">${Kit.Icon.html('robot',{size:14,cls:'kit-icon-inline'})}Hard</button>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn secondary" style="margin:0" onclick="addBot()" ${full?'disabled':''}>+ Add Bot</button>
        ${nBots?`<button class="btn secondary" style="margin:0" onclick="removeBot()">− Remove Bot</button>`:''}
      </div>`;
  } else if(botBox){ botBox.remove(); }
  // UX redesign Phase 5: hard-lock the game inside quick-play rooms.
  // When the room has a quickGame set, we don't render the tile picker at
  // all — the queued game is the only valid launch, and the server
  // auto-launches via canAllReadyStart() once humans are ready. We do
  // surface a single banner so the user sees what they're queued for.
  const tilesHost = $('hostTiles');
  if (tilesHost) {
    if (m.quickGame) {
      // No picker — show a fixed banner identifying the queued game.
      const gMeta = (catalogue||[]).find(x=>x.id===m.quickGame);
      const gName = gMeta ? esc(gMeta.name) : esc(m.quickGame);
      // Icon-first; falls back to emoji for games that don't ship a Phosphor name.
      const gGlyph = Kit.Icon.forGame(gMeta, { size: 32, cls: 'kit-icon-tile' });
      tilesHost.innerHTML = `
        <div class="quickplay-locked-banner" data-game="${esc(m.quickGame)}">
          <div class="qplb-emoji">${gGlyph}</div>
          <div class="qplb-body">
            <div class="qplb-eyebrow">${Kit.Icon.html('rocket',{size:12,cls:'kit-icon-inline'})}Quick Play queue</div>
            <div class="qplb-title">${gName}</div>
            <div class="qplb-hint muted">Game starts automatically when everyone's ready.</div>
          </div>
        </div>`;
    } else if (m.isHost) {
      // Normal custom / group room: full tile picker as before.
      renderTiles('hostTiles', gid => hostLaunchGame(gid), m.members.length);
    } else {
      // Guest in a custom room: clear (the "Waiting for host…" line in
      // #guestArea covers the messaging).
      tilesHost.innerHTML = '';
    }
  }
}

// W6 part 2: launch a game from the room lobby. If the game advertises
// variants in its features manifest, pop a tiny picker first; otherwise
// fire launch_game immediately like before.
function hostLaunchGame(gameId){
  const g = (catalogue||[]).find(x=>x.id===gameId);
  const variants = g?.variants || g?.features?.variants;
  if(!variants || !variants.length){
    net.send({type:'launch_game',gameId});
    return;
  }
  openVariantPicker(gameId, variants);
}

function openVariantPicker(gameId, variants, onPick){
  const overlay = $('rulesOverlay');
  const box = $('rulesBox');
  if(!overlay || !box) return;
  const g = (catalogue||[]).find(x=>x.id===gameId);
  box.innerHTML = `
    <h2 style="margin:0 0 6px;display:flex;align-items:center;gap:8px;justify-content:center">${Kit.Icon.html('cube',{size:20})}<span>${esc(g?.name || gameId)} · choose variant</span></h2>
    <div class="muted" style="margin-bottom:14px">Each variant uses different rules.</div>
    <div id="variantBtnList">
      ${variants.map(v => `
        <button class="btn variant-choice-chip" style="display:block;width:100%;margin:0 0 8px;text-align:left;padding:12px 14px"
                data-gid="${esc(gameId)}" data-vid="${esc(v.id)}">
          <div style="font-weight:800;font-size:1.02rem">${esc(v.name)}</div>
          ${v.description ? `<div class="muted" style="font-size:.82rem;margin-top:2px">${esc(v.description)}</div>` : ''}
        </button>`).join('')}
    </div>
    <button class="btn secondary" style="margin-top:6px" onclick="$('rulesOverlay').classList.add('hidden')">Cancel</button>`;
  box.querySelectorAll('.variant-choice-chip').forEach(btn => {
    btn.onclick = () => {
      $('rulesOverlay').classList.add('hidden');
      if (typeof onPick === 'function') onPick(btn.dataset.vid);
      else pickVariantAndLaunch(btn.dataset.gid, btn.dataset.vid);
    };
  });
  overlay.classList.remove('hidden');
}
function pickVariantAndLaunch(gameId, variantId){
  $('rulesOverlay').classList.add('hidden');
  net.send({type:'launch_game',gameId,variant:variantId});
}
function leaveOnline(){
  // UX redesign Phase 4: leaving an online room returns to the landing
  // (menuScreen) — the previous Online Setup screen no longer exists.
  if(net.ws){try{net.ws.close();}catch(e){}net.ws=null;}
  net.room=null;net.isHost=false;net.spectating=false;
  window._currentBots=[];
  if(window.Social) Social.reset();
  resetGameUi();
  showScreen('menuScreen');
}
function leaveGameToRoom(){ // back arrow in game
  if(mode==='local'){ if(confirm('Leave the game?')){ resetLocalSession(); resetGameUi(); showScreen('menuScreen'); } return; }
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
// Bugfix: catalogue glyphs use Phosphor icons; gameName returns plain
// text so callers can prefix with Kit.Icon.forGame() when they want the
// glyph.
function gameName(id){const g=catalogue.find(g=>g.id===id);return g?g.name:(id||'game');}
function gameGlyphHtml(id,opts){const g=catalogue.find(g=>g.id===id);return g?Kit.Icon.forGame(g,opts||{size:14,cls:'kit-icon-inline'}):'';}
function renderPublic(rooms){
  const el=$('publicList');
  if(!rooms||!rooms.length){el.innerHTML='<div class="muted">No open public rooms right now.</div>';return;}
  el.innerHTML=rooms.map((r,idx)=>{
    const live=r.inGame,label=live?'Spectate':'Join';
    const status=live
      ? '<span style="color:#f59e0b;display:inline-flex;align-items:center;gap:4px">'+Kit.Icon.html('target',{size:12})+esc(gameName(r.gameId))+'</span>'
      : (r.gameId
          ? '<span style="color:#10b981;display:inline-flex;align-items:center;gap:4px">'+Kit.Icon.html('rocket',{size:12})+esc(gameName(r.gameId))+' lobby</span>'
          : '<span style="color:#10b981;display:inline-flex;align-items:center;gap:4px">'+Kit.Icon.html('spinner',{size:12})+'Waiting</span>');
    // Quick-play room codes have a "quick-" prefix; render the rocket icon
    // inline in place of the prefix for visual distinction. Group rooms get
    // a users icon and a "Group ·" label so they're easy to spot.
    const isQuick=String(r.code||'').startsWith('quick-');
    const isGroup=!!r.isGroup;
    const codeRest=String(r.code||'').replace(/^quick-/,'').replace(/^GROUP-/i,'');
    const shown= isQuick ? Kit.Icon.html('rocket',{size:12,cls:'kit-icon-inline'})+codeRest
               : isGroup ? Kit.Icon.html('users',{size:12,cls:'kit-icon-inline'})+codeRest
               : codeRest;
    const tag = isGroup ? '<span style="color:#a78bfa;font-weight:700">Group</span> · ' : '';
    return `<div class="room-row"><div><div class="rc">${esc(shown)}</div><div class="rm">${tag}${esc(r.hostName)} · ${esc(r.players)}/${esc(r.maxPlayers)} · ${status}</div></div><button data-room-idx="${idx}">${label}</button></div>`;
  }).join('');
  el.querySelectorAll('[data-room-idx]').forEach(btn=>btn.onclick=()=>joinPublic(rooms[Number(btn.dataset.roomIdx)].code));
}

/* ====================== GAME VIEW DISPATCH ====================== */
// Hub hands the view to the right game client. Adding a game = add a client here.
// #2 — Pass-and-play board rotation. On a shared device with ≥2 human seats, when
// the FOCUSED seat changes the big main board rotates OUT, we render the next
// player's board, then it rotates IN. Card overlays are body-level fixed and
// pinned to anchors via getBoundingClientRect (which reflects ancestor
// transforms), so re-syncing them each frame makes them rescale + move together
// with the rotating board.
let _lastDisplaySeat=null,_lastDisplayGame=null;
function shouldRotateBoards(view){
  if(mode!=='local')return false;
  if(typeof localSeats==='undefined')return false;
  const humanSeats=localSeats.map((s,i)=>!s.bot?i:-1).filter(i=>i>=0);
  if(humanSeats.length<2)return false;                 // only when actually passing the device
  if(_lastDisplayGame!==view.game)return false;        // not on first render / game switch
  if(view.yourSeat==null||view.yourSeat===_lastDisplaySeat)return false;
  if(!humanSeats.includes(view.yourSeat))return false; // rotating TO a human-controlled board
  try{if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return false;}catch(_){ }
  return true;
}
// (removed syncOverlaysFor: per-frame CardManager.sync() during a 3D rotateY made the
//  transition choppy — every frame re-measured each card's projected getBoundingClientRect
//  and rewrote inline styles. The card overlays are now carried by the SAME CSS transform
//  as the board via a rotation layer, so the GPU interpolates them with zero per-frame JS.)
// Play the rotate-in (and a brief rotate-out flourish) WITHOUT blocking the
// render or the game's own animations: we render immediately (so any per-game
// deal/move flights run on time), then swing the freshly-built board into view,
// re-syncing the body-level card overlays each frame so they ride along.
function playBoardRotation(){
  const board=document.getElementById('mainBoardsContainer');
  if(!board)return;
  // Carry the body-level card overlays in a fixed "rotation layer" so the SAME CSS
  // transform that swings the board in also swings the cards in — one GPU-composited
  // animation, no per-frame measuring (which was the choppiness). Anchors live in the
  // board (rotates natively); overlays live in the layer (rotates identically).
  let layer=document.getElementById('cardRotateLayer');
  if(!layer){ layer=document.createElement('div'); layer.id='cardRotateLayer'; layer.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:80'; document.body.appendChild(layer); }
  const overlays=[...document.querySelectorAll('.kit-card-registered[data-cm-id]')];
  // skip cards mid-flight (they manage their own transform)
  const moved=overlays.filter(o=>!o.classList.contains('kit-card-moving'));
  moved.forEach(o=>layer.appendChild(o));

  if(typeof SFX!=='undefined'&&SFX.swap)SFX.swap();
  [board,layer].forEach(el=>{ el.classList.remove('board-rotate-in'); void el.offsetWidth; el.classList.add('board-rotate-in'); });

  setTimeout(()=>{
    [board,layer].forEach(el=>el.classList.remove('board-rotate-in'));
    // return overlays to the body and re-pin to the freshly-rendered anchors.
    moved.forEach(o=>{ if(o.parentElement===layer) document.body.appendChild(o); });
    if(typeof Kit!=='undefined'&&Kit.CardManager)Kit.CardManager.sync();
  },360);
}
// Track the highest event seq we've already auto-emoted for, per game, so a
// re-dispatch of the same view doesn't re-fire contextual emotes.
let _emoteSeqSeen = {};
function maybeContextualEmotes(view){
  if(!window.Kit || !Kit.Emotes || !Kit.Emotes.fromEvent || !window.Social || !window.Social.emote) return;
  const g = view.game;
  const bag = view[g];
  const events = bag && Array.isArray(bag.events) ? bag.events : null;
  if(!events || !events.length) return;
  const seen = _emoteSeqSeen[g] || 0;
  let maxSeq = seen;
  for(const ev of events){
    const seq = (ev && typeof ev.seq === 'number') ? ev.seq : null;
    if(seq != null && seq <= seen) continue;                 // already handled
    if(seq != null && seq > maxSeq) maxSeq = seq;
    const hit = Kit.Emotes.fromEvent(g, ev);
    if(hit && hit.seat != null && hit.seat >= 0 && (hit.prob == null || Math.random() < hit.prob)){
      const seats = window._currentSeats || [];
      const isBot = seats[hit.seat]?.bot || (window.localSeats && localSeats[hit.seat]?.bot);
      if(!isBot) continue; 
      const name = (seats[hit.seat] && seats[hit.seat].name) || (window.localSeats && localSeats[hit.seat] && localSeats[hit.seat].name) || '';
      try { Social.emote(hit.mood, name, hit.seat); } catch(e){}
    }
  }
  _emoteSeqSeen[g] = maxSeq;
}
function dispatchView(view){
  if(typeof window.assertViewParity === 'function') window.assertViewParity(view);
  const client=window.GameClients[view.game];
  if(!client){toast('Unknown game: '+view.game);return;}
  window._renderView=view;
  if(animating){pendingView=view;return;}
  maybeContextualEmotes(view);
  const rotate=shouldRotateBoards(view);
  _lastDisplaySeat=view.yourSeat;_lastDisplayGame=view.game;
  GameShell.render(view,client);
  if(rotate)playBoardRotation();   // non-blocking; game animations already running
  maybeRunBot(view); // drive bot seats if we're responsible
}
function flushView(){if(pendingView){const v=pendingView;pendingView=null;dispatchView(v);}}
function removeQwixxUi(){const top=$('topArea');if(!top)return;top.querySelectorAll('.qwixx-dice-zone,.qwixx-top-mini-strip,.skyjo-action-zone').forEach(el=>el.remove());}
function resetGameUi(){curView=null;prevView=null;animating=false;pendingView=null;summaryShown=false;lastRoundShown=false;_lastDisplaySeat=null;_lastDisplayGame=null;_emoteSeqSeen={};$('overlay').classList.add('hidden');$('overlay').style.opacity='';GameShell.unmount();$('topArea').style.display='';const piles=$('topArea').querySelector('.piles');if(piles)piles.style.display='flex';$('heldCardWrapper').style.display='';if(window._flip7ResetSeq)window._flip7ResetSeq();}
function hideOverlay(){const o=$('overlay');if(o.classList.contains('hidden'))return;o.style.opacity='0';setTimeout(()=>{o.classList.add('hidden');o.style.opacity='';},220);}
function bumpStatus(){const sb=$('statusBar');sb.classList.remove('bump');void sb.offsetWidth;sb.classList.add('bump');}

/* shared end-of-game/round summary (used by any game that sets view.summary) */
function showSummary(view){
  const sm=view.summary;if(!sm)return;
  const overlay=$('overlay'),box=$('overlayBox');
  const isOver=view.over;
  const hasDelta=sm.rows.some(r=>r.delta!=null);
  const head=`<tr><th>Player</th>${hasDelta?'<th>Round</th>':''}<th>Total</th></tr>`;
  const rows=sm.rows.map(r=>{const w=isOver&&sm.winners.includes(r.seat);const d=r.delta!=null?`<td>${r.delta>=0?'+':''}${r.delta}</td>`:'';return `<tr class="${w?'winner-row':''}"><td>${esc(r.name)}${w?' <span class="crown">'+Kit.Icon.html('crown',{size:14})+'</span>':''}</td>${d}<td>${esc(r.score)}</td></tr>`;}).join('');
  const wn=sm.winners.map(i=>{const r=sm.rows.find(x=>x.seat===i);return r?esc(r.name):'';}).join(' & ');
  let foot=isOver?`<div style="font-size:1.4rem;font-weight:900;margin:16px 0;color:#10b981;display:flex;align-items:center;gap:8px;justify-content:center"><span class="crown">${Kit.Icon.html('trophy',{size:24})}</span><span>${wn} ${sm.winners.length>1?'win':'wins'}!</span></div>`:'';
  let btns;
  if(mode==='local'){btns=isOver?`<button class="btn green" onclick="localNext()">Play Again</button><button class="btn secondary" onclick="quitLocal()">Menu</button>`:`<button class="btn" onclick="localNext()">Next Round</button>`;}
  else if(net.isHost){btns=`<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">${isOver?`<button class="btn green" onclick="net.send({type:'next_round'})">New Game</button><button class="btn secondary" onclick="net.send({type:'to_room'})">Back to Room</button>`:`<button class="btn" onclick="net.send({type:'next_round'})">Next Round</button>`}</div>`;}
  else btns='<div class="muted">Waiting for host…</div>';
  // Replay sharing — available to everyone (host + guests + spectators) for
  // ONLINE games once we have a replay handle from the server. Local pass-and
  // -play games stay offline-only, no replay URLs to share.
  let replayUi='';
  if(isOver && mode!=='local' && window._currentReplay?.id && window._currentReplay?.roomCode){
    const r=window._currentReplay;
    const url=location.origin+`/replay.html?room=${encodeURIComponent(r.roomCode)}&id=${encodeURIComponent(r.id)}`;
    replayUi=`<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
      <div style="font-size:.78rem;color:var(--text-dim);margin-bottom:8px;font-weight:700;letter-spacing:.04em;display:flex;align-items:center;gap:6px">${Kit.Icon.html('tv',{size:12})}SHARE THIS GAME</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
        <a class="btn" style="margin:0;text-decoration:none;display:inline-flex;align-items:center;gap:6px" href="${esc(url)}" target="_blank" rel="noopener">${Kit.Icon.html('play',{size:14})}Watch Replay</a>
        <button class="btn secondary" style="margin:0;display:inline-flex;align-items:center;gap:6px" onclick="(async()=>{try{await navigator.clipboard.writeText(${JSON.stringify(url)});this.innerHTML=${JSON.stringify(Kit.Icon.html('check',{size:14}))}+'Copied!';setTimeout(()=>this.innerHTML=${JSON.stringify(Kit.Icon.html('link',{size:14}))}+'Copy Link',1800);}catch{this.textContent='Copy failed'}})()">${Kit.Icon.html('link',{size:14})}Copy Link</button>
      </div>
    </div>`;
  }
  box.innerHTML=`<h2 style="margin:0 0 6px;font-size:1.8rem">${isOver?'Game Over!':'Round Complete'}</h2><table class="score-table">${head}${rows}</table>${foot}<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">${btns}</div>${replayUi}`;
  overlay.classList.remove('hidden');overlay.style.opacity='';
  if(isOver){Kit.confetti();SFX.win();}else SFX.good();
}

/* ====================== LOCAL PLAY (offline, single-device) ====================== */
let localEngine=null,localGameId=null,localActor=0;
let _localPick='skyjo';
function resetLocalSession(){
  localEngine=null; localGameId=null; localActor=0;
  // Phase 6: keep window mirror in sync so LocalSeatEditor sees the
  // reset (its refreshButton hides #seatsBtn when no engine is live).
  window.localEngine = null; window.localGameId = null;
}

/* Local seats: array of {name, bot, difficulty}. Rendered as rows. */
let localSeats=[{name:'Player 1',bot:false},{name:'Player 2',bot:false}];
// Phase 6: also expose on window so 00-local-seat-editor.js can READ the
// live seat array without going through the lexical-scope dance. (The
// setter setLocalSeats() already mutates this in place, so window.localSeats
// stays in sync — it's the same array reference.)
window.localSeats = localSeats;
// Exposed setter so the landing page's "instant play vs bot" can configure
// the local game without poking script-scoped lets directly.
window.setLocalSeats = function(arr){ if(Array.isArray(arr)) { localSeats.length=0; for(const s of arr) localSeats.push(s); renderLocalSeats(); refreshLocalTiles(); } };
window.setLocalPick = function(id){ _localPick = id; markLocalPick(); };
function defaultLocalVariant(gameId, requested){
  const g=catalogue.find(x=>x.id===gameId);
  const variants=g?.variants || g?.features?.variants || [];
  if(!variants || variants.length===0) return requested || 'standard';
  if(requested && variants.some(v=>v.id===requested)) return requested;
  const saved=window._localVariantByGame?.[gameId];
  if(saved && variants.some(v=>v.id===saved)) return saved;
  return variants[0]?.id || 'standard';
}
window.startLocalForGame = function(gameId, opts={}){
  if(typeof gameId === 'string') { _localPick = gameId; }
  const requested = typeof opts === 'string' ? opts : opts?.variant;
  window._localVariantPick = defaultLocalVariant(_localPick, requested);
  startLocalGame();
};
let _localBotDiff='medium';
function setLocalBotDiff(d){_localBotDiff=d;document.querySelectorAll('#localBotDiff button').forEach(b=>b.classList.toggle('on',b.dataset.d===d));}
function renderLocalSeats(){
  const box=$('localPlayers');box.innerHTML='';
  localSeats.forEach((seat,i)=>{
    const row=document.createElement('div');row.style.cssText='display:flex;gap:6px;align-items:center;margin-bottom:6px';
    const inp=document.createElement('input');inp.type='text';inp.className='input';inp.style.margin='0';inp.value=seat.name;
    inp.disabled=!!seat.bot;inp.oninput=()=>{localSeats[i].name=inp.value;};
    if(seat.bot)inp.style.opacity='.7';
    const del=document.createElement('button');del.className='icon-btn';del.appendChild(Kit.Icon('x',{size:14}));del.onclick=()=>{localSeats.splice(i,1);renderLocalSeats();refreshLocalTiles();};
    row.appendChild(inp);if(localSeats.length>2||seat.bot)row.appendChild(del);
    box.appendChild(row);
  });
}
function localCount(){return localSeats.length;}
function addLocalBot(){if(localSeats.length>=8)return;const names=['Botley','Chip','Ada','Turing','Pixel','Nova'];const n=localSeats.filter(s=>s.bot).length;localSeats.push({name:names[n]||'Bot',bot:true,difficulty:_localBotDiff});renderLocalSeats();refreshLocalTiles();}
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

  const variants = g?.variants || g?.features?.variants;
  if(variants && variants.length > 1 && !window._localVariantPick){
    openVariantPicker(_localPick, variants, (vid) => {
      window._localVariantPick = vid;
      startLocalGame();
    });
    return;
  }

  mode='local';localGameId=_localPick;localEngine=window.LocalEngines[_localPick](names, window._localVariantPick || 'standard');
  window._localVariantPick = null; 
  if(window.Social) Social.setActive(false);   // pass-and-play is one device
  // Phase 6: mirror to window for cross-module readers (00-local-seat-editor).
  window.mode = mode; window.localEngine = localEngine; window.localGameId = localGameId;
  // bot seats the local device will drive
  window._currentBots=seats.map((s,i)=>s.bot?{seat:i,difficulty:s.difficulty||'medium'}:null).filter(Boolean);
  window._controlledSeats=seats.map((s,i)=>!s.bot?i:-1).filter(i=>i>=0);
  resetGameUi();showScreen('gameScreen');$('gameRoomTag').classList.add('hidden');$('spectateTag').classList.add('hidden');
  renderLocal();
}
function isLocalBotSeat(seat){return !!localSeats[seat]?.bot;}
function firstLocalHumanSeat(){const i=localSeats.findIndex(s=>!s.bot);return i>=0?i:0;}
function localDisplaySeat(preferred=null){
  if(!localEngine) return firstLocalHumanSeat();
  // Per-game override: games where the active seat doesn't follow the
  // engine's currentSeat (e.g. Skyjo REVEAL is simultaneous but pass-
  // and-play wants to alternate humans one-at-a-time) can implement
  // localFocusSeat(state, humanSeats) on their GameClient.
  const humanSeats = SeatModel.localHumanSeats();
  const clientFor = window.GameClients && window.GameClients[localGameId];
  if (clientFor && typeof clientFor.localFocusSeat === 'function') {
    try {
      const stateForView = localEngine._state ? localEngine._state() : null;
      const focus = clientFor.localFocusSeat(stateForView, humanSeats);
      if (typeof focus === 'number' && focus >= 0) return focus;
    } catch (e) { console.warn('localFocusSeat threw', e); }
  }
  const actor=localEngine.actor();
  if(preferred!=null&&!isLocalBotSeat(preferred))return preferred;
  if(actor!=null&&!isLocalBotSeat(actor))return actor;
  return firstLocalHumanSeat();
}
function renderLocal(){
  if(!localEngine || !localGameId) return;
  const v=localEngine.viewFor(localDisplaySeat());
  window._controlledSeats=SeatModel.localHumanSeats();
  dispatchView(v);
}
// Re-render the active local game when the window resizes so viewport-derived
// sizing (e.g. the Qwixx slot machine's continuous reel size) tracks the screen
// live, not just on the next action. Debounced; the dice tray is self-gated so a
// mid-spin re-render never restarts the roll. Kit.Fit handles board scaling on
// its own ResizeObserver, so this is only for top-area widgets.
let _localResizeRaf = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    if (_localResizeRaf) return;
    _localResizeRaf = requestAnimationFrame(() => {
      _localResizeRaf = 0;
      if (localEngine && localGameId && document.getElementById('gameScreen')?.classList.contains('active')) {
        try { renderLocal(); } catch (e) { /* never break on resize */ }
      }
    });
  }, { passive: true });
}
function localAct(seat,msg){
  if(!localEngine || !localGameId) return;
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
function localNext(){ if(!localEngine) return; localEngine.next(); resetGameUi(); renderLocal(); }
function quitLocal(){
  window._currentBots=[];
  resetLocalSession();
  // Phase 6: clear the runtime mode so the seats button hides.
  // (Mode stays 'local' as the user's preferred default — that's the
  // Mode header toggle, not the runtime mode flag.)
  if (typeof window !== 'undefined') window.localEngine = null;
  resetGameUi();
  showScreen('menuScreen');
}

// Explicit globals for cross-file callers. Some browsers are less forgiving when
// a later classic script reads top-level function declarations through `window`,
// and the local seat screen depends on these to surface variants before launch.
window.openVariantPicker = openVariantPicker;
window.startLocalGame = startLocalGame;
window.renderLocal = renderLocal;
window.connectRoom = connectRoom;
window.quickPlay = quickPlay;
window.ensureName = ensureName;

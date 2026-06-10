/**
 * Client renderer + local engine for Schotten Totten (schotten).
 *
 * Contract:
 *   window.GameClients['schotten'].render(view, ctx)
 *   window.GameClients['schotten'].act(action, extra?)
 *   window.GameClients['schotten'].unmount()
 *   window.LocalEngines['schotten'](names)  — offline single-device play
 */
(function(){
  const ID = 'schotten';
  const COLORS = { red:'#ef4444', orange:'#f97316', yellow:'#eab308', green:'#22c55e', blue:'#3b82f6', purple:'#a855f7' };

  window.GameRules[ID] = {
    title: '🪨 Schotten Totten',
    quick: 'Win border stones by building the strongest 3-card formations.',
    steps: [
      'Each turn: play one clan card (1–9, six colours) on your side of a stone, then draw.',
      'A stone holds up to 3 cards per side. You can play on any unclaimed stone.',
      'Claim a stone when your formation beats your opponent’s (or can’t be beaten).',
      'Formations, strongest→weakest: colour run > three of a kind > colour > run > sum.',
      'Ties: higher total wins; still tied, whoever completed their 3rd card first.',
    ],
    tip: 'Win 5 stones total or 3 adjacent stones. Don’t reveal your strong stones too early.',
  };

  let selectedHand = null; // index of selected hand card (place flow)

  function send(action, extra = {}) {
    const seat = window._renderView?.yourSeat ?? 0;
    GameActions.send(action, extra, seat);
  }
  function act(action, extra = {}) { send(action, extra); }

  function cardEl(card, {small=false}={}) {
    const el = document.createElement('div');
    el.className = 'st-card' + (small ? ' st-card-sm' : '');
    el.style.background = COLORS[card.c] || '#888';
    el.textContent = card.v;
    return el;
  }

  function render(view, ctx = {}) {
    const s = view[ID];
    if (!s) return;
    const viewer = s.viewerSeat;
    const myTurn = s.current === viewer && viewer >= 0 && !view.over;

    // ---- The border: 9 stones, opponent side on top, my side on bottom ----
    const opp = 1 - (viewer < 0 ? 0 : viewer);
    const me = viewer < 0 ? 0 : viewer;
    const border = document.createElement('div');
    border.className = 'st-border';
    s.stones.forEach((st, i) => {
      const col = document.createElement('div');
      col.className = 'st-stone-col';

      const top = document.createElement('div'); top.className = 'st-side';
      st.sides[opp].forEach(c => top.appendChild(cardEl(c)));

      const stone = document.createElement('div');
      stone.className = 'st-stone' + (st.claimedBy === me ? ' st-mine' : st.claimedBy === opp ? ' st-theirs' : '');
      stone.textContent = st.claimedBy >= 0 ? (st.claimedBy === me ? '✓' : '✗') : '🪨';
      // Claim button when it's my turn, I've placed, and I can target this stone.
      if (myTurn && s.placedThisTurn && st.claimedBy < 0) {
        stone.classList.add('st-claimable');
        stone.onclick = () => act('claim', { target: i });
        stone.title = 'Claim this stone';
      }

      const bottom = document.createElement('div'); bottom.className = 'st-side st-side-me';
      st.sides[me].forEach(c => bottom.appendChild(cardEl(c)));
      // If a hand card is selected and this stone has room on my side, allow placing.
      if (myTurn && !s.placedThisTurn && selectedHand != null && st.claimedBy < 0 && st.sides[me].length < 3) {
        bottom.classList.add('st-droppable');
        bottom.onclick = () => { const h = selectedHand; selectedHand = null; act('place', { index: h, target: i }); };
      }

      col.appendChild(top); col.appendChild(stone); col.appendChild(bottom);
      border.appendChild(col);
    });

    // ---- My hand ----
    const handWrap = document.createElement('div');
    handWrap.className = 'st-hand';
    const myHand = s.players[me]?.hand;
    if (myHand) {
      myHand.forEach((c, idx) => {
        const el = cardEl(c);
        el.classList.add('st-hand-card');
        if (selectedHand === idx) el.classList.add('st-selected');
        if (myTurn && !s.placedThisTurn) el.onclick = () => { selectedHand = (selectedHand === idx ? null : idx); GameShell.render(window._renderView, window.GameClients[ID]); };
        handWrap.appendChild(el);
      });
    }

    const focus = document.createElement('div');
    focus.className = 'player-board st-board';
    const head = document.createElement('div'); head.className = 'st-head';
    head.innerHTML = `<span>${esc(s.players[me]?.name||'You')}: ${s.players[me]?.stonesWon||0} stones</span>`
      + `<span class="muted">vs ${esc(s.players[opp]?.name||'Opp')}: ${s.players[opp]?.stonesWon||0} · deck ${s.deckCount}</span>`;
    focus.appendChild(head);
    focus.appendChild(border);
    focus.appendChild(handWrap);

    let statusText;
    if (view.over) statusText = (s.winner === me ? '🏆 You win!' : 'You lose.');
    else if (viewer < 0) statusText = 'Spectating';
    else if (!myTurn) statusText = `Waiting for ${esc(s.players[opp]?.name||'opponent')}…`;
    else if (!s.placedThisTurn) statusText = selectedHand != null ? 'Tap a stone to place' : 'Your turn — pick a card';
    else statusText = 'Claim a stone, or end your turn';

    GameShell.renderTable({ game: ID, focus, topMode: 'hidden', status: statusText });

    // End-turn control (after placing).
    let ctrl = document.getElementById('stControls');
    if (!ctrl) { ctrl = document.createElement('div'); ctrl.id = 'stControls'; ctrl.className = 'f7-controls'; document.body.appendChild(ctrl); }
    ctrl.innerHTML = '';
    if (myTurn && s.placedThisTurn) {
      const end = document.createElement('button'); end.className = 'btn green'; end.textContent = 'End turn';
      end.onclick = () => act('end'); ctrl.appendChild(end);
    }

    if (view.summary && !summaryShown) showSummary(view);
  }

  function unmount() { selectedHand = null; const c = document.getElementById('stControls'); if (c) c.remove(); }

  window.GameClients[ID] = { render, act, unmount };

  /* ---- Local engine (offline single-device play) — mirrors src/games/schotten/server.ts ---- */
  const COLORLIST = ['red','orange','yellow','green','blue','purple'];
  const NOT_FULL = Number.MAX_SAFE_INTEGER;
  function score(cards){
    const sum = cards.reduce((a,c)=>a+c.v,0);
    if (cards.length<3) return [1,sum];
    const vals=cards.map(c=>c.v).sort((a,b)=>a-b);
    const sameColor=cards.every(c=>c.c===cards[0].c);
    const run=vals[0]+1===vals[1]&&vals[1]+1===vals[2];
    const trips=vals[0]===vals[1]&&vals[1]===vals[2];
    let rank=1; if(run&&sameColor)rank=5;else if(trips)rank=4;else if(sameColor)rank=3;else if(run)rank=2;
    return [rank,sum];
  }
  const cmp=(a,b)=>a[0]!==b[0]?a[0]-b[0]:a[1]-b[1];
  function unseen(s){const m={};for(const c of COLORLIST)m[c]=new Set([1,2,3,4,5,6,7,8,9]);for(const st of s.stones)for(const side of st.sides)for(const card of side)m[card.c].delete(card.v);return m;}
  function bestPossible(side,avail){if(side.length>=3)return score(side);const need=3-side.length;const pool=[];for(const c of COLORLIST)for(const v of avail[c])pool.push({v,c});let best=[0,0];const choose=(start,picked)=>{if(picked.length===need){const sc=score([...side,...picked]);if(cmp(sc,best)>0)best=sc;return;}for(let i=start;i<pool.length;i++)choose(i+1,[...picked,pool[i]]);};if(pool.length)choose(0,[]);else best=score(side);return best;}
  function canClaim(s,idx,claimer){const st=s.stones[idx];if(st.claimedBy>=0)return false;const mine=st.sides[claimer],theirs=st.sides[1-claimer];if(mine.length<3)return false;const ms=score(mine);if(theirs.length>=3){const ts=score(theirs);if(cmp(ms,ts)>0)return true;if(cmp(ms,ts)<0)return false;return st.fullAt[claimer]<st.fullAt[1-claimer];}const best=bestPossible(theirs,unseen(s));return cmp(ms,best)>=0;}
  function checkWin(s){for(let p=0;p<2;p++){const c=s.stones.filter(st=>st.claimedBy===p).length;if(c>=5){s.phase='GAME_OVER';s.winner=p;return;}for(let i=0;i+2<9;i++)if(s.stones[i].claimedBy===p&&s.stones[i+1].claimedBy===p&&s.stones[i+2].claimedBy===p){s.phase='GAME_OVER';s.winner=p;return;}}}
  function canPlaceAny(s,seat){if(s.players[seat].hand.length===0)return false;return s.stones.some(st=>st.claimedBy<0&&st.sides[seat].length<3);}
  function checkStall(s){if(s.phase!=='PLAY'||s.deck.length>0)return;if(canPlaceAny(s,0)||canPlaceAny(s,1))return;s.phase='GAME_OVER';const c0=s.stones.filter(st=>st.claimedBy===0).length,c1=s.stones.filter(st=>st.claimedBy===1).length;s.winner=c0===c1?-1:(c0>c1?0:1);}

  class SchottenEngine {
    constructor(names){
      const d=[];for(const c of COLORLIST)for(let v=1;v<=9;v++)d.push({id:`st_${c}_${v}`,v,c});
      for(let i=d.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[d[i],d[j]]=[d[j],d[i]];}
      const players=names.slice(0,2).map(name=>({name,hand:[]}));
      for(const p of players)for(let i=0;i<6;i++){const c=d.pop();if(c)p.hand.push(c);}
      this.s={schemaVersion:1,players,deck:d,stones:Array.from({length:9},()=>({sides:[[],[]],claimedBy:-1,fullAt:[NOT_FULL,NOT_FULL]})),current:0,phase:'PLAY',placedThisTurn:false,seq:0,winner:-1,lastAction:null};
    }
    apply(seat,msg){const s=this.s;if(s.phase!=='PLAY'||seat!==s.current)return;
      if(msg.action==='place'&&!s.placedThisTurn){const hi=msg.index|0,si=msg.target|0,p=s.players[seat];if(hi<0||hi>=p.hand.length)return;const st=s.stones[si];if(!st||st.claimedBy>=0||st.sides[seat].length>=3)return;const[card]=p.hand.splice(hi,1);st.sides[seat].push(card);if(st.sides[seat].length===3)st.fullAt[seat]=++s.seq;else s.seq++;s.placedThisTurn=true;s.lastAction={type:'place',player:seat,stone:si,card};return;}
      if(msg.action==='claim'){const si=msg.target|0;if(!s.stones[si]||!canClaim(s,si,seat))return;s.stones[si].claimedBy=seat;s.lastAction={type:'claim',player:seat,stone:si};checkWin(s);return;}
      if(msg.action==='end'&&(s.placedThisTurn||!canPlaceAny(s,seat))){const c=s.deck.pop();if(c)s.players[seat].hand.push(c);s.placedThisTurn=false;s.current=(s.current+1)%2;s.lastAction={type:'end',player:seat};checkStall(s);return;}
    }
    actor(){return this.s.current;}
    next(){/* base game has no rounds */}
    viewFor(seat){const s=this.s;const over=s.phase==='GAME_OVER';let summary;if(over)summary={rows:s.players.map((p,i)=>({seat:i,name:p.name,score:s.stones.filter(st=>st.claimedBy===i).length})),winners:s.winner>=0?[s.winner]:[]};
      return{game:'schotten',phase:over?'GAME_OVER':'PLAYING',over,yourSeat:seat,summary,state:{currentSeat:over?-1:s.current,pendingAction:over?null:(s.placedThisTurn?'claim_or_end':'place'),players:s.players.map((p,i)=>({seat:i,name:p.name,status:over?'out':(i===s.current?'active':'waiting'),score:s.stones.filter(st=>st.claimedBy===i).length})),actingCount:over?0:1},
        schotten:{current:s.current,placedThisTurn:s.placedThisTurn,deckCount:s.deck.length,winner:s.winner,viewerSeat:seat,lastAction:s.lastAction,
          stones:s.stones.map(st=>({claimedBy:st.claimedBy,sides:[st.sides[0].map(c=>({id:c.id,v:c.v,c:c.c})),st.sides[1].map(c=>({id:c.id,v:c.v,c:c.c}))]})),
          players:s.players.map((p,i)=>({seat:i,name:p.name,handCount:p.hand.length,stonesWon:s.stones.filter(st=>st.claimedBy===i).length,hand:i===seat?p.hand.map(c=>({id:c.id,v:c.v,c:c.c})):null}))}};}
  }
  window.LocalEngines[ID] = function(names){ const E=new SchottenEngine(names); return { apply(s,m){E.apply(s,m);}, next(){E.next();}, actor(){return E.actor();}, viewFor(s){return E.viewFor(s);} }; };
})();

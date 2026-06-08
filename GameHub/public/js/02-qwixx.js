/* ====================== GAME CLIENTS REGISTRY ====================== */
window.GameClients = window.GameClients || {};

/* -------------------- QWIXX client -------------------- */
(function(){
  const COLORS = ['red', 'yellow', 'green', 'blue'];
  const COLOR_KEY = { red: 'r', yellow: 'y', green: 'g', blue: 'b' };
  const C_HEX = { red: '#e74c3c', yellow: '#f1c40f', green: '#2ecc71', blue: '#3498db' };
  const SCORE_BY_MARKS = [0,1,3,6,10,15,21,28,36,45,55,66,78];

  function lastMark(row){ return row.marks.length ? Math.max(...row.marks) : -1; }
  function canMarkIndex(state, color, row, i){
    if(!row || state.locked.includes(color)) return false;
    if(!Number.isInteger(i) || i < 0 || i >= row.nums.length) return false;
    if(row.marks.includes(i)) return false;
    if(i <= lastMark(row)) return false;
    if(i === row.nums.length - 1 && row.marks.length < 5) return false;
    return true;
  }
  function rowPoints(row){
    let m = row.marks.length;
    if(row.marks.includes(row.nums.length - 1)) m++; // lock symbol
    return SCORE_BY_MARKS[Math.min(m, SCORE_BY_MARKS.length - 1)];
  }
  function scoreRows(rows, penalties){
    let total = 0;
    COLORS.forEach(c => { const row = rows[c]; if(row) total += rowPoints(row); });
    return total - penalties * 5;
  }
  function markHintsFor(state, player){
    const hints = new Map();
    const dice = state.dice || { w:[0,0], r:0, y:0, g:0, b:0 };
    const add = (color, idx, h) => {
      if(idx == null || idx < 0) return;
      const k = `${color}:${idx}`;
      if(!hints.has(k)) hints.set(k, []);
      hints.get(k).push(h);
    };

    const whiteSum = dice.w[0] + dice.w[1];
    const whiteIdxByColor = {};
    if(state.phase === 'WHITE_PHASE' && state.pendingWhiteDecisions.includes(player.seat)){
      COLORS.forEach(color => {
        const row = player.rows[color];
        const idx = row.nums.indexOf(whiteSum);
        whiteIdxByColor[color] = canMarkIndex(state, color, row, idx) ? idx : -1;
        if(whiteIdxByColor[color] >= 0) add(color, idx, { kind:'white', actionable:true, label:`W ${whiteSum}`, title:`White dice ${dice.w[0]}+${dice.w[1]}=${whiteSum}` });
      });
    }

    // The active player sees all six-dice possibilities at once. During WHITE_PHASE,
    // colored hints are previews for the follow-up color action; during COLOR_PHASE
    // they are actionable. If the preview shares a row with a possible white mark,
    // prefer colored marks to the right of that white mark because white must be
    // resolved first on the same row.
    if((state.phase === 'WHITE_PHASE' || state.phase === 'COLOR_PHASE') && player.seat === state.activeSeat){
      COLORS.forEach(color => {
        const die = dice[COLOR_KEY[color]];
        if(!die) return;
        const row = player.rows[color];
        let options = [dice.w[0], dice.w[1]]
          .map((w, wi) => ({ wi, w, sum: w + die, idx: row.nums.indexOf(w + die) }))
          .filter(o => canMarkIndex(state, color, row, o.idx));
        if(state.phase === 'WHITE_PHASE' && whiteIdxByColor[color] >= 0){
          const compatible = options.filter(o => o.idx > whiteIdxByColor[color]);
          if(compatible.length) options = compatible;
        }
        options.sort((a,b) => a.idx - b.idx);
        if(options[0]) add(color, options[0].idx, { kind:'color', actionable:state.phase === 'COLOR_PHASE', color, label:`${color[0].toUpperCase()} ${options[0].sum}`, title:`${color} die: white ${options[0].w}+${die}=${options[0].sum}${state.phase === 'WHITE_PHASE' ? ' (preview after white)' : ''}` });
      });
    }

    return hints;
  }

  function facePips(n){ return `<span class="pip-num">${n}</span>`; }
  function renderDie(value, cls, label){
    if(value <= 0) return '';
    return `<div class="qwixx-die ${cls}" title="${label}: ${value}">${facePips(value)}</div>`;
  }
  function renderDice(dice){
    dice = dice || {w:[0,0], r:0, y:0, g:0, b:0};
    return `<div class="qwixx-dice-rows">
      <div class="qwixx-dice-row"><span class="qwixx-dice-label">white</span><div class="qwixx-dice-line">${dice.w.map((v,i)=>renderDie(v,'white',`white ${i+1}`)).join('')}</div></div>
      <div class="qwixx-dice-row"><span class="qwixx-dice-label">colors</span><div class="qwixx-dice-line">
        ${renderDie(dice.r,'red','red')}${renderDie(dice.y,'yellow','yellow')}${renderDie(dice.g,'green','green')}${renderDie(dice.b,'blue','blue')}
      </div></div>
    </div>`;
  }

  function actionLegalForCell(state, player, color, row, i, hints){
    if(!canMarkIndex(state, color, row, i)) return false;
    const actionableHint = (hints.get(`${color}:${i}`) || []).some(h => h.actionable);
    return actionableHint && (player.seat === state.activeSeat || state.pendingWhiteDecisions.includes(player.seat));
  }
  function renderScorecard(player, state, viewerSeat, compact=false){
    const hints = markHintsFor(state, player);
    let html = `<div class="qwixx-scorecard${player.active ? ' active' : ''}${compact ? ' compact' : ''}">`;
    COLORS.forEach(color => {
      const row = player.rows[color];
      const locked = state.locked.includes(color);
      const pendingLock = state.pendingLocks && state.pendingLocks.includes(color);
      const last = lastMark(row);
      html += `<div class="qwixx-score-row">
        <div class="qwixx-row-hdr" style="background:${C_HEX[color]}">${color[0].toUpperCase()}</div>
        <div class="qwixx-row-cells">`;
      row.nums.forEach((n, i) => {
        const marked = row.marks.includes(i);
        const unavailable = !marked && (i <= last || locked);
        const cellHints = hints.get(`${color}:${i}`) || [];
        const legal = actionLegalForCell(state, player, color, row, i, hints);
        const hintHtml = compact ? '' : cellHints.map(h => `<span class="qwixx-hint ${h.kind === 'white' ? 'white' : color}${h.actionable ? '' : ' preview'}" title="${h.title}">${h.label}</span>`).join('');
        let cls = 'qwixx-cell';
        if(marked) cls += ' x';
        if(unavailable) cls += ' bad';
        if(locked || pendingLock) cls += ' lock';
        if(cellHints.length) cls += ' hintable good';
        const click = legal ? `onclick="window.GameClients['qwixx'].act('mark',{c:'${color}',i:${i}})"` : '';
        html += `<div class="${cls}" ${click}><span class="qwixx-num">${marked ? '✕' : n}</span>${hintHtml}</div>`;
      });
      const count = row.marks.length + (row.marks.includes(row.nums.length - 1) ? 1 : 0);
      const pts = rowPoints(row);
      html += `</div><div class="qwixx-row-score">${locked || pendingLock ? '🔒' : `${count}<small>${pts}</small>`}</div></div>`;
    });
    const you = player.seat === viewerSeat ? ' you' : '';
    html += `</div><div class="qwixx-player-foot${you}">Score ${scoreRows(player.rows, player.penalties)} · Penalties ${player.penalties}/4</div>`;
    return html;
  }

  function render(view){
    const s = view.state;
    const dice = s.dice || { w:[0,0], r:0, y:0, g:0, b:0 };
    removeQwixxUi();
    $('topArea').style.display = 'flex';
    const piles = $('topArea').querySelector('.piles');
    if(piles) piles.style.display = 'none';
    $('heldCardWrapper').style.display = 'none';

    const isAct = s.activeSeat === view.yourSeat;
    const isWhite = s.phase === 'WHITE_PHASE';
    const isColor = s.phase === 'COLOR_PHASE';
    const pendingWhite = isWhite && s.pendingWhiteDecisions.includes(view.yourSeat);
    const activeName = s.allPlayers.find(p => p.seat === s.activeSeat)?.name || 'Active player';

    let controlsHtml = '';
    if(isWhite){
      controlsHtml = pendingWhite
        ? `<button class="qwixx-ctrl-btn pri" onclick="window.GameClients['qwixx'].act('skip')">Skip white ${dice.w[0]+dice.w[1]}</button>`
        : `<span class="muted">Waiting for white-dice decisions…</span>`;
    } else if(isColor){
      controlsHtml = isAct
        ? `<button class="qwixx-ctrl-btn pri" onclick="window.GameClients['qwixx'].act('finishTurn')">${!s.activeMarkedThisTurn ? 'Take Penalty / Finish' : 'Finish Turn'}</button>`
        : `<span class="muted">${activeName} may take one color mark…</span>`;
    }

    const diceZone = document.createElement('div');
    diceZone.className = 'qwixx-dice-zone';
    diceZone.innerHTML = `
      <div class="qwixx-turn-head">
        <span>${isWhite ? '🎲 Everyone: white dice' : '🎯 Active player: one color combo'}</span>
        <span>Round ${s.round}</span>
      </div>
      ${renderDice(dice)}
      <div class="qwixx-combos">
        <span class="qwixx-combo white">White: ${dice.w[0]}+${dice.w[1]}=${dice.w[0]+dice.w[1]}</span>
        ${COLORS.map(c => dice[COLOR_KEY[c]] ? `<span class="qwixx-combo ${c}">${c[0].toUpperCase()}: ${dice.w[0]}+${dice[COLOR_KEY[c]]} / ${dice.w[1]}+${dice[COLOR_KEY[c]]}</span>` : '').join('')}
      </div>
      <div class="qwixx-controls">${controlsHtml}</div>`;
    $('topArea').appendChild(diceZone);

    const boardContainer = $('mainBoardsContainer');
    boardContainer.innerHTML = '';
    const boards = document.createElement('div');
    boards.className = 'qwixx-boards';
    if(window._qwixxFocusSeat == null || !s.allPlayers.some(p => p.seat === window._qwixxFocusSeat)) window._qwixxFocusSeat = view.yourSeat >= 0 ? view.yourSeat : s.activeSeat;
    if(mode === 'local') window._qwixxFocusSeat = view.yourSeat; // local device follows whose turn it is
    const focusSeat = window._qwixxFocusSeat;
    const sortedPlayers = [...s.allPlayers].sort((a,b) => (a.seat === focusSeat ? -1 : b.seat === focusSeat ? 1 : a.seat - b.seat));
    boards.innerHTML = sortedPlayers.map(player => {
      const compact = player.seat !== focusSeat;
      return `<div class="player-board qwixx-player-board${player.active ? ' active' : ''}${compact ? ' compact' : ''}" onclick="window._qwixxFocusSeat=${player.seat}; window.GameClients['qwixx'].render(window._renderView)">
        <div class="board-header"><span>${player.active ? '🎲 ' : ''}${player.name}${player.seat === view.yourSeat ? ' (you)' : ''}</span><span class="score-badge">${player.waiting ? 'thinking…' : 'score '+player.score}</span></div>
        ${renderScorecard(player, s, view.yourSeat, compact)}
      </div>`;
    }).join('');
    boardContainer.appendChild(boards);

    $('statusBar').textContent = s.phase === 'GAME_OVER' ? 'Game Over'
      : isWhite ? (pendingWhite ? `Mark one white ${dice.w[0]+dice.w[1]} or skip` : 'Waiting for other players')
      : isAct ? 'Take one white+color mark or finish' : `Waiting for ${activeName}`;

    if(s.phase === 'GAME_OVER') showSummary(view);
  }

  function act(action, msg = {}){
    const view = window._renderView;
    if(mode === 'local') localAct(view.yourSeat, { action, ...msg });
    else net.send({ type:'action', action, ...msg });
  }

  window.GameClients['qwixx'] = { render, act };

  class QwixxEngine {
    constructor(names){
      this.COLORS = COLORS;
      this.players = names.map(name => ({ name: name || 'Player', rows: {}, penalties: 0 }));
      this.players.forEach(p => COLORS.forEach(c => { p.rows[c] = this.makeRow(c); }));
      this.activeSeat = 0;
      this.phase = 'WHITE_PHASE';
      this.expansion = 'standard';
      this.locked = [];
      this.pendingLocks = [];
      this.pendingWhiteDecisions = this.players.map((_, i) => i);
      this.activeMarkedThisTurn = false;
      this.round = 1;
      this.dice = this.getDice();
    }
    makeRow(color){
      const nums = [];
      if(color === 'red' || color === 'yellow') for(let i=2;i<=12;i++) nums.push(i);
      else for(let i=12;i>=2;i--) nums.push(i);
      return { nums, cellColors: nums.map(()=>color), doubles: [], marks: [] };
    }
    getDice(){
      const rnd = () => Math.floor(Math.random()*6)+1;
      const d = { w:[rnd(),rnd()], r:rnd(), y:rnd(), g:rnd(), b:rnd() };
      this.locked.forEach(c => d[COLOR_KEY[c]] = 0);
      return d;
    }
    applyLocks(){ this.pendingLocks.forEach(c => { if(!this.locked.includes(c)) this.locked.push(c); }); this.pendingLocks = []; this.locked.forEach(c => this.dice[COLOR_KEY[c]] = 0); }
    mark(c,row,i){ row.marks.push(i); row.marks.sort((a,b)=>a-b); if(i === row.nums.length-1 && !this.locked.includes(c) && !this.pendingLocks.includes(c)) this.pendingLocks.push(c); }
    can(c,row,i){ return canMarkIndex(this, c, row, i); }
    nextTurn(){
      this.applyLocks();
      if(this.locked.length >= 2 || this.players.some(p => p.penalties >= 4)){ this.phase = 'GAME_OVER'; return; }
      this.activeSeat = (this.activeSeat + 1) % this.players.length;
      this.phase = 'WHITE_PHASE';
      this.dice = this.getDice();
      this.pendingWhiteDecisions = this.players.map((_, i) => i).filter(i => this.players[i].penalties < 4);
      this.activeMarkedThisTurn = false;
      this.round++;
    }
    applyAction(seat,msg){
      if(this.phase === 'GAME_OVER') return;
      if(msg.action === 'mark'){
        const c = msg.c, i = msg.i, p = this.players[seat], row = p && p.rows[c];
        if(!COLORS.includes(c) || !p || !row || !this.can(c,row,i)) return;
        const isAct = seat === this.activeSeat;
        if(this.phase === 'WHITE_PHASE'){
          if(!this.pendingWhiteDecisions.includes(seat)) return;
          const sum = this.dice.w[0]+this.dice.w[1];
          if(row.nums[i] !== sum) return;
          this.mark(c,row,i);
          this.pendingWhiteDecisions = this.pendingWhiteDecisions.filter(x=>x!==seat);
          if(isAct) this.activeMarkedThisTurn = true;
          if(this.pendingWhiteDecisions.length === 0){ this.applyLocks(); this.phase = 'COLOR_PHASE'; }
        } else if(this.phase === 'COLOR_PHASE'){
          if(!isAct) return;
          const die = this.dice[COLOR_KEY[c]];
          if(!die) return;
          const s1 = this.dice.w[0]+die, s2 = this.dice.w[1]+die;
          if(row.nums[i] !== s1 && row.nums[i] !== s2) return;
          this.mark(c,row,i);
          this.activeMarkedThisTurn = true;
          this.nextTurn();
        }
      } else if(msg.action === 'skip'){
        if(this.phase === 'WHITE_PHASE'){
          this.pendingWhiteDecisions = this.pendingWhiteDecisions.filter(x=>x!==seat);
          if(this.pendingWhiteDecisions.length === 0){ this.applyLocks(); this.phase = 'COLOR_PHASE'; }
        }
      } else if(msg.action === 'finishTurn'){
        if(this.phase !== 'COLOR_PHASE' || seat !== this.activeSeat) return;
        if(!this.activeMarkedThisTurn) this.players[this.activeSeat].penalties++;
        this.nextTurn();
      }
    }
    stateFor(seat){
      return { dice:this.dice, activeSeat:this.activeSeat, expansion:this.expansion, locked:this.locked, pendingLocks:this.pendingLocks,
        yourRows:this.players[seat]?.rows || {}, yourPenalties:this.players[seat]?.penalties || 0,
        allPlayers:this.players.map((pl,i)=>({ seat:i, name:pl.name, penalties:pl.penalties, score:scoreRows(pl.rows,pl.penalties), rows:pl.rows, waiting:this.phase==='WHITE_PHASE'?this.pendingWhiteDecisions.includes(i):false, active:i===this.activeSeat })),
        phase:this.phase, round:this.round, pendingWhiteDecisions:this.pendingWhiteDecisions, activeMarkedThisTurn:this.activeMarkedThisTurn };
    }
  }

  window.LocalEngines = window.LocalEngines || {};
  window.LocalEngines['qwixx'] = function(names){
    const E = new QwixxEngine(names);
    return {
      apply(seat,msg){ E.applyAction(seat,msg); },
      next(){ const fresh = new QwixxEngine(E.players.map(p=>p.name)); Object.assign(E, fresh); },
      actor(){ return E.phase === 'WHITE_PHASE' ? (E.pendingWhiteDecisions[0] ?? E.activeSeat) : E.activeSeat; },
      viewFor(seat){
        const s = E.stateFor(seat);
        let summary;
        if(E.phase === 'GAME_OVER'){
          const rows = E.players.map((pl,i)=>({ seat:i, name:pl.name, score:scoreRows(pl.rows,pl.penalties), delta:0 }));
          const max = Math.max(...rows.map(r=>r.score));
          summary = { rows, winners: rows.filter(r=>r.score===max).map(r=>r.seat) };
        }
        return { game:'qwixx', phase:E.phase, over:E.phase==='GAME_OVER', yourSeat:seat, summary, state:s };
      }
    };
  };
})();

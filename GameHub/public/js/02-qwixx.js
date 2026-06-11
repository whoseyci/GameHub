/* ====================== GAME CLIENTS REGISTRY ====================== */
window.GameClients = window.GameClients || {};

/* -------------------- QWIXX client -------------------- */
(function(){
  window.GameRules['qwixx']={title:'🎲 Qwixx',quick:'Cross off numbers left-to-right for the highest score.',steps:['Each turn rolls two white dice and four colored dice.','In the <b>White Phase</b>, everyone may cross one number equal to white + white on any row.','In the <b>Color Phase</b>, only the active player may cross one number equal to one white die + the matching colored die.','Numbers must always be crossed from left to right; you can skip numbers but never go back.','The far-right number locks a row only after enough marks. Two locked rows or four penalties ends the game.','More marks in a row score quadratically; penalties subtract points.'],tip:'Skipping is allowed. Avoid penalties, but do not wait too long to score rows.'};
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
  function possibleWhiteMarks(state, player){
    const dice = state.dice || { w:[0,0], r:0, y:0, g:0, b:0 };
    const sum = dice.w[0] + dice.w[1];
    return COLORS.map(color => {
      if(player.seat === state.activeSeat && state.activeColorUsed && state.activeColorRow === color) return null;
      const row = player.rows[color];
      const idx = row.nums.indexOf(sum);
      return canMarkIndex(state, color, row, idx) ? { kind:'white', color, idx, sum, use:'white', label:`W ${sum}`, title:`White dice ${dice.w[0]}+${dice.w[1]}=${sum}` } : null;
    }).filter(Boolean);
  }
  function possibleColorMarks(state, player){
    const dice = state.dice || { w:[0,0], r:0, y:0, g:0, b:0 };
    const out = [];
    if(player.seat !== state.activeSeat || state.activeColorUsed) return out;
    COLORS.forEach(color => {
      const die = dice[COLOR_KEY[color]];
      if(!die) return;
      const row = player.rows[color];
      [dice.w[0], dice.w[1]].forEach((w, wi) => {
        const sum = w + die;
        const idx = row.nums.indexOf(sum);
        if(canMarkIndex(state, color, row, idx) && !(state.activeWhiteRow === color && state.activeWhiteIndex != null && idx <= state.activeWhiteIndex)) out.push({ kind:'color', color, idx, wi, w, die, sum, use:'color', label:`${color[0].toUpperCase()} ${sum}`, title:`${color} die: white ${w}+${die}=${sum}` });
      });
    });
    return out;
  }
  function legalCombo(white, color){
    if(!white || !color) return true;
    if(white.color !== color.color) return true;
    // If taking both on the same row, white must be resolved first and therefore
    // must be left of the color mark.
    return white.idx < color.idx;
  }
  function moveValue(player, marks){
    if(!marks.length) return -15;
    let value = 0;
    for(const m of marks){
      const row = player.rows[m.color];
      const skip = m.idx - lastMark(row) - 1;
      const lockBonus = m.idx === row.nums.length - 1 ? 18 : 0;
      value += 10 + row.marks.length * 3 - skip * 1.35 + lockBonus;
    }
    return value;
  }
  function recommendedMove(state, player){
    const whites = possibleWhiteMarks(state, player);
    const colors = possibleColorMarks(state, player);
    const combos = [[]];
    whites.forEach(w => combos.push([w]));
    colors.forEach(c => combos.push([c]));
    whites.forEach(w => colors.forEach(c => { if(legalCombo(w,c)) combos.push([w,c]); }));
    combos.sort((a,b) => moveValue(player,b) - moveValue(player,a));
    const best = combos[0] || [];
    if(!best.length) return 'No safe mark — active player would take a penalty.';
    return 'Suggested: ' + best.map(m => `${m.kind === 'white' ? 'white' : m.color} ${m.sum} in ${m.color}`).join(' → ');
  }
  function markHintsFor(state, player){
    const hints = new Map();
    if(state.diceHidden) return hints;
    const add = (color, idx, h) => {
      if(idx == null || idx < 0) return;
      const k = `${color}:${idx}`;
      if(!hints.has(k)) hints.set(k, []);
      if(!hints.get(k).some(x => x.kind === h.kind && x.label === h.label)) hints.get(k).push(h);
    };

    const pendingWhite = state.phase === 'WHITE_PHASE' && state.pendingWhiteDecisions.includes(player.seat);
    const active = player.seat === state.activeSeat;

    // Everyone who has not resolved the white phase sees all white-sum choices.
    if(pendingWhite){
      possibleWhiteMarks(state, player).forEach(w => add(w.color, w.idx, { ...w, actionable:true }));
    }

    // Active player sees all colored possibilities from all six dice simultaneously.
    // In WHITE_PHASE these are previews; in COLOR_PHASE they are actionable.
    if(active && (state.phase === 'WHITE_PHASE' || state.phase === 'COLOR_PHASE')){
      possibleColorMarks(state, player).forEach(c => add(c.color, c.idx, { ...c, actionable:true, preview:state.phase === 'WHITE_PHASE' }));
    }

    return hints;
  }

  function diceList(dice){
    dice = dice || {w:[0,0], r:0, y:0, g:0, b:0};
    return [
      {color:'white',value:dice.w[0]},{color:'white',value:dice.w[1]},
      ...(dice.r?[{color:'red',value:dice.r}]:[]),...(dice.y?[{color:'yellow',value:dice.y}]:[]),
      ...(dice.g?[{color:'green',value:dice.g}]:[]),...(dice.b?[{color:'blue',value:dice.b}]:[]),
    ];
  }
  function renderDice(dice){
    return `<div class="qwixx-dice-rows"><button id="qwixxThrowBtn" class="qwixx-throw-btn">🎲 Throw dice</button><div id="qwixxDiceKit" class="qwixx-kit-dice"></div></div>`;
  }

  function actionLegalForCell(state, player, viewerSeat, color, row, i, hints){
    if(player.seat !== viewerSeat) return false; // inspecting an opponent never controls their sheet
    if(!canMarkIndex(state, color, row, i)) return false;
    return (hints.get(`${color}:${i}`) || []).some(h => h.actionable);
  }
  function renderMiniBoard(player, state, viewerSeat){
    const rows = COLORS.map(color => {
      const row = player.rows[color];
      const last = lastMark(row);
      const dots = Array.from({length:13}, (_, i) => {
        let cls = 'qwixx-mini-dot';
        if(i < row.nums.length){
          if(row.marks.includes(i)) cls += ' marked ' + color;
          else if(i <= last) cls += ' skipped';
        } else if(i === row.nums.length){
          cls += (state.locked.includes(color) || state.pendingLocks?.includes(color)) ? ' lock-on' : ' lock-off';
        } else {
          cls += ' spare';
        }
        return `<span class="${cls}"></span>`;
      }).join('');
      return `<div class="qwixx-mini-row"><span class="qwixx-mini-row-key ${color}"></span>${dots}<span class="qwixx-mini-row-pts">${rowPoints(row)}</span></div>`;
    }).join('');
    const pens = Array.from({length:4}, (_, i) => `<span class="qwixx-mini-pen ${player.penalties > i ? 'on' : ''}">⚠</span>`).join('');
    // BODY only — the dot grid + penalty pips. The shared Kit.MiniBoard provides the
    // frame, active/you states, header (name + score) and the inspect click.
    return `<div class="qwixx-mini-grid">${rows}</div><div class="qwixx-mini-pens">${pens}</div>`;
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
        const legal = actionLegalForCell(state, player, viewerSeat, color, row, i, hints);
        const hintHtml = compact ? '' : cellHints.map(h => `<span class="qwixx-hint ${h.kind === 'white' ? 'white' : color}${h.actionable ? '' : ' preview'}" title="${h.title}" onclick="event.stopPropagation();window.GameClients['qwixx'].act('mark',{c:'${color}',i:${i},use:'${h.use||h.kind}'})">${h.label}</span>`).join('');
        let cls = 'qwixx-cell';
        if(marked) cls += ' x';
        if(unavailable) cls += ' bad';
        if(locked || pendingLock) cls += ' lock';
        if(cellHints.length){
          cls += ' hintable good';
          // Tint the flashing hint glow by the mark's die: white dice → white glow,
          // colored dice → that row's colour (so the indicator reads as which die it is).
          const hasWhite = cellHints.some(h => h.kind === 'white');
          cls += hasWhite ? ' hint-glow-white' : (' hint-glow-' + color);
        }
        const firstAction = cellHints.find(h => h.actionable);
        const click = legal ? `onclick="window.GameClients['qwixx'].act('mark',{c:'${color}',i:${i},use:'${firstAction?.use||firstAction?.kind||'white'}'})"` : '';
        html += `<div class="${cls}" ${click}><span class="qwixx-num">${marked ? '✕' : n}</span>${hintHtml}</div>`;
      });
      const count = row.marks.length + (row.marks.includes(row.nums.length - 1) ? 1 : 0);
      const pts = rowPoints(row);
      html += `</div><div class="qwixx-row-score">${locked || pendingLock ? '🔒' : `${count}<small>${pts}</small>`}</div></div>`;
    });
    const you = player.seat === viewerSeat ? ' you' : '';
    const pens = Array.from({length:4},(_,i)=>`<span class="qwixx-full-pen ${player.penalties>i?'on':''}">⚠</span>`).join('');
    html += `</div><div class="qwixx-player-foot${you}"><span>Score ${scoreRows(player.rows, player.penalties)}</span><span class="qwixx-full-pens">${pens}</span></div>`;
    return html;
  }

  function render(view,ctx={}){
    // Rich game state lives under the namespaced key view.qwixx (the same shape the
    // server and the shared local engine emit). Older local engines stashed it on
    // view.state; keep that as a fallback so nothing breaks mid-migration.
    const s = view.qwixx || view.state;
    const dice = s.dice || { w:[0,0], r:0, y:0, g:0, b:0 };
    const isAct = s.activeSeat === view.yourSeat;
    const isWhite = s.phase === 'WHITE_PHASE';
    const isColor = s.phase === 'COLOR_PHASE';
    const pendingWhite = isWhite && s.pendingWhiteDecisions.includes(view.yourSeat);
    const activeName = s.allPlayers.find(p => p.seat === s.activeSeat)?.name || 'Active player';
    const diceSig = `${s.round}|${s.activeSeat}|${dice.w.join(',')}|${dice.r}|${dice.y}|${dice.g}|${dice.b}`;
    const diceRevealed = window._qwixxDiceSig === diceSig;
    const displayState = {...s, diceHidden: !diceRevealed};
    const focusSeat = ctx.focus ? ctx.focus({actingSeat:s.activeSeat, preferred:view.yourSeat}) : (view.yourSeat >= 0 ? view.yourSeat : s.activeSeat);
    const focused = s.allPlayers.find(p => p.seat === focusSeat) || s.allPlayers[0];
    const others = s.allPlayers.filter(p => p.seat !== focused.seat);

    let controlsHtml = '';
    if(!diceRevealed){
      controlsHtml = `<span class="muted">Throw dice to reveal this turn.</span>`;
    } else if(isWhite){
      if (pendingWhite) controlsHtml = `<button class="qwixx-ctrl-btn pri" onclick="window.GameClients['qwixx'].act('skip')">Skip white ${dice.w[0]+dice.w[1]}</button>`;
      else if (isAct && !s.activeColorUsed) controlsHtml = `<button class="qwixx-ctrl-btn pri" onclick="window.GameClients['qwixx'].act('finishTurn')">Skip color / pass to others</button>`;
      else controlsHtml = `<span class="muted">Waiting for white-dice decisions…</span>`;
    } else if(isColor){
      controlsHtml = isAct
        ? `<button class="qwixx-ctrl-btn pri" onclick="window.GameClients['qwixx'].act('finishTurn')">${!s.activeMarkedThisTurn ? 'Take Penalty / Finish' : 'Finish Turn'}</button>`
        : `<span class="muted">${esc(activeName)} may take one color mark…</span>`;
    }

    // Opponent strip: append each mini DIRECTLY as a grid child (a DocumentFragment
    // flattens on append), so they are the real grid items. (A display:contents
    // wrapper looked fine but hid the minis from the strip's :nth-child(N) column
    // rules — which made rows past the first CLIP under overflow:hidden, so only the
    // first 1–2 opponents showed their crossed-off marks. Fragment fixes that.)
    const opponents = document.createDocumentFragment();
    others.forEach(player => opponents.appendChild(Kit.MiniBoard({
      name: player.name, badge: player.score,
      active: !!player.active, you: player.seat === view.yourSeat,
      seat: player.seat, variant: 'qwixx',
      body: renderMiniBoard(player, displayState, view.yourSeat),
      onClick: () => window.GameClients['qwixx'].inspect(player.seat),
    })));
    const center = `<div class="qwixx-dice-zone">
      <div class="qwixx-turn-head">
        <span>${!diceRevealed ? '🎲 New throw' : (isWhite ? '🎲 Everyone: white dice' : '🎯 Active player: one color combo')}</span>
        <span>Round ${s.round}</span>
      </div>
      ${renderDice(dice)}
      <div class="qwixx-combos">
        ${diceRevealed ? `<span class="qwixx-combo white">White: ${dice.w[0]}+${dice.w[1]}=${dice.w[0]+dice.w[1]}</span>${COLORS.map(c => dice[COLOR_KEY[c]] ? `<span class="qwixx-combo ${c}">${c[0].toUpperCase()}: ${dice.w[0]}+${dice[COLOR_KEY[c]]} / ${dice.w[1]}+${dice[COLOR_KEY[c]]}</span>` : '').join('')}` : '<span class="qwixx-combo white">Dice hidden until throw</span>'}
      </div>
      <div class="qwixx-controls">${controlsHtml}</div>
    </div>`;
    const rec = focused.seat === s.activeSeat ? `<div class="qwixx-reco">💡 ${diceRevealed ? recommendedMove(s, focused) : 'Throw dice to reveal options.'}</div>` : '';
    const focus = `<div class="qwixx-table"><div class="qwixx-focus-card player-board${focused.active ? ' active' : ''}">
      <div class="board-header"><span>${focused.active ? '🎲 ' : ''}${esc(focused.name)}${focused.seat === view.yourSeat ? ' (you)' : ''}</span><span class="score-badge">Active: ${esc(activeName)} · total ${esc(focused.score)}</span></div>
      ${rec}
      ${renderScorecard(focused, displayState, view.yourSeat, false)}
    </div></div>`;
    const status = s.phase === 'GAME_OVER' ? 'Game Over'
      : !diceRevealed ? 'Throw dice to reveal this turn'
      : isWhite ? (pendingWhite ? `Mark one white ${dice.w[0]+dice.w[1]} or skip` : 'Waiting for other players')
      : isAct ? 'Take one white+color mark or finish' : `Waiting for ${esc(activeName)}`;

    GameShell.renderTable({game:'qwixx',opponents,center,focus,status,topMode:'custom',opponentClass:'qwixx-top-mini-strip'});

    const shouldRoll = !diceRevealed;
    const diceTray = $('qwixxDiceKit'), throwBtn = $('qwixxThrowBtn');
    const doThrow = () => {
      if(throwBtn) throwBtn.classList.add('hidden');
      window._qwixxDiceSig = diceSig;
      Kit.rollDice(diceTray, diceList(dice), {size: innerWidth < 760 ? 30 : 42, animate: true, originEl: throwBtn}).then(()=>{
        if(window._renderView && window._renderView.game === 'qwixx') dispatchView(window._renderView);
      });
    };
    if(shouldRoll){ diceTray.innerHTML=''; if(throwBtn){ throwBtn.classList.remove('hidden'); throwBtn.onclick=doThrow; } }
    else { if(throwBtn) throwBtn.classList.add('hidden'); Kit.rollDice(diceTray, diceList(dice), {size: innerWidth < 760 ? 30 : 42, animate: false}); }

    if(s.phase === 'GAME_OVER') showSummary(view);
  }

  function inspect(seat){
    const view=window._renderView;if(!view||view.game!=='qwixx')return;
    const s=view.qwixx||view.state;const player=s.allPlayers.find(p=>p.seat===seat);if(!player)return;
    const seats=s.allPlayers.filter(p=>p.seat!==view.yourSeat).map(p=>p.seat);
    const idx=seats.indexOf(seat),prev=seats[(idx-1+seats.length)%seats.length],next=seats[(idx+1)%seats.length];
    GameShell.inspect(`<div class="inspect-head"><button class="icon-btn" onclick="window.GameClients['qwixx'].inspect(${prev})">‹</button><b>${esc(player.name)}${player.active?' 🎲':''}</b><button class="icon-btn" onclick="window.GameClients['qwixx'].inspect(${next})">›</button><button class="icon-btn" onclick="GameShell.closeInspect()">✕</button></div><div class="player-board qwixx-focus-card">${renderScorecard(player,s,view.yourSeat,false)}</div>`);
  }

  function act(action, msg = {}){
    const view = window._renderView;
    GameActions.send(action, msg, view?.yourSeat ?? 0);
  }

  function unmount(){removeQwixxUi();}
  window.GameClients['qwixx'] = { render, act, inspect, unmount };

})();

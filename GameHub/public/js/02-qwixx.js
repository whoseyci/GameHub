/* ====================== GAME CLIENTS REGISTRY ====================== */
window.GameClients={
  
  'qwixx': (() => {
    const COLORS = ['red', 'yellow', 'green', 'blue'];
    const C_HEX = { red: '#e74c3c', yellow: '#f1c40f', green: '#2ecc71', blue: '#3498db' };

    function getFacesHtml(val, max) {
      const faces = ['front', 'right', 'back', 'left', 'top', 'bottom'];
      return faces.map(f => {
        let v = f === 'front' ? val : Math.floor(Math.random() * max) + 1;
        return `<div class="qwixx-cube__face qwixx-cube__face--${f}">${v}</div>`;
      }).join('');
    }

    function renderDice(dice, max, shouldAnimate) {
      const wHtml = dice.w.map((v, i) => `
        <div class="qwixx-scene w">
          <div class="qwixx-cube w ${shouldAnimate ? 'rolling' : ''}">${getFacesHtml(v, max)}</div>
        </div>
      `).join('');

      const cHtml = COLORS.filter(c => dice[c] > 0).map(c => `
        <div class="qwixx-scene ${c[0]}">
          <div class="qwixx-cube ${c[0]} ${shouldAnimate ? 'rolling' : ''}">${getFacesHtml(dice[c], max)}</div>
        </div>
      `).join('');

      return `<div class="qwixx-dice-rows">
        <div class="qwixx-dice-row"><span style="font-size:0.65rem;color:#999">white</span><div style="display:flex;gap:0.6rem">${wHtml}</div></div>
        <div class="qwixx-dice-row"><span style="font-size:0.65rem;color:#999">colors</span><div style="display:flex;gap:0.6rem">${cHtml}</div></div>
      </div>`;
    }

    function renderScorecard(p, state) {
      let html = `<div class="qwixx-scorecard">`;
      
      COLORS.forEach(c => {
        const row = p.rows[c];
        const locked = state.locked.includes(c);
        const last = row.marks.length > 0 ? row.marks[row.marks.length - 1] : -1;
        
        html += `<div class="qwixx-score-row">
          <div class="qwixx-row-hdr" style="background:${C_HEX[c]}">${c[0].toUpperCase()}</div>
          <div class="qwixx-row-cells">`;
        
        row.nums.forEach((n, i) => {
          const marked = row.marks.includes(i);
          const bad = !marked && i <= last;
          const isLockable = i === row.nums.length - 1 && row.marks.length >= 5;
          let cls = 'qwixx-cell';
          if (marked) cls += ' x';
          if (bad) cls += ' bad';
          if (locked) cls += ' lock';
          if (isLockable && !marked) cls += ' good';
          
          html += `<div class="${cls}" onclick="window.GameClients['qwixx'].act('mark', {c:'${c}',i:${i}})">${marked ? '✕' : n}</div>`;
        });
        
        html += `</div><div style="display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.8rem">${locked ? '🔒' : row.marks.length}</div></div>`;
      });
      
      html += `</div>`;
      return html;
    }

    return {
      render(view) {
        const s = view.state;
        const p = s.yourRows ? { rows: s.yourRows, penalties: s.yourPenalties } : { rows: {}, penalties: 0 };
        const max = s.expansion === 'longo' ? 8 : 6;

        $('topArea').style.display = 'flex';
        const piles = $('topArea').querySelector('.piles');
        if (piles) piles.style.display = 'none';
        $('heldCardWrapper').style.display = 'none';
        const oldDice = $('topArea').querySelector('.qwixx-dice-zone');
        if (oldDice) oldDice.remove();

        const diceZone = document.createElement('div');
        diceZone.className = 'qwixx-dice-zone';
        const isAct = s.activeSeat === view.yourSeat;
        const isWhite = s.phase === 'WHITE_PHASE';
        const isColor = s.phase === 'COLOR_PHASE';
        const pendingWhite = isWhite && s.pendingWhiteDecisions.includes(view.yourSeat);

        let controlsHtml = '';
        if (isWhite) {
           if (pendingWhite) {
              controlsHtml = `<button class="qwixx-ctrl-btn pri" onclick="window.GameClients['qwixx'].act('skip')">Skip White</button>`;
           } else {
              controlsHtml = `<span class="muted">Waiting for others...</span>`;
           }
        } else if (isColor) {
           if (isAct) {
              controlsHtml = `<button class="qwixx-ctrl-btn pri" onclick="window.GameClients['qwixx'].act('finishTurn')">${!s.activeMarkedThisTurn ? 'Take Penalty & Finish' : 'Finish Turn'}</button>`;
           }
        }

        diceZone.innerHTML = `
          <div style="display:flex;justify-content:space-between;width:100%;font-weight:800;font-size:0.9rem;margin-bottom:8px">
            <span>${isWhite ? '🎲 White Phase' : '🎯 Color Phase'}</span>
            <span>Round ${s.round}</span>
          </div>
          ${renderDice(s.dice || {w:[0,0],r:0,y:0,g:0,b:0}, max, !!(prevView && prevView.state && prevView.state.round !== s.round))}
          <div class="qwixx-controls">
            ${controlsHtml}
          </div>
        `;
        $('topArea').appendChild(diceZone);

        const boardContainer = $('mainBoardsContainer');
        boardContainer.innerHTML = '';
        const board = document.createElement('div');
        board.className = 'player-board';
        board.innerHTML = `<div class="board-header"><span>Your Sheet</span><span class="score-badge">Penalties: ${s.yourPenalties}/4</span></div>`;
        board.appendChild(document.createRange().createContextualFragment(renderScorecard(p, s)));
        boardContainer.appendChild(board);

        let sbText = 'Game Over';
        if (isWhite) {
           sbText = pendingWhite ? 'Your Turn (White Dice)!' : 'Waiting...';
        } else if (isColor) {
           sbText = isAct ? 'Your Turn (Color Dice)!' : 'Waiting...';
        }
        $('statusBar').textContent = sbText;

        if (prevView && prevView.state && prevView.state.round !== s.round) {
          setTimeout(() => {
            document.querySelectorAll('.qwixx-cube.rolling').forEach(cube => {
              let rx = Math.random() * 720 - 360;
              let ry = Math.random() * 720 - 360;
              cube.style.transition = 'none';
              cube.style.transform = `translateZ(-26px) rotateX(${rx}deg) rotateY(${ry}deg)`;
              
              cube.offsetHeight; // force reflow
              
              cube.style.transition = 'transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)';
              let finalRx = 360 * (Math.floor(Math.random() * 2) + 1);
              let finalRy = 360 * (Math.floor(Math.random() * 2) + 1);
              cube.style.transform = `translateZ(-26px) rotateX(${finalRx}deg) rotateY(${finalRy}deg)`;
              cube.classList.remove('rolling');
            });
          }, 10);
        }

        if (s.phase === "GAME_OVER") {
           showSummary(view);
        }
      },
      act(action, msg) {
        const view = window._renderView;
        if (mode === 'local') {
           localAct(view.yourSeat, { action, ...msg });
        } else {
           net.send({ type: 'action', action, ...msg });
        }
      }
    };
  })()

};
window.LocalEngines={};


/* -------------------- QWIXX client -------------------- */
(function(){
  
class QwixxEngine {
  constructor(names) {
    this.COLORS = ["red", "yellow", "green", "blue"];
    this.players = names.map(name => ({
      name: name || "Player",
      rows: {},
      penalties: 0,
    }));
    this.expansion = "standard";
    this.locked = [];
    this.pendingLocks = [];
    this.pendingWhiteDecisions = this.players.map((_, i) => i);
    this.activeMarkedThisTurn = false;
    this.round = 1;
    this.players.forEach(p => {
      this.COLORS.forEach(c => { p.rows[c] = this.makeRow(c); });
    });
    this.dice = this.getDice();
    this.activeSeat = 0;
    this.phase = "WHITE_PHASE";
  }
  
  makeRow(color) {
    const isAsc = color === "red" || color === "yellow";
    let nums = [];
    if (isAsc) { for (let i = 2; i <= 12; i++) nums.push(i); }
    else { for (let i = 12; i >= 2; i--) nums.push(i); }
    return { nums, cellColors: nums.map(() => color), doubles: [], marks: [] };
  }

  getDice() {
    const rnd = () => Math.floor(Math.random() * 6) + 1;
    return { w: [rnd(), rnd()], r: rnd(), y: rnd(), g: rnd(), b: rnd() };
  }

  applyAction(seat, msg) {
    if (this.phase === "GAME_OVER") return;

    if (msg.action === "mark") {
      const { c, i } = msg;
      const p = this.players[seat];
      if (!p) return;
      const row = p.rows[c];
      if (!row || row.marks.includes(i)) return;
      
      const last = row.marks.length > 0 ? row.marks[row.marks.length - 1] : -1;
      if (i <= last) return;
      
      const endIdx = row.nums.length - 1;
      if (i === endIdx && row.marks.length < 5) return;
      
      const isAct = seat === this.activeSeat;
      
      if (this.phase === "WHITE_PHASE") {
        if (!this.pendingWhiteDecisions.includes(seat)) return;
        const wSum = this.dice.w[0] + this.dice.w[1];
        if (row.nums[i] !== wSum) return;

        row.marks.push(i);
        row.marks.sort((a,b)=>a-b);
        this.pendingWhiteDecisions = this.pendingWhiteDecisions.filter(x => x !== seat);
        if (isAct) this.activeMarkedThisTurn = true;
        
        if (i === endIdx && row.marks.length >= 5 && !this.locked.includes(c) && !this.pendingLocks.includes(c)) {
          this.pendingLocks.push(c);
        }

        if (this.pendingWhiteDecisions.length === 0) {
          this.phase = "COLOR_PHASE";
        }
      } else if (this.phase === "COLOR_PHASE") {
        if (!isAct) return;
        
        const reqColor = row.cellColors[i];
        const cKey = reqColor[0];
        const sum1 = this.dice.w[0] + this.dice[cKey];
        const sum2 = this.dice.w[1] + this.dice[cKey];
        
        if (row.nums[i] !== sum1 && row.nums[i] !== sum2) return;
        
        row.marks.push(i);
        row.marks.sort((a,b)=>a-b);
        this.activeMarkedThisTurn = true;
        
        if (i === endIdx && row.marks.length >= 5 && !this.locked.includes(c) && !this.pendingLocks.includes(c)) {
          this.pendingLocks.push(c);
        }
        
        this.applyAction(seat, { action: "finishTurn" });
      }
    }

    if (msg.action === "skip") {
      if (this.phase === "WHITE_PHASE") {
        this.pendingWhiteDecisions = this.pendingWhiteDecisions.filter(x => x !== seat);
        if (this.pendingWhiteDecisions.length === 0) {
          this.phase = "COLOR_PHASE";
        }
      }
    }

    if (msg.action === "finishTurn") {
      if (this.phase !== "COLOR_PHASE" || seat !== this.activeSeat) return;
      
      if (!this.activeMarkedThisTurn) {
        this.players[this.activeSeat].penalties++;
      }
      
      this.pendingLocks.forEach(c => {
        if (!this.locked.includes(c)) this.locked.push(c);
      });
      this.pendingLocks = [];
      
      if (this.locked.length >= 2 || this.players.some(p => p.penalties >= 4)) {
        this.phase = "GAME_OVER";
      } else {
        this.activeSeat = (this.activeSeat + 1) % this.players.length;
        let tries = 0;
        while (this.players[this.activeSeat].penalties >= 4 && tries < this.players.length) {
          this.activeSeat = (this.activeSeat + 1) % this.players.length;
          tries++;
        }
        this.phase = "WHITE_PHASE";
        this.dice = this.getDice();
        this.locked.forEach(c => {
          this.dice[c[0]] = 0;
        });
        this.pendingWhiteDecisions = this.players.map((_, i) => i).filter(i => this.players[i].penalties < 4);
        this.activeMarkedThisTurn = false;
        this.round++;
      }
    }
  }

  getStateFor(seat) {
    const p = this.players[seat];
    return {
      dice: this.dice,
      activeSeat: this.activeSeat,
      expansion: this.expansion,
      locked: this.locked,
      yourRows: p ? p.rows : {},
      yourPenalties: p ? p.penalties : 0,
      allPlayers: this.players.map((pl, i) => ({
        seat: i,
        name: pl.name,
        penalties: pl.penalties,
        rows: pl.rows,
        waiting: this.phase === "WHITE_PHASE" ? this.pendingWhiteDecisions.includes(i) : false
      })),
      phase: this.phase,
      round: this.round,
      pendingWhiteDecisions: this.pendingWhiteDecisions,
      activeMarkedThisTurn: this.activeMarkedThisTurn
    };
  }
}

window.LocalEngines['qwixx'] = function(names) {
  const E = new QwixxEngine(names);
  return {
    apply(seat, msg) { E.applyAction(seat, msg); },
    next() { 
       E.players.forEach(p => {
          p.penalties = 0;
          E.COLORS.forEach(c => { p.rows[c] = E.makeRow(c); });
       });
       E.locked = [];
       E.pendingLocks = [];
       E.pendingWhiteDecisions = E.players.map((_, i) => i);
       E.activeMarkedThisTurn = false;
       E.round = 1;
       E.dice = E.getDice();
       E.activeSeat = 0;
       E.phase = "WHITE_PHASE";
    },
    actor() {
       if (E.phase === "WHITE_PHASE") {
           return E.pendingWhiteDecisions.length > 0 ? E.pendingWhiteDecisions[0] : E.activeSeat;
       }
       return E.activeSeat;
    },
    viewFor(seat) {
      const s = E.getStateFor(seat);
      let summary;
      if (E.phase === "GAME_OVER") {
        const scores = E.players.map((pl, i) => {
          let total = 0;
          E.COLORS.forEach(c => {
            let m = pl.rows[c].marks.length;
            if (pl.rows[c].marks.includes(pl.rows[c].nums.length - 1)) m++;
            total += (m * (m + 1)) / 2;
          });
          total -= pl.penalties * 5;
          return { seat: i, name: pl.name, score: total, delta: 0 };
        });
        const max = Math.max(...scores.map(x => x.score));
        summary = {
          rows: scores,
          winners: scores.filter(x => x.score === max).map(x => x.seat),
        };
      }
      return { game: 'qwixx', phase: E.phase, over: E.phase === "GAME_OVER", yourSeat: seat, summary, state: s };
    }
  };
};
})();

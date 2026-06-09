/*
  Copy this file to public/js/games/<id>.js and load it from index.html.
  Keep this file unloaded: it is documentation + starter code only.

  Contract:
    window.GameClients[id].render(view) draws the online/local view.
    window.GameClients[id].act(action, extra?) sends a player action.
    window.LocalEngines[id](names) is optional single-device offline play.
*/

(function(){
  const ID = 'template';

  function send(action, extra = {}) {
    const msg = { action, ...extra };
    const seat = window._renderView?.yourSeat ?? 0;
    if (typeof localAct === 'function' && mode === 'local') localAct(seat, msg);
    else if (typeof net !== 'undefined') net.send({ type: 'action', ...msg });
  }

  function render(view) {
    removeQwixxUi();
    $('topArea').style.display = 'none';
    $('miniBoardsContainer').innerHTML = '';
    $('mainBoardsContainer').innerHTML = `
      <div class="player-board">
        <div class="player-title">${esc(view.template?.players?.[view.yourSeat]?.name || 'Spectator')}</div>
        <div class="muted">Replace this with your game UI.</div>
        <button class="btn" onclick="window.GameClients['${ID}'].act('example')">Example action</button>
      </div>`;
    $('statusBar').textContent = view.yourSeat < 0 ? 'Spectating' : 'Playing';
    if (view.summary && !summaryShown) showSummary(view);
  }

  window.GameClients[ID] = { render, act: send };
})();

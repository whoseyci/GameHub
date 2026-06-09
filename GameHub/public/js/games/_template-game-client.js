/*
  Copy this file to public/js/games/<id>.js and load it from index.html.
  Keep this file unloaded: it is documentation + starter code only.

  Contract:
    window.GameClients[id].render(view, ctx) draws the online/local view.
    window.GameClients[id].act(action, extra?) sends a player action.
    window.GameClients[id].unmount() optionally cleans up game-only globals.
    window.LocalEngines[id](names) is optional single-device offline play.

  Use GameShell.renderTable(...) rather than directly mutating the global table
  containers. Use ctx.focus({actingSeat, preferred}) to keep local/online/bot focus
  consistent.
*/

(function(){
  const ID = 'template';
  window.GameRules[ID] = {
    title: '🧩 Template',
    quick: 'Replace this with a one-line summary.',
    steps: ['Describe setup.', 'Describe the turn.', 'Describe how the game ends.'],
    tip: 'Keep rule text registered with the game client so built-ins and scaffolded games use the same path.',
  };

  function send(action, extra = {}) {
    const seat = window._renderView?.yourSeat ?? 0;
    GameActions.send(action, extra, seat);
  }

  function render(view, ctx = {}) {
    const focused = ctx.focus ? ctx.focus({ actingSeat: view[ID]?.current, preferred: view.yourSeat }) : view.yourSeat;
    const focus = `
      <div class="player-board">
        <div class="player-title">${esc(view[ID]?.players?.[focused]?.name || 'Spectator')}</div>
        <div class="muted">Replace this with your game UI.</div>
        <button class="btn" onclick="window.GameClients['${ID}'].act('example')">Example action</button>
      </div>`;
    GameShell.renderTable({ game: ID, focus, topMode: 'hidden', status: view.yourSeat < 0 ? 'Spectating' : 'Playing' });
    if (view.summary && !summaryShown) showSummary(view);
  }

  function unmount() {}

  window.GameClients[ID] = { render, act: send, unmount };
})();

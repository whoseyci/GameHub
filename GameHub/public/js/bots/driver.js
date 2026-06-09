/**
 * BotDriver — Game-agnostic bot interface for the GameHub.
 *
 * Each game implements a BotStrategy and registers it here.
 * The driver handles:
 * - Determining which bot needs to act
 * - Routing to the correct game-specific strategy
 * - Injecting observation-correct views (not hidden truth)
 *
 * Bots "think" on the host's client so server compute stays ~0.
 */
const BotDriver = (() => {
  /** @type {Record<string, BotStrategy>} */
  const strategies = {};

  /**
   * @interface BotStrategy
   * @property {function(GameView, number, string): object|null} choose
   * @property {function(GameView): boolean} needsBot
   * @property {function(GameView): number} getActingSeat
   */

  /**
   * Register a game's bot strategy.
   * @param {string} gameId
   * @param {BotStrategy} strategy
   */
  function register(gameId, strategy) {
    strategies[gameId] = strategy;
  }

  /**
   * Check if any bot seat needs to act right now.
   * @param {GameView} view
   * @returns {boolean}
   */
  function needsBot(view) {
    const strategy = strategies[view.game];
    if (!strategy) return false;
    try {
      return strategy.needsBot(view);
    } catch (e) {
      console.warn(`BotDriver.needsBot error for ${view.game}:`, e);
      return false;
    }
  }

  /**
   * Get the seat index of the bot that should act.
   * @param {GameView} view
   * @returns {number|null}
   */
  function getActingSeat(view) {
    const strategy = strategies[view.game];
    if (!strategy) return null;
    try {
      return strategy.getActingSeat(view);
    } catch (e) {
      console.warn(`BotDriver.getActingSeat error for ${view.game}:`, e);
      return null;
    }
  }

  /**
   * Get the action for a specific bot seat.
   * @param {GameView} view
   * @param {number} botSeat
   * @param {string} difficulty
   * @returns {object|null}
   */
  function choose(view, botSeat, difficulty) {
    const strategy = strategies[view.game];
    if (!strategy) return null;
    try {
      // Build an observation-correct view for this bot seat
      const botView = buildBotObservation(view, botSeat);
      return strategy.choose(botView, botSeat, difficulty);
    } catch (e) {
      console.warn(`BotDriver.choose error for ${view.game} seat ${botSeat}:`, e);
      return null;
    }
  }

  /**
   * Build a view containing only the information a bot can observe.
   * For online bots, this is the view the host receives (with publicDrawn patched).
   * @param {GameView} view
   * @param {number} botSeat
   * @returns {GameView}
   */
  function buildBotObservation(view, botSeat) {
    const gv = view[view.game] || view.state || {};

    if (view.game === 'skyjo') {
      // Skyjo: host receives publicDrawn for deck draws, and lastAction for discard takes.
      // We need to patch the view so the bot sees what it can actually observe.
      const sg = { ...gv, currentPlayer: botSeat };
      if (sg.myDrawnCard == null && sg.turnAction === 'deck' && sg.publicDrawn != null) {
        sg.myDrawnCard = sg.publicDrawn;
      }
      if (sg.myDrawnCard == null && sg.turnAction === 'discard' && sg.lastAction && sg.lastAction.type === 'take_discard' && sg.lastAction.player === botSeat) {
        sg.myDrawnCard = sg.lastAction.value;
      }
      return { ...view, skyjo: sg };
    }

    // For other games, return the view as-is (game-specific strategies handle their own observation encoding).
    return view;
  }

  return { register, needsBot, getActingSeat, choose };
})();

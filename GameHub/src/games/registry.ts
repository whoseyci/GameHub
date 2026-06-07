import { GameDef } from './types';
import { flip7 } from './flip7';
import { skyjo } from './skyjo';
import { Qwixx } from './qwixx'; // 1. Import Qwixx here

// 2. Add qwixx to the GAME_CATALOGUE (not GAMES)
export const GAME_CATALOGUE: Record<string, GameDef<any, any>> = {
  flip7,
  skyjo,
  qwixx: Qwixx, 
};

// 3. Ensure getGame is exported so server.ts can find it
export const getGame = (gameId: string): GameDef<any, any> => {
  return GAME_CATALOGUE[gameId];
};

// 4. Ensure TICK_RUNNERS is exported (keep whatever you originally had inside it)
export const TICK_RUNNERS: Record<string, any> = {
  // If you had any tick runners for skyjo/flip7, leave them here. 
  // Qwixx is turn-based, so it doesn't need a tick runner!
};

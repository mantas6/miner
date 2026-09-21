import { SAVE_KEY, save } from '../persistence';
import { createInitialState } from './state';
import type { GameState } from './types';

export const PLAYER_DATA_RESET_CONFIRMATION = 'Reset all player data? This permanently clears cash, upgrades, equipment, cargo, stats, objectives, explored fog, and current ship progress. The mine terrain will be preserved.';

export function confirmPlayerDataReset(confirmReset: (message: string) => boolean): boolean {
  return confirmReset(PLAYER_DATA_RESET_CONFIRMATION);
}

/** Reset player-owned state while retaining the current world and enemies. */
export function resetPlayerData(state: GameState): void {
  const fresh = createInitialState();

  state.cash = fresh.cash;
  state.tick = fresh.tick;
  state.gameOver = fresh.gameOver;
  state.camX = fresh.camX;
  state.camY = fresh.camY;
  state.particles = fresh.particles;
  state.stats = fresh.stats;
  state.teleportEffect = fresh.teleportEffect;
  state.teleportReturnPosition = fresh.teleportReturnPosition;
  state.exploredTiles = fresh.exploredTiles;
  state.scannerDevices = fresh.scannerDevices;
  state.placedDynamite = fresh.placedDynamite;
  state.cargoContainers = fresh.cargoContainers;
  state.input = fresh.input;
  Object.assign(state.player, fresh.player);

  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Saving below still gives storage implementations without removeItem a chance.
  }
  save(state);
}

import { placeAtSurfaceSpawn } from '../core/state';
import type { GameState } from '../core/types';

export const WORLD_STATE_RESET_CONFIRMATION = 'Reset world state? This permanently regenerates all terrain, restores dug-out blocks and world enemies, clears explored fog, and removes deployed equipment along with anything stored in it. Player cash, upgrades, cargo bay, stats, settings, and ship condition are preserved.';

export function confirmWorldStateReset(confirmReset: (message: string) => boolean): boolean {
  return confirmReset(WORLD_STATE_RESET_CONFIRMATION);
}

/**
 * Regenerate world-owned state while preserving every player-owned value.
 *
 * Clearing `world` is almost all it takes — tiles are generated lazily on first
 * access — but the solo diff has to go with it, or the next restart would layer
 * the old tunnels straight back onto the fresh terrain.
 */
export function resetWorldTerrain(state: GameState): void {
  state.world = [];
  state.soloTileDiff = new Map();
  state.enemies = [];
  state.exploredTiles.clear();
  // Deployed scanners belong to the mine they were dropped into, and the fog they
  // were surveying is coming back; the ones still in the bay are player property
  // and stay there.
  state.scannerDevices = [];
  // A stick burning in a tunnel that no longer exists has nothing left to blow up.
  state.placedDynamite = [];
  // Likewise a crate: the tile it stood on is being regenerated, so it goes with
  // the mine it was left in, and whatever was stored inside it goes too.
  state.cargoContainers = [];
  state.particles = [];
  state.extractionPhase = 'none';
  state.teleportEffect = null;
  state.teleportReturnPosition = null;
  state.gameOver = false;
  state.input.gunArmed = false;
  placeAtSurfaceSpawn(state.player);
  state.camX = Math.max(0, state.player.x - 7);
  state.camY = 0;
}

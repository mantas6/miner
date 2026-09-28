import { placeAtHome } from '../core/state';
import type { GameState } from '../core/types';
import { applyTileEntries, recordTileDiff, tileDiffEntries } from './tile-diff';
import { makeTile } from './world';

export const WORLD_STATE_RESET_CONFIRMATION = 'Reset world state? This permanently regenerates all terrain — refilling dug-out tunnels, removing placed decorations and restoring world enemies — clears explored fog, and removes deployed scanners, dynamite, cargo containers and wrecks along with anything stored in them. Stations and portals stay where they stand, with the rock on their own tile cleared. The ship returns to the home base; player cash, upgrades, cargo bay, stats, settings, and ship condition are preserved.';

export function confirmWorldStateReset(confirmReset: (message: string) => boolean): boolean {
  return confirmReset(WORLD_STATE_RESET_CONFIRMATION);
}

/**
 * Regenerate world-owned state while preserving every player-owned value.
 *
 * Clearing `world` is almost all it takes — tiles are generated lazily on first
 * access — but the tile diff has to go with it, or the next restart would layer
 * the old tunnels straight back onto the fresh terrain.
 *
 * Stations are player property (and the base's crafting, fuel and portal
 * network), so they stay — but a station set down in a tunnel would now stand
 * inside fresh rock, so its own tile is carved back to open space in the new
 * diff. A portal is then always somewhere the ship can land.
 */
export function resetWorldTerrain(state: GameState): void {
  state.world = [];
  state.tileDiff = new Map();
  for (const station of state.stations) {
    if (makeTile(station.x, station.y).type === 'air') continue;
    recordTileDiff(state.tileDiff, {x: station.x, y: station.y, tile: {type: 'air'}});
  }
  applyTileEntries(state.world, tileDiffEntries(state.tileDiff));
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
  // A wreck is corpse loot lying in the old tunnels, and those tunnels are gone.
  state.wrecks = [];
  state.particles = [];
  state.teleportEffect = null;
  state.gameOver = false;
  placeAtHome(state.player);
  state.camX = Math.max(0, state.player.x - 7);
  state.camY = Math.max(0, state.player.y - 7);
}

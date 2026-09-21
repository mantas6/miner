import { START_Y, WORLD_W } from '../../shared/constants';
import { STARTING } from './balance';
import { createInventory, removeOres } from './inventory';
import type { GameState, GameStats, Player } from './types';

/** Tile column of the surface shaft where every ship starts or returns. */
export const SURFACE_SPAWN_X = Math.floor(WORLD_W / 2);

type PlaceablePlayer = Pick<Player, 'x' | 'y' | 'drawX' | 'drawY'>;

/** Move a ship to the surface shaft spawn, keeping its render position in sync. */
export function placeAtSurfaceSpawn(player: PlaceablePlayer): void {
  Object.assign(player, {
    x: SURFACE_SPAWN_X,
    y: START_Y,
    drawX: SURFACE_SPAWN_X,
    drawY: START_Y
  });
}

export function respawnPlayer(player: Player): void {
  placeAtSurfaceSpawn(player);
  Object.assign(player, {
    fuel: player.fuelMax,
    hull: player.hullMax,
    // Ore never survives a death; bought equipment — dynamite, scanners, guns,
    // teleporters, containers — rides out of the wreck with the miner. Ore stored
    // in a crate is not aboard at all, so it is not lost either.
    inventory: removeOres(player.inventory)
  });
}

/** Fresh zeroed run/progress statistics, shared by new games and save loading. */
export function createDefaultStats(): GameStats {
  return {
    maxDepth: 0,
    totalCashEarned: 0,
    oreMined: 0,
    artifactsFound: 0,
    enemiesDestroyed: 0,
    deaths: 0,
    motherlodeClaims: 0,
    motherlodeExtractions: 0
  };
}

export function createInitialState(): GameState {
  return {
    world: [],
    soloTileDiff: new Map(),
    cash: STARTING.cash,
    tick: 0,
    gameOver: false,
    camX: 0,
    camY: 0,
    particles: [],
    enemies: [],
    enemyIdCounter: 1,
    stats: createDefaultStats(),
    extractionPhase: 'none',
    teleportEffect: null,
    teleportReturnPosition: null,
    reducedMotion: false,
    exploredTiles: new Set<number>(),
    scannerDevices: [],
    placedDynamite: [],
    cargoContainers: [],
    armedPlacement: null,
    hoverTile: null,
    input: {
      keyImpulse: null,
      sprintDirection: null,
      sprintMomentum: null,
      lastKeyboardMove: 0,
      keyboardRepeatMs: 105,
      gunArmed: false,
      resetConfirmUntil: 0
    },
    player: {
      x: SURFACE_SPAWN_X,
      y: START_Y,
      drawX: SURFACE_SPAWN_X,
      drawY: START_Y,
      facing: 1,
      bob: 0,
      drillAnim: 0,
      drillDx: 0,
      drillDy: 1,
      fuel: STARTING.fuel,
      fuelMax: STARTING.fuelMax,
      hull: STARTING.hull,
      hullMax: STARTING.hullMax,
      cargoMax: STARTING.cargoMax,
      drill: STARTING.drill,
      inventory: createInventory()
    }
  };
}

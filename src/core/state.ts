import { HOME_ROW, HOME_X, SHIP_UPGRADE_SLOTS, isHomeCavern } from '../../shared/constants';
import { STARTING } from './balance';
import { createHomeState } from './home';
import { createInventory, removeOres } from './inventory';
import type { GameState, GameStats, Player } from './types';

/** Tile column of the home cavern where every ship starts or returns. */
export const HOME_SPAWN_X = HOME_X;

type PlaceablePlayer = Pick<Player, 'x' | 'y' | 'drawX' | 'drawY'>;

/** Move a ship to the home cavern floor, keeping its render position in sync. */
export function placeAtHome(player: PlaceablePlayer): void {
  Object.assign(player, {
    x: HOME_X,
    y: HOME_ROW,
    drawX: HOME_X,
    drawY: HOME_ROW
  });
}

/** Whether the ship is parked in the home cavern, where base services live. */
export function isAtHome(player: Pick<Player, 'x' | 'y'>): boolean {
  return isHomeCavern(player.x, player.y);
}

export function respawnPlayer(player: Player): void {
  placeAtHome(player);
  Object.assign(player, {
    fuel: player.fuelMax,
    hull: player.hullMax,
    // Ore never survives a death; bought equipment — dynamite, scanners,
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
    enemiesDestroyed: 0,
    deaths: 0
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
    teleportEffect: null,
    teleportReturnPosition: null,
    reducedMotion: false,
    exploredTiles: new Set<number>(),
    scannerDevices: [],
    placedDynamite: [],
    cargoContainers: [],
    home: createHomeState(),
    armedPlacement: null,
    hoverTile: null,
    input: {
      keyImpulse: null,
      sprintDirection: null,
      sprintMomentum: null,
      lastKeyboardMove: 0,
      keyboardRepeatMs: 105,
      resetConfirmUntil: 0
    },
    player: {
      x: HOME_X,
      y: HOME_ROW,
      drawX: HOME_X,
      drawY: HOME_ROW,
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
      inventory: createInventory(),
      equipment: Array.from({length: SHIP_UPGRADE_SLOTS}, () => null),
      boost: false
    }
  };
}

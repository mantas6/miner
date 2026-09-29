import { HOME_ROW, HOME_X, SHIP_UPGRADE_SLOTS, isHomeCavern } from '../../shared/constants';
import { RESPAWN, STARTING } from './balance';
import { createInventory, removeOres } from './inventory';
import { createInitialStations } from './stations';
import { applyEquipment } from './ship-upgrades';
import type { GameState, GameStats, Player } from './types';

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

/**
 * The share of a tank a replacement ship deploys with at `at`: a full one at home
 * (no tile, or one inside the home cavern — the base's own `Home` portal counts),
 * `RESPAWN.portalFuelFraction` at a portal out in the field.
 */
export function respawnFuelFraction(at?: {x: number; y: number}): number {
  return !at || isHomeCavern(at.x, at.y) ? 1 : RESPAWN.portalFuelFraction;
}

/** The fuel a tank of `fuelMax` holds at `fraction` full: whole units, never empty. */
export function respawnFuelUnits(fuelMax: number, fraction: number): number {
  return Math.max(1, Math.min(fuelMax, Math.floor(fuelMax * fraction)));
}

/**
 * The fuel a replacement ship would deploy with at `at`. Death strips every
 * fitted upgrade, so the tank is the starting one whatever the lost ship flew.
 */
export function respawnFuelAt(at?: {x: number; y: number}): number {
  return respawnFuelUnits(STARTING.fuelMax, respawnFuelFraction(at));
}

/**
 * Deploy a replacement ship at `at` (a portal) or the home base: fitted upgrades
 * and ore stripped, a full hull, and `fuelFraction` of the base tank (see
 * `respawnFuelFraction`; the default is a full one).
 */
export function respawnPlayer(player: Player, at?: {x: number; y: number}, fuelFraction = 1): void {
  if (at) {
    Object.assign(player, {x: at.x, y: at.y, drawX: at.x, drawY: at.y});
  } else {
    placeAtHome(player);
  }
  // Fitted upgrades do not survive the wreck: unfitting every slot is the wipe,
  // and re-deriving the maxima against the empty loadout drops them back to base
  // before the replacement ship deploys with a full hull and its share of a tank.
  player.equipment = Array.from({length: SHIP_UPGRADE_SLOTS}, () => null);
  applyEquipment(player);
  Object.assign(player, {
    fuel: respawnFuelUnits(player.fuelMax, fuelFraction),
    hull: player.hullMax,
    // Ore never survives a death, and neither do the upgrades fitted to the hull.
    // Bought equipment still riding in the bay — dynamite, scanners, teleporters,
    // containers — rides out of the wreck with the miner. Ore stored in a crate is
    // not aboard at all, so it is not lost either.
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
    deaths: 0,
    scannersObtained: 0,
    bestMarkCrafted: 0
  };
}

export function createInitialState(): GameState {
  const state: GameState = {
    world: [],
    tileDiff: new Map(),
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
    reducedMotion: false,
    exploredTiles: new Set<number>(),
    scannerDevices: [],
    placedDynamite: [],
    cargoContainers: [],
    wrecks: [],
    stations: createInitialStations(),
    tradeLedger: {},
    chestLedger: {},
    armedPlacement: null,
    hoverTile: null,
    input: {
      keyImpulse: null,
      sprintDirection: null,
      sprintMomentum: null,
      lastKeyboardMove: 0,
      keyboardRepeatMs: 105,
      bumpLock: null,
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
  // Derive the four maxima and the boost flag from the (empty) starting loadout,
  // so a fresh ship's stats come from the same path a save's do.
  applyEquipment(state.player);
  return state;
}

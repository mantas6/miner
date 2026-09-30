import { HOME_ROW, HOME_X, isHomeCavern } from '../../shared/constants';
import { RESPAWN, STARTING } from './balance';
import { createInventory, removeOres } from './inventory';
import { createInitialStations, homeExtractor, type PlacedStation } from './stations';
import { applyEquipment } from './ship-upgrades';
import { STARTER_SHIP, shipFor, slotsFor, type ShipId } from './ships';
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
 * Whether a replacement redeploying at `at` lands at home: no tile, or one inside
 * the home cavern — the base's own `Home` portal counts.
 */
export function isHomeSpawn(at?: {x: number; y: number}): boolean {
  return !at || isHomeCavern(at.x, at.y);
}

/** `fraction` of a maximum of `max`: whole units, never empty, never over the top. */
export function respawnShare(max: number, fraction: number): number {
  return Math.max(1, Math.min(max, Math.floor(max * fraction)));
}

/** What a replacement ship deploys with, and how much of its fuel the base paid for. */
export interface RespawnVitals {
  fuel: number;
  hull: number;
  /** Fuel taken out of the home extractor's store: 0 at a field portal or a dry store. */
  drawn: number;
}

/**
 * What a replacement `ship` would deploy with at `at`, with `storedFuel` banked in
 * the home extractor. Death strips every fitted upgrade but keeps the hull, so the
 * shares are of that hull's bare base tank and hull (`RESPAWN`):
 *   * at home the tank is drawn from the store, up to a full base tank; a store
 *     that cannot cover `homeFuelFraction` of one still deploys with that share
 *     (the store gives up what it had), so a dry base never strands a new ship;
 *   * at a field portal the tank is `portalFuelFraction` full and nothing is drawn;
 *   * the hull is `hullFraction` of its maximum either way.
 */
export function respawnVitals(ship: ShipId, at: {x: number; y: number} | undefined, storedFuel: number): RespawnVitals {
  const {fuelMax, hullMax} = shipFor(ship).base;
  const hull = respawnShare(hullMax, RESPAWN.hullFraction);
  if (!isHomeSpawn(at)) return {fuel: respawnShare(fuelMax, RESPAWN.portalFuelFraction), hull, drawn: 0};
  const drawn = Math.floor(Math.max(0, Math.min(fuelMax, storedFuel)));
  return {fuel: Math.max(drawn, respawnShare(fuelMax, RESPAWN.homeFuelFraction)), hull, drawn};
}

/** The fuel the home extractor has banked for a redeploy: 0 when none stands at the base. */
export function homeStoredFuel(stations: readonly PlacedStation[]): number {
  return homeExtractor(stations)?.fuel ?? 0;
}

/**
 * Deploy a replacement ship at `at` (a portal) or the home base: the same hull,
 * its fitted upgrades and ore stripped, and the fuel and hull `respawnVitals`
 * hands out — the fuel drawn from the home extractor at home, which is left that
 * much lower. Returns what it deployed with, for the redeploy toast.
 */
export function respawnPlayer(player: Player, stations: readonly PlacedStation[], at?: {x: number; y: number}): RespawnVitals {
  if (at) {
    Object.assign(player, {x: at.x, y: at.y, drawX: at.x, drawY: at.y});
  } else {
    placeAtHome(player);
  }
  // Fitted upgrades do not survive the wreck, but the hull does: every one of its
  // slots comes back empty, and re-deriving the maxima against the empty loadout
  // drops them back to the hull's base before the replacement ship deploys with
  // its share of a tank and a hull.
  player.equipment = Array.from({length: slotsFor(player.ship)}, () => null);
  applyEquipment(player);
  const vitals = respawnVitals(player.ship, at, homeStoredFuel(stations));
  const extractor = homeExtractor(stations);
  if (extractor && vitals.drawn > 0) extractor.fuel = Math.max(0, extractor.fuel - vitals.drawn);
  Object.assign(player, {
    fuel: vitals.fuel,
    hull: vitals.hull,
    // Ore never survives a death, and neither do the upgrades fitted to the hull.
    // Bought equipment still riding in the bay — dynamite, scanners, teleporters,
    // containers — rides out of the wreck with the miner. Ore stored in a crate is
    // not aboard at all, so it is not lost either.
    inventory: removeOres(player.inventory)
  });
  return vitals;
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
    bestMarkCrafted: 0,
    oresMined: {}
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
      ship: STARTER_SHIP,
      equipment: Array.from({length: slotsFor(STARTER_SHIP)}, () => null),
      boost: false
    }
  };
  // Derive the four maxima and the boost flag from the (empty) starting loadout,
  // so a fresh ship's stats come from the same path a save's do.
  applyEquipment(state.player);
  return state;
}

// The cheat-menu grants. Two of them now: a bundle of every ore, and a stocked
// fuel extractor, so a tester can reach crafting and refueling without a dig.
//
// Both are pure mutations of `GameState`, so they are testable without the game
// loop and dispatched from `game.ts` behind the developer panel's buttons.

import { ORES } from '../../shared/constants';
import { EXTRACTOR } from './balance';
import { STATION_CAPACITY, firstManufacturer } from './stations';
import { addItem, createInventory, oreItem, roomLeft } from './inventory';
import type { GameState } from './types';

/** How many of each ore one "Grant ores" press adds. */
export const DEVELOPER_ORE_BUNDLE = 10;

/** Coal one "Fill extractor" press queues. */
export const DEVELOPER_EXTRACTOR_COAL = 25;

/**
 * Add a bundle of every ore kind, filling the cargo bay first (up to `cargoMax`)
 * and overflowing the rest into the station stock (up to `STATION_CAPACITY`).
 * Crafting draws from the station stock, so the overflow is where the useful
 * materials land. Reports how many units were actually granted.
 */
export function grantDeveloperOres(state: GameState): number {
  const player = state.player;
  const manufacturer = firstManufacturer(state.stations);
  let bay = player.inventory;
  let station = manufacturer ? manufacturer.inventory : createInventory();
  let granted = 0;
  for (const ore of ORES) {
    const item = oreItem(ore);
    const toBay = Math.min(DEVELOPER_ORE_BUNDLE, roomLeft(bay, player.cargoMax));
    if (toBay > 0) { bay = addItem(bay, item, toBay); granted += toBay; }
    const remaining = DEVELOPER_ORE_BUNDLE - toBay;
    const toStation = Math.min(remaining, roomLeft(station, STATION_CAPACITY));
    if (toStation > 0) { station = addItem(station, item, toStation); granted += toStation; }
  }
  player.inventory = bay;
  if (manufacturer) manufacturer.inventory = station;
  return granted;
}

/** Queue coal and top every extractor's stored fuel to its cap. */
export function fillDeveloperExtractor(state: GameState): void {
  for (const station of state.stations) {
    if (station.kind !== 'extractor') continue;
    station.coal = DEVELOPER_EXTRACTOR_COAL;
    station.fuel = EXTRACTOR.fuelCap;
  }
}

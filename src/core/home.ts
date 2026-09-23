// The underground home base's mutable state.
//
// The two stations that sit on the home-cavern floor are fixed world objects, not
// tiles: their positions are constants (`STATIONS` in `shared/constants.ts`) and
// only their contents change. Those contents live here, in `state.home`, and are
// persisted — the manufacturing station's own stock, and the oil extractor's
// queued coal and stored fuel.
//
// Phase 4 grows the pure helpers around that state: which station a parked ship
// can reach, and the transfers that move stacks between the ship's bay and the
// station's stock. Phase 5 fills in the extractor's timed coal → fuel conversion
// (`tickExtractor`), run once per fixed step whether or not the player is watching.

import { STATIONS } from '../../shared/constants';
import { EXTRACTOR } from './balance';
import {
  addItem,
  findStack,
  removeItem,
  roomLeft,
  type Inventory,
  type InventoryItemKind
} from './inventory';
import { createInventory } from './inventory';

/** The oil extractor's timed coal → fuel conversion buffer. */
export interface HomeExtractor {
  /** Coal queued for conversion. */
  coal: number;
  /** Fuel already produced and waiting to top up the ship. */
  fuel: number;
  /**
   * Ticks accumulated toward the current coal, in `[0, EXTRACTOR.ticksPerCoal)`.
   * It freezes — rather than resetting — while there is no coal to burn or the
   * tank is full, so no queued coal is ever wasted on a stalled extractor.
   */
  progress: number;
}

/** Everything the home base stores between visits. */
export interface HomeState {
  /** The manufacturing station's own stock, apart from the ship's cargo bay. */
  station: {inventory: Inventory};
  extractor: HomeExtractor;
}

/** A fresh, empty home base. */
export function createHomeState(): HomeState {
  return {
    station: {inventory: createInventory()},
    extractor: {coal: 0, fuel: 0, progress: 0}
  };
}

/** Which of the two fixed stations sits on the cavern floor. */
export type StationKey = 'manufacturer' | 'extractor';

/**
 * Total item count the manufacturing station's stock holds, across every stack.
 * Generous next to the ship's bay — it is the base's warehouse, filled once and
 * drawn from for the rest of the save.
 */
export const STATION_CAPACITY = 500;

/**
 * How far a ship may stand from a station and still work it. One tile in any
 * direction (Chebyshev), plus the station's own tile, which the ship can fly onto.
 */
export const STATION_REACH = 1;

/** Whether `x`/`y` is the exact tile one of the two stations occupies. */
export function stationAt(x: number, y: number): StationKey | null {
  if (STATIONS.manufacturer.x === x && STATIONS.manufacturer.y === y) return 'manufacturer';
  if (STATIONS.extractor.x === x && STATIONS.extractor.y === y) return 'extractor';
  return null;
}

/** Whether a coordinate falls on either station tile. Decor may not be set here. */
export function isStationTile(x: number, y: number): boolean {
  return stationAt(x, y) !== null;
}

/** Whether a ship at `x`/`y` is close enough to work the given station. */
export function isStationReachable(key: StationKey, x: number, y: number): boolean {
  const station = STATIONS[key];
  return Math.max(Math.abs(station.x - x), Math.abs(station.y - y)) <= STATION_REACH;
}

/**
 * The station a parked ship would open with no tile named — the keyboard's answer.
 * The nearer of the two wins; the manufacturer breaks a tie, so a ship midway
 * between them lands on crafting rather than fuel.
 */
export function nearestStation(player: {x: number; y: number}): StationKey | null {
  let best: StationKey | null = null;
  let bestDistance = Infinity;
  for (const key of ['manufacturer', 'extractor'] as const) {
    if (!isStationReachable(key, player.x, player.y)) continue;
    const station = STATIONS[key];
    const distance = Math.abs(station.x - player.x) + Math.abs(station.y - player.y);
    if (distance < bestDistance) {
      best = key;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Move everything that fits from the ship's bay into the station's stock, ore and
 * equipment alike, capped by the station's capacity. A partial move is honest: a
 * station near full takes what it can and the rest stays aboard.
 */
export function stowAll(bay: Inventory, station: Inventory): {bay: Inventory; station: Inventory} {
  let nextBay = bay;
  let nextStation = station;
  for (const stack of bay) {
    const room = roomLeft(nextStation, STATION_CAPACITY);
    if (room <= 0) break;
    const moved = Math.min(stack.count, room);
    nextStation = addItem(nextStation, stack.item, moved);
    nextBay = removeItem(nextBay, stack.kind, moved);
  }
  return {bay: nextBay, station: nextStation};
}

/**
 * Move up to `count` units of one kind from the bay into the station, capped by
 * the station's remaining room. Reports how many moved so the caller can word it.
 * `count` defaults to the whole stack; a single-unit stow passes `1`.
 */
export function stowStack(
  bay: Inventory,
  station: Inventory,
  kind: InventoryItemKind,
  count = Infinity
): {bay: Inventory; station: Inventory; moved: number} {
  const stack = findStack(bay, kind);
  if (!stack) return {bay, station, moved: 0};
  const moved = Math.min(stack.count, count, roomLeft(station, STATION_CAPACITY));
  if (moved <= 0) return {bay, station, moved: 0};
  return {bay: removeItem(bay, kind, moved), station: addItem(station, stack.item, moved), moved};
}

/**
 * Take up to `count` units of one kind out of the station and into the bay, held
 * under the ship's `cargoMax` — every item aboard counts, so a full bay takes
 * nothing. Reports how many moved.
 */
export function takeFromStation(
  bay: Inventory,
  station: Inventory,
  kind: InventoryItemKind,
  count: number,
  cargoMax: number
): {bay: Inventory; station: Inventory; moved: number} {
  const stack = findStack(station, kind);
  if (!stack) return {bay, station, moved: 0};
  const moved = Math.min(stack.count, count, roomLeft(bay, cargoMax));
  if (moved <= 0) return {bay, station, moved: 0};
  return {bay: addItem(bay, stack.item, moved), station: removeItem(station, kind, moved), moved};
}

/**
 * One fixed 60 Hz step of the oil extractor: pure, and it runs regardless of where
 * the ship is. Every `EXTRACTOR.ticksPerCoal` ticks it burns one queued coal into
 * `EXTRACTOR.fuelPerCoal` stored fuel, clamped at `EXTRACTOR.fuelCap`.
 *
 * It never burns coal it cannot bank: with no coal queued, or the tank already at
 * the cap, the buffer is left untouched — the same reference is handed back, so a
 * caller can skip a repaint on a steady tick — and progress simply waits.
 */
export function tickExtractor(extractor: HomeExtractor): HomeExtractor {
  if (extractor.coal <= 0 || extractor.fuel >= EXTRACTOR.fuelCap) return extractor;
  const progress = extractor.progress + 1;
  if (progress < EXTRACTOR.ticksPerCoal) return {...extractor, progress};
  // A whole coal's worth of ticks elapsed: spend one, bank its fuel, and start over.
  return {
    coal: extractor.coal - 1,
    fuel: Math.min(EXTRACTOR.fuelCap, extractor.fuel + EXTRACTOR.fuelPerCoal),
    progress: 0
  };
}

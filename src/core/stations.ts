// The mine's stations: the Manufacturing Station, the Fuel Extractor and the
// Portal, each a placed entity standing on a tile.
//
// A station is a thing standing on a tile, like a cargo container: it has a
// position, and mutable contents. A manufacturer holds its own stock (the ore the
// player stows and crafts from); an extractor holds queued coal, stored fuel, and
// the tick progress of its coal → fuel conversion; a portal holds only its name.
// One of each is seeded on the home-cavern floor, and more can be crafted,
// carried, set down, and lifted back with the Construction Toolkit (up to each
// kind's `STATION_DEVICE` cap).
//
// This module owns the pure rules around that state: which station a parked ship
// can reach, the transfers that move stacks between the ship's bay and a
// manufacturer's stock, the extractor's timed conversion, and the placement rules
// a carried device answers. Everything here is pure and DOM-free.

import { STATIONS, isHomeCavern } from '../../shared/constants';
import { EXTRACTOR } from './balance';
import {
  addItem,
  createInventory,
  findStack,
  isOreKind,
  removeItem,
  roomLeft,
  type DeviceKind,
  type Inventory,
  type InventoryItemKind
} from './inventory';
import { ITEM_CATALOG } from './items';
import { isBlockedFor, placementRefusal, type Occupant, type PlacementCopy } from './placement';

/** Which kind of station this is. */
export type StationKind = 'manufacturer' | 'extractor' | 'portal';

/** A crafting station standing in the mine, with its own stock. */
export interface ManufacturerStation {
  kind: 'manufacturer';
  x: number;
  y: number;
  /** Its own slots. Immutable, like the ship's: a transfer replaces the array. */
  inventory: Inventory;
}

/** A fuel extractor standing in the mine, with its coal/fuel conversion buffer. */
export interface ExtractorStation {
  kind: 'extractor';
  x: number;
  y: number;
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

/**
 * A portal standing in the mine: a fixed travel point. It holds no stock — a
 * portal is always "empty", so the Construction Toolkit can always lift it — and
 * carries only a player-facing `name`, capped at `MAX_PORTAL_NAME_LENGTH`.
 */
export interface PortalStation {
  kind: 'portal';
  x: number;
  y: number;
  /** Player-facing label, e.g. `Home`. Sanitized to `MAX_PORTAL_NAME_LENGTH`. */
  name: string;
}

/** One station standing in the mine. */
export type PlacedStation = ManufacturerStation | ExtractorStation | PortalStation;

/** The extractor's buffer fields alone, for the pure `tickExtractor`. */
export type ExtractorBuffer = Pick<ExtractorStation, 'coal' | 'fuel' | 'progress'>;

/** The item one station of `kind` is carried as. */
export function stationDeviceItemKind(kind: StationKind): DeviceKind {
  return `device:${kind}`;
}

/** The player-facing name of a station kind, e.g. `Fuel Extractor` — its catalog label. */
export function stationLabel(kind: StationKind): string {
  return ITEM_CATALOG[stationDeviceItemKind(kind)].label;
}

/**
 * Total item count one manufacturer's stock holds, across every stack. Generous
 * next to the ship's bay — it is a warehouse, filled once and drawn from.
 */
export const STATION_CAPACITY = 500;

/**
 * How far a ship may stand from a station and still work it. One tile in any
 * direction (Chebyshev), plus the station's own tile, which the ship can fly onto.
 */
export const STATION_REACH = 1;

/** Per-kind placement limits, mirroring the cargo container's soft cap. */
export const STATION_DEVICE = Object.freeze({
  manufacturer: {maxPlaced: 4, reach: STATION_REACH},
  extractor: {maxPlaced: 4, reach: STATION_REACH},
  // The base's `Home` portal counts toward this cap.
  portal: {maxPlaced: 6, reach: STATION_REACH}
});

export function createManufacturer(x: number, y: number): ManufacturerStation {
  return {kind: 'manufacturer', x, y, inventory: createInventory()};
}

export function createExtractor(x: number, y: number): ExtractorStation {
  return {kind: 'extractor', x, y, coal: 0, fuel: 0, progress: 0};
}

export function createPortal(x: number, y: number, name: string): PortalStation {
  return {kind: 'portal', x, y, name};
}

/**
 * The default stations, seeded on the home-cavern floor: the manufacturer and
 * extractor at their old positions, plus the base's `Home` portal.
 */
export function createInitialStations(): PlacedStation[] {
  const extractor = createExtractor(STATIONS.extractor.x, STATIONS.extractor.y);
  // A new game's seeded extractor starts with a full fuel tank, so a returning
  // player can top the ship up before their first dig. Crafted extractors still
  // start empty.
  extractor.fuel = EXTRACTOR.fuelCap;
  return [
    createManufacturer(STATIONS.manufacturer.x, STATIONS.manufacturer.y),
    extractor,
    createPortal(STATIONS.portal.x, STATIONS.portal.y, 'Home')
  ];
}

/** The station standing on this tile, or `null`. */
export function stationAt(stations: readonly PlacedStation[], x: number, y: number): PlacedStation | null {
  return stations.find(station => station.x === x && station.y === y) ?? null;
}

/** Whether a ship at `x`/`y` is close enough to work this station. */
export function isStationReachable(station: PlacedStation, x: number, y: number): boolean {
  return Math.max(Math.abs(station.x - x), Math.abs(station.y - y)) <= STATION_REACH;
}

/**
 * The station a parked ship would open with no tile named — the keyboard's answer.
 * The nearest in reach wins; a manufacturer breaks a tie, so a ship midway between
 * two stations lands on crafting rather than fuel.
 */
export function nearestStation(
  stations: readonly PlacedStation[],
  player: {x: number; y: number}
): PlacedStation | null {
  let best: PlacedStation | null = null;
  let bestDistance = Infinity;
  for (const station of stations) {
    if (!isStationReachable(station, player.x, player.y)) continue;
    const distance = Math.abs(station.x - player.x) + Math.abs(station.y - player.y);
    // A strict `<` lets the first station at a distance win, but a manufacturer
    // must break a tie even when it comes later in the array, so prefer it here.
    if (distance < bestDistance || (distance === bestDistance && station.kind === 'manufacturer')) {
      best = station;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The extractor a ship at `x`/`y` is parked at for its automatic top-up: the one
 * on its own tile, else the nearest within `STATION_REACH` (the first listed on a
 * tie) — the same reach its screen opens from. `null` with none in reach.
 */
export function extractorInReach(stations: readonly PlacedStation[], x: number, y: number): ExtractorStation | null {
  let best: ExtractorStation | null = null;
  let bestDistance = Infinity;
  for (const station of stations) {
    if (station.kind !== 'extractor' || !isStationReachable(station, x, y)) continue;
    const distance = Math.abs(station.x - x) + Math.abs(station.y - y);
    if (distance < bestDistance) {
      best = station;
      bestDistance = distance;
    }
  }
  return best;
}

/** The first manufacturer among the stations, or `null` when there is none. */
export function firstManufacturer(stations: readonly PlacedStation[]): ManufacturerStation | null {
  return stations.find((s): s is ManufacturerStation => s.kind === 'manufacturer') ?? null;
}

/**
 * Whether a station stands inside the home cavern — part of the base, which is
 * where the home Supply and ordered fuel are delivered. Stations set down
 * elsewhere in the mine are field stations.
 */
export function isHomeStation(station: PlacedStation): boolean {
  return isHomeCavern(station.x, station.y);
}

/**
 * The base's fuel extractor: the first one standing inside the home cavern, or
 * `null` once none does (the Construction Toolkit can lift the seeded one away).
 * Extractors set down elsewhere in the mine are field stations, not the base.
 */
export function homeExtractor(stations: readonly PlacedStation[]): ExtractorStation | null {
  return stations.find((s): s is ExtractorStation => s.kind === 'extractor' && isHomeStation(s)) ?? null;
}

/** Every portal standing in the mine, in placement order. */
export function portals(stations: readonly PlacedStation[]): PortalStation[] {
  return stations.filter((s): s is PortalStation => s.kind === 'portal');
}

/** How many portals stand outside the home cavern. Counted in place: it runs every frame. */
export function fieldPortalCount(stations: readonly PlacedStation[]): number {
  let count = 0;
  for (const station of stations) {
    if (station.kind === 'portal' && !isHomeStation(station)) count++;
  }
  return count;
}

/**
 * The stock of the first manufacturer, for the objective guidance and the HUD:
 * an empty inventory when there is no manufacturer standing anywhere.
 */
export function manufacturerStock(stations: readonly PlacedStation[]): Inventory {
  return firstManufacturer(stations)?.inventory ?? createInventory();
}

/**
 * The bulk stow: move every ore stack that fits from the ship's bay into a
 * manufacturer's stock, capped by the station's capacity. Only ore — the haul a
 * trip brings home. Everything else aboard was taken aboard on purpose and is left
 * there: the trip kit (Repair Kits, Fuel Cells, Dynamite, Scanners, Teleporters,
 * Containers), devices and the toolkit to set down, upgrades to fit, decorations to
 * place. Each still stows by its own stack (`stowStack`). A partial move is honest:
 * a station near full takes what it can and the rest stays aboard.
 */
export function stowOre(bay: Inventory, station: Inventory): {bay: Inventory; station: Inventory} {
  let nextBay = bay;
  let nextStation = station;
  for (const stack of bay) {
    if (!isOreKind(stack.kind)) continue;
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
 * One fixed 60 Hz step of an fuel extractor: pure, and it runs regardless of where
 * the ship is. Every `EXTRACTOR.ticksPerCoal` ticks it burns one queued coal into
 * `EXTRACTOR.fuelPerCoal` stored fuel, clamped at `EXTRACTOR.fuelCap`.
 *
 * It never burns coal it cannot bank: with no coal queued, or the tank already at
 * the cap, the buffer is left untouched — the same reference is handed back, so a
 * caller can skip a repaint on a steady tick — and progress simply waits.
 */
export function tickExtractor(extractor: ExtractorBuffer): ExtractorBuffer {
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

/** How a station device words each of the shared placement refusals. */
function stationPlacementCopy(kind: StationKind): PlacementCopy {
  const label = stationLabel(kind);
  return {
    full: `Only ${STATION_DEVICE[kind].maxPlaced} ${label}s can stand in the mine at once.`,
    offMine: `A ${label} is set down underground, inside the mine.`,
    unexplored: `Set the ${label} down on a tile you have already explored.`,
    blocked: `Set the ${label} down in cleared space, not inside terrain.`,
    occupied: 'Something already stands on that tile.'
  };
}

/** The slice of the mine a station-device placement has to weigh a tile against. */
export interface StationPlacementContext {
  explored: ReadonlySet<number>;
  /** Whether the target tile is open space the device can be dropped into. */
  open: boolean;
  /** What already stands on the tile (`occupantsAt`). */
  occupants: ReadonlySet<Occupant>;
  /** How many stations of this kind already stand in the mine. */
  count: number;
}

/** Why this tile cannot take a station device, or `null` when it can. */
export function stationPlacementRefusal(
  x: number,
  y: number,
  kind: StationKind,
  context: StationPlacementContext
): string | null {
  return placementRefusal(x, y, {
    explored: context.explored,
    open: context.open,
    occupied: isBlockedFor('station', context.occupants),
    full: context.count >= STATION_DEVICE[kind].maxPlaced
  }, stationPlacementCopy(kind));
}

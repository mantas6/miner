// The preview grid shown while a carried device is armed for placement.
//
// Three of the depot's consumables are put *onto* a tile of the mine — the survey
// scanner, a stick of dynamite, and a cargo container — and each answers the same
// five placement questions from `placement.ts`. The rest (ore, the spent
// teleporter) are never placed, so they never get a grid.
//
// This module is the read-only companion to those three: given the armed kind and
// a snapshot of the mine, it says which nearby tiles the device could be dropped
// onto and which it could not, reusing `canPlaceDevice` so the tint the renderer
// paints can never contradict the toast an actual press would produce.
//
// Everything here is pure and DOM-free: the renderer supplies `isOpen` (its own
// terrain lookup) and draws whatever cells come back.

import { explorationIndex } from '../../shared/exploration-codec';
import { CARGO_CONTAINER, type PlacedContainer } from './cargo-container';
import { DYNAMITE, type PlacedDynamite } from './dynamite';
import { isDecorKind, isDeviceKind, type InventoryItemKind } from './inventory';
import { canPlaceDevice, inMineBounds, type PlacementSite } from './placement';
import { SCANNER_DEVICE, type ScannerDevice } from './scanner-device';
import { STATION_DEVICE, isStationTile, stationAt, type PlacedStation } from './stations';
import { type Wreck } from './wreck';

/**
 * How far around the ship the placement grid reaches. A device may legally go on
 * any explored, cleared tile of the mine, but tinting the whole world would bury
 * the terrain; the grid stays a bounded neighbourhood the player is looking at.
 */
export const PLACEMENT_OVERLAY_RADIUS = 4;

/** The device kinds that are set down onto a tile, and so earn a placement grid. */
const PLACEABLE_KINDS: ReadonlySet<InventoryItemKind> = new Set<InventoryItemKind>([
  'scanner', 'dynamite', 'container', 'device:manufacturer', 'device:extractor'
]);

/**
 * Whether this armed kind is one placed into the world (vs. spent, or mere cargo).
 * The deployables and the two placeable stations, plus any decoration — decorations
 * are set down as tiles, so they earn the same preview grid as the devices do.
 */
export function isPlaceableKind(kind: InventoryItemKind | null | undefined): boolean {
  if (kind === null || kind === undefined) return false;
  return PLACEABLE_KINDS.has(kind) || isDecorKind(kind);
}

/** The slice of the running mine a placement preview needs to read. */
export interface PlacementOverlayWorld {
  explored: ReadonlySet<number>;
  scannerDevices: readonly ScannerDevice[];
  placedDynamite: readonly PlacedDynamite[];
  cargoContainers: readonly PlacedContainer[];
  wrecks: readonly Wreck[];
  stations: readonly PlacedStation[];
  /** Whether the tile is cleared open space a device can be dropped into. */
  isOpen(x: number, y: number): boolean;
}

/** Whether any placed entity — a station, container, wreck, scanner, or dynamite — sits on this tile. */
function isTileOccupied(x: number, y: number, world: PlacementOverlayWorld): boolean {
  return stationAt(world.stations, x, y) !== null
    || world.cargoContainers.some(container => container.x === x && container.y === y)
    || world.wrecks.some(wreck => wreck.x === x && wreck.y === y)
    || world.scannerDevices.some(device => device.x === x && device.y === y)
    || world.placedDynamite.some(stick => stick.x === x && stick.y === y);
}

/** One tile of the preview grid: where it is, and whether the device fits. */
export interface PlacementOverlayCell {
  x: number;
  y: number;
  valid: boolean;
}

/**
 * Build the shared `PlacementSite` for one kind at one tile. `open` is only asked
 * of a tile inside the mine, so a hover far off the map never generates terrain
 * just to be told the tile was never a candidate — the same order the placement
 * handlers use.
 */
function placementSiteFor(
  kind: InventoryItemKind,
  x: number,
  y: number,
  world: PlacementOverlayWorld
): PlacementSite | null {
  const open = inMineBounds(x, y) && world.isOpen(x, y);
  // Decorations become tiles, so any explored, cleared, non-station tile takes
  // one: no soft cap, and no "occupied" — a tile is either air or it is not.
  if (isDecorKind(kind)) {
    return {
      explored: world.explored,
      open: open && !isStationTile(world.stations, x, y),
      occupied: false,
      full: false
    };
  }
  // The two placeable stations share the container's shape, but any placed entity
  // — station, crate, scanner, or dynamite — counts the tile as taken.
  if (isDeviceKind(kind)) {
    const key = kind === 'device:manufacturer' ? 'manufacturer' : 'extractor';
    return {
      explored: world.explored,
      open,
      occupied: isTileOccupied(x, y, world),
      full: world.stations.filter(station => station.kind === key).length >= STATION_DEVICE[key].maxPlaced
    };
  }
  switch (kind) {
    case 'scanner':
      return {
        explored: world.explored,
        open,
        occupied: world.scannerDevices.some(device => device.x === x && device.y === y),
        full: world.scannerDevices.length >= SCANNER_DEVICE.maxPlaced
      };
    case 'dynamite':
      return {
        explored: world.explored,
        open,
        occupied: world.placedDynamite.some(stick => stick.x === x && stick.y === y),
        full: world.placedDynamite.length >= DYNAMITE.maxPlaced
      };
    case 'container':
      return {
        explored: world.explored,
        open,
        occupied: world.cargoContainers.some(container => container.x === x && container.y === y)
          || world.wrecks.some(wreck => wreck.x === x && wreck.y === y),
        full: world.cargoContainers.length >= CARGO_CONTAINER.maxPlaced
      };
    default:
      return null;
  }
}

/** Whether the armed device could be placed on this exact tile right now. */
export function isPlacementValid(
  kind: InventoryItemKind | null | undefined,
  x: number,
  y: number,
  world: PlacementOverlayWorld
): boolean {
  if (!isPlaceableKind(kind)) return false;
  const site = placementSiteFor(kind!, x, y, world);
  if (site === null || !canPlaceDevice(x, y, site)) return false;
  return true;
}

/**
 * The preview grid around `centerX`/`centerY`: every explored, in-mine tile within
 * `radius`, each flagged valid or not. Unexplored tiles are left out — they stay
 * under fog, the device cannot go there, and tinting them would only clutter the
 * dark. Solid or occupied explored tiles are kept and flagged invalid, so the grid
 * shows the walls as clearly as the gaps.
 */
export function placementOverlayCells(
  kind: InventoryItemKind | null | undefined,
  centerX: number,
  centerY: number,
  world: PlacementOverlayWorld,
  radius = PLACEMENT_OVERLAY_RADIUS
): PlacementOverlayCell[] {
  if (!isPlaceableKind(kind)) return [];
  const cells: PlacementOverlayCell[] = [];
  for (let y = centerY - radius; y <= centerY + radius; y++) {
    for (let x = centerX - radius; x <= centerX + radius; x++) {
      if (!inMineBounds(x, y)) continue;
      if (!world.explored.has(explorationIndex(x, y))) continue;
      cells.push({x, y, valid: isPlacementValid(kind, x, y, world)});
    }
  }
  return cells;
}

// The preview grid shown while a carried device is armed for placement.
//
// Several carried things are put *onto* a tile of the mine — the survey scanner, a
// stick of dynamite, a cargo container, the station devices (portal included) and
// the decorations — and each answers the same five placement questions from
// `placement.ts`, occupancy included. The rest — ore, upgrades, the teleporter
// and repair kit (spent, not placed), and the toolkit (which lifts rather than
// places) — never get a grid.
//
// This module is the read-only companion to those: given the armed kind and
// a snapshot of the mine, it says which nearby tiles the device could be dropped
// onto and which it could not, reusing `canPlaceDevice` so the tint the renderer
// paints can never contradict the toast an actual press would produce.
//
// Everything here is pure and DOM-free: the renderer supplies `isOpen` (its own
// terrain lookup) and draws whatever cells come back.

import { explorationIndex } from '../../shared/exploration-codec';
import { CARGO_CONTAINER } from './cargo-container';
import { DYNAMITE } from './dynamite';
import type { InventoryItemKind } from './inventory';
import {
  canPlaceDevice,
  inMineBounds,
  isBlockedFor,
  occupantsAt,
  placementFamily,
  type OccupancyState,
  type PlacementSite
} from './placement';
import { SCANNER_DEVICE } from './scanner-device';
import { STATION_DEVICE, type PlacedStation, type StationKind } from './stations';

/**
 * How far around the ship the placement grid reaches. A device may legally go on
 * any explored, cleared tile of the mine, but tinting the whole world would bury
 * the terrain; the grid stays a bounded neighbourhood the player is looking at.
 */
export const PLACEMENT_OVERLAY_RADIUS = 4;

/**
 * Whether this armed kind is one placed into the world (vs. spent, or mere cargo):
 * the deployables, every station device (the portal included), and any decoration
 * — decorations are set down as tiles, so they earn the same preview grid.
 */
export function isPlaceableKind(kind: InventoryItemKind | null | undefined): boolean {
  if (kind === null || kind === undefined) return false;
  return placementFamily(kind) !== null;
}

/** The slice of the running mine a placement preview needs to read. */
export interface PlacementOverlayWorld extends OccupancyState {
  explored: ReadonlySet<number>;
  stations: readonly PlacedStation[];
  /** Whether the tile is cleared open space a device can be dropped into. */
  isOpen(x: number, y: number): boolean;
}

/** One tile of the preview grid: where it is, and whether the device fits. */
export interface PlacementOverlayCell {
  x: number;
  y: number;
  valid: boolean;
}

/** The station a `device:` kind sets down. */
function stationKindFor(kind: InventoryItemKind): StationKind {
  return kind.slice('device:'.length) as StationKind;
}

/** Whether the mine already holds as many of this kind as it will take. */
function isFull(kind: InventoryItemKind, world: PlacementOverlayWorld): boolean {
  switch (placementFamily(kind)) {
    case 'scanner': return world.scannerDevices.length >= SCANNER_DEVICE.maxPlaced;
    case 'dynamite': return world.placedDynamite.length >= DYNAMITE.maxPlaced;
    case 'container': return world.cargoContainers.length >= CARGO_CONTAINER.maxPlaced;
    case 'station': {
      const station = stationKindFor(kind);
      return world.stations.filter(placed => placed.kind === station).length >= STATION_DEVICE[station].maxPlaced;
    }
    default: return false;
  }
}

/**
 * Build the shared `PlacementSite` for one kind at one tile — the same one the
 * placement handlers build. `open` is only asked of a tile inside the mine, so a
 * hover far off the map never generates terrain just to be told the tile was never
 * a candidate.
 */
function placementSiteFor(
  kind: InventoryItemKind,
  x: number,
  y: number,
  world: PlacementOverlayWorld
): PlacementSite | null {
  const family = placementFamily(kind);
  if (family === null) return null;
  return {
    explored: world.explored,
    open: inMineBounds(x, y) && world.isOpen(x, y),
    occupied: isBlockedFor(family, occupantsAt(world, x, y)),
    full: isFull(kind, world)
  };
}

/** Whether the armed device could be placed on this exact tile right now. */
export function isPlacementValid(
  kind: InventoryItemKind | null | undefined,
  x: number,
  y: number,
  world: PlacementOverlayWorld
): boolean {
  if (kind === null || kind === undefined) return false;
  const site = placementSiteFor(kind, x, y, world);
  return site !== null && canPlaceDevice(x, y, site);
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

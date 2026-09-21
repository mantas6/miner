// The placement-preview grid: which nearby tiles a carried device could be
// dropped onto, and which it could not.
//
// The individual placement rules already have their own tests (dynamite, scanner,
// container); what is checked here is that the overlay reuses them faithfully —
// the tint it feeds the renderer agrees, tile for tile, with the refusal an actual
// press would earn — and that it never lights up for an item that is not placed.

import { describe, expect, it } from 'vitest';
import { SURFACE_HEIGHT, WORLD_W } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';
import { CARGO_CONTAINER, createPlacedContainer } from './cargo-container';
import { DYNAMITE, createPlacedDynamite } from './dynamite';
import { oreKind } from './inventory';
import {
  PLACEMENT_OVERLAY_RADIUS,
  isPlaceableKind,
  isPlacementValid,
  placementOverlayCells,
  type PlacementOverlayWorld
} from './placement-overlay';
import { createScannerDevice } from './scanner-device';

/** A mine that is open air everywhere, with a set of explored tiles seeded in. */
function world(overrides: Partial<PlacementOverlayWorld> = {}): PlacementOverlayWorld {
  return {
    explored: new Set<number>(),
    scannerDevices: [],
    placedDynamite: [],
    cargoContainers: [],
    isOpen: () => true,
    ...overrides
  };
}

describe('isPlaceableKind', () => {
  it('is true only for the three kinds set down onto a tile', () => {
    expect(isPlaceableKind('scanner')).toBe(true);
    expect(isPlaceableKind('dynamite')).toBe(true);
    expect(isPlaceableKind('container')).toBe(true);
  });

  it('is false for the spent, carried, and cargo kinds, and for nothing armed', () => {
    expect(isPlaceableKind('gun')).toBe(false);
    expect(isPlaceableKind('teleporter')).toBe(false);
    expect(isPlaceableKind(oreKind('Copper'))).toBe(false);
    expect(isPlaceableKind(null)).toBe(false);
    expect(isPlaceableKind(undefined)).toBe(false);
  });
});

describe('isPlacementValid', () => {
  const x = 40, y = 100;
  const explored = new Set([explorationIndex(x, y)]);

  it('accepts an explored, cleared, unoccupied tile inside the mine', () => {
    expect(isPlacementValid('scanner', x, y, world({explored}))).toBe(true);
    expect(isPlacementValid('dynamite', x, y, world({explored}))).toBe(true);
    expect(isPlacementValid('container', x, y, world({explored}))).toBe(true);
  });

  it('refuses an unexplored tile, still under fog', () => {
    expect(isPlacementValid('scanner', x, y, world())).toBe(false);
  });

  it('refuses solid ground', () => {
    expect(isPlacementValid('scanner', x, y, world({explored, isOpen: () => false}))).toBe(false);
  });

  it('refuses a tile already holding the same kind of device', () => {
    expect(isPlacementValid('scanner', x, y, world({explored, scannerDevices: [createScannerDevice(x, y)]}))).toBe(false);
    expect(isPlacementValid('dynamite', x, y, world({explored, placedDynamite: [createPlacedDynamite(x, y)]}))).toBe(false);
    expect(isPlacementValid('container', x, y, world({explored, cargoContainers: [createPlacedContainer(x, y)]}))).toBe(false);
  });

  it('does not confuse one device kind with another on the same tile', () => {
    // A stick on the tile does not stop a scanner going down beside it.
    expect(isPlacementValid('scanner', x, y, world({explored, placedDynamite: [createPlacedDynamite(x, y)]}))).toBe(true);
  });

  it('refuses everything once the mine is full of that kind', () => {
    const full = world({
      explored,
      placedDynamite: Array.from({length: DYNAMITE.maxPlaced}, (_, i) => createPlacedDynamite(i, 500))
    });
    expect(isPlacementValid('dynamite', x, y, full)).toBe(false);
  });

  it('refuses a tile outside the mine without asking the terrain about it', () => {
    let asked = false;
    const surface = world({explored: new Set([explorationIndex(x, 0)]), isOpen: () => { asked = true; return true; }});
    expect(isPlacementValid('scanner', x, SURFACE_HEIGHT - 1, surface)).toBe(false);
    expect(asked).toBe(false);
  });

  it('is never valid for an item that is not placed', () => {
    expect(isPlacementValid('gun', x, y, world({explored}))).toBe(false);
    expect(isPlacementValid(null, x, y, world({explored}))).toBe(false);
  });
});

describe('placementOverlayCells', () => {
  const cx = 40, cy = 100;

  it('returns nothing when the armed item is not placeable', () => {
    const explored = new Set([explorationIndex(cx, cy)]);
    expect(placementOverlayCells('gun', cx, cy, world({explored}))).toEqual([]);
    expect(placementOverlayCells(null, cx, cy, world({explored}))).toEqual([]);
  });

  it('covers only explored, in-mine tiles inside the radius', () => {
    // Explore a small patch, plus one tile beyond the radius that must be left out.
    const explored = new Set<number>();
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) explored.add(explorationIndex(x, y));
    explored.add(explorationIndex(cx + PLACEMENT_OVERLAY_RADIUS + 3, cy));
    const cells = placementOverlayCells('scanner', cx, cy, world({explored}));

    expect(cells).toHaveLength(9);
    expect(cells.every(cell => Math.abs(cell.x - cx) <= PLACEMENT_OVERLAY_RADIUS && Math.abs(cell.y - cy) <= PLACEMENT_OVERLAY_RADIUS)).toBe(true);
    // The far explored tile is outside the radius, so it is never in the grid.
    expect(cells.some(cell => cell.x === cx + PLACEMENT_OVERLAY_RADIUS + 3)).toBe(false);
  });

  it('never runs off the edges of the world', () => {
    const explored = new Set<number>();
    for (let x = 0; x < 3; x++) explored.add(explorationIndex(x, cy));
    const cells = placementOverlayCells('scanner', 0, cy, world({explored}));
    expect(cells.every(cell => cell.x >= 0 && cell.x < WORLD_W)).toBe(true);
  });

  it('flags each covered tile with the same answer a press would get', () => {
    const explored = new Set<number>();
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) explored.add(explorationIndex(x, y));
    const blocked = createScannerDevice(cx, cy);
    const scene = world({
      explored,
      scannerDevices: [blocked],
      // One wall tile to the east reads as solid.
      isOpen: (x, y) => !(x === cx + 1 && y === cy)
    });
    const cells = placementOverlayCells('scanner', cx, cy, scene);

    const at = (x: number, y: number) => cells.find(cell => cell.x === x && cell.y === y);
    expect(at(cx - 1, cy)?.valid).toBe(true);         // open, empty, explored
    expect(at(cx, cy)?.valid).toBe(false);            // occupied by the device
    expect(at(cx + 1, cy)?.valid).toBe(false);        // solid wall
    // Every flag matches the standalone validity check tile for tile.
    for (const cell of cells) {
      expect(cell.valid).toBe(isPlacementValid('scanner', cell.x, cell.y, scene));
    }
  });

  it('flags the whole grid invalid once the mine is full of that kind', () => {
    const explored = new Set<number>();
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) explored.add(explorationIndex(x, y));
    const full = world({
      explored,
      cargoContainers: Array.from({length: CARGO_CONTAINER.maxPlaced}, (_, i) => createPlacedContainer(i, 500))
    });
    const cells = placementOverlayCells('container', cx, cy, full);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every(cell => !cell.valid)).toBe(true);
  });
});

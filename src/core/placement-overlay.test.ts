// The placement-preview grid: which nearby tiles a carried device could be
// dropped onto, and which it could not.
//
// Which occupant refuses which kind is the cross-kind matrix in placement.test.ts;
// what is checked here is that the overlay reuses those rules faithfully — the
// tint it feeds the renderer agrees, tile for tile, with the refusal an actual
// press would earn — and that it never lights up for an item that is not placed.

import { describe, expect, it } from 'vitest';
import { STATIONS, WORLD_W } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';
import { CARGO_CONTAINER, containerPlacementRefusal, createPlacedContainer } from './cargo-container';
import { decorPlacementRefusal } from './decor';
import { DYNAMITE, createPlacedDynamite, dynamitePlacementRefusal } from './dynamite';
import { oreKind, type InventoryItemKind } from './inventory';
import { OCCUPANTS, occupantsAt, type Occupant } from './placement';
import {
  PLACEMENT_OVERLAY_RADIUS,
  isPlaceableKind,
  isPlacementValid,
  placementOverlayCells,
  type PlacementOverlayWorld
} from './placement-overlay';
import { createScannerDevice, scannerPlacementRefusal } from './scanner-device';
import { STATION_DEVICE, createManufacturer, createPortal, stationPlacementRefusal } from './stations';
import { HOME_ROW } from '../../shared/constants';
import { chestsInRange, gravesInRange, tradingPostAt } from '../world/world';

/** The first trading post in the interior band, for the occupancy check. */
function findPost(): {x: number; y: number} {
  for (let y = HOME_ROW + 40; y < HOME_ROW + 4000; y++) {
    for (let x = 3; x < WORLD_W - 3; x++) {
      const post = tradingPostAt(x, y);
      if (post) return post;
    }
  }
  throw new Error('no trading post found');
}

/** A mine that is open air everywhere, with a set of explored tiles seeded in. */
function world(overrides: Partial<PlacementOverlayWorld> = {}): PlacementOverlayWorld {
  return {
    explored: new Set<number>(),
    scannerDevices: [],
    placedDynamite: [],
    cargoContainers: [],
    wrecks: [],
    stations: [],
    isOpen: () => true,
    ...overrides
  };
}

describe('isPlaceableKind', () => {
  it('is true for the deployables, every station device, and any decoration', () => {
    expect(isPlaceableKind('scanner')).toBe(true);
    expect(isPlaceableKind('dynamite')).toBe(true);
    expect(isPlaceableKind('container')).toBe(true);
    expect(isPlaceableKind('device:manufacturer')).toBe(true);
    expect(isPlaceableKind('device:extractor')).toBe(true);
    expect(isPlaceableKind('device:portal')).toBe(true);
    expect(isPlaceableKind('decor:steelPlate')).toBe(true);
    expect(isPlaceableKind('decor:lampPanel')).toBe(true);
  });

  it('is false for the spent, carried, and cargo kinds, and for nothing armed', () => {
    expect(isPlaceableKind('teleporter')).toBe(false);
    expect(isPlaceableKind('toolkit')).toBe(false);
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
    const surface = world({explored: new Set([explorationIndex(x, -1)]), isOpen: () => { asked = true; return true; }});
    expect(isPlacementValid('scanner', x, -1, surface)).toBe(false);
    expect(asked).toBe(false);
  });

  it('is never valid for an item that is not placed', () => {
    expect(isPlacementValid('teleporter', x, y, world({explored}))).toBe(false);
    expect(isPlacementValid(null, x, y, world({explored}))).toBe(false);
  });

  it('accepts a decoration on cleared ground but never on a station tile', () => {
    expect(isPlacementValid('decor:lampPanel', x, y, world({explored}))).toBe(true);
    const sx = STATIONS.manufacturer.x, sy = STATIONS.manufacturer.y;
    const onStation = world({explored: new Set([explorationIndex(sx, sy)]), stations: [createManufacturer(sx, sy)]});
    expect(isPlacementValid('decor:lampPanel', sx, sy, onStation)).toBe(false);
  });

  it('never sets a decoration on an occupied tile, nor under the ship it would wall in', () => {
    expect(isPlacementValid('decor:lampPanel', x, y, world({explored, cargoContainers: [createPlacedContainer(x, y)]}))).toBe(false);
    expect(isPlacementValid('decor:lampPanel', x, y, world({explored, scannerDevices: [createScannerDevice(x, y)]}))).toBe(false);
    expect(isPlacementValid('decor:lampPanel', x, y, world({explored, placedDynamite: [createPlacedDynamite(x, y)]}))).toBe(false);
    expect(isPlacementValid('decor:lampPanel', x, y, world({explored, wrecks: [{x, y}]}))).toBe(false);
    expect(isPlacementValid('decor:lampPanel', x, y, world({explored, player: {x, y}}))).toBe(false);
    // A scanner still goes down right under the ship.
    expect(isPlacementValid('scanner', x, y, world({explored, player: {x, y}}))).toBe(true);
  });

  it('gives the portal the same grid as the other stations, capped at its own limit', () => {
    expect(isPlacementValid('device:portal', x, y, world({explored}))).toBe(true);
    expect(isPlacementValid('device:portal', x, y, world({explored, cargoContainers: [createPlacedContainer(x, y)]}))).toBe(false);
    const portals = Array.from({length: STATION_DEVICE.portal.maxPlaced}, (_, i) => createPortal(i, 500, `P${i}`));
    expect(isPlacementValid('device:portal', x, y, world({explored, stations: portals}))).toBe(false);
    // Full of portals says nothing about manufacturers.
    expect(isPlacementValid('device:manufacturer', x, y, world({explored, stations: portals}))).toBe(true);
    expect(placementOverlayCells('device:portal', x, y, world({explored})).length).toBeGreaterThan(0);
  });

  it('places the two station devices on cleared ground, and never on an occupied tile', () => {
    expect(isPlacementValid('device:manufacturer', x, y, world({explored}))).toBe(true);
    expect(isPlacementValid('device:extractor', x, y, world({explored}))).toBe(true);
    const taken = world({explored, cargoContainers: [createPlacedContainer(x, y)]});
    expect(isPlacementValid('device:extractor', x, y, taken)).toBe(false);
    const onStation = world({explored, stations: [createManufacturer(x, y)]});
    expect(isPlacementValid('device:manufacturer', x, y, onStation)).toBe(false);
  });

  it('never places a container or station on a trading post tile', () => {
    const post = findPost();
    const seen = world({explored: new Set([explorationIndex(post.x, post.y)])});
    expect(isPlacementValid('container', post.x, post.y, seen)).toBe(false);
    expect(isPlacementValid('device:manufacturer', post.x, post.y, seen)).toBe(false);
    expect(isPlacementValid('device:extractor', post.x, post.y, seen)).toBe(false);
  });

  it('never places a container or station on a chest still lying there, but frees the tile once looted bare', () => {
    const chest = chestsInRange(0, 0, WORLD_W - 1, 400)[0];
    const explored = new Set([explorationIndex(chest.x, chest.y)]);
    const lying = world({explored});
    expect(isPlacementValid('container', chest.x, chest.y, lying)).toBe(false);
    expect(isPlacementValid('device:manufacturer', chest.x, chest.y, lying)).toBe(false);

    const looted = {[`${chest.x},${chest.y}`]: []};
    const bare = world({explored, chestLedger: looted});
    expect(isPlacementValid('container', chest.x, chest.y, bare)).toBe(true);
    expect(isPlacementValid('device:manufacturer', chest.x, chest.y, bare)).toBe(true);
  });
});

describe('graves and placement', () => {
  it('never places a container or station on a grave, but leaves the rest of its nook open', () => {
    const grave = gravesInRange(0, 0, WORLD_W - 1, 400)[0];
    const explored = new Set([explorationIndex(grave.x, grave.y), explorationIndex(grave.x + 1, grave.y)]);
    const w = world({explored});
    expect(isPlacementValid('container', grave.x, grave.y, w)).toBe(false);
    expect(isPlacementValid('device:manufacturer', grave.x, grave.y, w)).toBe(false);
    // The tile beside it, in the same nook, is ordinary open floor.
    expect(isPlacementValid('container', grave.x + 1, grave.y, w)).toBe(true);
  });
});

describe('placementOverlayCells', () => {
  const cx = 40, cy = 100;

  it('returns nothing when the armed item is not placeable', () => {
    const explored = new Set([explorationIndex(cx, cy)]);
    expect(placementOverlayCells('teleporter', cx, cy, world({explored}))).toEqual([]);
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

describe('the overlay and the refusals agree for every kind and occupant', () => {
  const post = findPost();
  const chest = chestsInRange(0, 0, WORLD_W - 1, 400)[0];
  const grave = gravesInRange(0, 0, WORLD_W - 1, 400)[0];
  const x = 40, y = 100;

  /** A mine with one `occupant` standing on a tile, and where that tile is. */
  function scene(occupant: Occupant): {w: PlacementOverlayWorld; x: number; y: number} {
    const at = occupant === 'tradingPost' ? post : occupant === 'chest' ? chest : occupant === 'grave' ? grave : {x, y};
    const explored = new Set([explorationIndex(at.x, at.y)]);
    switch (occupant) {
      case 'station': return {w: world({explored, stations: [createManufacturer(x, y)]}), ...at};
      case 'container': return {w: world({explored, cargoContainers: [createPlacedContainer(x, y)]}), ...at};
      case 'wreck': return {w: world({explored, wrecks: [{x, y}]}), ...at};
      case 'scanner': return {w: world({explored, scannerDevices: [createScannerDevice(x, y)]}), ...at};
      case 'dynamite': return {w: world({explored, placedDynamite: [createPlacedDynamite(x, y)]}), ...at};
      case 'player': return {w: world({explored, player: {x, y}}), ...at};
      case 'decor': {
        const rows: {type: string}[][] = [];
        rows[y] = Array.from({length: WORLD_W}, () => ({type: 'air'}));
        rows[y][x] = {type: 'decor'};
        // A decoration is a solid tile, so the terrain lookup says so too.
        return {w: world({explored, world: rows, isOpen: (tx, ty) => !(tx === x && ty === y)}), ...at};
      }
      default: return {w: world({explored}), ...at};
    }
  }

  /** The toast a press would earn for this kind on this scene's tile. */
  function refusal(kind: InventoryItemKind, {w, x, y}: ReturnType<typeof scene>): string | null {
    const site = {explored: w.explored, open: w.isOpen(x, y), occupants: occupantsAt(w, x, y)};
    switch (kind) {
      case 'scanner': return scannerPlacementRefusal(x, y, {...site, devices: []});
      case 'dynamite': return dynamitePlacementRefusal(x, y, {...site, sticks: []});
      case 'container': return containerPlacementRefusal(x, y, {...site, containers: []});
      case 'device:manufacturer': return stationPlacementRefusal(x, y, 'manufacturer', {...site, count: 0});
      case 'device:extractor': return stationPlacementRefusal(x, y, 'extractor', {...site, count: 0});
      case 'device:portal': return stationPlacementRefusal(x, y, 'portal', {...site, count: 0});
      default: return decorPlacementRefusal(x, y, site);
    }
  }

  const kinds: InventoryItemKind[] = [
    'scanner', 'dynamite', 'container', 'device:manufacturer', 'device:extractor', 'device:portal', 'decor:steelPlate'
  ];
  for (const kind of kinds) {
    it.each(OCCUPANTS)(`${kind} on a tile holding a %s`, occupant => {
      const s = scene(occupant);
      expect(isPlacementValid(kind, s.x, s.y, s.w)).toBe(refusal(kind, s) === null);
    });
  }
});

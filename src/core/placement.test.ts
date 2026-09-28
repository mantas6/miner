// The shared placement rules: what stands on a tile (`occupantsAt`), and which of
// those occupants refuses each kind of thing the player sets down.
//
// The cross-kind matrix below runs every placeable kind against every occupant
// through that kind's own refusal function, so a module that stopped delegating
// to the shared table — or a table change nobody meant — fails here. The overlay
// agreeing with those refusals tile for tile is placement-overlay.test.ts.

import { describe, expect, it } from 'vitest';
import { HOME_ROW, WORLD_W } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';
import { containerPlacementRefusal, createPlacedContainer } from './cargo-container';
import { decorPlacementRefusal } from './decor';
import { createPlacedDynamite, dynamitePlacementRefusal } from './dynamite';
import type { InventoryItemKind } from './inventory';
import {
  OCCUPANTS,
  PLACEMENT_BLOCKERS,
  canPlaceDevice,
  occupantsAt,
  placementFamily,
  placementRefusal,
  type OccupancyState,
  type Occupant
} from './placement';
import { createScannerDevice, scannerPlacementRefusal } from './scanner-device';
import { createManufacturer, stationPlacementRefusal } from './stations';
import { chestsInRange, gravesInRange, tradingPostAt } from '../world/world';

/** The first trading post in the interior band. */
function findPost(): {x: number; y: number} {
  for (let y = HOME_ROW + 40; y < HOME_ROW + 4000; y++) {
    for (let x = 3; x < WORLD_W - 3; x++) {
      const post = tradingPostAt(x, y);
      if (post) return post;
    }
  }
  throw new Error('no trading post found');
}

/** An empty mine: nothing placed, no ship. */
function mine(overrides: Partial<OccupancyState> = {}): OccupancyState {
  return {stations: [], cargoContainers: [], wrecks: [], scannerDevices: [], placedDynamite: [], ...overrides};
}

describe('occupantsAt', () => {
  const x = 40, y = 100;

  it('finds nothing on bare ground', () => {
    expect(occupantsAt(mine(), x, y)).toEqual(new Set());
  });

  it.each<[Occupant, Partial<OccupancyState>]>([
    ['station', {stations: [createManufacturer(x, y)]}],
    ['container', {cargoContainers: [createPlacedContainer(x, y)]}],
    ['wreck', {wrecks: [{x, y}]}],
    ['scanner', {scannerDevices: [createScannerDevice(x, y)]}],
    ['dynamite', {placedDynamite: [createPlacedDynamite(x, y)]}],
    ['player', {player: {x, y}}]
  ])('reads a %s from the state', (occupant, overrides) => {
    expect(occupantsAt(mine(overrides), x, y)).toEqual(new Set([occupant]));
    // Only on its own tile.
    expect(occupantsAt(mine(overrides), x + 1, y)).toEqual(new Set());
  });

  it('reads a placed decoration from the generated rows, without needing them generated', () => {
    const world: {type: string}[][] = [];
    world[y] = Array.from({length: WORLD_W}, () => ({type: 'air'}));
    world[y][x] = {type: 'decor'};
    expect(occupantsAt(mine({world}), x, y)).toEqual(new Set(['decor']));
    expect(occupantsAt(mine({world}), x + 1, y)).toEqual(new Set());
    expect(occupantsAt(mine({world}), x, y + 50)).toEqual(new Set());
  });

  it('derives trading posts and graves from the coordinate', () => {
    const post = findPost();
    expect(occupantsAt(mine(), post.x, post.y)).toEqual(new Set(['tradingPost']));
    const grave = gravesInRange(0, 0, WORLD_W - 1, 400)[0];
    expect(occupantsAt(mine(), grave.x, grave.y)).toEqual(new Set(['grave']));
  });

  it('counts a chest until it is looted bare', () => {
    const chest = chestsInRange(0, 0, WORLD_W - 1, 400)[0];
    expect(occupantsAt(mine(), chest.x, chest.y)).toEqual(new Set(['chest']));
    expect(occupantsAt(mine({chestLedger: {[`${chest.x},${chest.y}`]: [{kind: 'dynamite', count: 1}]}}), chest.x, chest.y))
      .toEqual(new Set(['chest']));
    expect(occupantsAt(mine({chestLedger: {[`${chest.x},${chest.y}`]: []}}), chest.x, chest.y)).toEqual(new Set());
  });

  it('reports every occupant sharing a tile', () => {
    const shared = mine({
      scannerDevices: [createScannerDevice(x, y)],
      placedDynamite: [createPlacedDynamite(x, y)],
      player: {x, y}
    });
    expect(occupantsAt(shared, x, y)).toEqual(new Set(['scanner', 'dynamite', 'player']));
  });
});

describe('placementFamily', () => {
  it('groups every placed kind, the portal included, and nothing else', () => {
    expect(placementFamily('scanner')).toBe('scanner');
    expect(placementFamily('dynamite')).toBe('dynamite');
    expect(placementFamily('container')).toBe('container');
    expect(placementFamily('device:manufacturer')).toBe('station');
    expect(placementFamily('device:extractor')).toBe('station');
    expect(placementFamily('device:portal')).toBe('station');
    expect(placementFamily('decor:lampPanel')).toBe('decor');
    expect(placementFamily('teleporter')).toBeNull();
    expect(placementFamily('toolkit')).toBeNull();
    expect(placementFamily('ore:Iron')).toBeNull();
  });
});

describe('the cross-kind occupancy matrix', () => {
  const x = 40, y = 100;
  const explored = new Set([explorationIndex(x, y)]);

  /** Ask the kind's own refusal function about an open, explored tile holding `occupants`. */
  function refusal(kind: InventoryItemKind, occupants: ReadonlySet<Occupant>): string | null {
    const site = {explored, open: true, occupants};
    switch (kind) {
      case 'scanner': return scannerPlacementRefusal(x, y, {...site, devices: []});
      case 'dynamite': return dynamitePlacementRefusal(x, y, {...site, sticks: []});
      case 'container': return containerPlacementRefusal(x, y, {...site, containers: []});
      case 'device:manufacturer': return stationPlacementRefusal(x, y, 'manufacturer', {...site, count: 0});
      case 'device:extractor': return stationPlacementRefusal(x, y, 'extractor', {...site, count: 0});
      case 'device:portal': return stationPlacementRefusal(x, y, 'portal', {...site, count: 0});
      case 'decor:steelPlate': return decorPlacementRefusal(x, y, site);
      default: throw new Error(`not a placeable kind: ${kind}`);
    }
  }

  const everything = OCCUPANTS;
  const allButShip = OCCUPANTS.filter(occupant => occupant !== 'player');
  const refusedBy: [InventoryItemKind, readonly Occupant[]][] = [
    ['scanner', ['scanner']],
    ['dynamite', ['dynamite']],
    ['container', ['container', 'wreck', 'tradingPost', 'chest', 'grave']],
    ['device:manufacturer', allButShip],
    ['device:extractor', allButShip],
    ['device:portal', allButShip],
    ['decor:steelPlate', everything]
  ];

  it('accepts every kind on a tile nothing stands on', () => {
    for (const [kind] of refusedBy) expect(refusal(kind, new Set())).toBeNull();
  });

  for (const [kind, blockers] of refusedBy) {
    it.each(OCCUPANTS)(`${kind} on a tile holding a %s`, occupant => {
      const answer = refusal(kind, new Set([occupant]));
      if (blockers.includes(occupant)) expect(answer).toMatch(/already/);
      else expect(answer).toBeNull();
    });
  }

  it('is the table the modules read', () => {
    for (const [kind, blockers] of refusedBy) {
      expect([...PLACEMENT_BLOCKERS[placementFamily(kind)!]].sort()).toEqual([...blockers].sort());
    }
  });
});

describe('canPlaceDevice', () => {
  const explored = new Set([explorationIndex(40, 100)]);
  const copy = {full: 'full', offMine: 'offMine', unexplored: 'unexplored', blocked: 'blocked', occupied: 'occupied'};

  it.each([
    ['a good tile', 40, 100, {}],
    ['a full mine', 40, 100, {full: true}],
    ['off the mine', 40, -1, {}],
    ['under fog', 41, 100, {}],
    ['inside terrain', 40, 100, {open: false}],
    ['an occupied tile', 40, 100, {occupied: true}]
  ])('agrees with placementRefusal on %s', (_name, x, y, overrides) => {
    const site = {explored, open: true, occupied: false, full: false, ...overrides};
    expect(canPlaceDevice(x, y, site)).toBe(placementRefusal(x, y, site, copy) === null);
  });
});

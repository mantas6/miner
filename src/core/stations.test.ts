import { describe, expect, it } from 'vitest';
import { HOME_ROW, STATIONS } from '../../shared/constants';
import { EXTRACTOR } from './balance';
import { explorationIndex } from '../../shared/exploration-codec';
import {
  STATION_CAPACITY,
  STATION_DEVICE,
  createExtractor,
  createInitialStations,
  createManufacturer,
  isStationReachable,
  isStationTile,
  manufacturerStock,
  nearestStation,
  portals,
  stationAt,
  stationDeviceItemKind,
  stationPlacementRefusal,
  stowAll,
  stowStack,
  takeFromStation,
  tickExtractor
} from './stations';
import { addItem, countItem, createInventory, oreKind, totalItems, type Inventory } from './inventory';
import { itemForKind } from './items';
import { WORLD_W } from '../../shared/constants';
import { tradingPostAt } from '../world/world';

/** The first trading post in the interior band, for the occupancy checks. */
function findPost(): {x: number; y: number} {
  for (let y = HOME_ROW + 40; y < HOME_ROW + 4000; y++) {
    for (let x = 3; x < WORLD_W - 3; x++) {
      const post = tradingPostAt(x, y);
      if (post) return post;
    }
  }
  throw new Error('no trading post found');
}

/** A station stock or bay built from `{kind, count}` pairs. */
function inventory(...stacks: [string, number][]): Inventory {
  return stacks.reduce((inv, [kind, count]) => addItem(inv, itemForKind(kind as never), count), createInventory());
}

describe('the seeded stations', () => {
  it('places a manufacturer, an extractor, and the Home portal at the fixed positions', () => {
    const stations = createInitialStations();
    expect(stations).toHaveLength(3);
    expect(stationAt(stations, STATIONS.manufacturer.x, STATIONS.manufacturer.y)?.kind).toBe('manufacturer');
    const seededExtractor = stationAt(stations, STATIONS.extractor.x, STATIONS.extractor.y);
    expect(seededExtractor?.kind).toBe('extractor');
    // A new game's extractor starts with a full fuel tank.
    expect(seededExtractor?.kind === 'extractor' && seededExtractor.fuel).toBe(EXTRACTOR.fuelCap);
    const portal = stationAt(stations, STATIONS.portal.x, STATIONS.portal.y);
    expect(portal?.kind).toBe('portal');
    expect(portal?.kind === 'portal' && portal.name).toBe('Home');
  });

  it('lists the seeded portals and names the portal device item', () => {
    const seeded = portals(createInitialStations());
    expect(seeded.map(p => p.name)).toEqual(['Home']);
    expect(stationDeviceItemKind('portal')).toBe('device:portal');
  });

  it('caps portals at six, the base Home portal included', () => {
    expect(STATION_DEVICE.portal.maxPlaced).toBe(6);
  });
});

describe('locating the stations', () => {
  const stations = createInitialStations();

  it('reports which station a tile is, and none for the floor between them', () => {
    expect(stationAt(stations, STATIONS.manufacturer.x, STATIONS.manufacturer.y)?.kind).toBe('manufacturer');
    expect(stationAt(stations, STATIONS.manufacturer.x + 1, HOME_ROW)).toBeNull();
    expect(isStationTile(stations, STATIONS.extractor.x, STATIONS.extractor.y)).toBe(true);
    expect(isStationTile(stations, 0, 0)).toBe(false);
  });

  it('is reachable within one tile in any direction, and not beyond', () => {
    const manufacturer = stationAt(stations, STATIONS.manufacturer.x, STATIONS.manufacturer.y)!;
    expect(isStationReachable(manufacturer, STATIONS.manufacturer.x + 1, STATIONS.manufacturer.y - 1)).toBe(true);
    expect(isStationReachable(manufacturer, STATIONS.manufacturer.x + 2, STATIONS.manufacturer.y)).toBe(false);
  });

  it('opens the station the parked ship is standing on or beside, else none', () => {
    expect(nearestStation(stations, {x: STATIONS.manufacturer.x, y: HOME_ROW})?.kind).toBe('manufacturer');
    expect(nearestStation(stations, {x: STATIONS.extractor.x + 1, y: HOME_ROW})?.kind).toBe('extractor');
    // The spawn tile midway between the two is in reach of both; the manufacturer breaks the tie.
    expect(nearestStation(stations, {x: (STATIONS.manufacturer.x + STATIONS.extractor.x) / 2, y: HOME_ROW})?.kind).toBe('manufacturer');
    // Three tiles left of the manufacturer is out of reach of every seeded station.
    expect(nearestStation(stations, {x: STATIONS.manufacturer.x - 3, y: HOME_ROW})).toBeNull();
  });

  it('breaks a tie for the manufacturer even when it comes later in the array', () => {
    const stationsExtractorFirst = [createExtractor(10, 10), createManufacturer(12, 10)];
    // (11,10) is one tile from each; the manufacturer must still win the tie.
    expect(nearestStation(stationsExtractorFirst, {x: 11, y: 10})?.kind).toBe('manufacturer');
  });
});

describe('the primary manufacturer stock', () => {
  it('returns the first manufacturer inventory, or an empty one when there is none', () => {
    const manufacturer = createManufacturer(1, 1);
    manufacturer.inventory = inventory([oreKind('Iron'), 4]);
    expect(countItem(manufacturerStock([manufacturer]), oreKind('Iron'))).toBe(4);
    expect(manufacturerStock([createExtractor(2, 2)])).toHaveLength(0);
  });
});

describe('stowing cargo at the station', () => {
  it('moves everything that fits, ore and equipment alike', () => {
    const bay = inventory([oreKind('Iron'), 5], ['dynamite', 2]);
    const {bay: nextBay, station} = stowAll(bay, createInventory());

    expect(totalItems(nextBay)).toBe(0);
    expect(countItem(station, oreKind('Iron'))).toBe(5);
    expect(countItem(station, 'dynamite')).toBe(2);
  });

  it('takes only what the station has room for, leaving the rest aboard', () => {
    const bay = inventory([oreKind('Coal'), 10]);
    const nearlyFull = inventory([oreKind('Iron'), STATION_CAPACITY - 4]);
    const {bay: nextBay, station} = stowAll(bay, nearlyFull);

    expect(totalItems(station)).toBe(STATION_CAPACITY);
    expect(countItem(nextBay, oreKind('Coal'))).toBe(6);
  });

  it('stows one stack at a time, reporting how many moved', () => {
    const bay = inventory([oreKind('Gold'), 4]);
    const {bay: nextBay, station, moved} = stowStack(bay, createInventory(), oreKind('Gold'));

    expect(moved).toBe(4);
    expect(countItem(station, oreKind('Gold'))).toBe(4);
    expect(countItem(nextBay, oreKind('Gold'))).toBe(0);
  });
});

describe('taking cargo back out', () => {
  it('takes up to the count asked, held under the ship cargo limit', () => {
    const station = inventory([oreKind('Silver'), 10]);
    const {bay, station: nextStation, moved} = takeFromStation(createInventory(), station, oreKind('Silver'), 4, 20);

    expect(moved).toBe(4);
    expect(countItem(bay, oreKind('Silver'))).toBe(4);
    expect(countItem(nextStation, oreKind('Silver'))).toBe(6);
  });

  it('takes nothing when the bay is already at capacity', () => {
    const station = inventory([oreKind('Silver'), 10]);
    const full = inventory([oreKind('Coal'), 20]);
    const {bay, moved} = takeFromStation(full, station, oreKind('Silver'), 4, 20);

    expect(moved).toBe(0);
    expect(countItem(bay, oreKind('Silver'))).toBe(0);
  });

  it('reports nothing moved for a kind the station does not hold', () => {
    const {moved} = takeFromStation(createInventory(), createInventory(), oreKind('Ruby'), 1, 20);
    expect(moved).toBe(0);
  });
});

describe('placing a station device', () => {
  const explored = new Set([explorationIndex(40, 100)]);

  it('accepts an explored, cleared, unoccupied tile', () => {
    expect(stationPlacementRefusal(40, 100, 'extractor', {explored, open: true, occupied: false, count: 0})).toBeNull();
  });

  it('refuses a fogged, solid, occupied, or capped tile', () => {
    expect(stationPlacementRefusal(41, 100, 'extractor', {explored, open: true, occupied: false, count: 0})).toMatch(/already explored/);
    expect(stationPlacementRefusal(40, 100, 'extractor', {explored, open: false, occupied: false, count: 0})).toMatch(/cleared space/);
    expect(stationPlacementRefusal(40, 100, 'extractor', {explored, open: true, occupied: true, count: 0})).toMatch(/already stands/);
    expect(stationPlacementRefusal(40, 100, 'manufacturer', {explored, open: true, occupied: false, count: STATION_DEVICE.manufacturer.maxPlaced}))
      .toMatch(/Manufacturing Stations/);
    expect(stationPlacementRefusal(40, 100, 'portal', {explored, open: true, occupied: false, count: STATION_DEVICE.portal.maxPlaced}))
      .toMatch(/Portals/);
  });

  it('refuses a tile a trading post already stands on', () => {
    const post = findPost();
    const seen = new Set([explorationIndex(post.x, post.y)]);
    expect(stationPlacementRefusal(post.x, post.y, 'extractor', {explored: seen, open: true, occupied: false, count: 0}))
      .toMatch(/already stands/);
  });
});

describe('the extractor tick', () => {
  it('accumulates progress toward the current coal without converting yet', () => {
    const next = tickExtractor({coal: 5, fuel: 40, progress: 3});
    expect(next).toEqual({coal: 5, fuel: 40, progress: 4});
  });

  it('burns one coal into stored fuel on the tick that completes it', () => {
    const almost = {coal: 5, fuel: 40, progress: EXTRACTOR.ticksPerCoal - 1};
    const next = tickExtractor(almost);
    expect(next).toEqual({coal: 4, fuel: 40 + EXTRACTOR.fuelPerCoal, progress: 0});
  });

  it('converts a full queue over time, one coal every ticksPerCoal ticks', () => {
    let extractor = {coal: 2, fuel: 0, progress: 0};
    for (let i = 0; i < EXTRACTOR.ticksPerCoal * 2; i++) extractor = tickExtractor(extractor);
    expect(extractor).toEqual({coal: 0, fuel: EXTRACTOR.fuelPerCoal * 2, progress: 0});
  });

  it('clamps stored fuel at the cap rather than overfilling', () => {
    const almost = {coal: 1, fuel: EXTRACTOR.fuelCap - 5, progress: EXTRACTOR.ticksPerCoal - 1};
    const next = tickExtractor(almost);
    expect(next.fuel).toBe(EXTRACTOR.fuelCap);
    expect(next.coal).toBe(0);
  });

  it('does not waste coal once the fuel store is full: same buffer, untouched', () => {
    const full = {coal: 5, fuel: EXTRACTOR.fuelCap, progress: 7};
    expect(tickExtractor(full)).toBe(full);
  });

  it('idles with no coal queued, handing back the same reference', () => {
    const empty = {coal: 0, fuel: 40, progress: 0};
    expect(tickExtractor(empty)).toBe(empty);
  });

  it('is pure: it never mutates the buffer it is given', () => {
    const extractor = {coal: 3, fuel: 10, progress: 3};
    tickExtractor(extractor);
    expect(extractor).toEqual({coal: 3, fuel: 10, progress: 3});
  });

  it('a fresh extractor starts empty and unstarted', () => {
    expect(createExtractor(0, 0)).toMatchObject({coal: 0, fuel: 0, progress: 0});
  });
});

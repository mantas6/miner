import { describe, expect, it } from 'vitest';
import { HOME_ROW, STATIONS } from '../../shared/constants';
import { EXTRACTOR } from './balance';
import {
  STATION_CAPACITY,
  createHomeState,
  isStationReachable,
  isStationTile,
  nearestStation,
  stationAt,
  stowAll,
  stowStack,
  takeFromStation,
  tickExtractor
} from './home';
import { addItem, countItem, createInventory, oreKind, totalItems, type Inventory } from './inventory';
import { itemForKind } from './items';

/** A station stock or bay built from `{kind, count}` pairs. */
function inventory(...stacks: [string, number][]): Inventory {
  return stacks.reduce((inv, [kind, count]) => addItem(inv, itemForKind(kind as never), count), createInventory());
}

describe('locating the stations', () => {
  it('reports which station a tile is, and none for the floor between them', () => {
    expect(stationAt(STATIONS.manufacturer.x, STATIONS.manufacturer.y)).toBe('manufacturer');
    expect(stationAt(STATIONS.extractor.x, STATIONS.extractor.y)).toBe('extractor');
    expect(stationAt(STATIONS.manufacturer.x + 1, HOME_ROW)).toBeNull();
    expect(isStationTile(STATIONS.extractor.x, STATIONS.extractor.y)).toBe(true);
    expect(isStationTile(0, 0)).toBe(false);
  });

  it('is reachable within one tile in any direction, and not beyond', () => {
    expect(isStationReachable('manufacturer', STATIONS.manufacturer.x + 1, STATIONS.manufacturer.y - 1)).toBe(true);
    expect(isStationReachable('manufacturer', STATIONS.manufacturer.x + 2, STATIONS.manufacturer.y)).toBe(false);
  });

  it('opens the station the parked ship is standing on or beside, else none', () => {
    expect(nearestStation({x: STATIONS.manufacturer.x, y: HOME_ROW})).toBe('manufacturer');
    expect(nearestStation({x: STATIONS.extractor.x + 1, y: HOME_ROW})).toBe('extractor');
    // The spawn tile midway between the two is in reach of both; the manufacturer breaks the tie.
    expect(nearestStation({x: (STATIONS.manufacturer.x + STATIONS.extractor.x) / 2, y: HOME_ROW})).toBe('manufacturer');
    // Two tiles past the extractor is out of reach of both.
    expect(nearestStation({x: STATIONS.extractor.x + 2, y: HOME_ROW})).toBeNull();
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
    const next = tickExtractor(full);
    expect(next).toBe(full);
  });

  it('idles with no coal queued, handing back the same reference', () => {
    const empty = {coal: 0, fuel: 40, progress: 0};
    const next = tickExtractor(empty);
    expect(next).toBe(empty);
  });

  it('is pure: it never mutates the buffer it is given', () => {
    const extractor = {coal: 3, fuel: 10, progress: 3};
    tickExtractor(extractor);
    expect(extractor).toEqual({coal: 3, fuel: 10, progress: 3});
  });

  it('a fresh home base starts with an empty, unstarted extractor', () => {
    expect(createHomeState().extractor).toEqual({coal: 0, fuel: 0, progress: 0});
  });
});

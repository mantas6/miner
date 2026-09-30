import { describe, it, expect } from 'vitest';
import { RESPAWN, STARTING } from './balance';
import { ORES, START_Y, STATIONS, WORLD_W } from '../../shared/constants';
import { DYNAMITE_ITEM } from './dynamite';
import { addItem, addOre, countItem, countOres, createInventory } from './inventory';
import { applyEquipment, swapHull } from './ship-upgrades';
import { slotsFor } from './ships';
import {
  createInitialState,
  homeStoredFuel,
  isHomeSpawn,
  respawnPlayer,
  respawnShare,
  respawnVitals
} from './state';
import { homeExtractor, type ExtractorStation } from './stations';
import { TELEPORTER_ITEM } from './teleporter';
import type { GameState } from './types';
import { nth } from '../test-narrowing';

describe('initial game state', () => {
  it('starts a new game with starting capacities, no consumables, and no progress', () => {
    const state = createInitialState();

    expect(state.player.cargoMax).toBe(STARTING.cargoMax);
    expect(state.player.inventory).toHaveLength(0);
    expect(countOres(state.player.inventory)).toBe(0);
    expect(countItem(state.player.inventory, DYNAMITE_ITEM.kind)).toBe(0);
    expect(countItem(state.player.inventory, TELEPORTER_ITEM.kind)).toBe(0);
    expect(state.input.sprintDirection).toBeNull();
    expect(state.reducedMotion).toBe(false);
  });

  it('gives every new state its own stats object', () => {
    const first = createInitialState();
    first.stats.maxDepth = 500;

    expect(createInitialState().stats.maxDepth).toBe(0);
  });

  it('starts the objective progress counters at zero', () => {
    expect(createInitialState().stats).toMatchObject({scannersObtained: 0, bestMarkCrafted: 0});
  });
});

/** The home extractor of a fresh state, its store set to `fuel`. */
function homeStore(state: GameState, fuel: number): ExtractorStation {
  const extractor = homeExtractor(state.stations)!;
  extractor.fuel = fuel;
  return extractor;
}

describe('player respawn', () => {
  it('restores the ship, clears cargo, and strips the fitted upgrades', () => {
    const state = createInitialState();
    const player = state.player;
    player.x = 4;
    player.y = 80;
    // Fitted upgrades do not survive the wreck; the maxima fall back to base.
    player.equipment = ['upgrade:tank:1', 'upgrade:drill:1'];
    applyEquipment(player);
    player.fuel = 0;
    player.hull = 0;
    // Ore and equipment share the bay, and only the ore is lost with the ship.
    player.inventory = addItem(
      addItem(addOre(createInventory(), nth(ORES, 0), player.cargoMax)!, DYNAMITE_ITEM, 2),
      TELEPORTER_ITEM
    );

    respawnPlayer(player, state.stations);

    expect(player).toMatchObject({
      x: Math.floor(WORLD_W / 2),
      y: START_Y,
      fuel: STARTING.fuelMax,
      fuelMax: STARTING.fuelMax,
      hull: STARTING.hullMax * RESPAWN.hullFraction,
      hullMax: STARTING.hullMax,
      cargoMax: STARTING.cargoMax,
      drill: STARTING.drill
    });
    expect(countItem(player.inventory, DYNAMITE_ITEM.kind)).toBe(2);
    expect(countItem(player.inventory, TELEPORTER_ITEM.kind)).toBe(1);
    expect(countOres(player.inventory)).toBe(0);
    // Ore gone, the two bay equipment stacks remain, and every fitting slot empties.
    expect(player.inventory).toHaveLength(2);
    expect(player.equipment).toEqual([null, null, null]);
  });

  it('draws a full base tank out of the home extractor, leaving the store that much lower', () => {
    const state = createInitialState();
    const store = homeStore(state, 180);
    Object.assign(state.player, {fuel: 0, hull: 0});

    expect(respawnPlayer(state.player, state.stations)).toEqual({fuel: 100, hull: 50, drawn: 100});

    expect(state.player).toMatchObject({fuel: STARTING.fuelMax, hull: STARTING.hullMax * RESPAWN.hullFraction});
    expect(store.fuel).toBe(80);
  });

  it('drains a store short of a full tank, and never deploys under the reserve share', () => {
    const state = createInitialState();
    const store = homeStore(state, 70.5);

    expect(respawnPlayer(state.player, state.stations)).toMatchObject({fuel: 70, drawn: 70});
    expect(store.fuel).toBe(0.5);

    // A store that cannot cover half a tank gives up what it has; the ship still
    // deploys on half a tank.
    store.fuel = 20;
    expect(respawnPlayer(state.player, state.stations)).toMatchObject({fuel: 50, drawn: 20});
    expect(store.fuel).toBe(0);
  });

  it('deploys on the reserve share from a dry store, or with no home extractor at all', () => {
    const state = createInitialState();
    homeStore(state, 0);

    expect(respawnPlayer(state.player, state.stations)).toEqual({fuel: 50, hull: 50, drawn: 0});
    expect(state.player.fuel).toBe(STARTING.fuelMax * RESPAWN.homeFuelFraction);

    state.stations = state.stations.filter(station => station.kind !== 'extractor');
    expect(respawnPlayer(state.player, state.stations)).toEqual({fuel: 50, hull: 50, drawn: 0});
  });

  it('keeps half the base tank and half the hull at a field portal, drawing nothing', () => {
    const state = createInitialState();
    const store = homeStore(state, 300);
    const player = state.player;
    player.equipment = ['upgrade:tank:1', 'upgrade:hull:1', null];
    applyEquipment(player);
    Object.assign(player, {fuel: 0, hull: 0});

    expect(respawnPlayer(player, state.stations, {x: 30, y: 80})).toEqual({fuel: 50, hull: 50, drawn: 0});

    expect(player).toMatchObject({
      x: 30, y: 80,
      fuel: STARTING.fuelMax * RESPAWN.portalFuelFraction,
      fuelMax: STARTING.fuelMax,
      hull: STARTING.hullMax * RESPAWN.hullFraction,
      hullMax: STARTING.hullMax
    });
    expect(store.fuel).toBe(300);
  });

  it('draws at the base\'s own Home portal, which stands in the home cavern', () => {
    const state = createInitialState();
    const store = homeStore(state, 300);

    respawnPlayer(state.player, state.stations, {x: STATIONS.portal.x, y: STATIONS.portal.y});

    expect(state.player).toMatchObject({x: STATIONS.portal.x, fuel: STARTING.fuelMax});
    expect(store.fuel).toBe(200);
  });
});

describe('hull survival', () => {
  it('starts a new career in the Scout', () => {
    expect(createInitialState().player).toMatchObject({ship: 'scout'});
    expect(createInitialState().player.equipment).toHaveLength(slotsFor('scout'));
  });

  it('keeps the hull through a respawn, with every one of its slots empty and its own base', () => {
    const state = createInitialState();
    const player = state.player;
    swapHull(player, 'hauler');
    player.equipment = ['upgrade:tank:1', 'upgrade:hull:1', null, null];
    applyEquipment(player);
    Object.assign(player, {fuel: 0, hull: 0});

    respawnPlayer(player, state.stations);

    expect(player.ship).toBe('hauler');
    expect(player.equipment).toEqual([null, null, null, null]);
    expect(player).toMatchObject({fuel: 150, fuelMax: 150, hull: 62, hullMax: 125, cargoMax: 30});
  });
});

describe('respawn vitals', () => {
  it('knows home from the field: the home cavern and its Home portal are home', () => {
    expect(isHomeSpawn()).toBe(true);
    expect(isHomeSpawn({x: STATIONS.portal.x, y: STATIONS.portal.y})).toBe(true);
    expect(isHomeSpawn({x: 30, y: 80})).toBe(false);
  });

  it('draws the home tank from the store and hands out a fixed half at a field portal', () => {
    expect(respawnVitals('scout', undefined, 500)).toEqual({fuel: 100, hull: 50, drawn: 100});
    expect(respawnVitals('scout', undefined, 60)).toEqual({fuel: 60, hull: 50, drawn: 60});
    expect(respawnVitals('scout', undefined, 10)).toEqual({fuel: 50, hull: 50, drawn: 10});
    expect(respawnVitals('scout', undefined, 0)).toEqual({fuel: 50, hull: 50, drawn: 0});
    expect(respawnVitals('scout', {x: 30, y: 80}, 500)).toEqual({fuel: 50, hull: 50, drawn: 0});
  });

  it('is measured against the bare base tank and hull of the hull that survives', () => {
    expect(respawnVitals('hauler', undefined, 500)).toEqual({fuel: 150, hull: 62, drawn: 150});
    expect(respawnVitals('hauler', {x: 30, y: 80}, 500)).toEqual({fuel: 75, hull: 62, drawn: 0});
  });

  it('reads the home extractor\'s store, or nothing without one', () => {
    const state = createInitialState();
    homeStore(state, 123);
    expect(homeStoredFuel(state.stations)).toBe(123);
    expect(homeStoredFuel([])).toBe(0);
  });

  it('deals in whole units and never deploys an empty tank or hull', () => {
    expect(respawnShare(150, 0.5)).toBe(75);
    expect(respawnShare(99, 0.5)).toBe(49);
    expect(respawnShare(100, 0)).toBe(1);
    expect(respawnShare(100, 2)).toBe(100);
  });
});

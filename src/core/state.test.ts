import { describe, it, expect } from 'vitest';
import { RESPAWN, STARTING } from './balance';
import { ORES, START_Y, STATIONS, WORLD_W } from '../../shared/constants';
import { DYNAMITE_ITEM } from './dynamite';
import { addItem, addOre, countItem, countOres, createInventory } from './inventory';
import { applyEquipment } from './ship-upgrades';
import { createInitialState, respawnFuelAt, respawnFuelFraction, respawnFuelUnits, respawnPlayer } from './state';
import { TELEPORTER_ITEM } from './teleporter';
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

    respawnPlayer(player);

    expect(player).toMatchObject({
      x: Math.floor(WORLD_W / 2),
      y: START_Y,
      fuel: STARTING.fuelMax,
      fuelMax: STARTING.fuelMax,
      hull: STARTING.hullMax,
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

  it('fills the given share of the base tank, and always the whole hull', () => {
    const player = createInitialState().player;
    player.equipment = ['upgrade:tank:1', null, null];
    applyEquipment(player);
    Object.assign(player, {fuel: 0, hull: 0});

    respawnPlayer(player, {x: 30, y: 80}, RESPAWN.portalFuelFraction);

    expect(player).toMatchObject({
      x: 30, y: 80,
      fuel: STARTING.fuelMax * RESPAWN.portalFuelFraction,
      fuelMax: STARTING.fuelMax,
      hull: STARTING.hullMax
    });
  });
});

describe('respawn fuel', () => {
  it('is a full tank at home and half of one at a field portal', () => {
    expect(respawnFuelFraction()).toBe(1);
    // The base's own portal stands in the home cavern: home rules.
    expect(respawnFuelFraction({x: STATIONS.portal.x, y: STATIONS.portal.y})).toBe(1);
    expect(respawnFuelFraction({x: 30, y: 80})).toBe(RESPAWN.portalFuelFraction);

    expect(respawnFuelAt()).toBe(STARTING.fuelMax);
    expect(respawnFuelAt({x: 30, y: 80})).toBe(50);
  });

  it('deals in whole units and never deploys an empty tank', () => {
    expect(respawnFuelUnits(150, 0.5)).toBe(75);
    expect(respawnFuelUnits(99, 0.5)).toBe(49);
    expect(respawnFuelUnits(100, 0)).toBe(1);
    expect(respawnFuelUnits(100, 2)).toBe(100);
  });
});

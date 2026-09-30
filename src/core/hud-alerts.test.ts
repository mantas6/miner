import { describe, it, expect } from 'vitest';
import { ORES } from '../../shared/constants';
import { EXTRACTOR, STARTING } from './balance';
import { addOre, createInventory, oreKind, removeItem } from './inventory';
import { createInitialState } from './state';
import { homeExtractor } from './stations';
import {
  isAtOrAboveCapacity,
  isBaseLow,
  isBelowWarningFraction,
  shouldBaseAlert,
  shouldCargoBarFlash,
  shouldFuelBarFlash,
  shouldHullBarFlash
} from './hud-alerts';
import { nth } from '../test-narrowing';

function alertState(overrides = {}) {
  const state = createInitialState();
  Object.assign(state.player, overrides);
  return state;
}

/** One stack holding `count` units of the same ore. */
function oreLoad(count: number) {
  let inventory = createInventory();
  for (let i = 0; i < count; i++) inventory = addOre(inventory, nth(ORES, 0), count)!;
  return inventory;
}

describe('HUD alert flashing thresholds', () => {
  it('uses the existing low-fuel threshold for fuel bar flashing', () => {
    expect(shouldFuelBarFlash(alertState({ fuel: 24, fuelMax: STARTING.fuelMax }))).toBe(true);
    expect(shouldFuelBarFlash(alertState({ fuel: 25, fuelMax: STARTING.fuelMax }))).toBe(false);
    expect(shouldFuelBarFlash(alertState({ fuel: 80, fuelMax: STARTING.fuelMax }))).toBe(false);
  });

  it('flashes hull only below the low-hull threshold', () => {
    expect(shouldHullBarFlash(alertState({ hull: 29, hullMax: STARTING.hullMax }))).toBe(true);
    expect(shouldHullBarFlash(alertState({ hull: 30, hullMax: STARTING.hullMax }))).toBe(false);
    expect(shouldHullBarFlash(alertState({ hull: 70, hullMax: STARTING.hullMax }))).toBe(false);
  });

  it('does not flash bars while the game is over or max values are invalid', () => {
    const gameOver = alertState({ fuel: 1, hull: 1 });
    gameOver.gameOver = true;
    expect(shouldFuelBarFlash(gameOver)).toBe(false);
    expect(shouldHullBarFlash(gameOver)).toBe(false);
    expect(isBelowWarningFraction(0, 0, 0.25)).toBe(false);
  });

  it('flashes the cargo bar only when cargo is full', () => {
    const state = alertState({ cargoMax: 10 });
    state.player.inventory = oreLoad(9);
    expect(shouldCargoBarFlash(state)).toBe(false);

    state.player.inventory = addOre(state.player.inventory, nth(ORES, 1), 10)!;
    expect(shouldCargoBarFlash(state)).toBe(true);

    state.player.inventory = removeItem(state.player.inventory, oreKind(nth(ORES, 1).name));
    expect(shouldCargoBarFlash(state)).toBe(false);
  });

  it('keeps cargo flashing state tied to capacity, upgrades, game-over, and invalid max values', () => {
    const state = alertState({ cargoMax: 10 });
    state.player.inventory = oreLoad(10);
    expect(shouldCargoBarFlash(state)).toBe(true);

    state.player.cargoMax = 20;
    expect(shouldCargoBarFlash(state)).toBe(false);

    state.player.cargoMax = 10;
    state.gameOver = true;
    expect(shouldCargoBarFlash(state)).toBe(false);
    expect(isAtOrAboveCapacity(0, 0)).toBe(false);
  });
});

describe('the base fuel alert', () => {
  it('stays quiet while the home extractor could still fill a tank', () => {
    const state = alertState();
    // A new game's seeded store is full.
    expect(shouldBaseAlert(state)).toBe(false);

    Object.assign(homeExtractor(state.stations)!, {fuel: state.player.fuelMax, coal: 0});
    expect(shouldBaseAlert(state)).toBe(false);
  });

  it('counts queued coal at its conversion value', () => {
    const state = alertState();
    const base = homeExtractor(state.stations)!;
    Object.assign(base, {fuel: state.player.fuelMax - EXTRACTOR.fuelPerCoal, coal: 1});
    expect(shouldBaseAlert(state)).toBe(false);

    base.fuel -= 1;
    expect(shouldBaseAlert(state)).toBe(true);
  });

  it('measures against the fitted tank, not the starting one', () => {
    const state = alertState({ fuelMax: 150 });
    Object.assign(homeExtractor(state.stations)!, {fuel: 120, coal: 0});
    expect(shouldBaseAlert(state)).toBe(true);
  });

  it('caps the measure at what the store can hold, so a full store never alerts', () => {
    // A tank past the store's cap: a brim-full store is as good as the base gets.
    const state = alertState({ fuelMax: EXTRACTOR.fuelCap + 375 });
    const base = homeExtractor(state.stations)!;
    Object.assign(base, {fuel: EXTRACTOR.fuelCap, coal: 0});
    expect(shouldBaseAlert(state)).toBe(false);

    base.fuel = EXTRACTOR.fuelCap - 1;
    expect(shouldBaseAlert(state)).toBe(true);
    expect(isBaseLow({fuel: EXTRACTOR.fuelCap - EXTRACTOR.fuelPerCoal, coal: 1}, EXTRACTOR.fuelCap * 2)).toBe(false);
  });

  it('raises the alert when no extractor stands in the home cavern', () => {
    const state = alertState();
    state.stations = state.stations.filter(station => station.kind !== 'extractor');
    expect(shouldBaseAlert(state)).toBe(true);
  });
});

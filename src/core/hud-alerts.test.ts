import { describe, it, expect } from 'vitest';
import { ORES } from '../../shared/constants';
import { STARTING } from './balance';
import { addOre, createInventory, oreKind, removeItem } from './inventory';
import { createInitialState } from './state';
import {
  isAtOrAboveCapacity,
  isBelowWarningFraction,
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

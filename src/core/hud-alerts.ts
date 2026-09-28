import { FUEL, HULL } from './balance';
import { totalItems } from './inventory';
import type { GameState } from './types';

/**
 * Whether a resource is below `fraction` of its maximum. An empty or invalid
 * maximum reads as safe, to avoid false warning flashes.
 */
export function isBelowWarningFraction(current: number, max: number, fraction: number): boolean {
  return Number.isFinite(max) && max > 0 && (current / max) < fraction;
}

/**
 * Whether the cargo bay is full or overfilled, measured in items. An empty or
 * invalid maximum reads as safe, to avoid false warning flashes.
 */
export function isAtOrAboveCapacity(current: number, max: number): boolean {
  return Number.isFinite(max) && max > 0 && current >= max;
}

/** Whether the fuel meter should flash its low-fuel warning. */
export function shouldFuelBarFlash(state: GameState): boolean {
  return !state.gameOver && isBelowWarningFraction(state.player.fuel, state.player.fuelMax, FUEL.lowFuelFraction);
}

/** Whether the hull meter should flash its low-hull warning. */
export function shouldHullBarFlash(state: GameState): boolean {
  return !state.gameOver && isBelowWarningFraction(state.player.hull, state.player.hullMax, HULL.lowHullFraction);
}

/** Whether the cargo readout should flash its full-bay warning. */
export function shouldCargoBarFlash(state: GameState): boolean {
  return !state.gameOver && isAtOrAboveCapacity(totalItems(state.player.inventory), state.player.cargoMax);
}

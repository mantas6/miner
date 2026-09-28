import { FUEL } from './balance';

export type FuelReserveStatus = 'safe' | 'caution' | 'urgent';

export interface FuelReserveInput {
  fuel: number;
  playerY: number;
  startY: number;
  atSurface?: boolean;
  gameOver?: boolean;
}

export interface FuelReserveForecast {
  status: FuelReserveStatus;
  reserve: number;
  fuelAfterReturn: number;
  depthTiles: number;
}

/**
 * Estimates an ascent through a clear shaft, then doubles that cost as a
 * conservative detour/hover allowance. It intentionally does not pretend to
 * know the player's exact tunnel route.
 */
export function estimateFuelReturnReserve(depthTiles: number): number {
  const verticalTiles = Math.max(0, depthTiles);
  const clearShaftMove = (FUEL.baseMove + FUEL.vertical) * FUEL.flyMult;
  return verticalTiles * clearShaftMove * FUEL.returnReserveMultiplier;
}

export function classifyFuelReserve(fuel: number, reserve: number, gameOver = false): FuelReserveStatus {
  if (gameOver || fuel <= reserve) return 'urgent';
  if (fuel <= reserve * FUEL.returnReserveCautionMultiplier) return 'caution';
  return 'safe';
}

export function getFuelReserveForecast({ fuel, playerY, startY, atSurface = false, gameOver = false }: FuelReserveInput): FuelReserveForecast {
  const depthTiles = Math.max(0, playerY - startY);
  const reserve = atSurface ? 0 : estimateFuelReturnReserve(depthTiles);
  return {
    status: classifyFuelReserve(fuel, reserve, gameOver),
    reserve,
    fuelAfterReturn: fuel - reserve,
    depthTiles
  };
}

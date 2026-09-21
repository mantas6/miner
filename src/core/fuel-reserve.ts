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

/** The two coloured slices of the fuel gauge, as shares of the whole tank. */
export interface FuelGaugeSegments {
  /** Fuel the climb home would burn, capped by what is actually in the tank. */
  returnFraction: number;
  /** Fuel that would still be aboard once that climb is paid for. */
  surplusFraction: number;
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

/**
 * Splits the tank where the climb home ends, so the gauge itself can show the
 * forecast instead of a widget beside it: the first slice is what the return
 * trip owes, the second is what would survive it. Once the climb costs more than
 * the tank holds the surplus slice is empty and the whole fill is the debt —
 * which is exactly the moment the reserve status turns urgent.
 */
export function getFuelGaugeSegments(fuel: number, fuelMax: number, reserve: number): FuelGaugeSegments {
  const capacity = Number.isFinite(fuelMax) && fuelMax > 0 ? fuelMax : 0;
  if (capacity <= 0) return {returnFraction: 0, surplusFraction: 0};
  const inTank = Math.min(Math.max(0, fuel), capacity);
  const owed = Math.min(Math.max(0, reserve), inTank);
  return {returnFraction: owed / capacity, surplusFraction: (inTank - owed) / capacity};
}

/** Formats an always-visible, route-honest return-fuel forecast. */
export function formatFuelReserveForecast(input: FuelReserveInput): string {
  const forecast = getFuelReserveForecast(input);
  if (input.gameOver) return 'Fuel reserve: URGENT — ship disabled; restart at home base.';
  if (input.atSurface) return 'Fuel reserve: SAFE — at home base; refuel at the Oil Extractor before the next descent.';

  const reserve = Math.ceil(forecast.reserve);
  const remaining = Math.floor(forecast.fuelAfterReturn);
  const assumption = 'clear-shaft return + 2× detour reserve';
  if (forecast.status === 'urgent') {
    return `Fuel reserve: URGENT — turn back now; need ${reserve} fuel (${assumption}).`;
  }
  if (forecast.status === 'caution') {
    return `Fuel reserve: CAUTION — about ${Math.max(0, remaining)} fuel after return (${assumption}).`;
  }
  return `Fuel reserve: SAFE — about ${remaining} fuel after return (${assumption}).`;
}

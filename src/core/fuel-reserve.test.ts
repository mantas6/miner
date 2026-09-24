import { describe, expect, it } from 'vitest';
import {
  classifyFuelReserve,
  estimateFuelReturnReserve,
  formatFuelReserveForecast,
  getFuelReserveForecast
} from './fuel-reserve';

const underground = { playerY: 12, startY: 2, atSurface: false };

describe('fuel reserve forecast helper', () => {
  it('derives a conservative clear-shaft return reserve from shared fuel balance values', () => {
    expect(estimateFuelReturnReserve(10)).toBeCloseTo(3.3);
    const forecast = getFuelReserveForecast({ ...underground, fuel: 50 });
    expect(forecast.status).toBe('safe');
    expect(forecast.reserve).toBeCloseTo(3.3);
    expect(forecast.fuelAfterReturn).toBeCloseTo(46.7);
    expect(forecast.depthTiles).toBe(10);
  });

  it('classifies safe, caution, and urgent return margins', () => {
    expect(classifyFuelReserve(50, 3.3)).toBe('safe');
    expect(classifyFuelReserve(4.5, 3.3)).toBe('caution');
    expect(classifyFuelReserve(3.3, 3.3)).toBe('urgent');
  });

  it('formats transparent return guidance for underground, home-base, and game-over states', () => {
    expect(formatFuelReserveForecast({ ...underground, fuel: 50 }))
      .toBe('Fuel reserve: SAFE — about 46 fuel after return (clear-shaft return + 2× detour reserve).');
    expect(formatFuelReserveForecast({ ...underground, fuel: 4.5 }))
      .toBe('Fuel reserve: CAUTION — about 1 fuel after return (clear-shaft return + 2× detour reserve).');
    expect(formatFuelReserveForecast({ ...underground, fuel: 3.3 }))
      .toBe('Fuel reserve: URGENT — turn back now; need 4 fuel (clear-shaft return + 2× detour reserve).');
    expect(formatFuelReserveForecast({ playerY: 2, startY: 2, fuel: 100, atSurface: true }))
      .toBe('Fuel reserve: SAFE — at home base; refuel at the Fuel Extractor before the next descent.');
    expect(formatFuelReserveForecast({ ...underground, fuel: 0, gameOver: true }))
      .toBe('Fuel reserve: URGENT — ship disabled; restart at home base.');
  });
});

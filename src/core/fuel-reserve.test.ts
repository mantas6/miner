import { describe, expect, it } from 'vitest';
import {
  classifyFuelReserve,
  estimateFuelReturnReserve,
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
});

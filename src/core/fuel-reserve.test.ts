import { describe, expect, it } from 'vitest';
import {
  classifyFuelReserve,
  estimateFuelReturnReserve,
  formatFuelReserveForecast,
  getFuelGaugeSegments,
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
      .toBe('Fuel reserve: SAFE — at home base; refuel at the Oil Extractor before the next descent.');
    expect(formatFuelReserveForecast({ ...underground, fuel: 0, gameOver: true }))
      .toBe('Fuel reserve: URGENT — ship disabled; restart at home base.');
  });
});

describe('fuel gauge split', () => {
  it('splits the tank into the climb home and what would survive it', () => {
    expect(getFuelGaugeSegments(50, 100, 20)).toEqual({ returnFraction: 0.2, surplusFraction: 0.3 });
    // Empty tank above the fill, always: the two slices only ever sum to the fuel aboard.
    const { returnFraction, surplusFraction } = getFuelGaugeSegments(50, 100, 20);
    expect(returnFraction + surplusFraction).toBeCloseTo(0.5);
  });

  it('leaves no surplus once the climb costs more than the tank holds', () => {
    expect(getFuelGaugeSegments(30, 100, 80)).toEqual({ returnFraction: 0.3, surplusFraction: 0 });
    expect(getFuelGaugeSegments(30, 100, 30)).toEqual({ returnFraction: 0.3, surplusFraction: 0 });
  });

  it('is all surplus at the home base, where there is no climb to pay for', () => {
    expect(getFuelGaugeSegments(80, 100, 0)).toEqual({ returnFraction: 0, surplusFraction: 0.8 });
  });

  it('clamps a dry, overfull, or unmeasurable tank instead of overflowing the bar', () => {
    expect(getFuelGaugeSegments(-5, 100, 10)).toEqual({ returnFraction: 0, surplusFraction: 0 });
    expect(getFuelGaugeSegments(140, 100, 20)).toEqual({ returnFraction: 0.2, surplusFraction: 0.8 });
    expect(getFuelGaugeSegments(50, 0, 10)).toEqual({ returnFraction: 0, surplusFraction: 0 });
    expect(getFuelGaugeSegments(50, Number.NaN, 10)).toEqual({ returnFraction: 0, surplusFraction: 0 });
  });
});

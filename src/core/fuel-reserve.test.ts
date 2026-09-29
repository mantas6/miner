import { describe, expect, it } from 'vitest';
import { HOME_X, START_Y, STATIONS } from '../../shared/constants';
import { FUEL } from './balance';
import {
  HOME_FUEL_EXIT,
  classifyFuelReserve,
  fuelExitCost,
  fuelExitLabel,
  fuelReserveExits,
  getFuelReserveForecast,
  type FuelExit
} from './fuel-reserve';
import { createInitialStations, createPortal } from './stations';

const home: FuelExit = {kind: 'home', x: HOME_X, y: START_Y, name: 'Home'};
const underground = { playerX: HOME_X, playerY: START_Y + 10, exits: [home], atSurface: false };

describe('fuel reserve forecast helper', () => {
  it('prices a clear-flight climb from the shared fuel balance values', () => {
    // 10 rows × (0.25 + 0.08) × 0.5 flying × 1.35 allowance.
    expect(FUEL.returnReserveMultiplier).toBe(1.35);
    expect(fuelExitCost(HOME_X, START_Y + 10, home)).toBeCloseTo(2.2275);
    const forecast = getFuelReserveForecast({ ...underground, fuel: 50 });
    expect(forecast.status).toBe('safe');
    expect(forecast.reserve).toBeCloseTo(2.2275);
    expect(forecast.fuelAfterReturn).toBeCloseTo(47.7725);
    expect(forecast.exit).toBe(home);
  });

  it('charges the sideways trip at the base move, and nothing for rows below the ship', () => {
    // Four columns across on the same row: 4 × 0.25 × 0.5 × 1.35.
    expect(fuelExitCost(HOME_X + 4, START_Y, home)).toBeCloseTo(0.675);
    // An exit deeper than the ship is a free fall plus the sideways leg.
    expect(fuelExitCost(HOME_X, START_Y, {x: HOME_X + 4, y: START_Y + 30})).toBeCloseTo(0.675);
  });

  it('prices the reserve to the cheapest exit, a nearer portal included', () => {
    const deep: FuelExit = {kind: 'portal', x: HOME_X, y: START_Y + 77, name: 'Deep'};
    const forecast = getFuelReserveForecast({fuel: 20, playerX: HOME_X, playerY: START_Y + 100, exits: [home, deep]});
    expect(forecast.exit).toBe(deep);
    expect(forecast.reserve).toBeCloseTo(fuelExitCost(HOME_X, START_Y + 100, deep));
    expect(forecast.reserve).toBeLessThan(fuelExitCost(HOME_X, START_Y + 100, home));
    expect(forecast.status).toBe('safe');
  });

  it('skips a same-row portal far across the mine when home is the shorter trip', () => {
    const far: FuelExit = {kind: 'portal', x: 2, y: START_Y + 20, name: 'Far'};
    // Level with the portal, but 43 columns away: the 20-row climb home is cheaper.
    const forecast = getFuelReserveForecast({fuel: 50, playerX: HOME_X, playerY: START_Y + 20, exits: [home, far]});
    expect(forecast.exit).toBe(home);
    expect(forecast.reserve).toBeCloseTo(fuelExitCost(HOME_X, START_Y + 20, home));
  });

  it('reserves nothing at the home base, and gives up once the ship is lost', () => {
    const atHome = getFuelReserveForecast({fuel: 12, playerX: HOME_X + 3, playerY: START_Y, exits: [home], atSurface: true});
    expect(atHome).toMatchObject({status: 'safe', reserve: 0, fuelAfterReturn: 12, exit: home});
    expect(getFuelReserveForecast({...underground, fuel: 50, gameOver: true}).status).toBe('urgent');
  });

  it('classifies safe, caution, and urgent return margins', () => {
    expect(classifyFuelReserve(50, 3.3)).toBe('safe');
    expect(classifyFuelReserve(4.5, 3.3)).toBe('caution');
    expect(classifyFuelReserve(3.3, 3.3)).toBe('urgent');
  });

  it('names an exit the way the HUD reads it', () => {
    expect(fuelExitLabel(HOME_FUEL_EXIT)).toBe('Home');
    expect(fuelExitLabel(createPortal(10, 90, 'Deep'))).toBe('Portal "Deep"');
    expect(fuelExitLabel(null)).toBe('Home');
  });
});

describe('fuel reserve exits', () => {
  const open = () => true;

  it('lists home first, then every landable field portal, but not the home-cavern portal', () => {
    const deep = createPortal(30, START_Y + 50, 'Deep');
    const buried = createPortal(60, START_Y + 80, 'Buried');
    const stations = [...createInitialStations(), deep, buried];
    const exits = fuelReserveExits(stations, (x, y) => !(x === buried.x && y === buried.y));
    expect(exits).toEqual([HOME_FUEL_EXIT, deep]);
    // The portal itself, so a rename reads through.
    expect(exits[1]).toBe(deep);
  });

  it('drops the field portals once no portal stands in the home cavern to jump back to', () => {
    const deep = createPortal(30, START_Y + 50, 'Deep');
    const noHomePortal = [...createInitialStations().filter(s => s.kind !== 'portal'), deep];
    expect(fuelReserveExits(noHomePortal, open)).toEqual([HOME_FUEL_EXIT]);

    const homePortal = createPortal(STATIONS.portal.x, STATIONS.portal.y, 'Home');
    const buriedHome = (x: number, y: number) => !(x === homePortal.x && y === homePortal.y);
    expect(fuelReserveExits([homePortal, deep], buriedHome)).toEqual([HOME_FUEL_EXIT]);
    expect(fuelReserveExits([homePortal, deep], open)).toEqual([HOME_FUEL_EXIT, deep]);
  });
});

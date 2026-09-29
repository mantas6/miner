import { HOME_X, START_Y, isHomeCavern } from '../../shared/constants';
import { FUEL } from './balance';
import type { LandingCheck } from './portal';
import { portals, type PlacedStation } from './stations';

export type FuelReserveStatus = 'safe' | 'caution' | 'urgent';

/**
 * Somewhere reaching counts as making it back: the home cavern itself, or a field
 * portal the ship could jump home from for free. A `PortalStation` is one as is.
 */
export interface FuelExit {
  kind: 'home' | 'portal';
  x: number;
  y: number;
  name: string;
}

/** The home cavern's exit: its centre column on the floor row, where depth is zero. */
export const HOME_FUEL_EXIT: FuelExit = Object.freeze({kind: 'home', x: HOME_X, y: START_Y, name: 'Home'});

export interface FuelReserveInput {
  fuel: number;
  playerX: number;
  playerY: number;
  /** Every exit the forecast may choose; the cheapest wins. Empty reserves nothing. */
  exits: readonly FuelExit[];
  atSurface?: boolean;
  gameOver?: boolean;
}

export interface FuelReserveForecast {
  status: FuelReserveStatus;
  reserve: number;
  fuelAfterReturn: number;
  /** The exit the reserve is priced to, or `null` with none offered. */
  exit: FuelExit | null;
}

/**
 * The exits a ship can make for: the home cavern always, plus every field portal
 * it could land on — but only while a landable portal still stands in the home
 * cavern, since a field portal is only a way home if the network reaches there.
 * Portals inside the cavern are the home exit itself, so they are not listed
 * again. The field portals are the station objects themselves, so a rename shows
 * through without rebuilding the list.
 */
export function fuelReserveExits(stations: readonly PlacedStation[], canLand?: LandingCheck): FuelExit[] {
  const exits: FuelExit[] = [HOME_FUEL_EXIT];
  const landable = portals(stations).filter(portal => !canLand || canLand(portal.x, portal.y));
  if (!landable.some(portal => isHomeCavern(portal.x, portal.y))) return exits;
  for (const portal of landable) {
    if (!isHomeCavern(portal.x, portal.y)) exits.push(portal);
  }
  return exits;
}

/**
 * Fuel to fly from the ship to an exit through cleared ground: every row climbed
 * pays the vertical surcharge, every column crossed the base move, both at the
 * flying rate — then padded by `returnReserveMultiplier` as a detour/hover
 * allowance. Rows below the ship are free (a fall), so an exit deeper than the
 * ship costs only the sideways trip. It does not pretend to know the real tunnel.
 */
export function fuelExitCost(playerX: number, playerY: number, exit: Pick<FuelExit, 'x' | 'y'>): number {
  const climb = Math.max(0, playerY - exit.y) * (FUEL.baseMove + FUEL.vertical);
  const across = Math.abs(playerX - exit.x) * FUEL.baseMove;
  return (climb + across) * FUEL.flyMult * FUEL.returnReserveMultiplier;
}

/** How the HUD names an exit: `Home`, or `Portal "Deep"`. */
export function fuelExitLabel(exit: FuelExit | null): string {
  if (!exit || exit.kind === 'home') return 'Home';
  return `Portal "${exit.name}"`;
}

export function classifyFuelReserve(fuel: number, reserve: number, gameOver = false): FuelReserveStatus {
  if (gameOver || fuel <= reserve) return 'urgent';
  if (fuel <= reserve * FUEL.returnReserveCautionMultiplier) return 'caution';
  return 'safe';
}

export function getFuelReserveForecast({ fuel, playerX, playerY, exits, atSurface = false, gameOver = false }: FuelReserveInput): FuelReserveForecast {
  let exit: FuelExit | null = null;
  let cheapest = Infinity;
  for (const candidate of exits) {
    const cost = fuelExitCost(playerX, playerY, candidate);
    if (cost < cheapest) {
      cheapest = cost;
      exit = candidate;
    }
  }
  const reserve = atSurface || !exit ? 0 : cheapest;
  return {
    status: classifyFuelReserve(fuel, reserve, gameOver),
    reserve,
    fuelAfterReturn: fuel - reserve,
    exit
  };
}

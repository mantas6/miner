// Where a carried thing may be put down.
//
// Everything the player sets down in the mine — the survey scanner, a stick of
// dynamite, a cargo container, a station device, a decoration panel — answers the
// same five questions in the same order: is there room for another one, is the
// tile part of the mine at all, has it been explored, is it clear of terrain, and
// is something already sitting on it.
//
// The last question is answered once, here, by `occupantsAt`: every kind of thing
// that can stand on a tile, read from the one place each is recorded. Each family
// of placed thing then says which of those occupants it refuses (`PLACEMENT_BLOCKERS`),
// so the placement handlers and the preview grid can never disagree about it.
//
// Only the wording differs per device, so each brings its own copy. The refusals
// are phrased as the toast the player sees, which is what keeps a rule and its
// explanation from drifting apart.

import { MAX_WORLD_ROW, WORLD_W } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';
import { graveAt, tradingPostAt } from '../world/world';
import { chestStandsAt } from './chest';
import { isDecorKind, isDeviceKind, type InventoryItemKind } from './inventory';
import type { ChestLedger } from './types';

/** Inside the dug part of the world: not above the world, not the side walls. */
export function inMineBounds(x: number, y: number): boolean {
  return x >= 0 && x < WORLD_W && y >= 0 && y <= MAX_WORLD_ROW;
}

/** Every kind of thing that can stand on (or be) a tile of the mine. */
export type Occupant =
  | 'station'
  | 'container'
  | 'wreck'
  | 'scanner'
  | 'dynamite'
  | 'tradingPost'
  | 'chest'
  | 'grave'
  | 'player'
  | 'decor';

/** All occupant types, in a stable order — for tests and exhaustive tables. */
export const OCCUPANTS: readonly Occupant[] = [
  'station', 'container', 'wreck', 'scanner', 'dynamite', 'tradingPost', 'chest', 'grave', 'player', 'decor'
];

interface Spot {
  x: number;
  y: number;
}

/** The slice of the running mine `occupantsAt` reads. `GameState` satisfies it. */
export interface OccupancyState {
  stations: readonly Spot[];
  cargoContainers: readonly Spot[];
  wrecks: readonly Spot[];
  scannerDevices: readonly Spot[];
  placedDynamite: readonly Spot[];
  /** The opened-chest ledger; absent counts every generated chest as still lying there. */
  chestLedger?: ChestLedger;
  /** The ship, when there is one to account for. */
  player?: Spot;
  /**
   * The generated tile rows, read without generating any, for placed decor. A row
   * not yet generated holds no decor the player could have set down.
   */
  world?: readonly (readonly {type: string}[] | undefined)[];
}

const at = (x: number, y: number) => (spot: Spot) => spot.x === x && spot.y === y;

/**
 * Everything standing on this tile right now. Trading posts, chests and graves are
 * derived from the coordinate rather than stored, so they are asked of the world
 * generator; the rest come from their lists in the state.
 */
export function occupantsAt(state: OccupancyState, x: number, y: number): Set<Occupant> {
  const occupants = new Set<Occupant>();
  const here = at(x, y);
  if (state.stations.some(here)) occupants.add('station');
  if (state.cargoContainers.some(here)) occupants.add('container');
  if (state.wrecks.some(here)) occupants.add('wreck');
  if (state.scannerDevices.some(here)) occupants.add('scanner');
  if (state.placedDynamite.some(here)) occupants.add('dynamite');
  if (tradingPostAt(x, y) !== null) occupants.add('tradingPost');
  if (chestStandsAt(x, y, state.chestLedger) !== null) occupants.add('chest');
  if (graveAt(x, y) !== null) occupants.add('grave');
  if (state.player && here(state.player)) occupants.add('player');
  if (inMineBounds(x, y) && state.world?.[y]?.[x]?.type === 'decor') occupants.add('decor');
  return occupants;
}

/** The families of thing set down in the mine, each with its own idea of a taken tile. */
export type PlacementFamily = 'scanner' | 'dynamite' | 'container' | 'station' | 'decor';

/** Every occupant except the ship. */
const ANYTHING_BUT_THE_SHIP: ReadonlySet<Occupant> = new Set(OCCUPANTS.filter(occupant => occupant !== 'player'));

/**
 * Which occupants refuse each family. A scanner or a stick of dynamite only
 * refuses another of its own kind — both are small enough to tuck beside anything,
 * the ship included. A container refuses the other things that open on a press
 * (another crate, a wreck, a trading post, a chest, a grave). A station refuses
 * anything placed or standing there. A decoration becomes a solid tile, so it
 * refuses everything — the ship too, or it would be walled in where it stands.
 */
export const PLACEMENT_BLOCKERS: Readonly<Record<PlacementFamily, ReadonlySet<Occupant>>> = {
  scanner: new Set<Occupant>(['scanner']),
  dynamite: new Set<Occupant>(['dynamite']),
  container: new Set<Occupant>(['container', 'wreck', 'tradingPost', 'chest', 'grave']),
  station: ANYTHING_BUT_THE_SHIP,
  decor: new Set<Occupant>(OCCUPANTS)
};

/** Whether any of these occupants refuses a thing of this family on the tile. */
export function isBlockedFor(family: PlacementFamily, occupants: ReadonlySet<Occupant>): boolean {
  const blockers = PLACEMENT_BLOCKERS[family];
  for (const occupant of occupants) if (blockers.has(occupant)) return true;
  return false;
}

/** The placement family a carried kind belongs to, or `null` for one never set down. */
export function placementFamily(kind: InventoryItemKind): PlacementFamily | null {
  if (kind === 'scanner' || kind === 'dynamite' || kind === 'container') return kind;
  if (isDeviceKind(kind)) return 'station';
  if (isDecorKind(kind)) return 'decor';
  return null;
}

export interface PlacementSite {
  explored: ReadonlySet<number>;
  /** Whether the target tile is open space the device can be dropped into. */
  open: boolean;
  /** Something this device refuses is already on the tile. */
  occupied: boolean;
  /** As many of this device are already deployed as the mine will hold. */
  full: boolean;
}

/** One device's five refusals, in the order `placementRefusal` asks them. */
export interface PlacementCopy {
  full: string;
  offMine: string;
  unexplored: string;
  blocked: string;
  occupied: string;
}

/** Why this tile cannot take the device, or `null` when it can. */
export function placementRefusal(x: number, y: number, site: PlacementSite, copy: PlacementCopy): string | null {
  if (site.full) return copy.full;
  if (!inMineBounds(x, y)) return copy.offMine;
  if (!site.explored.has(explorationIndex(x, y))) return copy.unexplored;
  if (!site.open) return copy.blocked;
  if (site.occupied) return copy.occupied;
  return null;
}

/** Copy for a yes/no question, where the wording is never shown. */
const UNWORDED: PlacementCopy = {full: 'full', offMine: 'offMine', unexplored: 'unexplored', blocked: 'blocked', occupied: 'occupied'};

/**
 * Whether this tile can take the device — `placementRefusal` reduced to a yes/no.
 * The overlay that previews where a carried device may go reuses this so the tint
 * can never disagree with the toast a press would earn.
 */
export function canPlaceDevice(x: number, y: number, site: PlacementSite): boolean {
  return placementRefusal(x, y, site, UNWORDED) === null;
}

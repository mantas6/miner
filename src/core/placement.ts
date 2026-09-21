// Where a carried device may be put down.
//
// Two things are deployed into the mine now — the survey scanner and a stick of
// dynamite — and both answer the same five questions in the same order: is there
// room for another one, is the tile part of the mine at all, has it been
// explored, is it clear of terrain, and is something already sitting on it.
//
// Only the wording differs, so the rule lives here once and each device brings
// its own copy. The refusals are phrased as the toast the player sees, which is
// what keeps a rule and its explanation from drifting apart.

import { MAX_WORLD_ROW, WORLD_W } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';

/** Inside the dug part of the world: not above the world, not the side walls. */
export function inMineBounds(x: number, y: number): boolean {
  return x >= 0 && x < WORLD_W && y >= 0 && y <= MAX_WORLD_ROW;
}

export interface PlacementSite {
  explored: ReadonlySet<number>;
  /** Whether the target tile is open space the device can be dropped into. */
  open: boolean;
  /** Something of the same kind is already deployed on this tile. */
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

/**
 * Whether this tile can take the device — the same five questions
 * `placementRefusal` asks, reduced to a yes/no. The overlay that previews where a
 * carried device may go reuses this so the tint can never disagree with the toast
 * a press would earn.
 */
export function canPlaceDevice(x: number, y: number, site: PlacementSite): boolean {
  return !site.full
    && inMineBounds(x, y)
    && site.explored.has(explorationIndex(x, y))
    && site.open
    && !site.occupied;
}

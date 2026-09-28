// Tile access facade over `state.world`.
//
// Every reader and writer of the terrain goes through one object instead of the
// ad-hoc `get`/`set`/`ensureWorldRow` closures that used to live in game.ts, so
// that lazy row generation, terrain-cache invalidation, and tile-diff
// bookkeeping all happen in exactly one place.

import { WORLD_W } from '../../shared/constants';
import { isTraversableTile } from '../core/movement';
import type { LandingCheck } from '../core/portal';
import { ensureWorldRow } from '../world/world';
import type { GameState, Tile } from '../core/types';

/**
 * The landing check a jump or a respawn asks before it drops the ship onto a
 * tile: open space, read from the live `state.world` at the time of asking. A
 * portal tile the mine has filled back in — a save that lost its dug-out hole,
 * a regenerated world — answers no, so the ship is never set down inside rock.
 */
export function canLandOn(state: Pick<GameState, 'world'>): LandingCheck {
  return (x, y) => x >= 0 && x < WORLD_W && isTraversableTile(ensureWorldRow(state.world, y)?.[x]);
}

/**
 * Reads outside the generated world answer with indestructible rock rather than
 * `undefined`. A fresh tile per call, because callers may damage what they read.
 */
function outOfBoundsTile(): Tile {
  return {type: 'rock', hp: 999};
}

export interface WorldGrid {
  /** The live tile grid. Rows outside the generated range are still absent. */
  readonly world: Tile[][];
  /** Tile at a coordinate, generating its row chunk on first access. */
  get(x: number, y: number): Tile;
  /** Commit a tile mutation, invalidating render caches and recording the diff. */
  set(x: number, y: number, tile: Tile): void;
  /** Generate the row chunk containing `y` so bulk readers can index it. */
  ensureRow(y: number): Tile[] | undefined;
}

export interface WorldGridOptions {
  state: Pick<GameState, 'world'>;
  /** Mark one tile's terrain cache dirty; only called when its type changed. */
  invalidateTerrain(x: number, y: number): void;
  /** Record a committed mutation for the tile diff. */
  onTileSet(x: number, y: number, tile: Tile): void;
}

export function createWorldGrid({state, invalidateTerrain, onTileSet}: WorldGridOptions): WorldGrid {
  return {
    get world() {
      return state.world;
    },
    get(x, y) {
      if (x < 0 || x >= WORLD_W) return outOfBoundsTile();
      return ensureWorldRow(state.world, y)?.[x] || outOfBoundsTile();
    },
    set(x, y, tile) {
      const row = ensureWorldRow(state.world, y);
      if (!row || x < 0 || x >= row.length) return;
      const previousType = row[x].type;
      row[x] = tile;
      if (previousType !== tile.type) invalidateTerrain(x, y);
      onTileSet(x, y, tile);
    },
    ensureRow(y) {
      return ensureWorldRow(state.world, y);
    }
  };
}

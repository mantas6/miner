import { isTraversableTile } from './movement';
import { tileKey as key } from '../../shared/tile-key';
import type { Tile } from './types';

export interface TileCoordinate {
  x: number;
  y: number;
}

const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * Incrementally expands the traversable air component and returns dormant
 * enemies touching it. Seeds normally need to join air already known reachable.
 */
export function expandReachableAir(
  world: Tile[][],
  reachableAir: Set<string>,
  seeds: TileCoordinate[],
  forceSeeds = false
): TileCoordinate[] {
  const queue: TileCoordinate[] = [];
  const exposed = new Map<string, TileCoordinate>();

  for (const seed of seeds) {
    if (!isTraversableTile(world[seed.y]?.[seed.x])) continue;
    const seedKey = key(seed.x, seed.y);
    const joinsReachableAir = DIRECTIONS.some(([dx, dy]) => reachableAir.has(key(seed.x + dx, seed.y + dy)));
    if (!forceSeeds && !reachableAir.has(seedKey) && !joinsReachableAir) continue;
    if (!reachableAir.has(seedKey)) reachableAir.add(seedKey);
    queue.push(seed);
  }

  // An array iterator re-reads the length on every step, so this also visits the
  // tiles pushed onto the queue below: a breadth-first walk without index maths.
  for (const current of queue) {
    for (const [dx, dy] of DIRECTIONS) {
      const x = current.x + dx;
      const y = current.y + dy;
      const tile = world[y]?.[x];
      if (!tile) continue;
      const tileKey = key(x, y);
      if (tile.type === 'enemy') {
        exposed.set(tileKey, {x, y});
      } else if (isTraversableTile(tile) && !reachableAir.has(tileKey)) {
        reachableAir.add(tileKey);
        queue.push({x, y});
      }
    }
  }

  return [...exposed.values()];
}

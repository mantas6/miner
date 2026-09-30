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

/**
 * How close, in tiles (Manhattan, the distance enemies aggro and bite by), a ship
 * has to come to a dormant cocoon to wake it — provided the cocoon has a way out
 * to it (`cocoonsInWakeRadius`). Two tiles gives a hatching fiend one step of
 * warning before it is alongside, instead of being drilled out asleep.
 */
export const COCOON_WAKE_RADIUS = 2;

/**
 * The dormant cocoons within `radius` (Manhattan) of `center` that have a
 * reachable air path: at least one side opens onto air already known connected to
 * the ship (`reachableAir`). A cocoon sealed in dirt or rock — however close — has
 * no way out and stays asleep; only drilling next to it (or into it) changes that.
 * Rows missing from `world` (not generated yet) hold nothing to wake.
 */
export function cocoonsInWakeRadius(
  world: Tile[][],
  reachableAir: ReadonlySet<string>,
  center: TileCoordinate,
  radius = COCOON_WAKE_RADIUS
): TileCoordinate[] {
  const woken: TileCoordinate[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    const reach = radius - Math.abs(dy);
    for (let dx = -reach; dx <= reach; dx++) {
      const x = center.x + dx;
      const y = center.y + dy;
      if (world[y]?.[x]?.type !== 'enemy') continue;
      if (DIRECTIONS.some(([ox, oy]) => reachableAir.has(key(x + ox, y + oy)))) woken.push({x, y});
    }
  }
  return woken;
}

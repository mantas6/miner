import { WORLD_W } from '../../shared/constants';

// Eight-tile blocks halve the chunk count along each axis (a quarter of the
// per-frame blits and cache lookups of the old four-tile grid) while a mined
// tile's rebuild stays small enough that drilling feedback remains immediate.
export const TERRAIN_CHUNK_TILES = 8;

/**
 * Chunks kept beyond the ones on screen, least recently used dropped first. At
 * eight tiles a side this holds about the same terrain area the old four-tile
 * grid's 32 spares did.
 */
export const MAX_EXTRA_CHUNKS = 8;

/**
 * Chunk columns spanning the world, plus one either side so a coordinate just
 * off a wall still maps to a key of its own rather than aliasing a neighbour row.
 */
const CHUNK_KEY_STRIDE = Math.ceil(WORLD_W / TERRAIN_CHUNK_TILES) + 2;

/**
 * Cached chunks are rebuilt whenever their resolution changes, so the zoom they
 * are cut for is quantised: a wheel glide crosses two or three steps instead of
 * invalidating the whole cache on every frame it moves.
 */
export const TERRAIN_CACHE_ZOOM_STEP = 0.5;

export function terrainChunkCoordinate(tile: number): number {
  return Math.floor(tile / TERRAIN_CHUNK_TILES);
}

/**
 * A chunk's numeric cache key: row-major on the chunk grid, so a lookup costs no
 * string building. Unique for every chunk column from one left of the world to
 * one right of it, and safe for any row the world can generate.
 */
export function terrainChunkKey(chunkX: number, chunkY: number): number {
  return chunkY * CHUNK_KEY_STRIDE + chunkX + 1;
}

export function terrainChunkKeyForTile(x: number, y: number): number {
  return terrainChunkKey(terrainChunkCoordinate(x), terrainChunkCoordinate(y));
}

/**
 * Offscreen pixels per world pixel for a cached chunk.
 *
 * The zoom is rounded *up* to the next step so a magnified chunk is never
 * upscaled on screen, and the result stays capped at CSS resolution: high-DPI
 * screens accept the same slight softness they always have rather than paying
 * several times the generation cost.
 */
export function terrainCacheScale(zoom: number, devicePixelsPerCssPx: number): number {
  const quantisedZoom = Math.ceil(Math.max(zoom, TERRAIN_CACHE_ZOOM_STEP) / TERRAIN_CACHE_ZOOM_STEP) * TERRAIN_CACHE_ZOOM_STEP;
  return quantisedZoom * Math.min(1, devicePixelsPerCssPx);
}

/**
 * The chunk cache's bookkeeping, apart from any canvas: a map ordered least- to
 * most-recently used, where `null` is a cached "nothing to draw here" result
 * rather than a miss.
 */
export class ChunkCache<T> {
  private readonly entries = new Map<number, T | null>();

  get size(): number {
    return this.entries.size;
  }

  has(key: number): boolean {
    return this.entries.has(key);
  }

  /** The cached value, building it on a miss; either way it becomes the most recent. */
  use(key: number, build: () => T | null): T | null {
    let value: T | null;
    if (this.entries.has(key)) {
      value = this.entries.get(key) ?? null;
      // Re-inserting moves the key to the most-recently-used end of the map.
      this.entries.delete(key);
    } else {
      value = build();
    }
    this.entries.set(key, value);
    return value;
  }

  delete(key: number): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  /** Drop least-recently-used entries until at most `limit` remain. */
  trim(limit: number): void {
    for (const key of this.entries.keys()) {
      if (this.entries.size <= limit) return;
      this.entries.delete(key);
    }
  }
}

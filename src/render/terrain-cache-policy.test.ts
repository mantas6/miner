import { describe, expect, it } from 'vitest';
import { MAX_WORLD_ROW, WORLD_W } from '../../shared/constants';
import {
  ChunkCache,
  terrainCacheScale,
  terrainChunkCoordinate,
  terrainChunkKey,
  terrainChunkKeyForTile,
  TERRAIN_CHUNK_TILES
} from './terrain-cache-policy';

describe('chunk addressing', () => {
  it('groups tiles into fixed blocks', () => {
    expect(TERRAIN_CHUNK_TILES).toBe(8);
    expect(terrainChunkCoordinate(0)).toBe(0);
    expect(terrainChunkCoordinate(TERRAIN_CHUNK_TILES - 1)).toBe(0);
    expect(terrainChunkCoordinate(TERRAIN_CHUNK_TILES)).toBe(1);
    expect(terrainChunkCoordinate(-1)).toBe(-1);
    expect(terrainChunkKeyForTile(TERRAIN_CHUNK_TILES + 1, TERRAIN_CHUNK_TILES * 2)).toBe(terrainChunkKey(1, 2));
  });

  it('gives every chunk from one column off either wall its own numeric key', () => {
    const lastColumn = terrainChunkCoordinate(WORLD_W - 1) + 1;
    const keys = new Set<number>();
    let count = 0;
    for (let chunkY = -1; chunkY < 40; chunkY++) {
      for (let chunkX = -1; chunkX <= lastColumn; chunkX++) {
        keys.add(terrainChunkKey(chunkX, chunkY));
        count++;
      }
    }
    expect(keys.size).toBe(count);
  });

  it('stays an exact integer for the deepest row the world can generate', () => {
    const key = terrainChunkKeyForTile(WORLD_W - 1, MAX_WORLD_ROW);
    expect(Number.isSafeInteger(key)).toBe(true);
    expect(key).not.toBe(terrainChunkKeyForTile(WORLD_W - 1 - TERRAIN_CHUNK_TILES, MAX_WORLD_ROW));
  });
});

describe('ChunkCache', () => {
  it('builds once per key and caches a blank result as a hit', () => {
    const cache = new ChunkCache<string>();
    let builds = 0;
    const build = (value: string | null) => () => { builds++; return value; };

    expect(cache.use(1, build('a'))).toBe('a');
    expect(cache.use(1, build('other'))).toBe('a');
    expect(cache.use(2, build(null))).toBeNull();
    expect(cache.use(2, build('late'))).toBeNull();
    expect(builds).toBe(2);
    expect(cache.has(2)).toBe(true);
  });

  it('evicts the least recently used chunks first when trimmed', () => {
    const cache = new ChunkCache<number>();
    for (const key of [1, 2, 3, 4]) cache.use(key, () => key);
    // Touching 1 and 3 makes 2 then 4 the oldest.
    cache.use(1, () => -1);
    cache.use(3, () => -1);

    cache.trim(3);
    expect(cache.has(2)).toBe(false);
    expect([1, 3, 4].every(key => cache.has(key))).toBe(true);

    cache.trim(2);
    expect(cache.has(4)).toBe(false);
    expect(cache.has(1) && cache.has(3)).toBe(true);
    expect(cache.size).toBe(2);

    // A trim at or above the size keeps everything.
    cache.trim(5);
    expect(cache.size).toBe(2);
  });

  it('forgets a dropped chunk so the next use rebuilds it', () => {
    const cache = new ChunkCache<string>();
    cache.use(7, () => 'old');
    cache.delete(7);
    expect(cache.use(7, () => 'new')).toBe('new');
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe('terrainCacheScale', () => {
  it('caps at CSS resolution while unzoomed, whatever the display density', () => {
    expect(terrainCacheScale(1, 1)).toBe(1);
    expect(terrainCacheScale(1, 3)).toBe(1);
  });

  it('follows a canvas smaller than its CSS box down', () => {
    expect(terrainCacheScale(1, 0.5)).toBe(0.5);
  });

  it('cuts magnified chunks at or above their on-screen size', () => {
    expect(terrainCacheScale(2, 1)).toBe(2);
    expect(terrainCacheScale(1.2, 1)).toBeGreaterThanOrEqual(1.2);
  });

  it('quantises the zoom, so an easing glide rebuilds the cache a few times, not every frame', () => {
    const glide = [1, 1.05, 1.1, 1.2, 1.35, 1.45, 1.5].map(zoom => terrainCacheScale(zoom, 1));

    expect(new Set(glide).size).toBe(2);
  });

  it('never asks for less than the widest view needs', () => {
    expect(terrainCacheScale(0.5, 1)).toBe(0.5);
    expect(terrainCacheScale(0.1, 1)).toBe(0.5);
  });
});

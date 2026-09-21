import { describe, expect, it } from 'vitest';
import { MAX_SAVED_TILE_ENTRIES, WORLD_CHUNK_ROWS } from '../../shared/constants';
import { tileKey } from '../../shared/tile-key';
import type { Tile, TileEntry } from '../../shared/world-schema';
import {
  applyTileEntries,
  capTileEntries,
  createTileDiff,
  parseTileEntries,
  recordTileDiff,
  tileDiffEntries
} from './tile-diff';
import { makeTile } from './world';

const air: Tile = {type: 'air'};

describe('accumulating a diff', () => {
  it('records one entry per coordinate, last writer winning', () => {
    const diff = createTileDiff();

    recordTileDiff(diff, {x: 1, y: 2, tile: air});
    expect(diff.get(tileKey(1, 2))).toEqual({x: 1, y: 2, tile: air});

    recordTileDiff(diff, {x: 1, y: 2, tile: {type: 'dirt', hp: 1, maxHp: 2}});
    expect(diff.get(tileKey(1, 2))?.tile).toEqual({type: 'dirt', hp: 1, maxHp: 2});
    expect(diff.size).toBe(1);
  });

  it('keeps entries oldest-first, even when a coordinate is re-dug', () => {
    const diff = createTileDiff([
      {x: 1, y: 2, tile: air},
      {x: 3, y: 4, tile: air},
      {x: 1, y: 2, tile: {type: 'dirt', hp: 1, maxHp: 1}}
    ]);

    expect(tileDiffEntries(diff)).toEqual([
      {x: 1, y: 2, tile: {type: 'dirt', hp: 1, maxHp: 1}},
      {x: 3, y: 4, tile: air}
    ]);
  });

  it('round-trips valuables and their removal through entries', () => {
    const entries: TileEntry[] = [
      {x: 5, y: 41, tile: air},
      {x: 6, y: 41, tile: {type: 'ore', ore: {name: 'Gold', color: '#ffd65c', value: 70, min: 152, max: 602, chance: 0.04}, hp: 2, maxHp: 5}},
      {x: 7, y: 740, tile: {type: 'hazard', hp: 7, maxHp: 7}}
    ];
    const diff = createTileDiff(entries);
    expect(tileDiffEntries(diff)).toEqual(entries);

    recordTileDiff(diff, {x: 7, y: 740, tile: air});
    expect(tileDiffEntries(diff).at(-1)).toEqual({x: 7, y: 740, tile: air});
  });

  it('round-trips a placed decoration tile through entries', () => {
    const entries: TileEntry[] = [{x: 8, y: 12, tile: {type: 'decor', decor: 'lampPanel'}}];
    expect(tileDiffEntries(createTileDiff(entries))).toEqual(entries);
  });
});

describe('validating stored entries', () => {
  it('accepts a well-formed list and normalizes a legacy dormant enemy', () => {
    expect(parseTileEntries([{x: 2, y: 30, tile: {type: 'enemy', hp: 4, maxHp: 4}}])).toEqual([
      {x: 2, y: 30, tile: {type: 'enemy', kind: 'tunnelFiend', hp: 4, maxHp: 4}}
    ]);
  });

  it.each([
    ['a missing payload', undefined],
    ['a non-array', {x: 1, y: 2, tile: air}],
    ['an unknown tile type', [{x: 1, y: 2, tile: {type: 'lava'}}]],
    ['an out-of-range column', [{x: -1, y: 2, tile: air}]],
    ['an ore tile without its ore', [{x: 1, y: 2, tile: {type: 'ore', hp: 1, maxHp: 1}}]]
  ])('drops the whole payload for %s', (_name, value) => {
    expect(parseTileEntries(value)).toEqual([]);
  });
});

describe('capping a save', () => {
  const entry = (index: number): TileEntry => ({x: index % 90, y: 10 + index, tile: air});

  it('passes a list within budget through untouched', () => {
    const entries = [entry(1), entry(2)];
    expect(capTileEntries(entries, 4)).toEqual(entries);
  });

  it('keeps the newest mutations and forgets the oldest', () => {
    expect(capTileEntries([entry(1), entry(2), entry(3)], 2)).toEqual([entry(2), entry(3)]);
  });

  it('defaults to the shared save budget', () => {
    const entries = Array.from({length: MAX_SAVED_TILE_ENTRIES + 5}, (_, index) => entry(index));
    const capped = capTileEntries(entries);
    expect(capped).toHaveLength(MAX_SAVED_TILE_ENTRIES);
    expect(capped.at(-1)).toEqual(entries.at(-1));
  });
});

describe('applying entries to a world', () => {
  it('generates the row chunk each entry needs and leaves the rest ungenerated', () => {
    const world: Tile[][] = [];

    applyTileEntries(world, [{x: 8, y: 1205, tile: air}]);

    expect(world[1205][8]).toEqual(air);
    // Only the containing chunk was generated, and its untouched tiles are the
    // deterministic terrain the seed produces.
    expect(world[1205][9]).toEqual(makeTile(9, 1205));
    expect(world[1205 - WORLD_CHUNK_ROWS]).toBeUndefined();
  });

  it('ignores coordinates outside the world', () => {
    const world: Tile[][] = [];

    applyTileEntries(world, [{x: 200, y: 40, tile: air}, {x: 1, y: -3, tile: air}]);

    expect(world[40][1]).toEqual(makeTile(1, 40));
    expect(world.some(row => row?.includes(air))).toBe(false);
  });
});

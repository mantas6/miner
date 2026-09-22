import { describe, expect, it } from 'vitest';
import { WORLD_W } from './constants';
import { encodeExploration, explorationIndex, isTileExplored, mergeExploration, revealFootprint } from './exploration-codec';

describe('persistent fog exploration', () => {
  it('reveals an exact initial 3x3 underground footprint', () => {
    const explored = new Set<number>();
    const added = revealFootprint(explored, 20, 20, 3);

    expect(added).toHaveLength(9);
    for (let y = 19; y <= 21; y++) for (let x = 19; x <= 21; x++) {
      expect(isTileExplored(explored, x, y)).toBe(true);
    }
    expect(isTileExplored(explored, 18, 20)).toBe(false);
  });

  it('honors 4x4 and larger levels with deterministic even anchoring', () => {
    const four = new Set<number>();
    revealFootprint(four, 20, 20, 4);
    expect(four).toHaveLength(16);
    expect(isTileExplored(four, 19, 19)).toBe(true);
    expect(isTileExplored(four, 22, 22)).toBe(true);
    expect(isTileExplored(four, 18, 20)).toBe(false);

    const five = new Set<number>();
    revealFootprint(five, 20, 20, 5);
    expect(five).toHaveLength(25);
    expect(isTileExplored(five, 18, 18)).toBe(true);
    expect(isTileExplored(five, 22, 22)).toBe(true);
  });

  it('range-encodes sparse paths compactly and unions peer exploration', () => {
    const indexes = [explorationIndex(10, 10), explorationIndex(11, 10), explorationIndex(12, 10), explorationIndex(10, 11)];
    const encoded = encodeExploration(indexes);
    expect(encoded).toBe(`${10 * WORLD_W + 10}-${10 * WORLD_W + 12},${11 * WORLD_W + 10}`);

    const host = new Set<number>([explorationIndex(9, 10)]);
    expect(mergeExploration(host, encoded)).toEqual(indexes);
    expect(host).toHaveLength(5);
    expect(mergeExploration(host, encoded)).toEqual([]);
  });

  it('fogs the terrain above the cavern until the ship reveals it', () => {
    expect(isTileExplored(new Set(), 0, 0)).toBe(false);
    expect(isTileExplored(new Set(), 20, 20)).toBe(false);

    const explored = new Set<number>();
    revealFootprint(explored, 0, 0, 3);
    expect(isTileExplored(explored, 0, 0)).toBe(true);
  });

  it('round-trips explored terrain below 10,000 m', () => {
    const deep = explorationIndex(45, 1205);
    const encoded = encodeExploration([deep, deep + 1]);
    const restored = new Set<number>();

    expect(mergeExploration(restored, encoded)).toEqual([deep, deep + 1]);
    expect(restored).toEqual(new Set([deep, deep + 1]));
  });
});

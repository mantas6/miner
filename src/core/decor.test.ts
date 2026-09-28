// The pure decoration rules: the stack-kind ↔ tile-id mapping, and why a tile can
// or cannot take a decoration. The sim that spends the bay and writes the tile is
// game/decor.test.ts; this covers only the DOM-free helpers.

import { describe, expect, it } from 'vitest';
import { explorationIndex } from '../../shared/exploration-codec';
import { decorIdForKind, decorKindForId, decorPlacementRefusal } from './decor';
import type { DecorId } from './inventory';

const DECOR_IDS: DecorId[] = ['steelPlate', 'stoneBlock', 'copperTrim', 'lampPanel'];

describe('decor kind mapping', () => {
  it('round-trips every decoration id through its stack kind', () => {
    for (const id of DECOR_IDS) {
      expect(decorKindForId(id)).toBe(`decor:${id}`);
      expect(decorIdForKind(decorKindForId(id))).toBe(id);
    }
  });
});

describe('decorPlacementRefusal', () => {
  const x = 40;
  const y = 100;
  const explored = new Set([explorationIndex(x, y)]);

  it('accepts cleared, explored ground', () => {
    expect(decorPlacementRefusal(x, y, {explored, open: true})).toBeNull();
  });

  it('refuses a tile that has not been explored', () => {
    expect(decorPlacementRefusal(x, y, {explored: new Set(), open: true}))
      .toContain('already explored');
  });

  it('refuses a tile that is not cleared space', () => {
    expect(decorPlacementRefusal(x, y, {explored, open: false}))
      .toContain('cleared space');
  });

  it('refuses a tile outside the mine', () => {
    expect(decorPlacementRefusal(-1, y, {explored, open: true}))
      .toContain('underground');
  });
});

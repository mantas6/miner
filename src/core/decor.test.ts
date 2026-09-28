// The pure decoration rules: the stack-kind ↔ tile-id mapping, and why a tile can
// or cannot take a decoration. The sim that spends the bay and writes the tile is
// game/decor.test.ts; this covers only the DOM-free helpers.

import { describe, expect, it } from 'vitest';
import { explorationIndex } from '../../shared/exploration-codec';
import { decorIdForKind, decorKindForId, decorPlacementRefusal } from './decor';
import type { DecorId } from './inventory';
import type { Occupant } from './placement';

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
  const occupants = new Set<Occupant>();

  it('accepts cleared, explored ground', () => {
    expect(decorPlacementRefusal(x, y, {explored, open: true, occupants})).toBeNull();
  });

  it('refuses a tile that has not been explored', () => {
    expect(decorPlacementRefusal(x, y, {explored: new Set(), open: true, occupants}))
      .toContain('already explored');
  });

  it('refuses a tile that is not cleared space', () => {
    expect(decorPlacementRefusal(x, y, {explored, open: false, occupants}))
      .toContain('cleared space');
  });

  it('refuses a tile outside the mine', () => {
    expect(decorPlacementRefusal(-1, y, {explored, open: true, occupants}))
      .toContain('underground');
  });

  // Which occupants refuse a decoration is the cross-kind matrix in placement.test.ts.
  it('refuses a tile something already stands on, the ship included', () => {
    expect(decorPlacementRefusal(x, y, {explored, open: true, occupants: new Set(['player'])}))
      .toContain('already occupies');
  });
});

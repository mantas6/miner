import { describe, expect, it } from 'vitest';
import { DECOR_HP, MAX_WORLD_ROW, ORES, WORLD_STATE_VERSION } from './constants';
import {
  emptyWorldState,
  oreSchema,
  parseTile,
  parseWorldState,
  tileSchema
} from './world-schema';

describe('valuable tables', () => {
  // The generator embeds these entries in tiles that must survive validation on
  // both sides; a table the schema rejects would silently drop ore mutations.
  it('accepts every shipped ore', () => {
    for (const ore of ORES) expect(oreSchema.safeParse(ore).success).toBe(true);
  });
});

describe('tiles', () => {
  it('drops fields that are not part of a tile', () => {
    expect(parseTile({ type: 'rock', hp: 999, maxHp: 12, note: 'x' })).toEqual({ type: 'rock', hp: 999 });
  });

  it('normalizes a dormant enemy of unknown vintage to the weakest kind', () => {
    expect(parseTile({ type: 'enemy', hp: 4, maxHp: 4 })).toEqual({ type: 'enemy', kind: 'tunnelFiend', hp: 4, maxHp: 4 });
  });

  it('accepts a decoration tile and rejects an unknown decor id', () => {
    // Durability is optional on the wire: a decor tile saved before it existed
    // defaults to DECOR_HP so the whole payload still validates.
    expect(parseTile({ type: 'decor', decor: 'lampPanel' })).toEqual({ type: 'decor', decor: 'lampPanel', hp: DECOR_HP, maxHp: DECOR_HP });
    expect(parseTile({ type: 'decor', decor: 'steelPlate', hp: 12, maxHp: DECOR_HP })).toEqual({ type: 'decor', decor: 'steelPlate', hp: 12, maxHp: DECOR_HP });
    expect(parseTile({ type: 'decor', decor: 'gilded' })).toBeNull();
    expect(parseTile({ type: 'decor' })).toBeNull();
  });

  it('rejects hp below zero and maxHp below one', () => {
    expect(parseTile({ type: 'dirt', hp: -1, maxHp: 4 })).toBeNull();
    expect(parseTile({ type: 'dirt', hp: 0, maxHp: 0 })).toBeNull();
    expect(tileSchema.safeParse({ type: 'dirt', hp: 0, maxHp: 1 }).success).toBe(true);
  });
});

describe('persisted world state', () => {
  const tile = { x: 3, y: 7, tile: { type: 'dirt', hp: 2, maxHp: 2 } };

  it('accepts a pristine and a populated world', () => {
    expect(parseWorldState(emptyWorldState())).toEqual(emptyWorldState());
    expect(parseWorldState({ ...emptyWorldState(), initialized: true, tiles: [tile] })).toMatchObject({ tiles: [tile] });
  });

  it('rejects duplicate coordinates, a non-empty pristine world, and a foreign version', () => {
    expect(parseWorldState({ ...emptyWorldState(), initialized: true, tiles: [tile, tile] })).toBeNull();
    expect(parseWorldState({ ...emptyWorldState(), tiles: [tile] })).toBeNull();
    expect(parseWorldState({ ...emptyWorldState(), version: WORLD_STATE_VERSION + 1 })).toBeNull();
    expect(parseWorldState({ ...emptyWorldState(), revision: 0 })).toBeNull();
  });

  it('rejects tiles outside the world', () => {
    expect(parseWorldState({ ...emptyWorldState(), initialized: true, tiles: [{ ...tile, y: MAX_WORLD_ROW + 1 }] })).toBeNull();
    expect(parseWorldState({ ...emptyWorldState(), initialized: true, tiles: [{ ...tile, x: -1 }] })).toBeNull();
  });
});

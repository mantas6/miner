import { describe, expect, it, vi } from 'vitest';
import type { Tile } from '../core/types';
import { createWorldGrid } from './world-grid';

describe('world grid render hooks', () => {
  function grid() {
    const state = {world: [] as Tile[][]};
    const invalidateTerrain = vi.fn();
    const refreshTileDamage = vi.fn();
    const onTileSet = vi.fn();
    return {grid: createWorldGrid({state, invalidateTerrain, refreshTileDamage, onTileSet}), invalidateTerrain, refreshTileDamage};
  }

  it('reports a damage-only write for the crack overlay without dropping the cached terrain', () => {
    const {grid: world, invalidateTerrain, refreshTileDamage} = grid();
    world.set(10, 40, {type: 'dirt', hp: 1, maxHp: 5});
    invalidateTerrain.mockClear();
    refreshTileDamage.mockClear();

    world.set(10, 40, {type: 'dirt', hp: 0.5, maxHp: 5});
    expect(invalidateTerrain).not.toHaveBeenCalled();
    expect(refreshTileDamage).toHaveBeenCalledWith(10, 40);
  });

  it('reports a type change to both the terrain cache and the crack overlay', () => {
    const {grid: world, invalidateTerrain, refreshTileDamage} = grid();
    world.set(10, 40, {type: 'dirt', hp: 1, maxHp: 5});
    world.set(10, 40, {type: 'air'});
    expect(invalidateTerrain).toHaveBeenLastCalledWith(10, 40);
    expect(refreshTileDamage).toHaveBeenLastCalledWith(10, 40);
  });
});

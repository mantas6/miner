import { describe, expect, it, vi } from 'vitest';
import { createPlacedContainer } from '../core/cargo-container';
import { addItem } from '../core/inventory';
import { createInitialState } from '../core/state';
import { TELEPORTER_ITEM } from '../core/teleporter';
import { DYNAMITE_ITEM } from '../core/dynamite';
import { createTileDiff } from './tile-diff';
import { confirmWorldStateReset, resetWorldTerrain, WORLD_STATE_RESET_CONFIRMATION } from './world-state';

describe('world state reset', () => {
  it('requires explicit, world-specific confirmation', () => {
    const confirm = vi.fn(() => false);
    expect(confirmWorldStateReset(confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(WORLD_STATE_RESET_CONFIRMATION);
    expect(WORLD_STATE_RESET_CONFIRMATION).toContain('Player cash, upgrades, cargo bay, stats, settings, and ship condition are preserved');
  });

  it('regenerates terrain/entities/view state while preserving player progression and inventory', () => {
    const state = createInitialState();
    Object.assign(state.player, { fuel: 17, hull: 23, fuelMax: 400, hullMax: 300, cargoMax: 80, drill: 40 });
    state.player.inventory = addItem(
      addItem(state.player.inventory, DYNAMITE_ITEM, 2)!,
      TELEPORTER_ITEM,
      8
    )!;
    state.cash = 9999;
    state.stats.maxDepth = 900;
    state.world = [[{type:'air'}]];
    state.soloTileDiff = createTileDiff([{x:1, y:60, tile:{type:'air'}}]);
    state.enemies = [{id:1,kind:'tunnelFiend',x:1,y:1,drawX:1,drawY:1,hp:2,maxHp:2,alive:true,moveTick:0,biteTick:0,flash:0}];
    state.exploredTiles.add(400);
    state.extractionPhase = 'returning';
    state.teleportReturnPosition = {x: 17, y: 200};
    state.cargoContainers = [createPlacedContainer(12, 300)];
    const playerBefore = structuredClone(state.player);
    const statsBefore = structuredClone(state.stats);

    resetWorldTerrain(state);

    expect(state.world).toEqual([]);
    // The dug-out blocks go with the terrain, or the next restart would put the
    // old tunnels back into the fresh mine.
    expect(state.soloTileDiff.size).toBe(0);
    expect(state.enemies).toEqual([]);
    expect(state.exploredTiles.size).toBe(0);
    // A crate belongs to the mine it was left in, not to the ship.
    expect(state.cargoContainers).toEqual([]);
    expect(state.extractionPhase).toBe('none');
    expect(state.teleportReturnPosition).toBeNull();
    expect(state.cash).toBe(9999);
    expect(state.stats).toEqual(statsBefore);
    expect(state.player).toMatchObject({ ...playerBefore, x:45, y:2, drawX:45, drawY:2 });
  });
});

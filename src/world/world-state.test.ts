import { describe, expect, it, vi } from 'vitest';
import { HOME_ROW, HOME_X } from '../../shared/constants';
import { createPlacedContainer } from '../core/cargo-container';
import { addItem, createInventory } from '../core/inventory';
import { ITEM_CATALOG } from '../core/items';
import { createPortal } from '../core/stations';
import { createWreck } from '../core/wreck';
import { createInitialState } from '../core/state';
import { TELEPORTER_ITEM } from '../core/teleporter';
import { DYNAMITE_ITEM } from '../core/dynamite';
import { createTileDiff, tileDiffEntries } from './tile-diff';
import { ensureWorldRow, makeTile } from './world';
import { confirmWorldStateReset, resetWorldTerrain, WORLD_STATE_RESET_CONFIRMATION } from './world-state';

describe('world state reset', () => {
  it('requires explicit, world-specific confirmation', () => {
    const confirm = vi.fn(() => false);
    expect(confirmWorldStateReset(confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(WORLD_STATE_RESET_CONFIRMATION);
    expect(WORLD_STATE_RESET_CONFIRMATION).toContain('player cash, upgrades, cargo bay, stats, settings, and ship condition are preserved');
    // It says what happens to the things standing in the mine, not just the rock.
    expect(WORLD_STATE_RESET_CONFIRMATION).toContain('wrecks');
    expect(WORLD_STATE_RESET_CONFIRMATION).toContain('Stations and portals stay where they stand');
  });

  it('regenerates terrain/entities/view state while preserving player progression and inventory', () => {
    const state = createInitialState();
    Object.assign(state.player, { fuel: 17, hull: 23, fuelMax: 400, hullMax: 300, cargoMax: 80, drill: 40 });
    state.player.inventory = addItem(
      addItem(state.player.inventory, DYNAMITE_ITEM, 2),
      TELEPORTER_ITEM,
      8
    );
    state.cash = 9999;
    state.stats.maxDepth = 900;
    state.world = [[{type:'air'}]];
    state.tileDiff = createTileDiff([{x:1, y:60, tile:{type:'air'}}]);
    state.enemies = [{id:1,kind:'tunnelFiend',x:1,y:1,drawX:1,drawY:1,hp:2,maxHp:2,alive:true,moveTick:0,biteTick:0,flash:0,origin:{x:1,y:1}}];
    state.exploredTiles.add(400);
    state.cargoContainers = [createPlacedContainer(12, 300)];
    state.chestLedger = {'41,44': []};
    const playerBefore = structuredClone(state.player);
    const statsBefore = structuredClone(state.stats);

    resetWorldTerrain(state);

    // The seeded stations stand in the home cavern, open space in the fresh mine
    // too, so nothing needs carving and no row is generated ahead of time.
    expect(state.world).toEqual([]);
    // The dug-out blocks go with the terrain, or the next restart would put the
    // old tunnels back into the fresh mine.
    expect(state.tileDiff.size).toBe(0);
    expect(state.enemies).toEqual([]);
    expect(state.exploredTiles.size).toBe(0);
    // A crate belongs to the mine it was left in, not to the ship.
    expect(state.cargoContainers).toEqual([]);
    expect(state.cash).toBe(9999);
    // A chest looted bare stays looted: it is player history, like the trade ledger.
    expect(state.chestLedger).toEqual({'41,44': []});
    expect(state.stats).toEqual(statsBefore);
    expect(state.player).toMatchObject({ ...playerBefore, x:HOME_X, y:HOME_ROW, drawX:HOME_X, drawY:HOME_ROW });
  });

  it('drops the wrecks, keeps every station, and carves the tile under one set down in rock', () => {
    const state = createInitialState();
    const seeded = state.stations.length;
    // A portal in a tunnel: its tile is rock in the regenerated mine.
    expect(makeTile(30, 200).type).not.toBe('air');
    state.stations.push(createPortal(30, 200, 'Deep'));
    state.wrecks = [createWreck(12, 300, addItem(createInventory(), ITEM_CATALOG['upgrade:tank:1']))];

    resetWorldTerrain(state);

    expect(state.wrecks).toEqual([]);
    expect(state.stations).toHaveLength(seeded + 1);
    expect(tileDiffEntries(state.tileDiff)).toEqual([{x: 30, y: 200, tile: {type: 'air'}}]);
    // The carve is live at once, not only after the next restart rebuilds the world.
    expect(ensureWorldRow(state.world, 200)?.[30]).toEqual({type: 'air'});
  });
});

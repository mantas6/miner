// The per-frame publish: the objective's career inputs (depth record, base, exits),
// and the Info screen's trading-post rows — posts whose tile has been explored,
// refreshed as the map grows or the record deepens.

import { afterEach, describe, expect, it } from 'vitest';
import { ORES, START_Y, WORLD_W } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';
import { addItem, createInventory, oreItem } from '../core/inventory';
import { createInitialState } from '../core/state';
import { createPortal, homeExtractor } from '../core/stations';
import { nth } from '../test-narrowing';
import { uiStore } from '../ui/store';
import { tradingPostsInRange } from '../world/world';
import type { HudReadouts } from './readouts';
import { createAudioStub } from './test-support';
import { createUiSync } from './ui-sync';

const pristine = {...uiStore.getState()};
afterEach(() => { uiStore.setState(pristine); });

const readouts: HudReadouts = {sync() {}, reset() {}, fuelExit: null};

function setup(stub: HudReadouts = readouts) {
  const state = createInitialState();
  const sync = createUiSync({state, audio: createAudioStub(), readouts: stub, canLand: () => true});
  return {state, sync};
}

describe('objective inputs', () => {
  it('names the band below the career record at home, not the first one', () => {
    const {state, sync} = setup();
    state.player.equipment = ['upgrade:tank:1', null];
    state.stats.scannersObtained = 1;
    const post = nth(tradingPostsInRange(0, 0, WORLD_W - 1, START_Y + 400), 0);
    state.stats.maxDepth = Math.max(900, (post.y - START_Y) * 10);
    state.exploredTiles.add(explorationIndex(post.x, post.y));
    sync.sync();
    const objective = uiStore.getState().hud.objective;
    expect(objective).toMatch(/^Objective: dig toward \w+ around \d+ m while keeping fuel for the trip home\.$/);
    expect(objective).not.toContain('Iron around 30 m');
  });

  it('sends a ship at home with the base running dry to feed the extractor', () => {
    const {state, sync} = setup();
    const base = homeExtractor(state.stations)!;
    base.fuel = 10;
    base.coal = 0;
    state.player.inventory = addItem(createInventory(), oreItem(ORES.find(ore => ore.name === 'Coal')!), 3);
    sync.sync();
    expect(uiStore.getState().hud.objective).toBe('Objective: load the 3 coal aboard into the Fuel Extractor.');
  });

  it('points a ship low on fuel at the portal the reserve is priced to', () => {
    const portal = createPortal(20, START_Y + 40, 'Deep');
    const {state, sync} = setup({sync() {}, reset() {}, fuelExit: portal});
    state.player.y = START_Y + 50;
    state.player.fuel = 1;
    sync.sync();
    expect(uiStore.getState().hud.objective).toBe('Objective: fly to Portal "Deep" and jump home to refuel.');
  });
});

describe('trading posts found', () => {
  const posts = tradingPostsInRange(0, 0, WORLD_W - 1, START_Y + 400).sort((a, b) => a.y - b.y || a.x - b.x);
  const first = nth(posts, 0);
  const second = nth(posts, 1);
  const depthOf = (y: number) => (y - START_Y) * 10;

  it('lists explored posts down to the career record, refreshing as the map grows', () => {
    const {state, sync} = setup();
    sync.syncInfoDetails(true);
    expect(uiStore.getState().postRows).toEqual([]);

    // Seen, but the record says the ship never got that deep: not yet.
    state.exploredTiles.add(explorationIndex(first.x, first.y));
    sync.syncInfoDetails();
    expect(uiStore.getState().postRows).toEqual([]);

    state.stats.maxDepth = depthOf(first.y);
    sync.syncInfoDetails();
    expect(uiStore.getState().postRows).toEqual([{x: first.x, y: first.y, depthMeters: depthOf(first.y)}]);

    state.stats.maxDepth = depthOf(second.y);
    state.exploredTiles.add(explorationIndex(second.x, second.y));
    sync.syncInfoDetails();
    expect(uiStore.getState().postRows.map(row => [row.x, row.y])).toEqual([[first.x, first.y], [second.x, second.y]]);
  });

  it('keeps the rows when nothing moved, and starts over on a fresh map', () => {
    const {state, sync} = setup();
    state.stats.maxDepth = depthOf(first.y);
    state.exploredTiles.add(explorationIndex(first.x, first.y));
    sync.syncInfoDetails(true);
    const rows = uiStore.getState().postRows;
    sync.syncInfoDetails();
    expect(uiStore.getState().postRows).toBe(rows);

    state.exploredTiles = new Set();
    sync.syncInfoDetails();
    expect(uiStore.getState().postRows).toEqual([]);
  });
});

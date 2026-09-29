// The Info screen's trading-post rows, as the per-frame publish builds them: posts
// whose tile has been explored, refreshed as the map grows or the record deepens.

import { afterEach, describe, expect, it } from 'vitest';
import { START_Y, WORLD_W } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';
import { createInitialState } from '../core/state';
import { nth } from '../test-narrowing';
import { uiStore } from '../ui/store';
import { tradingPostsInRange } from '../world/world';
import type { HudReadouts } from './readouts';
import { createAudioStub } from './test-support';
import { createUiSync } from './ui-sync';

const pristine = {...uiStore.getState()};
afterEach(() => { uiStore.setState(pristine); });

const readouts: HudReadouts = {sync() {}, reset() {}};

function setup() {
  const state = createInitialState();
  const sync = createUiSync({state, audio: createAudioStub(), readouts, canLand: () => true});
  return {state, sync};
}

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

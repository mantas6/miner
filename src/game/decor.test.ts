// Arming a carried decoration and setting it down as a tile.
//
// The rules themselves are core/decor.test.ts; what is checked here is the wiring:
// the cargo bay pays for a placement, the tile diff records it, station tiles are
// refused, and an armed pointer is stood down by everything that should stand it
// down. It mirrors scanner-devices.test.ts, since a decoration shares the same
// two-press placement gesture — it is just a tile rather than a tracked device.

import { describe, expect, it } from 'vitest';
import { STATIONS } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';
import { addItem, countItem, createInventory, type DecorKind } from '../core/inventory';
import { itemForKind } from '../core/items';
import { createInitialState } from '../core/state';
import type { GameState } from '../core/types';
import { createDecor, type DecorSim } from './decor';
import { createAudioStub, createFakeGrid, createToastLog, type AudioStub, type FakeGrid } from './test-support';

const STEEL: DecorKind = 'decor:steelPlate';

interface Harness {
  state: GameState;
  decor: DecorSim;
  grid: FakeGrid;
  audio: AudioStub;
  toasts: ReturnType<typeof createToastLog>;
  armedUi: (DecorKind | null)[];
}

/** A ship parked in cleared, explored ground with `carried` steel plates aboard. */
function harness(carried = 1): Harness {
  const state = createInitialState();
  if (carried > 0) state.player.inventory = addItem(createInventory(), itemForKind(STEEL), carried);
  state.exploredTiles.add(explorationIndex(40, 100));
  const grid = createFakeGrid();
  const audio = createAudioStub();
  const toasts = createToastLog();
  const armedUi: (DecorKind | null)[] = [];
  const decor = createDecor({
    state,
    grid,
    audio,
    toast: toasts.toast,
    saveProgress: () => {},
    setArmedUi: kind => armedUi.push(kind)
  });
  return {state, decor, grid, audio, toasts, armedUi};
}

describe('arming a decoration', () => {
  it('arms from the slot, tells the UI, and stands down on a second press', () => {
    const h = harness();

    h.decor.toggleArmed(STEEL);
    expect(h.decor.armed).toBe(STEEL);
    expect(h.armedUi).toEqual([STEEL]);
    expect(h.toasts.saw('press a mapped tile')).toBe(true);

    h.decor.toggleArmed(STEEL);
    expect(h.decor.armed).toBeNull();
    expect(h.armedUi).toEqual([STEEL, null]);
    expect(h.toasts.saw('cancelled')).toBe(true);
  });

  it('refuses to arm with an empty bay, and says where to craft one', () => {
    const h = harness(0);

    h.decor.toggleArmed(STEEL);

    expect(h.decor.armed).toBeNull();
    expect(h.toasts.saw('station')).toBe(true);
    expect(h.audio.played).toContain('alarm');
  });
});

describe('placing a decoration', () => {
  it('spends one from the bay and writes the decor tile', () => {
    const h = harness(2);
    h.decor.toggleArmed(STEEL);

    expect(h.decor.placeAt(40, 100)).toBe(true);
    expect(h.grid.writes).toEqual([{x: 40, y: 100, tile: {type: 'decor', decor: 'steelPlate'}}]);
    expect(countItem(h.state.player.inventory, STEEL)).toBe(1);
    expect(h.decor.armed).toBeNull();
    expect(h.toasts.saw('Decoration placed')).toBe(true);
  });

  it('never writes onto a station tile', () => {
    const h = harness();
    const {x, y} = STATIONS.manufacturer;
    h.state.exploredTiles.add(explorationIndex(x, y));
    h.decor.toggleArmed(STEEL);

    expect(h.decor.placeAt(x, y)).toBe(false);
    expect(h.grid.writes).toEqual([]);
    expect(h.toasts.saw('station')).toBe(true);
    // The plate is kept and the pointer stays armed for another try.
    expect(h.decor.armed).toBe(STEEL);
    expect(countItem(h.state.player.inventory, STEEL)).toBe(1);
  });

  it('keeps the plate and stays armed on an unexplored tile', () => {
    const h = harness();
    h.decor.toggleArmed(STEEL);

    expect(h.decor.placeAt(41, 100)).toBe(false);
    expect(h.decor.armed).toBe(STEEL);
    expect(countItem(h.state.player.inventory, STEEL)).toBe(1);
    expect(h.toasts.saw('already explored')).toBe(true);
  });

  it('ignores a press on the mine when nothing is armed', () => {
    const h = harness();

    expect(h.decor.placeAt(40, 100)).toBe(false);
    expect(h.grid.writes).toEqual([]);
  });

  it('drops the armed pointer when the bay is emptied behind its back', () => {
    const h = harness();
    h.decor.toggleArmed(STEEL);
    h.state.player.inventory = createInventory();

    expect(h.decor.placeAt(40, 100)).toBe(false);
    expect(h.decor.armed).toBeNull();
    expect(h.grid.writes).toEqual([]);
  });

  it('drops the armed pointer with the ship', () => {
    const h = harness();
    h.decor.toggleArmed(STEEL);
    h.state.gameOver = true;

    // A lost ship both refuses the press and is tidied up by the fixed-step tick.
    expect(h.decor.placeAt(40, 100)).toBe(false);
    expect(h.decor.armed).toBeNull();
  });

  it('stands the armed pointer down on the tick after the ship is lost', () => {
    const h = harness();
    h.decor.toggleArmed(STEEL);
    h.state.gameOver = true;

    h.decor.tick();
    expect(h.decor.armed).toBeNull();
  });
});

// Arming, deploying, and running the scanners the player leaves in the mine.
//
// The rules themselves are core/scanner-device.test.ts; what is checked here is
// the wiring: the cargo bay pays for a placement, the fog reveal takes the shared
// path, and an armed pointer is stood down by everything that should stand it down.

import { describe, expect, it, vi } from 'vitest';
import { explorationIndex } from '../../shared/exploration-codec';
import { addItem, countItem, createInventory } from '../core/inventory';
import { SCANNER_DEVICE, SCANNER_ITEM, createScannerDevice, scannerFootprint } from '../core/scanner-device';
import { createInitialState } from '../core/state';
import type { GameState } from '../core/types';
import { createScannerDevices, type ScannerDeviceSim } from './scanner-devices';
import { createAudioStub, createFakeGrid, createToastLog, type AudioStub, type FakeGrid } from './test-support';

interface Harness {
  state: GameState;
  scanners: ScannerDeviceSim;
  grid: FakeGrid;
  audio: AudioStub;
  toasts: ReturnType<typeof createToastLog>;
  revealTiles: ReturnType<typeof vi.fn>;
  armedUi: boolean[];
  saveProgress: ReturnType<typeof vi.fn>;
}

/** A ship parked in cleared, explored ground with `carried` scanners aboard. */
function harness(carried = 1, random = () => 0): Harness {
  const state = createInitialState();
  if (carried > 0) state.player.inventory = addItem(createInventory(), SCANNER_ITEM, carried)!;
  state.exploredTiles.add(explorationIndex(40, 100));
  const grid = createFakeGrid();
  const audio = createAudioStub();
  const toasts = createToastLog();
  const armedUi: boolean[] = [];
  const revealTiles = vi.fn((indexes: number[]) => {
    for (const index of indexes) state.exploredTiles.add(index);
  });
  const saveProgress = vi.fn();
  const scanners = createScannerDevices({
    state,
    grid,
    audio,
    toast: toasts.toast,
    saveProgress,
    revealTiles,
    setArmedUi: value => armedUi.push(value),
    random
  });
  return {state, scanners, grid, audio, toasts, revealTiles, armedUi, saveProgress};
}

/** Step the simulation far enough for every deployed device to fire once. */
function runInterval(scanners: ScannerDeviceSim): void {
  for (let step = 0; step < SCANNER_DEVICE.intervalTicks; step++) scanners.tick();
}

describe('arming a scanner', () => {
  it('arms from the slot, tells the UI, and stands down on a second press', () => {
    const h = harness();

    h.scanners.toggleArmed();
    expect(h.scanners.armed).toBe(true);
    expect(h.armedUi).toEqual([true]);
    expect(h.toasts.saw('press a mapped tile')).toBe(true);

    h.scanners.toggleArmed();
    expect(h.scanners.armed).toBe(false);
    expect(h.armedUi).toEqual([true, false]);
    expect(h.toasts.saw('cancelled')).toBe(true);
  });

  it('refuses to arm with an empty bay, and says where to craft one', () => {
    const h = harness(0);

    h.scanners.toggleArmed();

    expect(h.scanners.armed).toBe(false);
    expect(h.toasts.saw('Manufacturing Station')).toBe(true);
    expect(h.audio.played).toContain('alarm');
  });

  it('refuses to arm once the mine is full of them', () => {
    const h = harness();
    h.state.scannerDevices = Array.from({length: SCANNER_DEVICE.maxPlaced}, (_, i) => createScannerDevice(i, 500));

    h.scanners.toggleArmed();

    expect(h.scanners.armed).toBe(false);
    expect(h.toasts.saw(`${SCANNER_DEVICE.maxPlaced} scanners`)).toBe(true);
  });

  it('is stood down by Escape only while something is armed', () => {
    const h = harness();

    expect(h.scanners.disarm()).toBe(false);
    h.scanners.toggleArmed();
    expect(h.scanners.disarm()).toBe(true);
    expect(h.scanners.armed).toBe(false);
  });
});

describe('deploying a scanner', () => {
  it('spends one from the bay and leaves the device on the tile', () => {
    const h = harness(2);
    h.scanners.toggleArmed();

    expect(h.scanners.placeAt(40, 100)).toBe(true);
    expect(h.state.scannerDevices).toEqual([{x: 40, y: 100, timer: 0}]);
    expect(countItem(h.state.player.inventory, SCANNER_ITEM.kind)).toBe(1);
    expect(h.scanners.armed).toBe(false);
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.toasts.saw('Scanner deployed')).toBe(true);
  });

  it('ignores a press on the mine when nothing is armed', () => {
    const h = harness();

    expect(h.scanners.placeAt(40, 100)).toBe(false);
    expect(h.state.scannerDevices).toEqual([]);
    expect(countItem(h.state.player.inventory, SCANNER_ITEM.kind)).toBe(1);
  });

  it('keeps the scanner and stays armed when the tile is refused', () => {
    const h = harness();
    h.scanners.toggleArmed();

    // Still under fog: not a tile the player has any business surveying yet.
    expect(h.scanners.placeAt(41, 100)).toBe(false);
    expect(h.state.scannerDevices).toEqual([]);
    expect(countItem(h.state.player.inventory, SCANNER_ITEM.kind)).toBe(1);
    expect(h.scanners.armed).toBe(true);
    expect(h.toasts.saw('already explored')).toBe(true);
  });

  it('refuses solid ground, without generating rows for a press off the map', () => {
    const h = harness();
    h.grid.put(40, 100, {type: 'dirt', hp: 3, maxHp: 3});
    h.scanners.toggleArmed();

    expect(h.scanners.placeAt(40, 100)).toBe(false);
    expect(h.toasts.saw('cleared space')).toBe(true);

    expect(h.scanners.placeAt(-5, 1_000_000_000)).toBe(false);
    expect(h.toasts.saw('underground')).toBe(true);
  });

  it('drops the armed pointer when the bay is emptied behind its back', () => {
    const h = harness();
    h.scanners.toggleArmed();
    h.state.player.inventory = createInventory();

    expect(h.scanners.placeAt(40, 100)).toBe(false);
    expect(h.scanners.armed).toBe(false);
    expect(h.state.scannerDevices).toEqual([]);
  });

  it('drops the armed pointer with the ship', () => {
    const h = harness();
    h.scanners.toggleArmed();
    h.state.gameOver = true;

    expect(h.scanners.placeAt(40, 100)).toBe(false);
    expect(h.scanners.armed).toBe(false);
    expect(h.state.scannerDevices).toEqual([]);
  });
});

describe('a deployed scanner at work', () => {
  it('reports one tile per interval through the shared exploration path', () => {
    const h = harness();
    h.scanners.toggleArmed();
    h.scanners.placeAt(40, 100);

    for (let step = 0; step < SCANNER_DEVICE.intervalTicks - 1; step++) h.scanners.tick();
    expect(h.revealTiles).not.toHaveBeenCalled();

    h.scanners.tick();
    expect(h.revealTiles).toHaveBeenCalledTimes(1);
    expect(scannerFootprint(h.state.scannerDevices[0])).toContain(h.revealTiles.mock.calls[0][0][0]);
  });

  it('maps its whole square, then announces that it has gone inert', () => {
    const h = harness();
    h.scanners.toggleArmed();
    h.scanners.placeAt(40, 100);
    const footprint = scannerFootprint(h.state.scannerDevices[0]);

    for (let reveal = 0; reveal < footprint.length; reveal++) runInterval(h.scanners);

    expect(footprint.every(index => h.state.exploredTiles.has(index))).toBe(true);
    expect(h.toasts.messages.filter(message => message.includes('went inert'))).toHaveLength(1);

    // And it keeps its place in the mine without ever reporting again.
    const reveals = h.revealTiles.mock.calls.length;
    runInterval(h.scanners);
    expect(h.revealTiles.mock.calls.length).toBe(reveals);
    expect(h.state.scannerDevices).toHaveLength(1);
  });

  it('batches two devices firing on the same step into one reveal', () => {
    const h = harness(2);
    h.state.exploredTiles.add(explorationIndex(60, 100));
    h.scanners.toggleArmed();
    h.scanners.placeAt(40, 100);
    h.scanners.toggleArmed();
    h.scanners.placeAt(60, 100);

    runInterval(h.scanners);

    expect(h.revealTiles).toHaveBeenCalledTimes(1);
    expect(h.revealTiles.mock.calls[0][0]).toHaveLength(2);
  });

  it('costs nothing at all while the mine holds no devices', () => {
    const h = harness();

    runInterval(h.scanners);

    expect(h.revealTiles).not.toHaveBeenCalled();
    expect(h.saveProgress).not.toHaveBeenCalled();
  });
});

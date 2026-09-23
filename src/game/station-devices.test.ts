// Placing the two stations: arming a carried device and setting it down in the mine.
//
// The rules themselves live in core/stations.ts; what is checked here is the
// wiring — the cargo bay pays for a placement, the armed pointer follows the same
// stand-down rules the other placeables obey, and occupancy covers every placed
// entity, not just other stations.

import { describe, expect, it, vi } from 'vitest';
import { explorationIndex } from '../../shared/exploration-codec';
import { createPlacedContainer } from '../core/cargo-container';
import { addItem, countItem, createInventory } from '../core/inventory';
import { itemForKind } from '../core/items';
import { createInitialState } from '../core/state';
import { STATION_DEVICE, stationAt } from '../core/stations';
import type { GameState } from '../core/types';
import { createStationDevices, type StationDeviceSim } from './station-devices';
import { createAudioStub, createFakeGrid, createToastLog, type AudioStub, type FakeGrid } from './test-support';
import { HOME_ROW, WORLD_W } from '../../shared/constants';
import { tradingPostAt } from '../world/world';

/** The first trading post in the interior band, for the occupancy check. */
function findPost(): {x: number; y: number} {
  for (let y = HOME_ROW + 40; y < HOME_ROW + 4000; y++) {
    for (let x = 3; x < WORLD_W - 3; x++) {
      const post = tradingPostAt(x, y);
      if (post) return post;
    }
  }
  throw new Error('no trading post found');
}

interface Harness {
  state: GameState;
  devices: StationDeviceSim;
  grid: FakeGrid;
  audio: AudioStub;
  toasts: ReturnType<typeof createToastLog>;
  armedUi: (string | null)[];
  saveProgress: ReturnType<typeof vi.fn>;
}

/** A ship parked on cleared, explored ground, carrying `carried` of each device. */
function harness(carried = 1): Harness {
  const state = createInitialState();
  // Start with the seeded home stations cleared, so the counts start from zero.
  state.stations = [];
  if (carried > 0) {
    state.player.inventory = addItem(
      addItem(createInventory(), itemForKind('device:manufacturer'), carried),
      itemForKind('device:extractor'), carried
    );
  }
  state.exploredTiles.add(explorationIndex(40, 100));
  Object.assign(state.player, {x: 40, y: 100});
  const grid = createFakeGrid();
  const audio = createAudioStub();
  const toasts = createToastLog();
  const armedUi: (string | null)[] = [];
  const saveProgress = vi.fn();
  const devices = createStationDevices({
    state,
    grid,
    audio,
    toast: toasts.toast,
    saveProgress,
    setArmedUi: kind => armedUi.push(kind)
  });
  return {state, devices, grid, audio, toasts, armedUi, saveProgress};
}

describe('arming a station device', () => {
  it('arms from the slot, tells the UI, and stands down on a second press', () => {
    const h = harness();

    h.devices.toggleArmed('extractor');
    expect(h.devices.armed).toBe('extractor');
    expect(h.armedUi).toEqual(['extractor']);
    expect(h.toasts.saw('press a mapped tile')).toBe(true);

    h.devices.toggleArmed('extractor');
    expect(h.devices.armed).toBeNull();
    expect(h.armedUi).toEqual(['extractor', null]);
    expect(h.toasts.saw('cancelled')).toBe(true);
  });

  it('swaps the armed kind when the other device is armed', () => {
    const h = harness();
    h.devices.toggleArmed('manufacturer');
    h.devices.toggleArmed('extractor');
    expect(h.devices.armed).toBe('extractor');
  });

  it('refuses to arm with an empty bay, and says where to craft one', () => {
    const h = harness(0);

    h.devices.toggleArmed('manufacturer');

    expect(h.devices.armed).toBeNull();
    expect(h.toasts.saw('Manufacturing Station')).toBe(true);
    expect(h.audio.played).toContain('alarm');
  });

  it('refuses to arm once the mine is full of that kind', () => {
    const h = harness();
    for (let i = 0; i < STATION_DEVICE.extractor.maxPlaced; i++) {
      h.state.stations.push({kind: 'extractor', x: i, y: 500, coal: 0, fuel: 0, progress: 0});
    }

    h.devices.toggleArmed('extractor');

    expect(h.devices.armed).toBeNull();
    expect(h.toasts.saw(`${STATION_DEVICE.extractor.maxPlaced} Oil Extractors`)).toBe(true);
  });
});

describe('setting a station down', () => {
  it('spends one from the bay and stands the station in the mine', () => {
    const h = harness(2);

    h.devices.toggleArmed('extractor');
    expect(h.devices.placeAt(40, 100)).toBe(true);

    expect(h.state.stations).toHaveLength(1);
    expect(stationAt(h.state.stations, 40, 100)?.kind).toBe('extractor');
    expect(countItem(h.state.player.inventory, 'device:extractor')).toBe(1);
    expect(h.devices.armed).toBeNull();
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.toasts.saw('Oil Extractor set down')).toBe(true);
  });

  it('ignores a press on the mine when nothing is armed', () => {
    const h = harness();
    expect(h.devices.placeAt(40, 100)).toBe(false);
    expect(h.state.stations).toEqual([]);
  });

  it('keeps the device and stays armed when the tile is refused', () => {
    const h = harness();
    h.devices.toggleArmed('manufacturer');

    // Still under fog: not somewhere the player could find it again.
    expect(h.devices.placeAt(41, 100)).toBe(false);
    expect(h.state.stations).toEqual([]);
    expect(countItem(h.state.player.inventory, 'device:manufacturer')).toBe(1);
    expect(h.devices.armed).toBe('manufacturer');
    expect(h.toasts.saw('already explored')).toBe(true);
  });

  it('refuses a tile another placed entity already occupies', () => {
    const h = harness();
    h.state.cargoContainers.push(createPlacedContainer(40, 100));
    h.devices.toggleArmed('manufacturer');

    expect(h.devices.placeAt(40, 100)).toBe(false);
    expect(h.toasts.saw('already stands')).toBe(true);
    expect(h.state.stations).toEqual([]);
  });

  it('refuses a tile a trading post already stands on', () => {
    const h = harness();
    const post = findPost();
    h.state.exploredTiles.add(explorationIndex(post.x, post.y));
    h.devices.toggleArmed('manufacturer');

    expect(h.devices.placeAt(post.x, post.y)).toBe(false);
    expect(h.toasts.saw('already stands')).toBe(true);
    expect(h.state.stations).toEqual([]);
  });

  it('drops the armed pointer when the bay is emptied behind its back', () => {
    const h = harness();
    h.devices.toggleArmed('extractor');
    h.state.player.inventory = createInventory();

    expect(h.devices.placeAt(40, 100)).toBe(false);
    expect(h.devices.armed).toBeNull();
    expect(h.state.stations).toEqual([]);
  });

  it('drops the armed pointer with the ship', () => {
    const h = harness();
    h.devices.toggleArmed('extractor');
    h.state.gameOver = true;

    expect(h.devices.placeAt(40, 100)).toBe(false);
    expect(h.devices.armed).toBeNull();
    expect(h.state.stations).toEqual([]);
  });

  it('stands the armed pointer down when the ship is lost, on the next tick', () => {
    const h = harness();
    h.devices.toggleArmed('extractor');
    h.state.gameOver = true;

    h.devices.tick();

    expect(h.devices.armed).toBeNull();
  });
});

// The Construction Toolkit: lifting empty stations, containers and hanging
// decorations back aboard.
//
// The rules it leans on (reach, emptiness, bay room) come from core/stations.ts
// and core/cargo-container.ts; what is checked here is the lift itself — a loaded
// target is refused, an empty one is packed into the bay, and the toolkit is never
// spent doing it.

import { describe, expect, it, vi } from 'vitest';
import { DECOR_HP } from '../../shared/constants';
import { createPlacedContainer } from '../core/cargo-container';
import { addItem, countItem, createInventory, oreItem } from '../core/inventory';
import { createInitialState } from '../core/state';
import { createExtractor, createManufacturer, createPortal, type PlacedStation } from '../core/stations';
import type { GameState, Ore } from '../core/types';
import { TOOLKIT_ITEM, createToolkit, type ToolkitSim } from './toolkit';
import { createAudioStub, createFakeGrid, createToastLog, type AudioStub, type FakeGrid } from './test-support';

const COPPER: Ore = {name: 'Copper', color: '#c87a3a', value: 8, min: 0, max: 900, chance: 1};

interface Harness {
  state: GameState;
  grid: FakeGrid;
  toolkit: ToolkitSim;
  audio: AudioStub;
  toasts: ReturnType<typeof createToastLog>;
  armedUi: boolean[];
  saveProgress: ReturnType<typeof vi.fn>;
}

/** A ship parked at (40,100) carrying `toolkits` toolkits, no seeded stations. */
function harness(toolkits = 1): Harness {
  const state = createInitialState();
  state.stations = [];
  if (toolkits > 0) state.player.inventory = addItem(createInventory(), TOOLKIT_ITEM, toolkits);
  Object.assign(state.player, {x: 40, y: 100});
  const audio = createAudioStub();
  const toasts = createToastLog();
  const armedUi: boolean[] = [];
  const saveProgress = vi.fn();
  const grid = createFakeGrid();
  const toolkit = createToolkit({
    state,
    grid,
    audio,
    toast: toasts.toast,
    saveProgress,
    setArmedUi: value => armedUi.push(value)
  });
  return {state, grid, toolkit, audio, toasts, armedUi, saveProgress};
}

describe('arming the toolkit', () => {
  it('arms from the slot, tells the UI, and stows on a second press', () => {
    const h = harness();

    h.toolkit.toggleArmed();
    expect(h.toolkit.armed).toBe(true);
    expect(h.armedUi).toEqual([true]);
    expect(h.toasts.saw('press an empty station, a container or a hanging decoration')).toBe(true);

    h.toolkit.toggleArmed();
    expect(h.toolkit.armed).toBe(false);
    expect(h.armedUi).toEqual([true, false]);
  });

  it('refuses to arm with no toolkit aboard', () => {
    const h = harness(0);

    h.toolkit.toggleArmed();

    expect(h.toolkit.armed).toBe(false);
    expect(h.toasts.saw('No Construction Toolkit aboard')).toBe(true);
    expect(h.audio.played).toContain('alarm');
  });
});

describe('lifting a station', () => {
  it('packs an empty extractor into the bay and keeps the toolkit', () => {
    const h = harness();
    const extractor = createExtractor(41, 100);
    h.state.stations.push(extractor);
    h.toolkit.toggleArmed();

    expect(h.toolkit.liftAt(41, 100)).toBe(true);

    expect(h.state.stations).toEqual([]);
    expect(countItem(h.state.player.inventory, 'device:extractor')).toBe(1);
    // Durable: the toolkit is still aboard.
    expect(countItem(h.state.player.inventory, TOOLKIT_ITEM.kind)).toBe(1);
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.toasts.saw('Fuel Extractor packed')).toBe(true);
  });

  it('packs an empty portal into the bay — a portal is always liftable', () => {
    const h = harness();
    h.state.stations.push(createPortal(41, 100, 'Depot'));
    h.toolkit.toggleArmed();

    expect(h.toolkit.liftAt(41, 100)).toBe(true);

    expect(h.state.stations).toEqual([]);
    expect(countItem(h.state.player.inventory, 'device:portal')).toBe(1);
    // Durable: the toolkit is still aboard.
    expect(countItem(h.state.player.inventory, TOOLKIT_ITEM.kind)).toBe(1);
    expect(h.toasts.saw('Portal packed')).toBe(true);
  });

  it('refuses a manufacturer that still holds stock', () => {
    const h = harness();
    const manufacturer = createManufacturer(41, 100);
    manufacturer.inventory = addItem(createInventory(), oreItem(COPPER), 2);
    h.state.stations.push(manufacturer);
    h.toolkit.toggleArmed();

    expect(h.toolkit.liftAt(41, 100)).toBe(false);

    expect(h.state.stations).toHaveLength(1);
    expect(h.toasts.saw('Empty it first')).toBe(true);
    expect(h.audio.played).toContain('alarm');
  });

  it('refuses an extractor that still holds coal or fuel', () => {
    const h = harness();
    const extractor: PlacedStation = {kind: 'extractor', x: 41, y: 100, coal: 0, fuel: 12, progress: 0};
    h.state.stations.push(extractor);
    h.toolkit.toggleArmed();

    expect(h.toolkit.liftAt(41, 100)).toBe(false);
    expect(h.toasts.saw('Empty it first')).toBe(true);
  });

  it('refuses a station the ship has flown away from', () => {
    const h = harness();
    h.state.stations.push(createExtractor(41, 100));
    h.state.player.y = 120;
    h.toolkit.toggleArmed();

    expect(h.toolkit.liftAt(41, 100)).toBe(false);
    expect(h.toasts.saw('Too far from the station')).toBe(true);
  });

  it('refuses when the cargo bay has no room for the device', () => {
    const h = harness();
    h.state.player.cargoMax = 1; // The toolkit alone fills it.
    h.state.stations.push(createExtractor(41, 100));
    h.toolkit.toggleArmed();

    expect(h.toolkit.liftAt(41, 100)).toBe(false);
    expect(h.state.stations).toHaveLength(1);
    expect(h.toasts.saw('Cargo bay is full')).toBe(true);
  });
});

describe('lifting a container', () => {
  it('packs an empty container into the bay', () => {
    const h = harness();
    h.state.cargoContainers.push(createPlacedContainer(41, 100));
    h.toolkit.toggleArmed();

    expect(h.toolkit.liftAt(41, 100)).toBe(true);

    expect(h.state.cargoContainers).toEqual([]);
    expect(countItem(h.state.player.inventory, 'container')).toBe(1);
    expect(h.toasts.saw('Container packed')).toBe(true);
  });

  it('refuses a container that still holds cargo', () => {
    const h = harness();
    const container = createPlacedContainer(41, 100);
    container.inventory = addItem(createInventory(), oreItem(COPPER), 3);
    h.state.cargoContainers.push(container);
    h.toolkit.toggleArmed();

    expect(h.toolkit.liftAt(41, 100)).toBe(false);
    expect(h.state.cargoContainers).toHaveLength(1);
    expect(h.toasts.saw('Empty it first')).toBe(true);
  });
});

describe('lifting a hanging decoration', () => {
  const portrait = () => ({type: 'decor' as const, decor: 'leninPortrait' as const, hp: DECOR_HP, maxHp: DECOR_HP});

  it('packs a Lenin Portrait in reach into the bay and leaves air behind', () => {
    const h = harness();
    h.grid.put(41, 99, portrait());
    h.toolkit.toggleArmed();

    expect(h.toolkit.liftAt(41, 99)).toBe(true);

    expect(h.grid.get(41, 99)).toEqual({type: 'air'});
    expect(h.grid.writes).toEqual([{x: 41, y: 99, tile: {type: 'air'}}]);
    expect(countItem(h.state.player.inventory, 'decor:leninPortrait')).toBe(1);
    expect(countItem(h.state.player.inventory, TOOLKIT_ITEM.kind)).toBe(1);
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.toasts.saw('Lenin Portrait packed into the bay.')).toBe(true);
  });

  it('refuses a portrait the ship is not alongside', () => {
    const h = harness();
    h.grid.put(42, 100, portrait());
    h.toolkit.toggleArmed();

    expect(h.toolkit.liftAt(42, 100)).toBe(false);
    expect(h.grid.get(42, 100)).toEqual(portrait());
    expect(h.toasts.saw('Too far from the decoration')).toBe(true);
  });

  it('refuses when the cargo bay has no room for the portrait', () => {
    const h = harness();
    h.state.player.cargoMax = 1; // The toolkit alone fills it.
    h.grid.put(41, 100, portrait());
    h.toolkit.toggleArmed();

    expect(h.toolkit.liftAt(41, 100)).toBe(false);
    expect(h.grid.writes).toEqual([]);
    expect(h.toasts.saw('Cargo bay is full')).toBe(true);
  });

  it('leaves a solid decoration to the drill', () => {
    const h = harness();
    h.grid.put(41, 100, {type: 'decor', decor: 'steelPlate', hp: DECOR_HP, maxHp: DECOR_HP});
    h.toolkit.toggleArmed();

    expect(h.toolkit.liftAt(41, 100)).toBe(false);
    expect(h.grid.writes).toEqual([]);
    expect(h.toolkit.armed).toBe(true);
  });
});

describe('a press on nothing', () => {
  it('lifts nothing on bare rock and stays armed', () => {
    const h = harness();
    h.toolkit.toggleArmed();

    expect(h.toolkit.liftAt(12, 300)).toBe(false);
    expect(h.toolkit.armed).toBe(true);
  });

  it('does nothing when not armed', () => {
    const h = harness();
    h.state.stations.push(createExtractor(41, 100));

    expect(h.toolkit.liftAt(41, 100)).toBe(false);
    expect(h.state.stations).toHaveLength(1);
  });

  it('drops the armed pointer with the ship on the next tick', () => {
    const h = harness();
    h.toolkit.toggleArmed();
    h.state.gameOver = true;

    h.toolkit.tick();

    expect(h.toolkit.armed).toBe(false);
  });
});

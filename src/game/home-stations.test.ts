import { describe, expect, it, vi } from 'vitest';
import { STATIONS } from '../../shared/constants';
import { EXTRACTOR } from '../core/balance';
import { addItem, countItem, createInventory, oreKind } from '../core/inventory';
import { itemForKind } from '../core/items';
import { createInitialState } from '../core/state';
import {
  firstManufacturer,
  type ExtractorStation,
  type ManufacturerStation
} from '../core/stations';
import type { GameState } from '../core/types';
import { createHomeStations, type HomeStationsSim } from './home-stations';
import { createAudioStub, createToastLog, type AudioStub } from './test-support';

interface Harness {
  state: GameState;
  sim: HomeStationsSim;
  audio: AudioStub;
  toasts: ReturnType<typeof createToastLog>;
  saveProgress: ReturnType<typeof vi.fn>;
  setStationUi: ReturnType<typeof vi.fn>;
  setExtractorUi: ReturnType<typeof vi.fn>;
}

function harness(): Harness {
  const state = createInitialState();
  const context = {
    state,
    audio: createAudioStub(),
    toasts: createToastLog(),
    saveProgress: vi.fn(),
    setStationUi: vi.fn(),
    setExtractorUi: vi.fn()
  };
  const sim = createHomeStations({
    state,
    audio: context.audio,
    toast: context.toasts.toast,
    saveProgress: context.saveProgress,
    setStationUi: context.setStationUi,
    setExtractorUi: context.setExtractorUi,
    syncPlayer: vi.fn()
  });
  return {...context, sim};
}

/** The seeded manufacturer, which crafting and stowing act on. */
function manufacturer(state: GameState): ManufacturerStation {
  return firstManufacturer(state.stations)!;
}

/** The seeded extractor, which the coal/fuel transfers act on. */
function extractor(state: GameState): ExtractorStation {
  return state.stations.find((s): s is ExtractorStation => s.kind === 'extractor')!;
}

/** Park the ship on a station tile so `nearestStation` resolves to it. */
function park(state: GameState, station: 'manufacturer' | 'extractor'): void {
  Object.assign(state.player, {x: STATIONS[station].x, y: STATIONS[station].y});
}

function ore(name: string, count: number) {
  return {kind: oreKind(name), count};
}

describe('opening the stations', () => {
  it('opens the nearest one on Space, and toggles it shut on the next', () => {
    const h = harness();
    park(h.state, 'manufacturer');

    expect(h.sim.openNearest()).toBe(true);
    expect(h.sim.openStation?.kind).toBe('manufacturer');
    expect(h.setStationUi).toHaveBeenLastCalledWith(manufacturer(h.state).inventory);

    expect(h.sim.openNearest()).toBe(true);
    expect(h.sim.openStation).toBeNull();
    expect(h.setStationUi).toHaveBeenLastCalledWith(null);
  });

  it('opens the extractor when the ship is parked beside it', () => {
    const h = harness();
    park(h.state, 'extractor');

    expect(h.sim.openNearest()).toBe(true);
    expect(h.sim.openStation?.kind).toBe('extractor');
    expect(h.setExtractorUi).toHaveBeenLastCalledWith({coal: 0, fuel: 0, progress: 0});
  });

  it('refuses when no station is in reach', () => {
    const h = harness();
    Object.assign(h.state.player, {x: 5, y: 300});

    expect(h.sim.openNearest()).toBe(false);
    expect(h.toasts.saw('No station within reach')).toBe(true);
  });

  it('opens a station clicked on directly, and refuses one out of reach', () => {
    const h = harness();
    park(h.state, 'manufacturer');
    expect(h.sim.openAt(STATIONS.manufacturer.x, STATIONS.manufacturer.y)).toBe(true);

    h.sim.close();
    Object.assign(h.state.player, {x: 5, y: 300});
    expect(h.sim.openAt(STATIONS.manufacturer.x, STATIONS.manufacturer.y)).toBe(false);
    expect(h.toasts.saw('Too far from the station')).toBe(true);
  });

  it('closes the screen when the toolkit lifts the open station out from under it', () => {
    const h = harness();
    park(h.state, 'manufacturer');
    h.sim.openNearest();
    expect(h.sim.openStation?.kind).toBe('manufacturer');

    // Something (the toolkit) removes the open station from the world.
    h.state.stations = h.state.stations.filter(s => s.kind !== 'manufacturer');
    h.sim.tick();

    expect(h.sim.openStation).toBeNull();
    expect(h.setStationUi).toHaveBeenLastCalledWith(null);
  });
});

describe('moving cargo through the station', () => {
  it('stows the whole bay and repaints the stock', () => {
    const h = harness();
    park(h.state, 'manufacturer');
    h.state.player.inventory = addItem(createInventory(), itemForKind(oreKind('Iron')), 6);
    h.sim.openNearest();

    h.sim.stowAll();

    expect(countItem(manufacturer(h.state).inventory, oreKind('Iron'))).toBe(6);
    expect(h.state.player.inventory).toHaveLength(0);
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.setStationUi).toHaveBeenLastCalledWith(manufacturer(h.state).inventory);
  });

  it('stows a single stack of one kind, leaving the rest of the bay aboard', () => {
    const h = harness();
    park(h.state, 'manufacturer');
    h.state.player.inventory = addItem(
      addItem(createInventory(), itemForKind(oreKind('Iron')), 6),
      itemForKind(oreKind('Coal')), 4
    );
    h.sim.openNearest();

    h.sim.stow(oreKind('Iron'));

    expect(countItem(manufacturer(h.state).inventory, oreKind('Iron'))).toBe(6);
    expect(countItem(h.state.player.inventory, oreKind('Iron'))).toBe(0);
    // The coal was never asked for, so it stays in the bay.
    expect(countItem(h.state.player.inventory, oreKind('Coal'))).toBe(4);
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.setStationUi).toHaveBeenLastCalledWith(manufacturer(h.state).inventory);
  });

  it('stows a single unit when asked, leaving the rest of the stack aboard', () => {
    const h = harness();
    park(h.state, 'manufacturer');
    h.state.player.inventory = addItem(createInventory(), itemForKind(oreKind('Iron')), 6);
    h.sim.openNearest();

    h.sim.stow(oreKind('Iron'), true);

    expect(countItem(manufacturer(h.state).inventory, oreKind('Iron'))).toBe(1);
    expect(countItem(h.state.player.inventory, oreKind('Iron'))).toBe(5);
  });

  it('takes a stack back out, held under the cargo limit', () => {
    const h = harness();
    park(h.state, 'manufacturer');
    manufacturer(h.state).inventory = addItem(createInventory(), itemForKind(oreKind('Gold')), 3);
    h.sim.openNearest();

    h.sim.take(oreKind('Gold'));

    expect(countItem(h.state.player.inventory, oreKind('Gold'))).toBe(3);
    expect(countItem(manufacturer(h.state).inventory, oreKind('Gold'))).toBe(0);
  });

  it('does nothing outside the station screen', () => {
    const h = harness();
    h.state.player.inventory = addItem(createInventory(), itemForKind(oreKind('Iron')), 6);

    h.sim.stowAll();

    expect(h.state.player.inventory).toHaveLength(1);
  });
});

describe('crafting at the station', () => {
  it('turns station ore into an item by output kind', () => {
    const h = harness();
    park(h.state, 'manufacturer');
    manufacturer(h.state).inventory = [ore('Iron', 3)].reduce(
      (inv, stack) => addItem(inv, itemForKind(stack.kind), stack.count), createInventory()
    );
    h.sim.openNearest();

    h.sim.craft('repairKit');

    expect(countItem(manufacturer(h.state).inventory, 'repairKit')).toBe(1);
    expect(countItem(manufacturer(h.state).inventory, oreKind('Iron'))).toBe(0);
  });

  it('refuses a recipe the station cannot afford', () => {
    const h = harness();
    park(h.state, 'manufacturer');
    h.sim.openNearest();

    h.sim.craft('repairKit');

    expect(countItem(manufacturer(h.state).inventory, 'repairKit')).toBe(0);
    expect(h.toasts.saw('Not enough materials')).toBe(true);
  });
});

describe('the oil extractor transfers', () => {
  it('loads every coal aboard into the extractor', () => {
    const h = harness();
    park(h.state, 'extractor');
    h.state.player.inventory = addItem(createInventory(), itemForKind(oreKind('Coal')), 7);
    h.sim.openNearest();

    h.sim.loadCoal();

    expect(extractor(h.state).coal).toBe(7);
    expect(countItem(h.state.player.inventory, oreKind('Coal'))).toBe(0);
    expect(h.setExtractorUi).toHaveBeenLastCalledWith({coal: 7, fuel: 0, progress: 0});
  });

  it('tops the tank up via `refuel()` after `openNearest()`', () => {
    const h = harness();
    park(h.state, 'extractor');
    h.state.player.fuel = h.state.player.fuelMax - 30;
    extractor(h.state).fuel = 50;
    h.sim.openNearest();

    h.sim.refuel();

    expect(h.state.player.fuel).toBe(h.state.player.fuelMax);
    expect(extractor(h.state).fuel).toBe(20);
  });

  it('refuses with an empty extractor (`No fuel stored`)', () => {
    const h = harness();
    park(h.state, 'extractor');
    h.state.player.fuel = h.state.player.fuelMax - 30;
    h.sim.openNearest();

    h.sim.refuel();

    expect(h.state.player.fuel).toBe(h.state.player.fuelMax - 30);
    expect(h.toasts.saw('No fuel stored')).toBe(true);
  });
});

describe('parking on the extractor to refuel', () => {
  it('pours stored fuel into the tank once on arrival, capped by the tank', () => {
    const h = harness();
    park(h.state, 'extractor');
    h.state.player.fuel = h.state.player.fuelMax - 30;
    extractor(h.state).fuel = 50;

    h.sim.tick();

    expect(h.state.player.fuel).toBe(h.state.player.fuelMax);
    expect(extractor(h.state).fuel).toBe(20);
    expect(h.toasts.saw('Refueled +30 from the extractor')).toBe(true);
  });

  it('does not pour again on a second tick while still parked', () => {
    const h = harness();
    park(h.state, 'extractor');
    h.state.player.fuel = h.state.player.fuelMax - 30;
    extractor(h.state).fuel = 50;

    h.sim.tick();
    extractor(h.state).fuel = 40;
    h.sim.tick();

    // Tank stayed full, and the store the second tick topped up is untouched.
    expect(h.state.player.fuel).toBe(h.state.player.fuelMax);
    expect(extractor(h.state).fuel).toBe(40);
  });

  it('pours again after leaving and returning', () => {
    const h = harness();
    park(h.state, 'extractor');
    h.state.player.fuel = h.state.player.fuelMax - 30;
    extractor(h.state).fuel = 50;

    h.sim.tick();
    // Fly off, burn some fuel, then park again.
    Object.assign(h.state.player, {x: 5, y: 300});
    h.sim.tick();
    park(h.state, 'extractor');
    h.state.player.fuel = h.state.player.fuelMax - 10;
    h.sim.tick();

    expect(h.state.player.fuel).toBe(h.state.player.fuelMax);
    expect(extractor(h.state).fuel).toBe(10);
  });

  it('stays silent when the tank is already full', () => {
    const h = harness();
    park(h.state, 'extractor');
    h.state.player.fuel = h.state.player.fuelMax;
    extractor(h.state).fuel = 50;

    h.sim.tick();

    expect(extractor(h.state).fuel).toBe(50);
    expect(h.toasts.saw('Refueled')).toBe(false);
  });

  it('stays silent when the store is empty', () => {
    const h = harness();
    park(h.state, 'extractor');
    h.state.player.fuel = h.state.player.fuelMax - 30;
    extractor(h.state).fuel = 0;

    h.sim.tick();

    expect(h.state.player.fuel).toBe(h.state.player.fuelMax - 30);
    expect(h.toasts.saw('Refueled')).toBe(false);
  });
});

describe('the extractor tick', () => {
  it('converts queued coal to stored fuel over time, regardless of position', () => {
    const h = harness();
    // The ship is nowhere near the extractor: the tick runs anyway.
    Object.assign(h.state.player, {x: 5, y: 300});
    Object.assign(extractor(h.state), {coal: 1, fuel: 0, progress: 0});

    for (let i = 0; i < EXTRACTOR.ticksPerCoal; i++) h.sim.tick();

    expect(extractor(h.state)).toMatchObject({coal: 0, fuel: EXTRACTOR.fuelPerCoal, progress: 0});
    // The banked fuel is persisted the moment a coal is spent.
    expect(h.saveProgress).toHaveBeenCalled();
  });

  it('repaints the open extractor screen as the conversion advances', () => {
    const h = harness();
    park(h.state, 'extractor');
    Object.assign(extractor(h.state), {coal: 2, fuel: 0, progress: 0});
    h.sim.openNearest();
    h.setExtractorUi.mockClear();

    h.sim.tick();

    expect(h.setExtractorUi).toHaveBeenLastCalledWith({coal: 2, fuel: 0, progress: 1});
  });

  it('does nothing on a steady tick with an empty extractor', () => {
    const h = harness();
    park(h.state, 'extractor');
    h.sim.openNearest();
    h.setExtractorUi.mockClear();

    h.sim.tick();

    expect(h.setExtractorUi).not.toHaveBeenCalled();
    expect(h.saveProgress).not.toHaveBeenCalled();
  });
});

describe('a lost ship', () => {
  it('shuts whichever screen was up on the next tick', () => {
    const h = harness();
    park(h.state, 'manufacturer');
    h.sim.openNearest();
    expect(h.sim.openStation?.kind).toBe('manufacturer');

    h.state.gameOver = true;
    h.sim.tick();

    expect(h.sim.openStation).toBeNull();
    expect(h.setStationUi).toHaveBeenLastCalledWith(null);
  });
});

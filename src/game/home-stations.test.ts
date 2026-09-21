import { describe, expect, it, vi } from 'vitest';
import { STATIONS } from '../../shared/constants';
import { addItem, countItem, createInventory, oreKind } from '../core/inventory';
import { itemForKind } from '../core/items';
import { createInitialState } from '../core/state';
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
    expect(h.sim.openStation).toBe('manufacturer');
    expect(h.setStationUi).toHaveBeenLastCalledWith(h.state.home.station.inventory);

    expect(h.sim.openNearest()).toBe(true);
    expect(h.sim.openStation).toBeNull();
    expect(h.setStationUi).toHaveBeenLastCalledWith(null);
  });

  it('opens the extractor when the ship is parked beside it', () => {
    const h = harness();
    park(h.state, 'extractor');

    expect(h.sim.openNearest()).toBe(true);
    expect(h.sim.openStation).toBe('extractor');
    expect(h.setExtractorUi).toHaveBeenLastCalledWith({coal: 0, fuel: 0});
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
});

describe('moving cargo through the station', () => {
  it('stows the whole bay and repaints the stock', () => {
    const h = harness();
    park(h.state, 'manufacturer');
    h.state.player.inventory = addItem(createInventory(), itemForKind(oreKind('Iron')), 6);
    h.sim.openNearest();

    h.sim.stowAll();

    expect(countItem(h.state.home.station.inventory, oreKind('Iron'))).toBe(6);
    expect(h.state.player.inventory).toHaveLength(0);
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.setStationUi).toHaveBeenLastCalledWith(h.state.home.station.inventory);
  });

  it('takes a stack back out, held under the cargo limit', () => {
    const h = harness();
    park(h.state, 'manufacturer');
    h.state.home.station.inventory = addItem(createInventory(), itemForKind(oreKind('Gold')), 3);
    h.sim.openNearest();

    h.sim.take(oreKind('Gold'));

    expect(countItem(h.state.player.inventory, oreKind('Gold'))).toBe(3);
    expect(countItem(h.state.home.station.inventory, oreKind('Gold'))).toBe(0);
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
    h.state.home.station.inventory = [ore('Iron', 3)].reduce(
      (inv, stack) => addItem(inv, itemForKind(stack.kind), stack.count), createInventory()
    );
    h.sim.openNearest();

    h.sim.craft('repairKit');

    expect(countItem(h.state.home.station.inventory, 'repairKit')).toBe(1);
    expect(countItem(h.state.home.station.inventory, oreKind('Iron'))).toBe(0);
  });

  it('refuses a recipe the station cannot afford', () => {
    const h = harness();
    park(h.state, 'manufacturer');
    h.sim.openNearest();

    h.sim.craft('repairKit');

    expect(countItem(h.state.home.station.inventory, 'repairKit')).toBe(0);
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

    expect(h.state.home.extractor.coal).toBe(7);
    expect(countItem(h.state.player.inventory, oreKind('Coal'))).toBe(0);
    expect(h.setExtractorUi).toHaveBeenLastCalledWith({coal: 7, fuel: 0});
  });

  it('tops the ship tank up from stored fuel, capped by the tank', () => {
    const h = harness();
    park(h.state, 'extractor');
    h.state.player.fuel = h.state.player.fuelMax - 30;
    h.state.home.extractor.fuel = 50;
    h.sim.openNearest();

    h.sim.refuel();

    expect(h.state.player.fuel).toBe(h.state.player.fuelMax);
    expect(h.state.home.extractor.fuel).toBe(20);
  });

  it('refuses a refuel with an empty extractor', () => {
    const h = harness();
    park(h.state, 'extractor');
    h.state.player.fuel = h.state.player.fuelMax - 30;
    h.sim.openNearest();

    h.sim.refuel();

    expect(h.state.player.fuel).toBe(h.state.player.fuelMax - 30);
    expect(h.toasts.saw('No fuel stored')).toBe(true);
  });
});

describe('a lost ship', () => {
  it('shuts whichever screen was up on the next tick', () => {
    const h = harness();
    park(h.state, 'manufacturer');
    h.sim.openNearest();
    expect(h.sim.openStation).toBe('manufacturer');

    h.state.gameOver = true;
    h.sim.tick();

    expect(h.sim.openStation).toBeNull();
    expect(h.setStationUi).toHaveBeenLastCalledWith(null);
  });
});

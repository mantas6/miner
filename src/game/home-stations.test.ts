import { describe, expect, it, vi } from 'vitest';
import { START_Y, STATIONS } from '../../shared/constants';
import { EXTRACTOR } from '../core/balance';
import { addItem, countItem, createInventory, oreKind } from '../core/inventory';
import { itemForKind } from '../core/items';
import { createInitialState } from '../core/state';
import {
  STATION_CAPACITY,
  createExtractor,
  createManufacturer,
  firstManufacturer,
  type ExtractorStation,
  type ManufacturerStation
} from '../core/stations';
import { EXTRACTOR_FUEL_ORDER, extractorFuelOrder, supplyPrice } from '../core/trading';
import type { GameState } from '../core/types';
import { createHomeStations, type HomeStationsSim } from './home-stations';
import { createAudioStub, createPortalsSimStub, createToastLog, type AudioStub, type PortalsSimStub } from './test-support';

interface Harness {
  state: GameState;
  sim: HomeStationsSim;
  audio: AudioStub;
  toasts: ReturnType<typeof createToastLog>;
  saveProgress: ReturnType<typeof vi.fn>;
  setStationUi: ReturnType<typeof vi.fn>;
  setExtractorUi: ReturnType<typeof vi.fn>;
  portals: PortalsSimStub;
}

/** A harness whose wallet starts at `cash`. */
function harnessWithCash(cash: number): Harness {
  const h = harness();
  h.state.cash = cash;
  return h;
}

function harness(): Harness {
  const state = createInitialState();
  const context = {
    state,
    audio: createAudioStub(),
    toasts: createToastLog(),
    saveProgress: vi.fn(),
    setStationUi: vi.fn(),
    setExtractorUi: vi.fn(),
    portals: createPortalsSimStub()
  };
  const sim = createHomeStations({
    state,
    audio: context.audio,
    toast: context.toasts.toast,
    saveProgress: context.saveProgress,
    addCash: (amount: number) => { state.cash += amount; },
    setStationUi: context.setStationUi,
    setExtractorUi: context.setExtractorUi,
    portals: context.portals
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
    expect(h.setStationUi).toHaveBeenLastCalledWith(manufacturer(h.state));

    expect(h.sim.openNearest()).toBe(true);
    expect(h.sim.openStation).toBeNull();
    expect(h.setStationUi).toHaveBeenLastCalledWith(null);
  });

  it('opens the extractor when the ship is parked beside it', () => {
    const h = harness();
    park(h.state, 'extractor');
    extractor(h.state).fuel = 0;

    expect(h.sim.openNearest()).toBe(true);
    expect(h.sim.openStation?.kind).toBe('extractor');
    expect(h.setExtractorUi).toHaveBeenLastCalledWith({coal: 0, fuel: 0, progress: 0, supply: true});
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

describe('leaving a station', () => {
  it('shuts the open screen once the ship is out of reach', () => {
    const h = harness();
    park(h.state, 'manufacturer');
    h.sim.openNearest();
    h.sim.tick();
    expect(h.sim.openStation?.kind).toBe('manufacturer');

    Object.assign(h.state.player, {x: 5, y: 300});
    h.sim.tick();

    expect(h.sim.openStation).toBeNull();
    expect(h.setStationUi).toHaveBeenLastCalledWith(null);
  });
});

describe('opening a portal', () => {
  it('opens the travel list on Space when a portal is the nearest station', () => {
    const h = harness();
    Object.assign(h.state.player, {x: STATIONS.portal.x, y: STATIONS.portal.y});

    expect(h.sim.openNearest()).toBe(true);

    const portal = h.state.stations.find(s => s.kind === 'portal');
    expect(h.portals.openTravel).toHaveBeenCalledWith(portal);
    // A portal has no station screen of its own, so none was published.
    expect(h.sim.openStation).toBeNull();
    expect(h.setStationUi).not.toHaveBeenCalled();
  });

  it('opens the travel list when a portal tile is pressed directly', () => {
    const h = harness();
    Object.assign(h.state.player, {x: STATIONS.portal.x, y: STATIONS.portal.y});

    expect(h.sim.openAt(STATIONS.portal.x, STATIONS.portal.y)).toBe(true);
    expect(h.portals.openTravel).toHaveBeenCalledOnce();
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
    expect(h.setStationUi).toHaveBeenLastCalledWith(manufacturer(h.state));
    expect(h.audio.played).toEqual(['stow']);
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
    expect(h.setStationUi).toHaveBeenLastCalledWith(manufacturer(h.state));
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
    expect(h.audio.played).toEqual(['take']);
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
    expect(h.audio.played).toEqual(['craft']);
  });

  it('refuses a batch that would overflow the station stock, saying so', () => {
    const h = harness();
    park(h.state, 'manufacturer');
    // Stone Block ×2 ← 1 Coal grows a full stock by one.
    manufacturer(h.state).inventory = addItem(createInventory(), itemForKind(oreKind('Coal')), STATION_CAPACITY);
    h.sim.openNearest();

    h.sim.craft('decor:stoneBlock');

    expect(countItem(manufacturer(h.state).inventory, 'decor:stoneBlock')).toBe(0);
    expect(countItem(manufacturer(h.state).inventory, oreKind('Coal'))).toBe(STATION_CAPACITY);
    expect(h.toasts.saw('Station stock is full')).toBe(true);
    expect(h.audio.played).toEqual(['alarm']);
  });

  it('refuses a recipe the station cannot afford', () => {
    const h = harness();
    park(h.state, 'manufacturer');
    h.sim.openNearest();

    h.sim.craft('repairKit');

    expect(countItem(manufacturer(h.state).inventory, 'repairKit')).toBe(0);
    expect(h.toasts.saw('Not enough materials')).toBe(true);
    expect(h.audio.played).toEqual(['alarm']);
  });

  it('counts crafted Scanners and keeps the best upgrade mark crafted', () => {
    const h = harness();
    park(h.state, 'manufacturer');
    manufacturer(h.state).inventory = [ore('Copper', 8), ore('Silver', 8), ore('Gold', 3), ore('Iron', 4)].reduce(
      (inv, stack) => addItem(inv, itemForKind(stack.kind), stack.count), createInventory()
    );
    h.sim.openNearest();

    h.sim.craft('scanner');
    h.sim.craft('scanner');
    expect(h.state.stats.scannersObtained).toBe(2);
    expect(h.state.stats.bestMarkCrafted).toBe(0);

    h.sim.craft('upgrade:drill:2');
    h.sim.craft('upgrade:tank:1');
    expect(h.state.stats.bestMarkCrafted).toBe(2);
    // A refused craft counts nothing.
    h.sim.craft('upgrade:hull:3');
    expect(h.state.stats.bestMarkCrafted).toBe(2);
    expect(h.state.stats.scannersObtained).toBe(2);
  });
});

describe('the fuel extractor transfers', () => {
  it('loads every coal aboard into the extractor', () => {
    const h = harness();
    park(h.state, 'extractor');
    extractor(h.state).fuel = 0;
    h.state.player.inventory = addItem(createInventory(), itemForKind(oreKind('Coal')), 7);
    h.sim.openNearest();

    h.sim.loadCoal();

    expect(extractor(h.state).coal).toBe(7);
    expect(countItem(h.state.player.inventory, oreKind('Coal'))).toBe(0);
    expect(h.setExtractorUi).toHaveBeenLastCalledWith({coal: 7, fuel: 0, progress: 0, supply: true});
  });

  it('loads only what the hopper has room for, leaving the rest aboard', () => {
    const h = harness();
    park(h.state, 'extractor');
    extractor(h.state).coal = STATION_CAPACITY - 3;
    h.state.player.inventory = addItem(createInventory(), itemForKind(oreKind('Coal')), 7);
    h.sim.openNearest();

    h.sim.loadCoal();

    expect(extractor(h.state).coal).toBe(STATION_CAPACITY);
    expect(countItem(h.state.player.inventory, oreKind('Coal'))).toBe(4);
    expect(h.toasts.saw('Loaded 3 coal')).toBe(true);

    h.sim.loadCoal();
    expect(countItem(h.state.player.inventory, oreKind('Coal'))).toBe(4);
    expect(h.toasts.saw('hopper is full')).toBe(true);
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
    expect(h.audio.played).toEqual(['refuel']);
  });

  it('refuses with an empty extractor (`No fuel stored`)', () => {
    const h = harness();
    park(h.state, 'extractor');
    extractor(h.state).fuel = 0;
    h.state.player.fuel = h.state.player.fuelMax - 30;
    h.sim.openNearest();

    h.sim.refuel();

    expect(h.state.player.fuel).toBe(h.state.player.fuelMax - 30);
    expect(h.toasts.saw('No fuel stored')).toBe(true);
  });
});

describe('parking on the extractor to refuel', () => {
  it('pours stored fuel into the tank on arrival, capped by the tank', () => {
    const h = harness();
    park(h.state, 'extractor');
    h.state.player.fuel = h.state.player.fuelMax - 30;
    extractor(h.state).fuel = 50;

    h.sim.tick();

    expect(h.state.player.fuel).toBe(h.state.player.fuelMax);
    expect(extractor(h.state).fuel).toBe(20);
    expect(h.toasts.saw('Refueled +30 from the extractor')).toBe(true);
    expect(h.audio.played).toEqual(['refuel']);
  });

  it('keeps topping up from fresh conversions while parked, toasting only on arrival', () => {
    const h = harness();
    park(h.state, 'extractor');
    h.state.player.fuel = 10;
    // Less stored than the tank needs, and one coal queued to convert.
    Object.assign(extractor(h.state), {fuel: 20, coal: 1, progress: 0});

    h.sim.tick();
    expect(h.state.player.fuel).toBe(30);
    expect(extractor(h.state).fuel).toBe(0);
    expect(h.toasts.saw('Refueled +20 from the extractor')).toBe(true);
    expect(h.audio.played).toEqual(['refuel']);
    const toastsAfterArrival = h.toasts.messages.length;

    // Stay parked while the coal burns: its fuel pours straight into the tank.
    for (let i = 0; i < EXTRACTOR.ticksPerCoal; i++) h.sim.tick();

    expect(h.state.player.fuel).toBe(30 + EXTRACTOR.fuelPerCoal);
    expect(extractor(h.state)).toMatchObject({coal: 0, fuel: 0});
    // Quietly: no second toast or cue for the mid-visit top-up, but it is saved.
    expect(h.toasts.messages).toHaveLength(toastsAfterArrival);
    expect(h.audio.played).toEqual(['refuel']);
    expect(h.saveProgress).toHaveBeenCalled();
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
    expect(h.audio.played).not.toContain('refuel');
  });

  it('tops up a crumb silently: no "Refueled +0" when the pour rounds to nothing', () => {
    const h = harness();
    park(h.state, 'extractor');
    h.state.player.fuel = h.state.player.fuelMax - 0.125;
    extractor(h.state).fuel = 50;

    h.sim.tick();

    expect(h.state.player.fuel).toBe(h.state.player.fuelMax);
    expect(extractor(h.state).fuel).toBe(49.875);
    expect(h.toasts.saw('Refueled')).toBe(false);
    expect(h.audio.played).not.toContain('refuel');
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

    expect(h.setExtractorUi).toHaveBeenLastCalledWith({coal: 2, fuel: 0, progress: 1, supply: true});
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

describe('the home Supply counter', () => {
  it('buys a Supply item for cash into the home manufacturer\'s stock', () => {
    const price = supplyPrice('repairKit');
    const h = harnessWithCash(price + 5);
    park(h.state, 'manufacturer');
    h.sim.openNearest();

    h.sim.buySupply('repairKit');

    expect(h.state.cash).toBe(5);
    expect(countItem(manufacturer(h.state).inventory, 'repairKit')).toBe(1);
    // It lands in the station, not the bay.
    expect(countItem(h.state.player.inventory, 'repairKit')).toBe(0);
    expect(h.setStationUi).toHaveBeenLastCalledWith(manufacturer(h.state));
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.audio.played).toEqual(['buy']);
    expect(h.toasts.saw(`Bought Repair Kit for $${price}`)).toBe(true);
    expect(h.state.stats.scannersObtained).toBe(0);
  });

  it('counts a bought Scanner toward the objective\'s scanners obtained', () => {
    const h = harnessWithCash(supplyPrice('scanner'));
    park(h.state, 'manufacturer');
    h.sim.openNearest();

    h.sim.buySupply('scanner');

    expect(countItem(manufacturer(h.state).inventory, 'scanner')).toBe(1);
    expect(h.state.stats.scannersObtained).toBe(1);
  });

  it('refuses when the wallet cannot cover the price', () => {
    const h = harnessWithCash(supplyPrice('scanner') - 1);
    park(h.state, 'manufacturer');
    h.sim.openNearest();

    h.sim.buySupply('scanner');

    expect(h.state.cash).toBe(supplyPrice('scanner') - 1);
    expect(countItem(manufacturer(h.state).inventory, 'scanner')).toBe(0);
    expect(h.toasts.saw('Not enough cash for Scanner')).toBe(true);
    expect(h.audio.played).toEqual(['alarm']);
  });

  it('refuses a purchase the full station stock has no room for', () => {
    const h = harnessWithCash(10_000);
    park(h.state, 'manufacturer');
    manufacturer(h.state).inventory = addItem(createInventory(), itemForKind(oreKind('Coal')), STATION_CAPACITY);
    h.sim.openNearest();

    h.sim.buySupply('dynamite');

    expect(h.state.cash).toBe(10_000);
    expect(countItem(manufacturer(h.state).inventory, 'dynamite')).toBe(0);
    expect(h.toasts.saw('Station stock is full')).toBe(true);
  });

  it('refuses an item the Supply does not sell', () => {
    const h = harnessWithCash(10_000);
    park(h.state, 'manufacturer');
    h.sim.openNearest();

    h.sim.buySupply('teleporter');

    expect(h.state.cash).toBe(10_000);
    expect(countItem(manufacturer(h.state).inventory, 'teleporter')).toBe(0);
  });

  it('sells nothing at a manufacturer set down away from the base', () => {
    const h = harnessWithCash(10_000);
    const field = createManufacturer(10, START_Y + 200);
    h.state.stations.push(field);
    Object.assign(h.state.player, {x: field.x, y: field.y});
    h.sim.openNearest();
    expect(h.sim.openStation).toBe(field);

    h.sim.buySupply('repairKit');

    expect(h.state.cash).toBe(10_000);
    expect(countItem(field.inventory, 'repairKit')).toBe(0);
    expect(h.toasts.saw('only sold at the home base')).toBe(true);
  });
});

describe('ordering fuel into the home extractor', () => {
  it('orders a batch of fuel into the store for cash', () => {
    const h = harnessWithCash(1000);
    park(h.state, 'extractor');
    extractor(h.state).fuel = 0;
    h.sim.openNearest();
    const order = extractorFuelOrder(0, 1000);
    expect(order.amount).toBe(EXTRACTOR_FUEL_ORDER);

    h.sim.buyExtractorFuel();

    expect(extractor(h.state).fuel).toBe(EXTRACTOR_FUEL_ORDER);
    expect(h.state.cash).toBe(1000 - order.cost);
    expect(h.setExtractorUi).toHaveBeenLastCalledWith({coal: 0, fuel: EXTRACTOR_FUEL_ORDER, progress: 0, supply: true});
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.audio.played).toEqual(['buy']);
    expect(h.toasts.saw(`Ordered ${EXTRACTOR_FUEL_ORDER} fuel into the extractor for $${order.cost}`)).toBe(true);
  });

  it('orders only what the store has room for', () => {
    const h = harnessWithCash(1000);
    park(h.state, 'extractor');
    extractor(h.state).fuel = EXTRACTOR.fuelCap - 30;
    h.sim.openNearest();

    h.sim.buyExtractorFuel();

    expect(extractor(h.state).fuel).toBe(EXTRACTOR.fuelCap);
  });

  it('refuses when the store is full', () => {
    const h = harnessWithCash(1000);
    park(h.state, 'extractor');
    extractor(h.state).fuel = EXTRACTOR.fuelCap;
    h.sim.openNearest();

    h.sim.buyExtractorFuel();

    expect(h.state.cash).toBe(1000);
    expect(h.toasts.saw('store is full')).toBe(true);
    expect(h.audio.played).toEqual(['alarm']);
  });

  it('refuses when the wallet is empty', () => {
    const h = harnessWithCash(0);
    park(h.state, 'extractor');
    extractor(h.state).fuel = 0;
    h.sim.openNearest();

    h.sim.buyExtractorFuel();

    expect(extractor(h.state).fuel).toBe(0);
    expect(h.toasts.saw('Not enough cash')).toBe(true);
  });

  it('delivers nothing to an extractor set down away from the base', () => {
    const h = harnessWithCash(1000);
    const field = createExtractor(10, START_Y + 200);
    h.state.stations.push(field);
    Object.assign(h.state.player, {x: field.x, y: field.y});
    h.sim.openNearest();
    expect(h.setExtractorUi).toHaveBeenLastCalledWith({coal: 0, fuel: 0, progress: 0, supply: false});

    h.sim.buyExtractorFuel();

    expect(field.fuel).toBe(0);
    expect(h.state.cash).toBe(1000);
    expect(h.toasts.saw('only delivered to the home base')).toBe(true);
  });
});

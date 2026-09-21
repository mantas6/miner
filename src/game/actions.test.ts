import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOME_X, ORES, START_Y } from '../../shared/constants';
import { ECONOMY, LIMITS, STARTING } from '../core/balance';
import { CARGO_CONTAINER_ITEM } from '../core/cargo-container';
import { cargoCost, drillCost, partialFill, refuelCost, repairCost } from '../core/economy';
import { DYNAMITE_ITEM } from '../core/dynamite';
import { addItem, addOre, countItem, countOres, createInventory } from '../core/inventory';
import { SCANNER_ITEM } from '../core/scanner-device';
import { createInitialState } from '../core/state';
import { TELEPORTER_ITEM } from '../core/teleporter';
import type { GameState } from '../core/types';
import { createActions, type GameActions } from './actions';
import {
  createAudioStub,
  createToastLog,
  type AudioStub
} from './test-support';

interface Harness {
  state: GameState;
  actions: GameActions;
  audio: AudioStub;
  toasts: ReturnType<typeof createToastLog>;
  saveProgress: ReturnType<typeof vi.fn>;
  flags: {atSurface: boolean};
}

function harness(): Harness {
  const state = createInitialState();
  const context = {
    state,
    audio: createAudioStub(),
    toasts: createToastLog(),
    saveProgress: vi.fn(),
    flags: {atSurface: true}
  };
  const actions = createActions({
    state,
    audio: context.audio,
    toast: context.toasts.toast,
    saveProgress: context.saveProgress,
    // The real orchestrator also banks lifetime earnings here.
    addCash: amount => {
      state.cash += amount;
      if (amount > 0) state.stats.totalCashEarned += amount;
    },
    atSurface: () => context.flags.atSurface
  });
  return {...context, actions};
}

describe('selling cargo', () => {
  it('pays the full cargo value, empties the bay, and records the earnings', () => {
    const h = harness();
    // Two units of one ore and one of another: the sale is per stack, not per slot.
    h.state.player.inventory = addOre(addOre(addOre(createInventory(), ORES[0], 9)!, ORES[0], 9)!, ORES[3], 9)!;
    const expected = ORES[0].value * 2 + ORES[3].value;

    h.actions.sell();

    expect(h.state.cash).toBe(STARTING.cash + expected);
    expect(h.state.stats.totalCashEarned).toBe(expected);
    expect(countOres(h.state.player.inventory)).toBe(0);
    expect(h.state.player.inventory).toHaveLength(0);
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.audio.played).toContain('cash');
  });

  it('refuses to sell underground and keeps the cargo aboard', () => {
    const h = harness();
    h.flags.atSurface = false;
    h.state.player.inventory = addOre(createInventory(), ORES[0], 9)!;

    h.actions.sell();

    expect(h.state.cash).toBe(STARTING.cash);
    expect(countOres(h.state.player.inventory)).toBe(1);
    expect(h.toasts.saw('Depot is on the surface')).toBe(true);
  });

  it('says so when there is nothing to sell', () => {
    const h = harness();

    h.actions.sell();

    expect(h.state.cash).toBe(STARTING.cash);
    expect(h.toasts.saw('Cargo is empty')).toBe(true);
  });
});

describe('depot services', () => {
  it('fills the tank completely when the wallet can afford it', () => {
    const h = harness();
    h.state.player.fuel = 40;
    h.state.cash = 500;
    const cost = refuelCost(h.state.player);

    h.actions.refuel();

    expect(h.state.player.fuel).toBe(h.state.player.fuelMax);
    expect(h.state.cash).toBe(500 - cost);
    expect(h.toasts.saw('Fuel tank full')).toBe(true);
  });

  it('buys a proportional part of a refuel when the cash runs short', () => {
    const h = harness();
    h.state.player.fuel = 20;
    h.state.cash = 5;
    const cost = refuelCost(h.state.player);
    const expected = partialFill(20, h.state.player.fuelMax, 5, cost);

    h.actions.refuel();

    expect(expected.pay).toBe(5);
    expect(h.state.player.fuel).toBeCloseTo(expected.value);
    expect(h.state.player.fuel).toBeLessThan(h.state.player.fuelMax);
    expect(h.state.cash).toBe(0);
    expect(h.toasts.saw('Partial refuel')).toBe(true);
  });

  it('repairs partially on the same money math', () => {
    const h = harness();
    h.state.player.hull = 10;
    h.state.cash = 4;
    const expected = partialFill(10, h.state.player.hullMax, 4, repairCost(h.state.player));

    h.actions.repair();

    expect(h.state.player.hull).toBeCloseTo(expected.value);
    expect(h.state.cash).toBe(0);
    expect(h.toasts.saw('Partial repair')).toBe(true);
  });

  it('refuses a service with no cash at all and warns audibly', () => {
    const h = harness();
    h.state.player.fuel = 10;
    h.state.cash = 0;

    h.actions.refuel();

    expect(h.state.player.fuel).toBe(10);
    expect(h.toasts.saw('No cash to buy fuel')).toBe(true);
    expect(h.audio.played).toContain('alarm');
  });

  it('declines to sell a service that is already at maximum', () => {
    const h = harness();
    h.state.cash = 500;

    h.actions.refuel();
    h.actions.repair();

    expect(h.state.cash).toBe(500);
    expect(h.toasts.saw('Fuel tank already full')).toBe(true);
    expect(h.toasts.saw('Hull already at full strength')).toBe(true);
  });

  it('prioritises selling, then fuel, then hull at the depot', () => {
    const h = harness();
    h.state.cash = 500;
    h.state.player.inventory = addOre(createInventory(), ORES[0], 9)!;
    h.state.player.fuel = 50;
    h.state.player.hull = 50;

    h.actions.surfaceService();
    expect(countOres(h.state.player.inventory)).toBe(0);

    h.actions.surfaceService();
    expect(h.state.player.fuel).toBe(h.state.player.fuelMax);

    h.actions.surfaceService();
    expect(h.state.player.hull).toBe(h.state.player.hullMax);

    h.actions.surfaceService();
    expect(h.toasts.last).toContain('Cargo empty, hull and fuel are full');
  });
});

describe('buying upgrades', () => {
  it('charges the price and applies the upgrade', () => {
    const h = harness();
    h.state.cash = 1000;
    const cost = cargoCost(h.state.player);

    h.actions.buyUpgrade('cargo', cost, 'Cargo bay expanded.');

    expect(h.state.player.cargoMax).toBe(STARTING.cargoMax + ECONOMY.cargo.step);
    expect(h.state.cash).toBe(1000 - cost);
    expect(h.saveProgress).toHaveBeenCalled();
  });

  it('leaves the ship untouched when the money is short', () => {
    const h = harness();
    h.state.cash = 10;

    h.actions.buyUpgrade('drill', drillCost(h.state.player), 'Drill power increased.');

    expect(h.state.player.drill).toBe(STARTING.drill);
    expect(h.state.cash).toBe(10);
    expect(h.toasts.saw(`Need $${drillCost(h.state.player)}`)).toBe(true);
    expect(h.audio.played).toContain('alarm');
  });

  it('refuses an upgrade that is already maxed out, without charging', () => {
    const h = harness();
    h.state.cash = 5000;
    h.state.player.drill = LIMITS.drill.max;

    h.actions.buyUpgrade('drill', 1, 'Drill power increased.');

    expect(h.state.cash).toBe(5000);
    expect(h.toasts.saw('already at maximum level')).toBe(true);
  });

  it('sells upgrades only at the depot', () => {
    const h = harness();
    h.flags.atSurface = false;
    h.state.cash = 5000;

    h.actions.buyUpgrade('cargo', 1, 'Cargo bay expanded.');

    expect(h.state.player.cargoMax).toBe(STARTING.cargoMax);
    expect(h.toasts.saw('Upgrades are at the surface')).toBe(true);
  });
});

describe('buying equipment', () => {
  it('loads consumables one at a time', () => {
    const h = harness();
    h.state.cash = ECONOMY.dynamite.price + ECONOMY.teleporter.price;

    h.actions.buyDynamite();
    h.actions.buyTeleporter();

    // Every consumable is cargo now, each kind in a slot of its own.
    expect(countItem(h.state.player.inventory, DYNAMITE_ITEM.kind)).toBe(1);
    expect(countItem(h.state.player.inventory, TELEPORTER_ITEM.kind)).toBe(1);
    expect(h.state.cash).toBe(0);
  });

  it.each([
    ['scanner', SCANNER_ITEM.kind, ECONOMY.scanner.price, (actions: GameActions) => actions.buyScanner()],
    ['dynamite', DYNAMITE_ITEM.kind, ECONOMY.dynamite.price, (actions: GameActions) => actions.buyDynamite()],
    ['teleporter', TELEPORTER_ITEM.kind, ECONOMY.teleporter.price, (actions: GameActions) => actions.buyTeleporter()],
    ['container', CARGO_CONTAINER_ITEM.kind, ECONOMY.container.price, (actions: GameActions) => actions.buyContainer()]
  ])('loads a %s into the bay, and refuses one the bay cannot hold', (_name, kind, price, buy) => {
    const h = harness();
    h.state.cash = price * 2;

    buy(h.actions);
    buy(h.actions);

    // Two units of one kind stack together — two items in one stack.
    expect(countItem(h.state.player.inventory, kind)).toBe(2);
    expect(h.state.cash).toBe(0);

    // Fill the bay to its item capacity: there is now nowhere for it to go.
    h.state.cash = price;
    let full = createInventory();
    for (let i = 0; i < h.state.player.cargoMax; i++) full = addOre(full, ORES[0], h.state.player.cargoMax)!;
    h.state.player.inventory = full;

    buy(h.actions);

    expect(countItem(h.state.player.inventory, kind)).toBe(0);
    expect(h.state.cash).toBe(price);
    expect(h.toasts.saw('Cargo bay is full')).toBe(true);
    expect(h.audio.played).toContain('alarm');
  });
});

describe('using the teleporter', () => {
  // The jump asks the browser about reduced motion, and this suite has no DOM.
  afterEach(() => vi.unstubAllGlobals());

  /** A ship well past the 100 m threshold, with `count` teleporters in the bay. */
  function deepWithTeleporters(h: Harness, count: number): void {
    vi.stubGlobal('window', {});
    const y = START_Y + 40;
    Object.assign(h.state.player, {x: 20, y, drawX: 20, drawY: y});
    h.state.player.inventory = addItem(createInventory(), TELEPORTER_ITEM, count)!;
    h.flags.atSurface = false;
  }

  it('spends one teleporter on the trip up and nothing on the trip back', () => {
    const h = harness();
    deepWithTeleporters(h, 2);

    h.actions.useTeleporter();

    expect(countItem(h.state.player.inventory, TELEPORTER_ITEM.kind)).toBe(1);
    expect(h.state.player.y).toBe(START_Y);
    expect(h.state.teleportReturnPosition).toEqual({x: 20, y: START_Y + 40});
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.toasts.saw('Teleported safely home')).toBe(true);

    h.flags.atSurface = true;
    h.actions.useTeleporter();

    // The return point is the receipt for the charge already spent.
    expect(countItem(h.state.player.inventory, TELEPORTER_ITEM.kind)).toBe(1);
    expect(h.state.player.y).toBe(START_Y + 40);
    expect(h.state.teleportReturnPosition).toBeNull();
  });

  it('frees the slot once the last teleporter is spent', () => {
    const h = harness();
    deepWithTeleporters(h, 1);

    h.actions.useTeleporter();

    expect(countItem(h.state.player.inventory, TELEPORTER_ITEM.kind)).toBe(0);
    expect(h.state.player.inventory.every(slot => slot === null)).toBe(true);
  });

  it('refuses the jump with nothing in the bay', () => {
    const h = harness();
    deepWithTeleporters(h, 0);

    h.actions.useTeleporter();

    expect(h.state.player.y).toBe(START_Y + 40);
    expect(h.state.teleportReturnPosition).toBeNull();
    expect(h.toasts.saw('No teleporter aboard')).toBe(true);
    expect(h.audio.played).toContain('alarm');
  });

  it('keeps the teleporter when the ship is too close to home to use it', () => {
    const h = harness();
    deepWithTeleporters(h, 1);
    Object.assign(h.state.player, {x: HOME_X, y: START_Y + 1, drawX: HOME_X, drawY: START_Y + 1});

    h.actions.useTeleporter();

    expect(countItem(h.state.player.inventory, TELEPORTER_ITEM.kind)).toBe(1);
    expect(h.toasts.saw('depth of at least')).toBe(true);
    expect(h.audio.played).toContain('alarm');
  });
});

// The ship ladder: the table's shape, the one-way order, and the lookups the
// shipyard, the save and the renderer lean on. Pure data, no DOM.

import { describe, expect, it } from 'vitest';
import { ORES } from '../../shared/constants';
import { STARTING } from './balance';
import { canCraft, missingInputs } from './crafting';
import { addItem, createInventory, oreKind } from './inventory';
import { itemForKind } from './items';
import {
  MAX_SHIP_CARGO,
  MAX_SHIP_SLOTS,
  SHIPS,
  SHIP_ORDER,
  STARTER_SHIP,
  fitEquipmentTo,
  formatShipGains,
  isShipId,
  nextShip,
  shipFor,
  shipGains,
  shipTier,
  slotsFor
} from './ships';

describe('the ship table', () => {
  it('lists every hull once, keyed by its own id, in ladder order', () => {
    expect(SHIP_ORDER).toEqual(['scout', 'hauler', 'prospector', 'leviathan', 'corebreaker']);
    for (const id of SHIP_ORDER) expect(SHIPS[id].id).toBe(id);
    expect(Object.keys(SHIPS).sort()).toEqual([...SHIP_ORDER].sort());
  });

  it('starts in the Scout, whose base is the STARTING ship and which cannot be built', () => {
    expect(STARTER_SHIP).toBe('scout');
    expect(SHIPS.scout.base).toEqual({
      fuelMax: STARTING.fuelMax, hullMax: STARTING.hullMax, cargoMax: STARTING.cargoMax, drill: STARTING.drill
    });
    expect(SHIPS.scout.inputs).toEqual([]);
  });

  it('grows by one slot and on every stat per rung, so a swap never shrinks anything', () => {
    for (let i = 1; i < SHIP_ORDER.length; i++) {
      const from = shipFor(SHIP_ORDER[i - 1]!), to = shipFor(SHIP_ORDER[i]!);
      expect(to.slots).toBe(from.slots + 1);
      expect(to.base.fuelMax).toBeGreaterThan(from.base.fuelMax);
      expect(to.base.hullMax).toBeGreaterThan(from.base.hullMax);
      expect(to.base.cargoMax).toBeGreaterThan(from.base.cargoMax);
      expect(to.base.drill).toBeGreaterThanOrEqual(from.base.drill);
      expect(to.inputs.length).toBeGreaterThan(0);
    }
    expect(MAX_SHIP_SLOTS).toBe(SHIPS.corebreaker.slots);
    expect(MAX_SHIP_CARGO).toBe(SHIPS.corebreaker.base.cargoMax);
  });

  it('pins the balance table', () => {
    const rows = SHIP_ORDER.map(id => {
      const ship = SHIPS[id];
      return [ship.label, ship.slots, ship.base.fuelMax, ship.base.hullMax, ship.base.cargoMax, ship.base.drill];
    });
    expect(rows).toEqual([
      ['Scout', 3, 100, 100, 20, 1],
      ['Hauler', 4, 150, 125, 30, 1],
      ['Prospector', 5, 200, 150, 40, 2],
      ['Leviathan', 6, 275, 200, 55, 3],
      ['Core Breaker', 7, 350, 250, 70, 4]
    ]);
  });

  it('builds every hull from ores the ore table knows', () => {
    const names = new Set(ORES.map(ore => oreKind(ore.name)));
    for (const id of SHIP_ORDER) {
      for (const input of SHIPS[id].inputs) expect(names.has(input.kind as ReturnType<typeof oreKind>)).toBe(true);
    }
  });
});

describe('the ladder', () => {
  it('only ever steps up one rung, and stops at the Core Breaker', () => {
    expect(nextShip('scout')).toBe('hauler');
    expect(nextShip('hauler')).toBe('prospector');
    expect(nextShip('prospector')).toBe('leviathan');
    expect(nextShip('leviathan')).toBe('corebreaker');
    expect(nextShip('corebreaker')).toBeNull();
    expect(SHIP_ORDER.map(shipTier)).toEqual([0, 1, 2, 3, 4]);
  });

  it('tells a real hull id from junk', () => {
    expect(isShipId('hauler')).toBe(true);
    expect(isShipId('battlecruiser')).toBe(false);
    expect(isShipId(3)).toBe(false);
    expect(isShipId(undefined)).toBe(false);
  });

  it('prices a swap as the difference of the two bases', () => {
    expect(shipGains('scout', 'hauler')).toEqual({fuelMax: 50, hullMax: 25, cargoMax: 10, drill: 0});
    expect(formatShipGains('scout', 'hauler')).toBe('+1 slot · +50 fuel · +25 hull · +10 cargo');
    expect(formatShipGains('hauler', 'prospector')).toBe('+1 slot · +50 fuel · +25 hull · +10 cargo · +1 drill');
  });

  it('bills the Hauler light on Iron, the early bottleneck', () => {
    expect(shipFor('hauler').inputs).toEqual([
      {kind: oreKind('Iron'), count: 16},
      {kind: oreKind('Copper'), count: 10},
      {kind: oreKind('Silver'), count: 6}
    ]);
  });

  it('is checked against station stock with the recipe helpers', () => {
    const hauler = shipFor('hauler');
    let stock = createInventory();
    stock = addItem(stock, itemForKind(oreKind('Iron')), 16);
    expect(canCraft(stock, hauler)).toBe(false);
    expect(missingInputs(stock, hauler)).toEqual([
      {kind: oreKind('Copper'), count: 10},
      {kind: oreKind('Silver'), count: 6}
    ]);
    stock = addItem(addItem(stock, itemForKind(oreKind('Copper')), 10), itemForKind(oreKind('Silver')), 6);
    expect(canCraft(stock, hauler)).toBe(true);
  });
});

describe('fitEquipmentTo', () => {
  it('keeps fitted slots in place and pads or trims to the hull', () => {
    expect(fitEquipmentTo(['a', null, 'b'], 'hauler')).toEqual(['a', null, 'b', null]);
    expect(fitEquipmentTo(['a', null, 'b', 'c', 'd'], 'scout')).toEqual(['a', null, 'b']);
    expect(fitEquipmentTo([], 'leviathan')).toHaveLength(slotsFor('leviathan'));
  });
});

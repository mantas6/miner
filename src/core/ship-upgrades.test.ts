// The ship-equipment rules: what fitted upgrades derive, and when a fit or an
// unfit is refused. Pure functions over a Player, no DOM and no game loop.

import { describe, expect, it } from 'vitest';
import { STARTING } from './balance';
import { addItem, countItem, createInventory, oreItem } from './inventory';
import { itemForKind } from './items';
import { createInitialState } from './state';
import {
  SHIP_UPGRADE_SLOTS,
  applyEquipment,
  canUnequip,
  computeStats,
  equip,
  unequip
} from './ship-upgrades';
import type { Player } from './types';

const COPPER = {name: 'Copper', color: '#c87a3a', value: 8, min: 0, max: 900, chance: 1};

function player(): Player {
  return createInitialState().player;
}

describe('the fitting slots', () => {
  it('carries exactly the persisted number of slots', () => {
    expect(SHIP_UPGRADE_SLOTS).toBe(2);
    expect(player().equipment).toHaveLength(SHIP_UPGRADE_SLOTS);
  });
});

describe('applyEquipment', () => {
  it('leaves a bare ship at the starting base', () => {
    const p = player();
    p.equipment = [null, null];
    applyEquipment(p);
    expect(p.fuelMax).toBe(STARTING.fuelMax);
    expect(p.hullMax).toBe(STARTING.hullMax);
    expect(p.cargoMax).toBe(STARTING.cargoMax);
    expect(p.drill).toBe(STARTING.drill);
    expect(p.boost).toBe(false);
  });

  it('sums duplicate bonuses over the base', () => {
    const p = player();
    p.equipment = ['upgrade:tank:2', 'upgrade:tank:1'];
    applyEquipment(p);
    // +100 and +50 over the starting 100.
    expect(p.fuelMax).toBe(250);
  });

  it('adds a mix of stats and raises the boost flag for a booster', () => {
    const p = player();
    p.equipment = ['upgrade:drill:3', 'upgrade:booster:1'];
    applyEquipment(p);
    expect(p.drill).toBe(STARTING.drill + 4);
    expect(p.boost).toBe(true);
    // The booster touches no stat of its own.
    expect(p.fuelMax).toBe(STARTING.fuelMax);
  });

  it('clamps fuel and hull down when the maxima shrink', () => {
    const p = player();
    p.equipment = ['upgrade:tank:2', 'upgrade:hull:2'];
    applyEquipment(p);
    p.fuel = p.fuelMax;
    p.hull = p.hullMax;

    p.equipment = [null, null];
    applyEquipment(p);
    expect(p.fuelMax).toBe(STARTING.fuelMax);
    expect(p.fuel).toBe(STARTING.fuelMax);
    expect(p.hull).toBe(STARTING.hullMax);
  });
});

describe('computeStats', () => {
  it('derives without touching a Player', () => {
    expect(computeStats(['upgrade:cargo:3', null]).cargoMax).toBe(STARTING.cargoMax + 40);
    expect(computeStats(['upgrade:booster:1', null]).boost).toBe(true);
  });
});

describe('equip', () => {
  it('moves an upgrade out of the bay and into the slot', () => {
    const p = player();
    p.inventory = addItem(createInventory(), itemForKind('upgrade:tank:1'));

    const result = equip(p, 0, 'upgrade:tank:1');

    expect(result.ok).toBe(true);
    expect(p.equipment[0]).toBe('upgrade:tank:1');
    expect(countItem(p.inventory, 'upgrade:tank:1')).toBe(0);
    expect(p.fuelMax).toBe(STARTING.fuelMax + 50);
  });

  it('refuses when the upgrade is not in the bay', () => {
    const p = player();
    const result = equip(p, 0, 'upgrade:tank:1');
    expect(result.ok).toBe(false);
    expect(p.equipment[0]).toBeNull();
  });

  it('swaps the previous occupant back into the bay', () => {
    const p = player();
    p.equipment = ['upgrade:tank:1', null];
    p.inventory = addItem(createInventory(), itemForKind('upgrade:drill:2'));
    applyEquipment(p);

    const result = equip(p, 0, 'upgrade:drill:2');

    expect(result.ok).toBe(true);
    expect(p.equipment[0]).toBe('upgrade:drill:2');
    expect(countItem(p.inventory, 'upgrade:drill:2')).toBe(0);
    expect(countItem(p.inventory, 'upgrade:tank:1')).toBe(1);
    expect(p.drill).toBe(STARTING.drill + 2);
    expect(p.fuelMax).toBe(STARTING.fuelMax);
  });

  it('refuses a swap the shrunken cargo bay could not hold the old upgrade back into', () => {
    const p = player();
    // Cargo Hold Mk III fitted: cargoMax 60. Swapping it out for a tank drops it
    // back to 20, but the bay is already carrying 20 ore plus the tank to fit.
    p.equipment = ['upgrade:cargo:3', null];
    applyEquipment(p);
    let inv = addItem(createInventory(), oreItem(COPPER), 20);
    inv = addItem(inv, itemForKind('upgrade:tank:1'));
    p.inventory = inv;

    const result = equip(p, 0, 'upgrade:tank:1');

    expect(result).toEqual({ok: false, reason: expect.stringContaining('Cargo bay')});
    // Nothing moved.
    expect(p.equipment[0]).toBe('upgrade:cargo:3');
    expect(countItem(p.inventory, 'upgrade:tank:1')).toBe(1);
  });
});

describe('canUnequip / unequip', () => {
  it('refuses to unfit a Cargo Hold whose room the bay is already using', () => {
    const p = player();
    p.equipment = ['upgrade:cargo:1', null]; // cargoMax 30
    applyEquipment(p);
    p.inventory = addItem(createInventory(), oreItem(COPPER), 30); // bay full at 30

    expect(canUnequip(p, 0)).toBe(false);
    const result = unequip(p, 0);
    expect(result.ok).toBe(false);
    expect(p.equipment[0]).toBe('upgrade:cargo:1');
  });

  it('unfits an upgrade back into the bay when there is room', () => {
    const p = player();
    p.equipment = ['upgrade:cargo:1', null];
    applyEquipment(p);
    p.inventory = addItem(createInventory(), oreItem(COPPER), 5);

    expect(canUnequip(p, 0)).toBe(true);
    const result = unequip(p, 0);

    expect(result.ok).toBe(true);
    expect(p.equipment[0]).toBeNull();
    expect(countItem(p.inventory, 'upgrade:cargo:1')).toBe(1);
    expect(p.cargoMax).toBe(STARTING.cargoMax);
  });

  it('refuses to unfit an empty slot', () => {
    const p = player();
    const result = unequip(p, 1);
    expect(result.ok).toBe(false);
    expect(canUnequip(p, 1)).toBe(false);
  });
});

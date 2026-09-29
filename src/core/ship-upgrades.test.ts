// The ship-equipment rules: what fitted upgrades derive, and when a fit or an
// unfit is refused. Pure functions over a Player, no DOM and no game loop.

import { describe, expect, it } from 'vitest';
import { STARTING } from './balance';
import { addItem, countItem, createInventory, oreItem, type UpgradeKind } from './inventory';
import { itemForKind } from './items';
import { hitsLeft } from './scanner';
import { createInitialState } from './state';
import {
  SHIP_UPGRADE_SLOTS,
  UPGRADE_EFFECTS,
  applyEquipment,
  canUnequip,
  computeStats,
  equip,
  firstFittingSlot,
  hasEmptyOpenSlot,
  isSlotLocked,
  unequip,
  unlockedSlotCount,
  upgradeBonus
} from './ship-upgrades';
import type { Player } from './types';

const COPPER = {name: 'Copper', color: '#c87a3a', value: 8, min: 0, max: 900, chance: 1};
/** `stats.bestMarkCrafted` before and after the first Mk II craft. */
const LOCKED = 1;
const UNLOCKED = 2;

function player(): Player {
  return createInitialState().player;
}

/** A ship with `equipment` fitted, its maxima derived and its tank and hull full. */
function fitted(equipment: (UpgradeKind | null)[]): Player {
  const p = player();
  p.equipment = equipment;
  applyEquipment(p);
  p.fuel = p.fuelMax;
  p.hull = p.hullMax;
  return p;
}

function withBay(p: Player, ...kinds: UpgradeKind[]): Player {
  for (const kind of kinds) p.inventory = addItem(p.inventory, itemForKind(kind));
  return p;
}

describe('the fitting slots', () => {
  it('carries exactly the persisted number of slots', () => {
    expect(SHIP_UPGRADE_SLOTS).toBe(3);
    expect(player().equipment).toHaveLength(SHIP_UPGRADE_SLOTS);
  });

  it('keeps the last slot locked until a Mk II has been crafted', () => {
    expect(unlockedSlotCount(0)).toBe(2);
    expect(unlockedSlotCount(LOCKED)).toBe(2);
    expect(unlockedSlotCount(UNLOCKED)).toBe(3);
    expect(unlockedSlotCount(4)).toBe(3);
    expect([0, 1, 2].map(slot => isSlotLocked(slot, LOCKED))).toEqual([false, false, true]);
    expect([0, 1, 2].map(slot => isSlotLocked(slot, UNLOCKED))).toEqual([false, false, false]);
  });

  it('picks the first empty open slot, never a locked one', () => {
    expect(firstFittingSlot([null, null, null], LOCKED)).toBe(0);
    expect(firstFittingSlot(['upgrade:tank:1', null, null], LOCKED)).toBe(1);
    // Both open slots full: swap into slot 0 rather than the locked third.
    expect(firstFittingSlot(['upgrade:tank:1', 'upgrade:drill:1', null], LOCKED)).toBe(0);
    expect(firstFittingSlot(['upgrade:tank:1', 'upgrade:drill:1', null], UNLOCKED)).toBe(2);
    expect(firstFittingSlot(['upgrade:tank:1', 'upgrade:drill:1', 'upgrade:hull:1'], UNLOCKED)).toBe(0);
  });

  it('tells an empty open slot from a full or locked one', () => {
    expect(hasEmptyOpenSlot([null, null, null], LOCKED)).toBe(true);
    expect(hasEmptyOpenSlot(['upgrade:tank:1', null, null], LOCKED)).toBe(true);
    // Only the locked third is empty: nothing to fit into.
    expect(hasEmptyOpenSlot(['upgrade:tank:1', 'upgrade:drill:1', null], LOCKED)).toBe(false);
    expect(hasEmptyOpenSlot(['upgrade:tank:1', 'upgrade:drill:1', null], UNLOCKED)).toBe(true);
    expect(hasEmptyOpenSlot(['upgrade:tank:1', 'upgrade:drill:1', 'upgrade:hull:1'], UNLOCKED)).toBe(false);
  });
});

describe('applyEquipment', () => {
  it('leaves a bare ship at the starting base', () => {
    const p = player();
    p.equipment = [null, null, null];
    applyEquipment(p);
    expect(p.fuelMax).toBe(STARTING.fuelMax);
    expect(p.hullMax).toBe(STARTING.hullMax);
    expect(p.cargoMax).toBe(STARTING.cargoMax);
    expect(p.drill).toBe(STARTING.drill);
    expect(p.boost).toBe(false);
  });

  it('sums duplicate bonuses over the base', () => {
    const p = player();
    p.equipment = ['upgrade:tank:2', 'upgrade:tank:1', 'upgrade:tank:1'];
    applyEquipment(p);
    // +100, +50 and +50 over the starting 100.
    expect(p.fuelMax).toBe(300);
  });

  it('adds a mix of stats and raises the boost flag for a booster', () => {
    const p = player();
    p.equipment = ['upgrade:drill:3', 'upgrade:booster:1', null];
    applyEquipment(p);
    expect(p.drill).toBe(STARTING.drill + 3.5);
    expect(p.boost).toBe(true);
    // The booster touches no stat of its own.
    expect(p.fuelMax).toBe(STARTING.fuelMax);
  });

  it('clamps fuel and hull down when the maxima shrink, and never tops them up', () => {
    const p = fitted(['upgrade:tank:2', 'upgrade:hull:2', null]);

    p.equipment = [null, null, null];
    applyEquipment(p);
    expect(p.fuelMax).toBe(STARTING.fuelMax);
    expect(p.fuel).toBe(STARTING.fuelMax);
    expect(p.hull).toBe(STARTING.hullMax);

    // The load path: restoring a bigger tank sets the maximum, not the fuel.
    p.fuel = 40;
    p.equipment = ['upgrade:tank:2', null, null];
    applyEquipment(p);
    expect(p.fuelMax).toBe(STARTING.fuelMax + 100);
    expect(p.fuel).toBe(40);
  });
});

describe('drill marks', () => {
  it('uses fractional bonuses so no mark is a dead zone', () => {
    expect(UPGRADE_EFFECTS.drill.bonuses).toEqual([0.75, 1.75, 3.5, 7]);
    expect(computeStats(['upgrade:drill:1', null, null]).drill).toBe(1.75);
    expect(computeStats(['upgrade:drill:2', null, null]).drill).toBe(2.75);
    expect(computeStats(['upgrade:drill:3', null, null]).drill).toBe(4.5);
  });

  it('gives the tier-4 Core Drill +7 power, stacking with the other marks', () => {
    expect(upgradeBonus('upgrade:drill:4')).toBe(7);
    expect(computeStats(['upgrade:drill:4', null, null]).drill).toBe(STARTING.drill + 7);
    expect(computeStats(['upgrade:drill:4', 'upgrade:drill:3', null]).drill).toBe(STARTING.drill + 10.5);
    // It cuts 9-hp dirt to two hits and 16-hp stone-hard ground to two as well.
    expect(hitsLeft(9, STARTING.drill + 7)).toBe(2);
    expect(hitsLeft(16, STARTING.drill + 7)).toBe(2);
  });

  it('fits the Core Drill from the bay like any other upgrade', () => {
    const p = withBay(fitted([null, null, null]), 'upgrade:drill:4');
    expect(equip(p, 0, 'upgrade:drill:4', UNLOCKED)).toEqual({ok: true});
    expect(p.equipment[0]).toBe('upgrade:drill:4');
    expect(p.drill).toBe(STARTING.drill + 7);
    expect(countItem(p.inventory, 'upgrade:drill:4')).toBe(0);
  });

  it('every single-slot drill mark cuts hits on 6/9 hp dirt', () => {
    const loadouts: (UpgradeKind | null)[] = [null, 'upgrade:drill:1', 'upgrade:drill:2', 'upgrade:drill:3'];
    const powers = loadouts.map(kind => computeStats([kind, null, null]).drill);
    const hits = (hp: number) => powers.map(power => hitsLeft(hp, power));
    expect(hits(9)).toEqual([9, 6, 4, 2]);
    expect(hits(6)).toEqual([6, 4, 3, 2]);
  });

  it('drives tile hp down by the real drill power and clears at zero', () => {
    // Four hits of Mk II (2.75) on 9-hp dirt: 6.25, 3.5, 0.75, then ≤ 0. The
    // arithmetic stays exact because every bonus is a multiple of 1/4.
    const power = computeStats(['upgrade:drill:2', null, null]).drill;
    let hp = 9;
    const trail: number[] = [];
    while (hp > 0) { hp -= power; trail.push(hp); }
    expect(trail).toEqual([6.25, 3.5, 0.75, -2]);
  });
});

describe('computeStats', () => {
  it('derives without touching a Player', () => {
    expect(computeStats(['upgrade:cargo:3', null, null]).cargoMax).toBe(STARTING.cargoMax + 40);
    expect(computeStats(['upgrade:booster:1', null, null]).boost).toBe(true);
  });
});

describe('equip', () => {
  it('moves an upgrade out of the bay and into the slot', () => {
    const p = withBay(player(), 'upgrade:tank:1');

    const result = equip(p, 0, 'upgrade:tank:1', LOCKED);

    expect(result.ok).toBe(true);
    expect(p.equipment[0]).toBe('upgrade:tank:1');
    expect(countItem(p.inventory, 'upgrade:tank:1')).toBe(0);
    expect(p.fuelMax).toBe(STARTING.fuelMax + 50);
  });

  it('refuses when the upgrade is not in the bay', () => {
    const p = player();
    const result = equip(p, 0, 'upgrade:tank:1', LOCKED);
    expect(result.ok).toBe(false);
    expect(p.equipment[0]).toBeNull();
  });

  it('refuses the locked third slot until a Mk II has been crafted', () => {
    const p = withBay(player(), 'upgrade:tank:1');

    const refused = equip(p, 2, 'upgrade:tank:1', LOCKED);
    expect(refused).toEqual({ok: false, reason: expect.stringContaining('locked')});
    expect(p.equipment[2]).toBeNull();
    expect(countItem(p.inventory, 'upgrade:tank:1')).toBe(1);

    expect(equip(p, 2, 'upgrade:tank:1', UNLOCKED).ok).toBe(true);
    expect(p.equipment[2]).toBe('upgrade:tank:1');
  });

  it('swaps the previous occupant back into the bay', () => {
    const p = withBay(fitted(['upgrade:tank:1', null, null]), 'upgrade:drill:2');

    const result = equip(p, 0, 'upgrade:drill:2', LOCKED);

    expect(result.ok).toBe(true);
    expect(p.equipment[0]).toBe('upgrade:drill:2');
    expect(countItem(p.inventory, 'upgrade:drill:2')).toBe(0);
    expect(countItem(p.inventory, 'upgrade:tank:1')).toBe(1);
    expect(p.drill).toBe(STARTING.drill + 1.75);
    expect(p.fuelMax).toBe(STARTING.fuelMax);
  });

  it('refuses a swap the shrunken cargo bay could not hold the old upgrade back into', () => {
    const p = player();
    // Cargo Hold Mk III fitted: cargoMax 60. Swapping it out for a tank drops it
    // back to 20, but the bay is already carrying 20 ore plus the tank to fit.
    p.equipment = ['upgrade:cargo:3', null, null];
    applyEquipment(p);
    let inv = addItem(createInventory(), oreItem(COPPER), 20);
    inv = addItem(inv, itemForKind('upgrade:tank:1'));
    p.inventory = inv;

    const result = equip(p, 0, 'upgrade:tank:1', LOCKED);

    expect(result).toEqual({ok: false, reason: expect.stringContaining('Cargo bay')});
    // Nothing moved.
    expect(p.equipment[0]).toBe('upgrade:cargo:3');
    expect(countItem(p.inventory, 'upgrade:tank:1')).toBe(1);
  });
});

describe('fitting carries the change in maximum over to fuel and hull', () => {
  it('adds a tank or plating bonus to the current fuel or hull once', () => {
    const p = withBay(player(), 'upgrade:tank:1', 'upgrade:hull:1');
    p.fuel = 60;
    p.hull = 30;

    expect(equip(p, 0, 'upgrade:tank:1', LOCKED).ok).toBe(true);
    expect(p).toMatchObject({fuel: 110, fuelMax: STARTING.fuelMax + 50});
    expect(equip(p, 1, 'upgrade:hull:1', LOCKED).ok).toBe(true);
    expect(p).toMatchObject({hull: 80, hullMax: STARTING.hullMax + 50});
  });

  it('is neutral across an unfit and refit — no free fuel or hull', () => {
    const p = fitted(['upgrade:tank:1', 'upgrade:hull:1', null]);
    p.fuel = 90;
    p.hull = 70;

    expect(unequip(p, 0).ok).toBe(true);
    expect(unequip(p, 1).ok).toBe(true);
    expect(p).toMatchObject({fuel: 40, hull: 20});
    expect(equip(p, 0, 'upgrade:tank:1', LOCKED).ok).toBe(true);
    expect(equip(p, 1, 'upgrade:hull:1', LOCKED).ok).toBe(true);
    expect(p).toMatchObject({fuel: 90, hull: 70});
  });

  it('carries a swap between tank marks as the difference in their bonuses', () => {
    const p = withBay(fitted(['upgrade:tank:2', null, null]), 'upgrade:tank:1');
    p.fuel = 150;

    expect(equip(p, 0, 'upgrade:tank:1', LOCKED).ok).toBe(true);
    expect(p).toMatchObject({fuel: 100, fuelMax: STARTING.fuelMax + 50});
  });

  it('leaves fuel and hull alone for a loadout change that moves neither maximum', () => {
    const p = withBay(fitted(['upgrade:drill:1', null, null]), 'upgrade:drill:2');
    p.fuel = 0.5;
    p.hull = 0.5;

    expect(equip(p, 0, 'upgrade:drill:2', LOCKED).ok).toBe(true);
    expect(p).toMatchObject({fuel: 0.5, hull: 0.5});
  });

  it('refuses an unfit that would drain the tank below 1', () => {
    const p = fitted(['upgrade:tank:1', null, null]);
    p.fuel = 50.5;

    expect(unequip(p, 0)).toEqual({ok: false, reason: 'Not enough fuel to purge that tank.'});
    expect(p.equipment[0]).toBe('upgrade:tank:1');
    expect(p.fuel).toBe(50.5);
    expect(countItem(p.inventory, 'upgrade:tank:1')).toBe(0);

    p.fuel = 51;
    expect(unequip(p, 0).ok).toBe(true);
    expect(p.fuel).toBe(1);
  });

  it('refuses an unfit that would break the hull', () => {
    const p = fitted(['upgrade:hull:2', null, null]);
    p.hull = 100;

    expect(unequip(p, 0)).toEqual({ok: false, reason: 'Not enough hull to strip that plating.'});
    expect(p.equipment[0]).toBe('upgrade:hull:2');
    expect(p.hull).toBe(100);
  });

  it('refuses a swap that would drain the tank below 1, changing nothing', () => {
    const p = withBay(fitted(['upgrade:tank:3', null, null]), 'upgrade:drill:1');
    p.fuel = 150;

    expect(equip(p, 0, 'upgrade:drill:1', LOCKED)).toEqual({ok: false, reason: 'Not enough fuel to purge that tank.'});
    expect(p.equipment[0]).toBe('upgrade:tank:3');
    expect(p.fuel).toBe(150);
    expect(countItem(p.inventory, 'upgrade:drill:1')).toBe(1);
    expect(countItem(p.inventory, 'upgrade:tank:3')).toBe(0);
  });
});

describe('canUnequip / unequip', () => {
  it('refuses to unfit a Cargo Hold whose room the bay is already using', () => {
    const p = fitted(['upgrade:cargo:1', null, null]); // cargoMax 30
    p.inventory = addItem(createInventory(), oreItem(COPPER), 30); // bay full at 30

    expect(canUnequip(p, 0)).toBe(false);
    const result = unequip(p, 0);
    expect(result.ok).toBe(false);
    expect(p.equipment[0]).toBe('upgrade:cargo:1');
  });

  it('unfits an upgrade back into the bay when there is room', () => {
    const p = fitted(['upgrade:cargo:1', null, null]);
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
    expect(unequip(p, 2).ok).toBe(false);
  });
});

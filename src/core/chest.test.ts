// The chest rules: what a chest was buried with, how its mark of upgrade rises with
// depth, which chests still lie in the mine, and how far the lid opens from. The
// wiring that opens one and retires it once bare is game/chests.test.ts.

import { describe, expect, it } from 'vitest';
import { ORES, START_Y, WORLD_W } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';
import { chestsInRange } from '../world/world';
import {
  CHEST,
  CHEST_DEEP_DEPTH,
  CHEST_MID_DEPTH,
  chestContents,
  chestKey,
  chestLoot,
  chestStandsAt,
  chestUpgradePool,
  inventoryFromLedger,
  isChestLooted,
  isChestReachable,
  ledgerStacks,
  reachableChest
} from './chest';
import { isCatalogKind } from './items';
import { isOreKind, isUpgradeKind, parseUpgradeKind, totalItems } from './inventory';
import { nth } from '../test-narrowing';

/** A spread of coordinates across the mine's depth bands. */
function sample(rows: [number, number], count = 400): {x: number; y: number}[] {
  const out: {x: number; y: number}[] = [];
  for (let i = 0; i < count; i++) {
    out.push({x: 2 + (i * 7) % (WORLD_W - 4), y: rows[0] + Math.floor((i * 131) % (rows[1] - rows[0]))});
  }
  return out;
}

describe('chestLoot', () => {
  it('is deterministic for a coordinate', () => {
    for (const {x, y} of sample([START_Y + 8, START_Y + 900], 50)) expect(chestLoot(x, y)).toEqual(chestLoot(x, y));
  });

  it('rolls 2–4 distinct, real, non-cash stacks', () => {
    for (const {x, y} of sample([START_Y + 8, START_Y + 900])) {
      const loot = chestLoot(x, y);
      expect(loot.length).toBeGreaterThanOrEqual(2);
      expect(loot.length).toBeLessThanOrEqual(4);
      expect(new Set(loot.map(stack => stack.kind)).size).toBe(loot.length);
      for (const stack of loot) {
        expect(stack.count).toBeGreaterThan(0);
        expect(isOreKind(stack.kind) || isCatalogKind(stack.kind)).toBe(true);
      }
    }
  });

  it('draws ore from the depth band the chest lies in', () => {
    for (const {x, y} of sample([START_Y + 8, START_Y + 900])) {
      for (const stack of chestLoot(x, y).filter(entry => isOreKind(entry.kind))) {
        // An ore item carries its own record; the chest must lie inside its band.
        const ore = ORES.find(entry => entry.name === stack.item.label)!;
        expect(y).toBeGreaterThanOrEqual(ore.min);
        expect(y).toBeLessThanOrEqual(ore.max);
      }
    }
    // Shallow chests never hold gold.
    for (const {x, y} of sample([START_Y + 8, START_Y + 60])) {
      expect(chestLoot(x, y).some(stack => stack.kind === 'ore:Gold')).toBe(false);
    }
  });

  it('holds a ship upgrade in only a few chests in a hundred', () => {
    const coords = sample([START_Y + 8, START_Y + 900], 2000);
    const withUpgrade = coords.filter(({x, y}) => chestLoot(x, y).some(stack => isUpgradeKind(stack.kind))).length;
    const rate = withUpgrade / coords.length;
    expect(CHEST.upgradeChance).toBeCloseTo(0.07);
    expect(rate).toBeGreaterThan(0.03);
    expect(rate).toBeLessThan(0.12);
  });

  it('gates the upgrade mark by depth: Mk I shallow, Mk II mid, Mk III or Booster deep', () => {
    expect(chestUpgradePool(START_Y + 10).every(kind => parseUpgradeKind(kind).tier === 1 && kind !== 'upgrade:booster:1')).toBe(true);
    expect(chestUpgradePool(START_Y + CHEST_MID_DEPTH).every(kind => parseUpgradeKind(kind).tier === 2)).toBe(true);
    expect(chestUpgradePool(START_Y + CHEST_DEEP_DEPTH)).toContain('upgrade:booster:1');
    expect(chestUpgradePool(START_Y + CHEST_DEEP_DEPTH).filter(kind => kind !== 'upgrade:booster:1')
      .every(kind => parseUpgradeKind(kind).tier === 3)).toBe(true);
    // And the loot itself respects it.
    const tiers = (rows: [number, number]) => sample(rows, 3000)
      .flatMap(({x, y}) => chestLoot(x, y).filter(stack => isUpgradeKind(stack.kind)).map(stack => stack.kind));
    const shallow = tiers([START_Y + 8, START_Y + CHEST_MID_DEPTH - 1]);
    expect(shallow.length).toBeGreaterThan(0);
    expect(shallow.every(kind => kind.endsWith(':1') && kind !== 'upgrade:booster:1')).toBe(true);
    const deep = tiers([START_Y + CHEST_DEEP_DEPTH, START_Y + 900]);
    expect(deep.length).toBeGreaterThan(0);
    expect(deep.every(kind => kind.endsWith(':3') || kind === 'upgrade:booster:1')).toBe(true);
  });
});

describe('the chest ledger', () => {
  const chest = nth(chestsInRange(0, 0, WORLD_W - 1, 400), 0);

  it('holds rolled loot until first opened, then whatever the ledger says', () => {
    expect(chestContents({}, chest.x, chest.y)).toEqual(chestLoot(chest.x, chest.y));
    const ledger = {[chestKey(chest.x, chest.y)]: [{kind: 'dynamite' as const, count: 2}]};
    expect(totalItems(chestContents(ledger, chest.x, chest.y))).toBe(2);
  });

  it('round-trips an inventory through ledger stacks', () => {
    const loot = chestLoot(chest.x, chest.y);
    expect(inventoryFromLedger(ledgerStacks(loot))).toEqual(loot);
  });

  it('counts an empty entry as a chest looted bare, gone from the mine', () => {
    const ledger = {[chestKey(chest.x, chest.y)]: []};
    expect(isChestLooted(ledger, chest.x, chest.y)).toBe(true);
    expect(chestStandsAt(chest.x, chest.y, ledger)).toBeNull();
    expect(chestStandsAt(chest.x, chest.y, {})).toEqual(chest);
    expect(chestStandsAt(chest.x, chest.y)).toEqual(chest);
    expect(chestStandsAt(chest.x + 1, chest.y, {})).toBeNull();
  });

  it('opens from the chest tile or any of the eight around it, if explored', () => {
    expect(isChestReachable(chest, chest.x + 1, chest.y + 1)).toBe(true);
    expect(isChestReachable(chest, chest.x + 2, chest.y)).toBe(false);
    const explored = new Set([explorationIndex(chest.x, chest.y)]);
    expect(reachableChest({}, explored, chest.x - 1, chest.y)).toEqual(chest);
    expect(reachableChest({}, explored, chest.x, chest.y)).toEqual(chest);
    expect(reachableChest({}, explored, chest.x - 2, chest.y)).toBeNull();
    // Under fog, or looted bare, there is nothing to open.
    expect(reachableChest({}, new Set(), chest.x, chest.y)).toBeNull();
    expect(reachableChest({[chestKey(chest.x, chest.y)]: []}, explored, chest.x, chest.y)).toBeNull();
  });
});

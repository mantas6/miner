// The wreck rules: what a dying ship leaves behind, where a wreck stands, how far
// its hatch opens from, and what a salvage transfer is allowed to move. The wiring
// that opens one and removes it when emptied is game/wrecks.test.ts.

import { describe, expect, it } from 'vitest';
import { addItem, addOre, countItem, countOres, createInventory, oreItem } from './inventory';
import type { Ore, Player } from './types';
import {
  WRECK,
  buildWreckInventory,
  createWreck,
  dropWreck,
  isWreckReachable,
  lootAll,
  reachableWreck,
  takeFromWreck,
  wreckAt,
  type Wreck
} from './wreck';

const COPPER: Ore = {name: 'Copper', color: '#c87a3a', value: 8, min: 0, max: 900, chance: 1};
const IRON: Ore = {name: 'Iron', color: '#b7c3d0', value: 5, min: 0, max: 900, chance: 1};

/** A minimal player carrying `ore` copper and the two fitted upgrades below. */
function player(overrides: Partial<Player> = {}): Pick<Player, 'x' | 'y' | 'inventory' | 'equipment'> {
  return {
    x: 20,
    y: 80,
    inventory: addItem(addOre(createInventory(), COPPER, 50)!, oreItem(IRON), 3),
    equipment: ['upgrade:tank:1', 'upgrade:drill:2'],
    ...overrides
  } as Pick<Player, 'x' | 'y' | 'inventory' | 'equipment'>;
}

describe('buildWreckInventory', () => {
  it('collects the ore aboard and one item per fitted upgrade', () => {
    const inventory = buildWreckInventory(player());

    expect(countOres(inventory)).toBe(4); // 1 copper + 3 iron
    expect(countItem(inventory, 'upgrade:tank:1')).toBe(1);
    expect(countItem(inventory, 'upgrade:drill:2')).toBe(1);
  });

  it('leaves non-ore bay equipment out — that rides out with the miner', () => {
    const p = player({
      inventory: addItem(addOre(createInventory(), COPPER, 50)!, oreItem(IRON), 1),
      equipment: [null, null]
    });
    // Add a teleporter to the bay: it survives a death, so it is not wreck loot.
    p.inventory = addItem(p.inventory, {kind: 'teleporter', label: 'Teleporter', color: '#72d9ff', value: 0});

    const inventory = buildWreckInventory(p);

    expect(countItem(inventory, 'teleporter')).toBe(0);
    expect(countOres(inventory)).toBe(2);
  });

  it('is empty for a ship with no ore and no upgrades', () => {
    expect(buildWreckInventory({inventory: createInventory(), equipment: [null, null]})).toEqual([]);
  });
});

describe('dropWreck', () => {
  it('pushes a wreck at the ship tile holding what a death would strip', () => {
    const wrecks: Wreck[] = [];
    const wreck = dropWreck(wrecks, player());

    expect(wreck).not.toBeNull();
    expect(wreck).toMatchObject({x: 20, y: 80});
    expect(wrecks).toEqual([wreck]);
    expect(countOres(wreck!.inventory)).toBe(4);
  });

  it('leaves no wreck when the ship carries nothing worth salvaging', () => {
    const wrecks: Wreck[] = [];
    const wreck = dropWreck(wrecks, {x: 1, y: 2, inventory: createInventory(), equipment: [null]});

    expect(wreck).toBeNull();
    expect(wrecks).toEqual([]);
  });

  it('caps the graveyard at WRECK.maxPlaced, dropping the oldest', () => {
    const wrecks = Array.from({length: WRECK.maxPlaced}, (_, i) => createWreck(i, 0));
    const wreck = dropWreck(wrecks, player());

    expect(wrecks).toHaveLength(WRECK.maxPlaced);
    expect(wrecks[0]).not.toMatchObject({x: 0, y: 0}); // the first was shifted off
    expect(wrecks.at(-1)).toBe(wreck);
  });
});

describe('wreck reach', () => {
  it('finds a wreck on a tile and answers reach in Chebyshev distance', () => {
    const wrecks = [createWreck(10, 10)];
    expect(wreckAt(wrecks, 10, 10)).toBe(wrecks[0]);
    expect(wreckAt(wrecks, 11, 10)).toBeNull();
    expect(isWreckReachable(wrecks[0], 11, 11)).toBe(true);  // one tile diagonal
    expect(isWreckReachable(wrecks[0], 12, 10)).toBe(false); // two tiles away
  });

  it('opens the nearest wreck in reach, the one under the ship winning', () => {
    const under = createWreck(10, 10);
    const beside = createWreck(11, 10);
    const wrecks = [beside, under];

    expect(reachableWreck(wrecks, 10, 10)).toBe(under);
    expect(reachableWreck(wrecks, 20, 20)).toBeNull();
  });
});

describe('takeFromWreck', () => {
  it('hauls a whole stack up to the cargo-bay limit', () => {
    const wreck = addItem(createInventory(), oreItem(COPPER), 6);
    const result = takeFromWreck(createInventory(), wreck, oreItem(COPPER).kind, 10);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(countOres(result.ship)).toBe(6);
    expect(countOres(result.wreck)).toBe(0);
    expect(result.moved).toBe(6);
  });

  it('takes a single unit, leaving the rest in the wreck', () => {
    const wreck = addItem(createInventory(), oreItem(COPPER), 6);
    const result = takeFromWreck(createInventory(), wreck, oreItem(COPPER).kind, 10, 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(countOres(result.ship)).toBe(1);
    expect(countOres(result.wreck)).toBe(5);
  });

  it('takes only what the cargo bay can still hold', () => {
    const ship = addOre(createInventory(), COPPER, 10)!; // bay holds 8, one short of cargoMax? use explicit
    const wreck = addItem(createInventory(), oreItem(IRON), 5);
    const result = takeFromWreck(ship, wreck, oreItem(IRON).kind, countOres(ship) + 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.moved).toBe(2);
    expect(countItem(result.wreck, oreItem(IRON).kind)).toBe(3);
  });

  it('refuses when the bay is already full', () => {
    const ship = addItem(createInventory(), oreItem(COPPER), 5);
    const wreck = addItem(createInventory(), oreItem(IRON), 3);
    const result = takeFromWreck(ship, wreck, oreItem(IRON).kind, 5);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toContain('Cargo bay is full');
  });

  it('refuses a kind the wreck does not hold', () => {
    const result = takeFromWreck(createInventory(), createInventory(), oreItem(COPPER).kind, 10);
    expect(result.ok).toBe(false);
  });
});

describe('lootAll', () => {
  it('hauls everything that fits and reports the count', () => {
    const wreck = addItem(addItem(createInventory(), oreItem(COPPER), 4), oreItem(IRON), 3);
    const result = lootAll(createInventory(), wreck, 20);

    expect(result.moved).toBe(7);
    expect(result.wreck).toEqual([]);
    expect(countOres(result.ship)).toBe(7);
  });

  it('stops at the cargo-bay limit, leaving the overflow behind', () => {
    const wreck = addItem(createInventory(), oreItem(COPPER), 10);
    const result = lootAll(createInventory(), wreck, 4);

    expect(result.moved).toBe(4);
    expect(countOres(result.wreck)).toBe(6);
  });
});

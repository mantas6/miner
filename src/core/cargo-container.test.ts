// The container's rules: where a crate may stand, how far its lid opens from,
// and what a transfer across the gap is allowed to move.
//
// The wiring — the bay that pays for a placement, the menu the UI paints — is
// game/cargo-containers.test.ts.

import { describe, expect, it } from 'vitest';
import { explorationIndex } from '../../shared/exploration-codec';
import {
  CARGO_CONTAINER,
  CARGO_CONTAINER_ITEM,
  containerAt,
  containerPlacementRefusal,
  createPlacedContainer,
  isWithinContainerReach,
  reachableContainer,
  storeInContainer,
  takeFromContainer
} from './cargo-container';
import { DYNAMITE_ITEM } from './dynamite';
import {
  addItem,
  countItem,
  countOres,
  createInventory,
  oreItem,
  totalItems,
  type Inventory
} from './inventory';
import type { Ore } from './types';

const COPPER: Ore = {name: 'Copper', color: '#c87a3a', value: 8, min: 0, max: 900, chance: 1};
const IRON: Ore = {name: 'Iron', color: '#9aa7b4', value: 12, min: 0, max: 900, chance: 1};

/** A bay holding `count` of one ore. */
function withOre(ore: Ore, count: number, bay: Inventory = createInventory()): Inventory {
  return addItem(bay, oreItem(ore), count);
}

describe('placing a container', () => {
  const explored = new Set([explorationIndex(40, 100)]);
  const site = {explored, open: true, containers: []};

  it('accepts explored, cleared ground inside the mine', () => {
    expect(containerPlacementRefusal(40, 100, site)).toBeNull();
  });

  it.each([
    ['off the mine', 40, -1, {...site}, 'underground'],
    ['still under fog', 41, 100, {...site}, 'already explored'],
    ['inside terrain', 40, 100, {...site, open: false}, 'cleared space']
  ])('refuses a tile %s', (_name, x, y, context, fragment) => {
    expect(containerPlacementRefusal(x, y, context)).toContain(fragment);
  });

  it('refuses a tile another crate already stands on', () => {
    const containers = [createPlacedContainer(40, 100)];

    expect(containerPlacementRefusal(40, 100, {...site, containers})).toContain('already stands');
  });

  it('refuses one more than the mine will hold, before anything else', () => {
    const containers = Array.from({length: CARGO_CONTAINER.maxPlaced}, (_, i) => createPlacedContainer(i, 500));

    // Even for a tile that would otherwise be perfectly good.
    expect(containerPlacementRefusal(40, 100, {...site, containers}))
      .toContain(`${CARGO_CONTAINER.maxPlaced} containers`);
  });
});

describe('reaching a container', () => {
  const container = createPlacedContainer(40, 100);

  it.each([
    ['the crate\'s own tile', 40, 100, true],
    ['the tile beside it', 41, 100, true],
    ['the tile diagonally off it', 41, 101, true],
    ['two tiles away', 42, 100, false],
    ['two rows above', 40, 98, false]
  ])('opens from %s: %s', (_name, x, y, expected) => {
    expect(isWithinContainerReach(container, x, y)).toBe(expected);
  });

  it('finds the crate on this tile, and nothing on an empty one', () => {
    const containers = [container, createPlacedContainer(12, 300)];

    expect(containerAt(containers, 12, 300)).toBe(containers[1]);
    expect(containerAt(containers, 13, 300)).toBeNull();
  });

  it('prefers the crate the ship is standing on to the one beside it', () => {
    const beside = createPlacedContainer(40, 100);
    const under = createPlacedContainer(41, 100);

    expect(reachableContainer([beside, under], 41, 100)).toBe(under);
    expect(reachableContainer([beside, under], 90, 100)).toBeNull();
  });
});

describe('storing a stack', () => {
  it('moves the whole stack across in one press', () => {
    const ship = withOre(COPPER, 6);
    const crate = createPlacedContainer(40, 100);

    const result = storeInContainer(ship, crate.inventory, oreItem(COPPER).kind);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.moved).toBe(6);
    expect(result.label).toBe('Copper');
    expect(countOres(result.ship)).toBe(0);
    expect(countOres(result.container)).toBe(6);
  });

  it('stacks onto what the crate already holds', () => {
    const crate = withOre(COPPER, 2);
    const result = storeInContainer(withOre(COPPER, 3), crate, oreItem(COPPER).kind);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(countOres(result.container)).toBe(5);
    // One kind, one stack: a stack that lands on an open one opens no second one.
    expect(result.container).toHaveLength(1);
  });

  it('fills only up to the crate\'s remaining item room, and reports a partial move', () => {
    const crate = withOre(COPPER, CARGO_CONTAINER.capacity - 2);
    const result = storeInContainer(withOre(IRON, 5), crate, oreItem(IRON).kind);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Two units fit; the other three stay aboard.
    expect(result.moved).toBe(2);
    expect(totalItems(result.container)).toBe(CARGO_CONTAINER.capacity);
    expect(countItem(result.ship, oreItem(IRON).kind)).toBe(3);
  });

  it('refuses a crate already at its item capacity and changes nothing', () => {
    const crate = withOre(COPPER, CARGO_CONTAINER.capacity);
    const ship = addItem(createInventory(), DYNAMITE_ITEM, 2);

    const result = storeInContainer(ship, crate, DYNAMITE_ITEM.kind);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toContain('Container is full');
  });

  it('reports a kind that is not aboard at all', () => {
    const result = storeInContainer(createInventory(), createInventory(), CARGO_CONTAINER_ITEM.kind);

    expect(result).toEqual({ok: false, refusal: 'Nothing of that kind is aboard.'});
  });

  it('moves only one unit when asked, leaving the rest of the stack aboard', () => {
    const result = storeInContainer(withOre(COPPER, 6), createInventory(), oreItem(COPPER).kind, 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.moved).toBe(1);
    expect(countOres(result.ship)).toBe(5);
    expect(countOres(result.container)).toBe(1);
  });

  it('a single-unit store into a nearly full crate still fits within its room', () => {
    const crate = withOre(COPPER, CARGO_CONTAINER.capacity - 1);
    const result = storeInContainer(withOre(COPPER, 4), crate, oreItem(COPPER).kind, 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.moved).toBe(1);
    expect(totalItems(result.container)).toBe(CARGO_CONTAINER.capacity);
  });
});

describe('taking a stack back', () => {
  it('moves equipment across up to the bay capacity, counting what is already aboard', () => {
    const crate = addItem(createInventory(), DYNAMITE_ITEM, 4);

    const result = takeFromContainer(createInventory(), crate, DYNAMITE_ITEM.kind, 10);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(countItem(result.ship, DYNAMITE_ITEM.kind)).toBe(4);
    expect(countItem(result.container, DYNAMITE_ITEM.kind)).toBe(0);
  });

  /**
   * The rule that keeps a $200 crate from quietly buying every level of the cargo
   * upgrade: a crate stores freely, but the ship still carries what the bay says
   * it carries — and everything aboard, ore or equipment, counts toward that.
   */
  it('takes only as much as the cargo-bay capacity still allows', () => {
    const crate = withOre(COPPER, 10);

    const result = takeFromContainer(withOre(IRON, 8), crate, oreItem(COPPER).kind, 10);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.moved).toBe(2);
    expect(countOres(result.ship)).toBe(10);
    // The rest stays where it was, rather than falling on the floor.
    expect(countOres(result.container)).toBe(8);
  });

  it('counts equipment aboard against the same capacity as ore', () => {
    const ship = addItem(createInventory(), DYNAMITE_ITEM, 8);
    const crate = withOre(COPPER, 5);

    const result = takeFromContainer(ship, crate, oreItem(COPPER).kind, 10);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Eight sticks aboard leave room for only two units of ore.
    expect(result.moved).toBe(2);
    expect(totalItems(result.ship)).toBe(10);
  });

  it('refuses outright once the bay is at its item capacity', () => {
    const result = takeFromContainer(withOre(IRON, 10), withOre(COPPER, 1), oreItem(COPPER).kind, 10);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toContain('Cargo bay is full at 10 items');
  });

  it('reports a kind the crate does not hold', () => {
    const result = takeFromContainer(createInventory(), createInventory(), DYNAMITE_ITEM.kind, 99);

    expect(result).toEqual({ok: false, refusal: 'Nothing of that kind is in the container.'});
  });

  it('moves only one unit when asked, leaving the rest in the crate', () => {
    const result = takeFromContainer(createInventory(), withOre(COPPER, 6), oreItem(COPPER).kind, 10, 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.moved).toBe(1);
    expect(countOres(result.ship)).toBe(1);
    expect(countOres(result.container)).toBe(5);
  });
});

describe('a fresh container', () => {
  it('opens empty with its whole item capacity free', () => {
    const crate = createPlacedContainer(40, 100);

    expect(crate.inventory).toHaveLength(0);
    expect(totalItems(crate.inventory)).toBe(0);
  });
});

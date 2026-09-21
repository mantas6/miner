import { describe, expect, it } from 'vitest';
import { ORES } from '../../shared/constants';
import {
  INVENTORY_CAPACITY,
  addItem,
  addOre,
  countItem,
  countOres,
  createInventory,
  findStack,
  inventoryStacks,
  isFull,
  isOreKind,
  oreItem,
  oreKind,
  oreStacks,
  removeItem,
  removeOres,
  roomLeft,
  totalItems,
  type Inventory
} from './inventory';

const coal = ORES[0];
const copper = ORES[2];
const silver = ORES[3];

/** Fill the bay with one unit of each of the first `count` ore types. */
function withOreTypes(count: number, capacity = 99): Inventory {
  let inventory = createInventory();
  for (const ore of ORES.slice(0, count)) inventory = addOre(inventory, ore, capacity)!;
  return inventory;
}

describe('a fresh inventory', () => {
  it('starts empty with a positive item capacity', () => {
    const inventory = createInventory();

    expect(INVENTORY_CAPACITY).toBeGreaterThan(0);
    expect(inventory).toHaveLength(0);
    expect(totalItems(inventory)).toBe(0);
    expect(inventoryStacks(inventory)).toEqual([]);
    expect(roomLeft(inventory, INVENTORY_CAPACITY)).toBe(INVENTORY_CAPACITY);
  });
});

describe('stacking', () => {
  it('puts the first unit of a kind in a new stack', () => {
    const inventory = addItem(createInventory(), oreItem(coal));

    expect(inventory).toHaveLength(1);
    expect(inventory[0]).toEqual({kind: oreKind('Coal'), count: 1, item: oreItem(coal)});
  });

  it('grows the open stack instead of opening a second', () => {
    let inventory = createInventory();
    for (let i = 0; i < 4; i++) inventory = addItem(inventory, oreItem(coal));

    expect(countItem(inventory, oreKind('Coal'))).toBe(4);
    expect(inventoryStacks(inventory)).toHaveLength(1);
  });

  it('gives every kind its own stack, in arrival order', () => {
    const inventory = withOreTypes(3);

    expect(inventoryStacks(inventory).map(stack => stack.item.label)).toEqual(['Coal', 'Iron', 'Copper']);
    expect(findStack(inventory, oreKind('Copper'))?.count).toBe(1);
    expect(findStack(inventory, oreKind('Gold'))).toBeNull();
  });

  it('adds several units at once, and ignores a non-positive count', () => {
    const inventory = addItem(createInventory(), oreItem(copper), 3);

    expect(countItem(inventory, oreKind('Copper'))).toBe(3);
    expect(addItem(inventory, oreItem(copper), 0)).toBe(inventory);
    expect(addItem(inventory, oreItem(copper), -2)).toBe(inventory);
  });

  it('never mutates the inventory it was handed', () => {
    const before = createInventory();
    const after = addItem(before, oreItem(coal));

    expect(before).toHaveLength(0);
    expect(after).not.toBe(before);
  });
});

describe('a full inventory', () => {
  it('reports full once the total item count reaches capacity', () => {
    const inventory = addItem(createInventory(), oreItem(coal), 5);

    expect(isFull(inventory, 5)).toBe(true);
    expect(roomLeft(inventory, 5)).toBe(0);
    expect(isFull(inventory, 6)).toBe(false);
    expect(roomLeft(inventory, 6)).toBe(1);
  });

  it('measures fullness across every stack, not by the number of kinds', () => {
    const inventory = withOreTypes(3, 3);

    expect(totalItems(inventory)).toBe(3);
    expect(isFull(inventory, 3)).toBe(true);
  });
});

describe('removing', () => {
  it('takes units off a stack and drops the stack when it empties', () => {
    let inventory = addItem(createInventory(), oreItem(coal), 3);

    inventory = removeItem(inventory, oreKind('Coal'), 2);
    expect(countItem(inventory, oreKind('Coal'))).toBe(1);

    inventory = removeItem(inventory, oreKind('Coal'));
    expect(countItem(inventory, oreKind('Coal'))).toBe(0);
    expect(inventory).toHaveLength(0);
  });

  it('drops a whole stack when more is taken than it holds', () => {
    const inventory = removeItem(addItem(createInventory(), oreItem(coal), 2), oreKind('Coal'), 9);

    expect(totalItems(inventory)).toBe(0);
  });

  it('leaves a kind it does not hold alone', () => {
    const inventory = withOreTypes(2);

    expect(removeItem(inventory, oreKind('Gold'))).toBe(inventory);
    expect(removeItem(inventory, oreKind('Coal'), 0)).toBe(inventory);
  });
});

describe('ore', () => {
  it('recognises ore stacks by kind', () => {
    expect(isOreKind(oreKind('Coal'))).toBe(true);
    expect(isOreKind('dynamite')).toBe(false);
  });

  it('counts every ore unit across the stacks', () => {
    let inventory = addItem(createInventory(), oreItem(coal), 4);
    inventory = addItem(inventory, oreItem(silver), 2);

    expect(countOres(inventory)).toBe(6);
    expect(oreStacks(inventory).map(stack => stack.item.value)).toEqual([coal.value, silver.value]);
  });

  it('caps loading at the cargo-bay capacity, whatever the mix of kinds', () => {
    let inventory = createInventory();
    for (let i = 0; i < 3; i++) inventory = addOre(inventory, coal, 3)!;

    expect(countOres(inventory)).toBe(3);
    expect(addOre(inventory, coal, 3)).toBeNull();
    // A different ore is refused the same way once the bay is full.
    expect(addOre(inventory, copper, 3)).toBeNull();
    expect(addOre(inventory, copper, 4)).not.toBeNull();
  });

  it('lets any number of ore kinds share the bay while there is room', () => {
    const inventory = withOreTypes(6, 99);

    expect(inventoryStacks(inventory)).toHaveLength(6);
    expect(countOres(inventory)).toBe(6);
  });

  it('clears every ore stack on a sale', () => {
    const sold = removeOres(withOreTypes(3));

    expect(countOres(sold)).toBe(0);
    expect(sold).toHaveLength(0);
  });

  it('leaves an inventory with nothing to sell untouched', () => {
    const empty = createInventory();

    expect(removeOres(empty)).toBe(empty);
  });
});

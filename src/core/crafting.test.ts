import { describe, expect, it } from 'vitest';
import { canCraft, craft, missingInputs, RECIPES, type Recipe } from './crafting';
import { addItem, countItem, createInventory, oreKind, type Inventory } from './inventory';
import { isCatalogKind, itemForKind } from './items';

/** A station stock built from ore `{name, count}` pairs. */
function ores(...stacks: [string, number][]): Inventory {
  return stacks.reduce((inv, [name, count]) => addItem(inv, itemForKind(oreKind(name)), count), createInventory());
}

const repairKit = RECIPES.find(recipe => recipe.output === 'repairKit')!;

describe('the recipe table', () => {
  it('only ever outputs real catalogue items', () => {
    for (const recipe of RECIPES) expect(isCatalogKind(recipe.output)).toBe(true);
  });

  it('offers all twelve ship-upgrade marks plus the booster', () => {
    const upgrades = RECIPES.filter(recipe => recipe.output.startsWith('upgrade:'));
    expect(upgrades.map(recipe => recipe.output)).toContain('upgrade:tank:1');
    expect(upgrades.map(recipe => recipe.output)).toContain('upgrade:hull:3');
    expect(upgrades.map(recipe => recipe.output)).toContain('upgrade:booster:1');
    expect(upgrades).toHaveLength(13);
  });
});

describe('checking a recipe', () => {
  it('is craftable only when every input is present', () => {
    expect(canCraft(ores(['Iron', 3]), repairKit)).toBe(true);
    expect(canCraft(ores(['Iron', 2]), repairKit)).toBe(false);
    expect(canCraft(createInventory(), repairKit)).toBe(false);
  });

  it('lists the shortfall, and nothing once the inputs are met', () => {
    const dynamite = RECIPES.find(recipe => recipe.output === 'dynamite')!;
    expect(missingInputs(ores(['Coal', 1]), dynamite)).toEqual([
      {kind: oreKind('Coal'), count: 1},
      {kind: oreKind('Iron'), count: 1}
    ]);
    expect(missingInputs(ores(['Coal', 2], ['Iron', 1]), dynamite)).toEqual([]);
  });
});

describe('crafting', () => {
  it('consumes the inputs and adds the output to the same (station) inventory', () => {
    const before = ores(['Iron', 5]);
    const after = craft(before, repairKit);

    expect(after).not.toBeNull();
    expect(countItem(after!, oreKind('Iron'))).toBe(2);
    expect(countItem(after!, 'repairKit')).toBe(1);
  });

  it('produces the recipe count, not always one', () => {
    const multi: Recipe = {output: 'dynamite', count: 3, inputs: [{kind: oreKind('Iron'), count: 1}]};
    const after = craft(ores(['Iron', 1]), multi);
    expect(countItem(after!, 'dynamite')).toBe(3);
  });

  it('returns null and changes nothing when the inputs are short', () => {
    const before = ores(['Iron', 2]);
    expect(craft(before, repairKit)).toBeNull();
    expect(countItem(before, oreKind('Iron'))).toBe(2);
  });
});

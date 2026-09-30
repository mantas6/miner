import { describe, expect, it } from 'vitest';
import { canCraft, craft, fitsAfterCraft, missingInputs, RECIPES, type Recipe } from './crafting';
import { addItem, countItem, createInventory, oreKind, totalItems, type Inventory } from './inventory';
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

  it('offers all twelve ship-upgrade marks plus the booster and the Core Drill', () => {
    const upgrades = RECIPES.filter(recipe => recipe.output.startsWith('upgrade:'));
    expect(upgrades.map(recipe => recipe.output)).toContain('upgrade:tank:1');
    expect(upgrades.map(recipe => recipe.output)).toContain('upgrade:hull:3');
    expect(upgrades.map(recipe => recipe.output)).toContain('upgrade:booster:1');
    expect(upgrades.map(recipe => recipe.output)).toContain('upgrade:drill:4');
    expect(upgrades).toHaveLength(14);
  });

  it('turns one Uranium into two Fuel Cells', () => {
    const fuelCell = RECIPES.find(recipe => recipe.output === 'fuelCell')!;
    expect(fuelCell).toMatchObject({count: 2, inputs: [{kind: oreKind('Uranium'), count: 1}]});
    const after = craft(ores(['Uranium', 1]), fuelCell);
    expect(countItem(after!, 'fuelCell')).toBe(2);
    expect(countItem(after!, oreKind('Uranium'))).toBe(0);
  });

  it('builds the Core Drill from the three deepest ores', () => {
    const coreDrill = RECIPES.find(recipe => recipe.output === 'upgrade:drill:4')!;
    expect(coreDrill.inputs).toEqual([
      {kind: oreKind('Core Shard'), count: 3},
      {kind: oreKind('Uranium'), count: 2},
      {kind: oreKind('Alienite'), count: 2}
    ]);
    expect(canCraft(ores(['Core Shard', 3], ['Uranium', 2], ['Alienite', 1]), coreDrill)).toBe(false);
    const after = craft(ores(['Core Shard', 3], ['Uranium', 2], ['Alienite', 2]), coreDrill);
    expect(countItem(after!, 'upgrade:drill:4')).toBe(1);
    expect(totalItems(after!)).toBe(1);
  });

  it('spares Iron on the kit and the container, leaning on Copper instead', () => {
    const bill = (output: string) => RECIPES.find(recipe => recipe.output === output)!.inputs;
    expect(bill('repairKit')).toEqual([{kind: oreKind('Iron'), count: 2}, {kind: oreKind('Copper'), count: 1}]);
    expect(bill('container')).toEqual([{kind: oreKind('Iron'), count: 4}, {kind: oreKind('Copper'), count: 2}]);
  });

  it('puts one Mk II within the Silver band: the Fuel Tank takes no Gold, the rest still do', () => {
    const bill = (output: string) => RECIPES.find(recipe => recipe.output === output)!.inputs;
    expect(bill('upgrade:tank:2')).toEqual([{kind: oreKind('Silver'), count: 4}, {kind: oreKind('Copper'), count: 2}]);
    for (const id of ['cargo', 'drill', 'hull']) {
      expect(bill(`upgrade:${id}:2`)).toEqual([{kind: oreKind('Silver'), count: 3}, {kind: oreKind('Gold'), count: 3}]);
    }
  });
});

describe('checking a recipe', () => {
  it('is craftable only when every input is present', () => {
    expect(canCraft(ores(['Iron', 2], ['Copper', 1]), repairKit)).toBe(true);
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
    const before = ores(['Iron', 5], ['Copper', 1]);
    const after = craft(before, repairKit);

    expect(after).not.toBeNull();
    expect(countItem(after!, oreKind('Iron'))).toBe(3);
    expect(countItem(after!, oreKind('Copper'))).toBe(0);
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

  it('refuses a batch that would push the stock past its capacity', () => {
    const stoneBlock = RECIPES.find(recipe => recipe.output === 'decor:stoneBlock')!;
    // One Coal in, two blocks out: a full stock would grow by one.
    const full = ores(['Coal', 10]);
    expect(fitsAfterCraft(full, stoneBlock, 10)).toBe(false);
    expect(craft(full, stoneBlock, 10)).toBeNull();
    expect(craft(full, stoneBlock, 11)).not.toBeNull();
    // A recipe that consumes more than it makes always fits, even at the cap.
    const after = craft(ores(['Iron', 9], ['Copper', 1]), repairKit, 10);
    expect(after && totalItems(after)).toBe(8);
  });
});

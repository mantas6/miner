// Crafting: recipes, and the pure functions that check and run them.
//
// A recipe turns a handful of ore into one useful item — a consumable, a ship
// upgrade, or a decoration. Crafting happens at the manufacturing station, so
// every recipe both consumes from and produces into the *station's* stock (the
// player stows ore there, crafts, and takes the result back aboard); the ship's
// bay is never touched here.
//
// The whole table lives in one place so the numbers are trivial to tune, and the
// three functions below are pure and DOM-free: `canCraft` asks whether the inputs
// are present, `missingInputs` lists the shortfall for a UI to show, and `craft`
// returns the station's inventory after the swap (or `null` when it cannot).

import {
  addItem,
  countItem,
  oreKind,
  removeItem,
  totalItems,
  type Inventory,
  type InventoryItemKind
} from './inventory';
import { itemForKind } from './items';

/** One input line of a recipe: how many of which kind it consumes. */
export interface RecipeInput {
  kind: InventoryItemKind;
  count: number;
}

/** One recipe: the item it yields (and how many), and what it costs to make. */
export interface Recipe {
  output: InventoryItemKind;
  count: number;
  inputs: RecipeInput[];
}

/** Shorthand: an ore-input line by ore name. */
function ore(name: string, count: number): RecipeInput {
  return {kind: oreKind(name), count};
}

/**
 * The single tunable recipe table. Ore names must match `ORES` in
 * `shared/constants.ts`. The four ship upgrades come in three marks, so each mark
 * is four sibling recipes sharing one input cost; the drill alone has a fourth,
 * the Core Drill, made from the deepest ores.
 */
export const RECIPES: Recipe[] = [
  {output: 'repairKit', count: 1, inputs: [ore('Iron', 3)]},
  {output: 'dynamite', count: 1, inputs: [ore('Coal', 2), ore('Iron', 1)]},
  {output: 'scanner', count: 1, inputs: [ore('Copper', 2), ore('Silver', 1)]},
  {output: 'container', count: 1, inputs: [ore('Iron', 6)]},
  {output: 'teleporter', count: 1, inputs: [ore('Silver', 3), ore('Gold', 2)]},
  {output: 'fuelCell', count: 2, inputs: [ore('Uranium', 1)]},

  {output: 'device:manufacturer', count: 1, inputs: [ore('Iron', 8), ore('Copper', 4), ore('Silver', 2)]},
  {output: 'device:extractor', count: 1, inputs: [ore('Iron', 6), ore('Copper', 4), ore('Coal', 2)]},
  {output: 'device:portal', count: 1, inputs: [ore('Silver', 3), ore('Gold', 3), ore('Iron', 2)]},
  {output: 'toolkit', count: 1, inputs: [ore('Iron', 4), ore('Copper', 2)]},

  {output: 'upgrade:tank:1', count: 1, inputs: [ore('Iron', 4), ore('Copper', 2)]},
  {output: 'upgrade:cargo:1', count: 1, inputs: [ore('Iron', 4), ore('Copper', 2)]},
  {output: 'upgrade:drill:1', count: 1, inputs: [ore('Iron', 4), ore('Copper', 2)]},
  {output: 'upgrade:hull:1', count: 1, inputs: [ore('Iron', 4), ore('Copper', 2)]},

  {output: 'upgrade:tank:2', count: 1, inputs: [ore('Silver', 3), ore('Gold', 3)]},
  {output: 'upgrade:cargo:2', count: 1, inputs: [ore('Silver', 3), ore('Gold', 3)]},
  {output: 'upgrade:drill:2', count: 1, inputs: [ore('Silver', 3), ore('Gold', 3)]},
  {output: 'upgrade:hull:2', count: 1, inputs: [ore('Silver', 3), ore('Gold', 3)]},

  {output: 'upgrade:tank:3', count: 1, inputs: [ore('Ruby', 2), ore('Emerald', 2), ore('Alienite', 1)]},
  {output: 'upgrade:cargo:3', count: 1, inputs: [ore('Ruby', 2), ore('Emerald', 2), ore('Alienite', 1)]},
  {output: 'upgrade:drill:3', count: 1, inputs: [ore('Ruby', 2), ore('Emerald', 2), ore('Alienite', 1)]},
  {output: 'upgrade:hull:3', count: 1, inputs: [ore('Ruby', 2), ore('Emerald', 2), ore('Alienite', 1)]},

  {output: 'upgrade:drill:4', count: 1, inputs: [ore('Core Shard', 3), ore('Uranium', 2), ore('Alienite', 2)]},

  {output: 'upgrade:booster:1', count: 1, inputs: [ore('Copper', 3), ore('Coal', 2), ore('Silver', 1)]},

  {output: 'decor:steelPlate', count: 1, inputs: [ore('Iron', 2)]},
  {output: 'decor:stoneBlock', count: 2, inputs: [ore('Coal', 1)]},
  {output: 'decor:copperTrim', count: 1, inputs: [ore('Copper', 2)]},
  {output: 'decor:lampPanel', count: 1, inputs: [ore('Copper', 1), ore('Coal', 1)]}
];

/** Whether the station stock holds every input a recipe needs. */
export function canCraft(inventory: Inventory, recipe: Recipe): boolean {
  return recipe.inputs.every(input => countItem(inventory, input.kind) >= input.count);
}

/**
 * The inputs the station is short on, each with the missing quantity. Empty when
 * the recipe can be crafted, so a UI can grey a button out and say why in one call.
 */
export function missingInputs(inventory: Inventory, recipe: Recipe): RecipeInput[] {
  const missing: RecipeInput[] = [];
  for (const input of recipe.inputs) {
    const short = input.count - countItem(inventory, input.kind);
    if (short > 0) missing.push({kind: input.kind, count: short});
  }
  return missing;
}

/**
 * Whether the stock would still fit under `capacity` items once the recipe has
 * run: its inputs leave and `recipe.count` outputs arrive, so only a recipe that
 * yields more than it consumes (two Stone Blocks from one Coal) can overflow.
 */
export function fitsAfterCraft(inventory: Inventory, recipe: Recipe, capacity: number): boolean {
  const consumed = recipe.inputs.reduce((sum, input) => sum + input.count, 0);
  return totalItems(inventory) - consumed + recipe.count <= capacity;
}

/**
 * Consume a recipe's inputs from the station stock and add its output, returning
 * the station's new inventory. `null` — and no change — when the inputs are not
 * all present, or when the result would overflow `capacity` (the station's
 * `STATION_CAPACITY`; unbounded by default).
 */
export function craft(inventory: Inventory, recipe: Recipe, capacity = Infinity): Inventory | null {
  if (!canCraft(inventory, recipe) || !fitsAfterCraft(inventory, recipe, capacity)) return null;
  let next = inventory;
  for (const input of recipe.inputs) next = removeItem(next, input.kind, input.count);
  return addItem(next, itemForKind(recipe.output), recipe.count);
}

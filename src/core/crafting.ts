// Crafting: recipes, and the pure functions that check and run them.
//
// A recipe turns a handful of ore into one useful item — a consumable, a ship
// upgrade, or a decoration. Crafting happens at the manufacturing station, so
// every recipe both consumes from and produces into the *station's* stock (the
// player stows ore there, crafts, and takes the result back aboard); the ship's
// bay is never touched here — `pooledShortfall` only counts it, so a quoted bill
// does not call ore still aboard missing.
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
  /**
   * A second route to an output the table already makes: its row carries its own
   * id (`recipeId`, the output plus `:alt`) so both rows can be pressed.
   */
  alt?: boolean;
  /** The row's own name, when it is not just the output's label ("Deep Portal"). */
  label?: string;
  /**
   * The best mark ever crafted (`stats.bestMarkCrafted`) before the recipe is
   * offered at all; left out, it is always on the list.
   */
  unlockMark?: number;
}

/**
 * The mark that unlocks the deep recipes: the first Mk II crafted, the same
 * milestone that opens a hull's last slot. By then the career is into Ruby and
 * past the Silver and Gold bands the standard Portal and Teleporter are built
 * from, so the deep routes take the ore it is actually digging.
 */
export const DEEP_RECIPE_MARK = 2;

/** Shorthand: an ore-input line by ore name. */
function ore(name: string, count: number): RecipeInput {
  return {kind: oreKind(name), count};
}

/**
 * The single tunable recipe table. Ore names must match `ORES` in
 * `shared/constants.ts`. The four ship upgrades come in three marks, so each mark
 * is four sibling recipes sharing one input cost — bar the Fuel Tank Mk II, which
 * skips the Gold so a Scout can craft its first Mk II (and open its last slot) from
 * the Silver band; the drill alone has a fourth, the Core Drill, made from the
 * deepest ores. Iron is the early bottleneck (every Mk I and the Hauler want it),
 * so the kit and the container lean on over-supplied Copper instead.
 *
 * The Teleporter and the Portal each have a deep alternate (`alt`), unlocked with
 * the first Mk II (`DEEP_RECIPE_MARK`): the standard bills want Silver and Gold,
 * which stop spawning long before the deep game, so the Deep Teleporter and the
 * Deep Portal make the same item from the Emerald, Ruby and Alienite a deep trip
 * brings home. An alternate always follows its standard row, so a lookup by
 * output (the post prices, the objective) finds the standard bill first.
 */
export const RECIPES: Recipe[] = [
  {output: 'repairKit', count: 1, inputs: [ore('Iron', 2), ore('Copper', 1)]},
  {output: 'dynamite', count: 1, inputs: [ore('Coal', 2), ore('Iron', 1)]},
  {output: 'scanner', count: 1, inputs: [ore('Copper', 2), ore('Silver', 1)]},
  {output: 'container', count: 1, inputs: [ore('Iron', 4), ore('Copper', 2)]},
  {output: 'teleporter', count: 1, inputs: [ore('Silver', 3), ore('Gold', 2)]},
  {
    output: 'teleporter', count: 1, inputs: [ore('Emerald', 1), ore('Alienite', 1)],
    alt: true, label: 'Deep Teleporter', unlockMark: DEEP_RECIPE_MARK
  },
  {output: 'fuelCell', count: 2, inputs: [ore('Uranium', 1)]},

  {output: 'device:manufacturer', count: 1, inputs: [ore('Iron', 8), ore('Copper', 4), ore('Silver', 2)]},
  {output: 'device:extractor', count: 1, inputs: [ore('Iron', 6), ore('Copper', 4), ore('Coal', 2)]},
  {output: 'device:portal', count: 1, inputs: [ore('Silver', 3), ore('Gold', 3), ore('Iron', 2)]},
  {
    output: 'device:portal', count: 1, inputs: [ore('Ruby', 2), ore('Emerald', 2), ore('Iron', 2)],
    alt: true, label: 'Deep Portal', unlockMark: DEEP_RECIPE_MARK
  },
  {output: 'toolkit', count: 1, inputs: [ore('Iron', 4), ore('Copper', 2)]},

  {output: 'upgrade:tank:1', count: 1, inputs: [ore('Iron', 4), ore('Copper', 2)]},
  {output: 'upgrade:cargo:1', count: 1, inputs: [ore('Iron', 4), ore('Copper', 2)]},
  {output: 'upgrade:drill:1', count: 1, inputs: [ore('Iron', 4), ore('Copper', 2)]},
  {output: 'upgrade:hull:1', count: 1, inputs: [ore('Iron', 4), ore('Copper', 2)]},

  {output: 'upgrade:tank:2', count: 1, inputs: [ore('Silver', 4), ore('Copper', 2)]},
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

/**
 * A recipe's row id — the `data-craft` value its Craft button carries and the
 * name a craft command takes: the output kind, plus `:alt` for an alternate.
 */
export function recipeId(recipe: Recipe): string {
  return recipe.alt ? `${recipe.output}:alt` : recipe.output;
}

/** The name a recipe row is listed under: its own label, else its output's. */
export function recipeLabel(recipe: Recipe): string {
  return recipe.label ?? itemForKind(recipe.output).label;
}

/** Whether a recipe is on offer yet, given the best mark ever crafted. */
export function isRecipeUnlocked(recipe: Recipe, bestMarkCrafted: number): boolean {
  return bestMarkCrafted >= (recipe.unlockMark ?? 0);
}

/** The recipes a Manufacturer lists at `bestMarkCrafted`, in table order. */
export function unlockedRecipes(bestMarkCrafted: number): Recipe[] {
  return RECIPES.filter(recipe => isRecipeUnlocked(recipe, bestMarkCrafted));
}

/** The recipe a row id names (`recipeId`), or `undefined`. */
export function findRecipe(id: string): Recipe | undefined {
  return RECIPES.find(recipe => recipeId(recipe) === id);
}

/** The standard (non-alternate) recipe for an output, or `undefined` when nothing makes it. */
export function standardRecipe(output: InventoryItemKind): Recipe | undefined {
  return RECIPES.find(recipe => recipe.output === output && !recipe.alt);
}

/**
 * Anything built from a list of inputs: a recipe, or a hull on the ship ladder
 * (`core/ships.ts`), which consumes ore the same way but yields no stock item.
 */
export interface HasInputs {
  inputs: readonly RecipeInput[];
}

/** Whether the station stock holds every input a recipe (or a hull) needs. */
export function canCraft(inventory: Inventory, recipe: HasInputs): boolean {
  return recipe.inputs.every(input => countItem(inventory, input.kind) >= input.count);
}

/**
 * The inputs the station is short on, each with the missing quantity. Empty when
 * the recipe can be crafted, so a UI can grey a button out and say why in one call.
 */
export function missingInputs(inventory: Inventory, recipe: HasInputs): RecipeInput[] {
  const missing: RecipeInput[] = [];
  for (const input of recipe.inputs) {
    const short = input.count - countItem(inventory, input.kind);
    if (short > 0) missing.push({kind: input.kind, count: short});
  }
  return missing;
}

/**
 * A bill measured against the ship's bay and the station stock together. Crafting
 * and building still consume from the stock alone; this is what the Shipyard and
 * the objective quote, so ore still aboard is not reported as missing.
 */
export interface PooledShortfall {
  /** What neither the bay nor the stock holds: still to be mined or bought. */
  missing: RecipeInput[];
  /** What the stock lacks but the bay carries: stow it and it counts. */
  stow: RecipeInput[];
}

/** The shortfall of a recipe (or a hull) across the bay and the stock, per input. */
export function pooledShortfall(bay: Inventory, stock: Inventory, recipe: HasInputs): PooledShortfall {
  const missing: RecipeInput[] = [];
  const stow: RecipeInput[] = [];
  for (const input of recipe.inputs) {
    const short = input.count - countItem(stock, input.kind);
    if (short <= 0) continue;
    const aboard = Math.min(short, countItem(bay, input.kind));
    if (aboard > 0) stow.push({kind: input.kind, count: aboard});
    if (short > aboard) missing.push({kind: input.kind, count: short - aboard});
  }
  return {missing, stow};
}

/** Input lines in words, e.g. "10 Iron, 6 Silver". */
export function formatInputs(inputs: readonly RecipeInput[]): string {
  return inputs.map(input => `${input.count} ${itemForKind(input.kind).label}`).join(', ');
}

/**
 * A pooled shortfall as one line: "Need 4 Silver", "Need 4 Silver · 6 Iron
 * aboard to stow", or "Stow the 6 Iron aboard to build"; empty when neither.
 */
export function formatPooledShortfall({missing, stow}: PooledShortfall): string {
  if (missing.length === 0) return stow.length > 0 ? `Stow the ${formatInputs(stow)} aboard to build` : '';
  const need = `Need ${formatInputs(missing)}`;
  return stow.length > 0 ? `${need} · ${formatInputs(stow)} aboard to stow` : need;
}

/** The stock with every input taken out. The caller checks `canCraft` first. */
export function consumeInputs(inventory: Inventory, recipe: HasInputs): Inventory {
  let next = inventory;
  for (const input of recipe.inputs) next = removeItem(next, input.kind, input.count);
  return next;
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
  return addItem(consumeInputs(inventory, recipe), itemForKind(recipe.output), recipe.count);
}

// Trading posts: what a post buys back from you, and what it will sell.
//
// A post is a coordinate, nothing more (see `world.ts`), so everything it offers is
// derived here, deterministically, from that coordinate. Two halves:
//
//   * Selling. A post buys *any* ore at the ore table's own `value`, with no limit
//     — the same price the old depot would have paid — so the sell side needs no
//     table at all; the price of a stack is just `itemForKind(kind).value`.
//   * Buying. A post stocks 2–3 finished items drawn from a depth-tiered pool, each
//     with a price and a small stock (1–3). Both the choice and the stock are rolled
//     from the coordinate, so a given post always offers the same wares; the only
//     thing that changes is how much of each is left, which lives in
//     `state.tradeLedger` (see `game/trading.ts`).
//
// Pricing rule (documented once, here): a post is a middleman, so a buy price is
// the ore-value of the item's crafting recipe — the sum of `count × ore.value` over
// its inputs — marked up by `TRADING_MARKUP`. That keeps every price sane relative
// to the ore the player is selling to afford it, and tunes with the recipe table.
//
// Everything here is pure and DOM-free.

import { START_Y } from '../../shared/constants';
import { RECIPES } from './crafting';
import { itemForKind } from './items';
import type { InventoryItemKind } from './inventory';
import { rand } from '../world/world';

/** A post is a middleman: it sells finished gear for more than the ore to make it. */
export const TRADING_MARKUP = 1.5;

/** One buy offer a post stocks: a finished item, its price, and how many remain. */
export interface BuyOffer {
  kind: InventoryItemKind;
  label: string;
  price: number;
  /** Initial stock rolled for the post, 1–3; the live remaining count lives in the ledger. */
  stock: number;
}

/** One entry of the buy pool: an item, and the shallowest row a post stocks it at. */
interface PoolEntry {
  kind: InventoryItemKind;
  minRow: number;
}

/**
 * The depth-tiered pool a post draws its buy offers from. The four base wares are
 * stocked at any post; upgrades and the pricier tools appear only deeper, so a deep
 * post is worth the trip. Rows are `START_Y + n`, so the tiers move with the home
 * row exactly like the ore bands do.
 */
const BUY_POOL: readonly PoolEntry[] = [
  {kind: 'repairKit', minRow: START_Y + 40},
  {kind: 'dynamite', minRow: START_Y + 40},
  {kind: 'scanner', minRow: START_Y + 40},
  {kind: 'container', minRow: START_Y + 40},
  {kind: 'upgrade:drill:1', minRow: START_Y + 80},
  {kind: 'upgrade:tank:1', minRow: START_Y + 80},
  {kind: 'upgrade:cargo:1', minRow: START_Y + 80},
  {kind: 'upgrade:hull:1', minRow: START_Y + 80},
  {kind: 'toolkit', minRow: START_Y + 120},
  {kind: 'teleporter', minRow: START_Y + 160},
  {kind: 'upgrade:drill:2', minRow: START_Y + 260},
  {kind: 'upgrade:tank:2', minRow: START_Y + 260},
  {kind: 'upgrade:cargo:2', minRow: START_Y + 260},
  {kind: 'upgrade:hull:2', minRow: START_Y + 260}
];

/** The ledger key one post is stored under. */
export function tradePostKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** The ore-value of an item's crafting recipe inputs; 0 for an item with no recipe. */
function recipeOreValue(kind: InventoryItemKind): number {
  const recipe = RECIPES.find(entry => entry.output === kind);
  if (!recipe) return 0;
  return recipe.inputs.reduce((sum, input) => sum + input.count * itemForKind(input.kind).value, 0);
}

/** A post's buy price for one item: its recipe's ore-value, marked up. */
export function buyPrice(kind: InventoryItemKind): number {
  return Math.max(1, Math.round(recipeOreValue(kind) * TRADING_MARKUP));
}

/** The unit price a post pays for one unit of an ore: the ore table's own value. */
export function sellPrice(kind: InventoryItemKind): number {
  return itemForKind(kind).value;
}

/**
 * The 2–3 buy offers a post at `x`/`y` stocks, in a stable order (so the ledger's
 * per-index stock always lines up). Both the selection and each offer's stock are
 * rolled from the coordinate, so a post's wares never change between visits.
 */
export function offersForPost(x: number, y: number): BuyOffer[] {
  const eligible = BUY_POOL.filter(entry => y >= entry.minRow);
  if (eligible.length === 0) return [];
  const wanted = 2 + Math.floor(rand(x + 41, y + 67) * 2); // 2 or 3
  const count = Math.min(eligible.length, wanted);
  // A deterministic shuffle: rank each eligible entry by a per-item roll and take
  // the first `count`. The roll folds in the entry's index so two entries never tie.
  const ranked = eligible
    .map((entry, index) => ({entry, roll: rand(x + index * 7 + 13, y + index * 5 + 29)}))
    .sort((a, b) => a.roll - b.roll)
    .slice(0, count);
  return ranked.map(({entry}, index) => ({
    kind: entry.kind,
    label: itemForKind(entry.kind).label,
    price: buyPrice(entry.kind),
    stock: 1 + Math.floor(rand(x + index * 3 + 101, y + index * 9 + 211) * 3) // 1–3
  }));
}

/**
 * The remaining stock for each offer of a post: the ledger's record when it has
 * one, otherwise the freshly rolled initial stocks. Always the same length as
 * `offers`, so a caller can index the two together.
 */
export function remainingStock(
  ledger: Record<string, number[]>,
  x: number,
  y: number,
  offers: readonly BuyOffer[]
): number[] {
  const saved = ledger[tradePostKey(x, y)];
  if (saved && saved.length === offers.length) return saved.map((n, i) => Math.max(0, Math.min(offers[i].stock, Math.floor(n))));
  return offers.map(offer => offer.stock);
}

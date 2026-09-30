// Trading posts: what a post buys back from you, and what it will sell.
//
// A post is a coordinate, nothing more (see `world.ts`), so everything it offers is
// derived here, deterministically, from that coordinate. Two halves:
//
//   * Selling. A post buys *any* ore at the ore table's own `value`, with no limit
//     — the same price the old depot would have paid — so the sell side needs no
//     table at all; the price of a stack is just `itemForKind(kind).value`.
//   * Buying. Every post keeps a Repair Kit shelf (`POST_REPAIR_KIT_STOCK` of them),
//     so a hurt ship that finds any post can patch its hull, and beside it stocks
//     2–3 more finished items drawn from a depth-tiered pool, each with a price and
//     a small stock (1–3). Both the choice and the stock are rolled from the
//     coordinate, so a given post always offers the same wares; the only thing that
//     changes is how much of each is left, which lives in `state.tradeLedger` (see
//     `game/trading.ts`).
//
// Pricing rule (documented once, here): a post is a middleman, so a buy price is
// the ore-value of the item's crafting recipe — the sum of `count × ore.value` over
// its inputs — marked up by `TRADING_MARKUP`. That keeps every price sane relative
// to the ore the player is selling to afford it, and tunes with the recipe table.
//
// Cash has three more sinks, priced here too: fuel (at a post into the tank, at
// home into the Fuel Extractor), priced off the coal it would take to make it and
// dearer the deeper the post; hull repairs at any portal, priced off the post's
// Repair Kits; and the home Supply, the base Manufacturer's short list of basics
// at a steeper markup.
//
// Everything here is pure and DOM-free.

import { START_Y, rowDepthMeters } from '../../shared/constants';
import { tileKey } from '../../shared/tile-key';
import { EXTRACTOR, HULL } from './balance';
import { standardRecipe } from './crafting';
import { itemForKind } from './items';
import { CORE_DRILL_KIND, oreKind, type InventoryItemKind } from './inventory';
import { rand } from '../world/world';

/** How far a ship may stand from a post and still trade: Chebyshev ≤ 1, its own tile too. */
export const TRADING_POST_REACH = 1;

/** A post is a middleman: it sells finished gear for more than the ore to make it. */
export const TRADING_MARKUP = 1.5;

/** One buy offer a post stocks: a finished item, its price, and how many remain. */
export interface BuyOffer {
  kind: InventoryItemKind;
  label: string;
  price: number;
  /**
   * Initial stock: rolled 1–3 for a pool offer, `POST_REPAIR_KIT_STOCK` for the
   * kit shelf; the live remaining count lives in the ledger.
   */
  stock: number;
}

/** The ware every post keeps on its shelf, whatever its depth or rolled offers. */
export const POST_REPAIR_KIT: InventoryItemKind = 'repairKit';

/** How many Repair Kits a post's standing shelf holds before it is drawn down. */
export const POST_REPAIR_KIT_STOCK = 2;

/** One entry of the buy pool: an item, and the shallowest row a post stocks it at. */
interface PoolEntry {
  kind: InventoryItemKind;
  minRow: number;
}

/**
 * The depth-tiered pool a post draws its rolled buy offers from. The base wares
 * are stocked at any post; upgrades and the pricier tools appear only deeper, so a
 * deep post is worth the trip. Each upgrade tier opens with the band of the ore
 * its bill first wants: the Mk II parts with Ruby (2300 m, where the Prospector's
 * bill starts), the Mk III parts with Alienite (5400 m), and the Fuel Cell and the
 * Core Drill with Uranium (7000 m) — the late-game gear, priced in the thousands,
 * that gives a deep trip's cash somewhere to go. Rows are `START_Y + n`, so the
 * tiers move with the home row exactly like the ore bands do. The Repair Kit is
 * not in it: every post keeps its own kit shelf (`POST_REPAIR_KIT`) on top of
 * whatever it rolls.
 */
const BUY_POOL: readonly PoolEntry[] = [
  {kind: 'dynamite', minRow: START_Y + 40},
  {kind: 'scanner', minRow: START_Y + 40},
  {kind: 'container', minRow: START_Y + 40},
  {kind: 'upgrade:drill:1', minRow: START_Y + 80},
  {kind: 'upgrade:tank:1', minRow: START_Y + 80},
  {kind: 'upgrade:cargo:1', minRow: START_Y + 80},
  {kind: 'upgrade:hull:1', minRow: START_Y + 80},
  {kind: 'toolkit', minRow: START_Y + 120},
  {kind: 'teleporter', minRow: START_Y + 160},
  {kind: 'upgrade:drill:2', minRow: START_Y + 230},
  {kind: 'upgrade:tank:2', minRow: START_Y + 230},
  {kind: 'upgrade:cargo:2', minRow: START_Y + 230},
  {kind: 'upgrade:hull:2', minRow: START_Y + 230},
  {kind: 'upgrade:drill:3', minRow: START_Y + 540},
  {kind: 'upgrade:tank:3', minRow: START_Y + 540},
  {kind: 'upgrade:cargo:3', minRow: START_Y + 540},
  {kind: 'upgrade:hull:3', minRow: START_Y + 540},
  {kind: 'fuelCell', minRow: START_Y + 700},
  {kind: CORE_DRILL_KIND, minRow: START_Y + 700}
];

/**
 * The ore-value of an item's standard crafting recipe inputs; 0 for an item with
 * no recipe. A deep alternate (the Deep Portal) never reprices its output.
 */
function recipeOreValue(kind: InventoryItemKind): number {
  const recipe = standardRecipe(kind);
  if (!recipe) return 0;
  return recipe.inputs.reduce((sum, input) => sum + input.count * itemForKind(input.kind).value, 0);
}

/**
 * A buy price for one item: its recipe's ore-value per unit made, marked up — by
 * a post's `TRADING_MARKUP` unless another seller (the home Supply) names its own.
 * A recipe that yields several units (two Stone Blocks from one Coal) spreads its
 * inputs across all of them, so one unit never costs the whole batch.
 */
export function buyPrice(kind: InventoryItemKind, markup = TRADING_MARKUP): number {
  const made = standardRecipe(kind)?.count ?? 1;
  return Math.max(1, Math.round(recipeOreValue(kind) / Math.max(1, made) * markup));
}

/**
 * Fuel for cash — at a post straight into the tank, or at home into the Fuel
 * Extractor's store. It is priced off Coal, the ore it is made from: one coal's
 * value spread over the fuel it converts to, marked up so mining coal always
 * beats buying the fuel it would have made. The markup holds the home price at
 * about $0.29 a unit whatever a coal converts to.
 */
export const FUEL_TRADE_MARKUP = 4.2;

/**
 * Fuel dearer by depth at a post: the price climbs by the base price again every
 * this many metres (`1 + depth / FUEL_DEPTH_METERS`), so 4000 m pays double and
 * the deepest posts nearly triple. The home extractor always pays the base price.
 */
export const FUEL_DEPTH_METERS = 4000;

/**
 * What one unit of bought fuel costs, in dollars (fractional: ~$0.29 at home), at
 * `depthMeters` — a post's own depth; 0, the default, is the home price.
 */
export function fuelUnitPrice(depthMeters = 0): number {
  const base = itemForKind(oreKind('Coal')).value / EXTRACTOR.fuelPerCoal * FUEL_TRADE_MARKUP;
  return base * (1 + Math.max(0, depthMeters) / FUEL_DEPTH_METERS);
}

/** The fuel price at the post standing on `row`: `fuelUnitPrice` at its depth. */
export function postFuelUnitPrice(row: number): number {
  return fuelUnitPrice(rowDepthMeters(row));
}

/** A fuel order: how much fuel it pours, and the whole dollars it costs. */
export interface FuelPurchase {
  amount: number;
  cost: number;
}

const NO_FUEL: FuelPurchase = Object.freeze({amount: 0, cost: 0});

/**
 * The biggest fuel order `cash` covers, filling `fuel` toward `fuelMax`.
 *
 * The wallet buys whole units: an order is never less than one, so a tank within
 * a unit of full — or a wallet that cannot pay for one — buys nothing. When the
 * wallet covers the whole gap the order fills it exactly (a fractional top-off
 * included); otherwise it buys as many whole units as the cash allows. The cost
 * is rounded *down* to whole dollars (never below $1), so a partial fill is never
 * charged more than the fuel it pours.
 */
export function fuelPurchase(fuel: number, fuelMax: number, cash: number, unitPrice: number): FuelPurchase {
  const room = Math.max(0, fuelMax - fuel);
  if (room < 1 || !(unitPrice > 0)) return NO_FUEL;
  const affordable = Math.floor(cash / unitPrice);
  if (affordable < 1) return NO_FUEL;
  const amount = affordable >= room ? room : affordable;
  // The epsilon keeps a product like 55 × (8 / 55 × 2) = 15.999… from flooring a dollar short.
  const cost = Math.max(1, Math.floor(amount * unitPrice + 1e-9));
  return cost > cash ? NO_FUEL : {amount, cost};
}

/**
 * What one hull point of a paid repair costs at a portal, in dollars (fractional).
 *
 * A portal patches the hull at the rate a trading post's Repair Kits work out to,
 * minus the kit: one kit restores `HULL.repairKitFraction` of the hull maximum and
 * a post sells it for `buyPrice(POST_REPAIR_KIT)`, so a hull point costs that price
 * over that share. A repair worth one kit costs what the kit would; a full repair
 * from nothing costs 1 / `repairKitFraction` kits, whatever the hull's size. The
 * convenience — no bay slot, no trip to a post, any amount — is the portal's
 * reward for being built; pricing it any lower would undercut every kit.
 */
export function hullRepairPointPrice(hullMax: number): number {
  const restoredPerKit = hullMax * HULL.repairKitFraction;
  return restoredPerKit > 0 ? buyPrice(POST_REPAIR_KIT) / restoredPerKit : 0;
}

/** A paid hull repair: the hull points it restores, and the whole dollars it costs. */
export type HullRepair = FuelPurchase;

/**
 * The biggest hull repair `cash` covers at a portal, patching `hull` toward
 * `hullMax` at `hullRepairPointPrice`. The same whole-unit rules as a fuel fill
 * (`fuelPurchase`): nothing within a point of full or for a wallet short of one
 * point, the whole gap when the wallet covers it, otherwise as many whole points as
 * it does, and the cost rounded down to whole dollars (never below $1).
 */
export function hullRepair(hull: number, hullMax: number, cash: number): HullRepair {
  return fuelPurchase(hull, hullMax, cash, hullRepairPointPrice(hullMax));
}

/** The most fuel one "Buy fuel" press orders into the home extractor. */
export const EXTRACTOR_FUEL_ORDER = 100;

/**
 * One extractor fuel order: up to `EXTRACTOR_FUEL_ORDER` into the store holding
 * `stored`, capped by `EXTRACTOR.fuelCap` and by what `cash` covers, at the
 * home price.
 */
export function extractorFuelOrder(stored: number, cash: number): FuelPurchase {
  const target = Math.min(EXTRACTOR.fuelCap, stored + EXTRACTOR_FUEL_ORDER);
  return fuelPurchase(stored, target, cash, fuelUnitPrice());
}

/**
 * What a whole `EXTRACTOR_FUEL_ORDER` costs at the home price, in whole dollars —
 * the rate the extractor's button, the objective and the hazards guide quote
 * ("$29 per 100").
 */
export function extractorFuelOrderPrice(): number {
  return Math.round(EXTRACTOR_FUEL_ORDER * fuelUnitPrice());
}

/** Home Supply's markup: the base sells the basics, dearer than a post, for convenience. */
export const HOME_SUPPLY_MARKUP = 2;

/** What the home-cavern Manufacturer's Supply section sells, in list order. */
export const SUPPLY_POOL: readonly InventoryItemKind[] = Object.freeze(['repairKit', 'dynamite', 'scanner', 'container']);

/** One home Supply item's price. */
export function supplyPrice(kind: InventoryItemKind): number {
  return buyPrice(kind, HOME_SUPPLY_MARKUP);
}

/** Whether the home Supply sells `kind`. */
export function isSupplyKind(kind: InventoryItemKind): boolean {
  return SUPPLY_POOL.includes(kind);
}

/**
 * The unit price a post pays for one unit of an ore: the ore table's own value.
 * The one sell price in the game — the trade screen, the cargo readout and the
 * item tooltips all read it — so it is never taken from a stack's own record.
 */
export function sellPrice(kind: InventoryItemKind): number {
  return itemForKind(kind).value;
}

/**
 * A post's buy offers, in a stable order (so the ledger's per-index stock always
 * lines up): first the standing Repair Kit shelf every post keeps, then the 2–3
 * wares rolled from the depth-tiered pool. Both the selection and each rolled
 * offer's stock come from the coordinate, so a post's wares never change between
 * visits.
 */
export function offersForPost(x: number, y: number): BuyOffer[] {
  const kitShelf: BuyOffer = {
    kind: POST_REPAIR_KIT,
    label: itemForKind(POST_REPAIR_KIT).label,
    price: buyPrice(POST_REPAIR_KIT),
    stock: POST_REPAIR_KIT_STOCK
  };
  const eligible = BUY_POOL.filter(entry => y >= entry.minRow);
  const wanted = 2 + Math.floor(rand(x + 41, y + 67) * 2); // 2 or 3
  const count = Math.min(eligible.length, wanted);
  // A deterministic shuffle: rank each eligible entry by a per-item roll and take
  // the first `count`. The roll folds in the entry's index so two entries never tie.
  const ranked = eligible
    .map((entry, index) => ({entry, roll: rand(x + index * 7 + 13, y + index * 5 + 29)}))
    .sort((a, b) => a.roll - b.roll)
    .slice(0, count);
  return [kitShelf, ...ranked.map(({entry}, index) => ({
    kind: entry.kind,
    label: itemForKind(entry.kind).label,
    price: buyPrice(entry.kind),
    stock: 1 + Math.floor(rand(x + index * 3 + 101, y + index * 9 + 211) * 3) // 1–3
  }))];
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
  const saved = ledger[tileKey(x, y)];
  if (saved && saved.length === offers.length) {
    // Same length as `offers`, checked just above, so every offer is there.
    return offers.map((offer, i) => Math.max(0, Math.min(offer.stock, Math.floor(saved[i] ?? 0))));
  }
  return offers.map(offer => offer.stock);
}

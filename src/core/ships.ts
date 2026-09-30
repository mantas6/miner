// The ship ladder: the hulls a miner can fly, from the starter Scout up to the
// Core Breaker.
//
// A ship is a base, not an upgrade. Its four stats — `fuelMax`, `hullMax`,
// `cargoMax`, `drill` — are what `computeStats` in `core/ship-upgrades.ts` starts
// from before the fitted upgrades add on top, and its `slots` is how many fitting
// slots the hull carries. On every hull the last slot stays locked until the first
// Mk II upgrade is crafted (`isSlotLocked`), so a Scout flies two open slots and
// the third opens with the first Mk II, a Hauler three and a fourth, and so on.
//
// The ladder is one-way: only the next ship up from the current one can be built
// (`nextShip`), at a Manufacturer, from ore in its stock (`inputs`, checked with
// `canCraft` / `missingInputs` like any recipe). The build swaps the hull rather
// than producing an item — there is no fleet and no going back. The hull survives
// a death; only a full player-data reset returns the Scout.
//
// Pure data and lookups, DOM-free.

import { STARTING } from './balance';
import { missingInputs, type RecipeInput } from './crafting';
import { oreKind, type Inventory } from './inventory';

/** Every hull on the ladder, in build order. */
export const SHIP_ORDER = ['scout', 'hauler', 'prospector', 'leviathan', 'corebreaker'] as const;

/** One hull's id. Persisted in the save as `ship`. */
export type ShipId = typeof SHIP_ORDER[number];

/** The four stats a hull provides before any upgrade is fitted. */
export interface ShipBase {
  fuelMax: number;
  hullMax: number;
  cargoMax: number;
  drill: number;
}

/** One hull on the ladder. */
export interface ShipDef {
  id: ShipId;
  label: string;
  /** Fitting slots the hull carries; the last is locked until a Mk II is crafted. */
  slots: number;
  base: ShipBase;
  /** The live hull's three-stop sheen (top, middle, bottom), for the renderer. */
  hull: readonly [string, string, string];
  /** What building it consumes from a Manufacturer's stock; empty for the starter. */
  inputs: RecipeInput[];
}

/** Shorthand: an ore-input line by ore name (names must match `ORES`). */
function ore(name: string, count: number): RecipeInput {
  return {kind: oreKind(name), count};
}

/**
 * The single tunable ship table. Each hull adds one fitting slot and a bigger
 * base on every stat, so a swap never shrinks the bay or the tank.
 */
export const SHIPS: Readonly<Record<ShipId, ShipDef>> = {
  scout: {
    id: 'scout', label: 'Scout', slots: 3,
    // The starter's base is `STARTING`'s: 100 fuel, 100 hull, 20 cargo, drill 1.
    base: {fuelMax: STARTING.fuelMax, hullMax: STARTING.hullMax, cargoMax: STARTING.cargoMax, drill: STARTING.drill},
    hull: ['#9ee6ff', '#4dbbe8', '#126a98'],
    inputs: []
  },
  hauler: {
    id: 'hauler', label: 'Hauler', slots: 4,
    base: {fuelMax: 150, hullMax: 125, cargoMax: 30, drill: 1},
    hull: ['#ffe0a8', '#e8a64d', '#98561a'],
    inputs: [ore('Iron', 16), ore('Copper', 10), ore('Silver', 6)]
  },
  prospector: {
    id: 'prospector', label: 'Prospector', slots: 5,
    base: {fuelMax: 200, hullMax: 150, cargoMax: 40, drill: 2},
    hull: ['#c4ffb8', '#5fd06a', '#1d7a33'],
    inputs: [ore('Silver', 12), ore('Gold', 10), ore('Ruby', 4)]
  },
  leviathan: {
    id: 'leviathan', label: 'Leviathan', slots: 6,
    base: {fuelMax: 275, hullMax: 200, cargoMax: 55, drill: 3},
    hull: ['#dcc8ff', '#9a6ff0', '#4a2a98'],
    inputs: [ore('Ruby', 8), ore('Emerald', 6), ore('Alienite', 4)]
  },
  corebreaker: {
    id: 'corebreaker', label: 'Core Breaker', slots: 7,
    base: {fuelMax: 350, hullMax: 250, cargoMax: 70, drill: 4},
    hull: ['#ffbfa8', '#f0603f', '#8a1f12'],
    inputs: [ore('Alienite', 6), ore('Uranium', 4), ore('Core Shard', 3)]
  }
};

/** The hull every new career starts in. */
export const STARTER_SHIP: ShipId = 'scout';

/** The most fitting slots any hull carries. */
export const MAX_SHIP_SLOTS = Math.max(...SHIP_ORDER.map(id => SHIPS[id].slots));

/** The largest base cargo bay any hull carries. */
export const MAX_SHIP_CARGO = Math.max(...SHIP_ORDER.map(id => SHIPS[id].base.cargoMax));

/** Whether a (saved, hand-edited) string names a hull on the ladder. */
export function isShipId(value: unknown): value is ShipId {
  return typeof value === 'string' && (SHIP_ORDER as readonly string[]).includes(value);
}

export function shipFor(id: ShipId): ShipDef {
  return SHIPS[id];
}

/** How many fitting slots the hull carries. */
export function slotsFor(id: ShipId): number {
  return SHIPS[id].slots;
}

/** The hull's rung on the ladder: 0 for the Scout, 4 for the Core Breaker. */
export function shipTier(id: ShipId): number {
  return SHIP_ORDER.indexOf(id);
}

/** The one hull that can be built from `id`, or `null` on the top rung. */
export function nextShip(id: ShipId): ShipId | null {
  return SHIP_ORDER[shipTier(id) + 1] ?? null;
}

/** The next hull up the ladder, and what a Manufacturer's stock still lacks to build it. */
export interface NextShipShortfall {
  id: ShipId;
  /** Each input the stock is short on, with the missing count; empty when it can be built. */
  missing: RecipeInput[];
}

/** What building the next hull up from `id` still needs out of `stock`, or `null` on the top rung. */
export function nextShipShortfall(id: ShipId, stock: Inventory): NextShipShortfall | null {
  const next = nextShip(id);
  return next ? {id: next, missing: missingInputs(stock, SHIPS[next])} : null;
}

/** What a swap from `from` to `to` adds to each base stat. */
export function shipGains(from: ShipId, to: ShipId): ShipBase {
  const a = SHIPS[from].base, b = SHIPS[to].base;
  return {
    fuelMax: b.fuelMax - a.fuelMax,
    hullMax: b.hullMax - a.hullMax,
    cargoMax: b.cargoMax - a.cargoMax,
    drill: b.drill - a.drill
  };
}

/**
 * A swap's gains in words, e.g. "+1 slot · +50 fuel · +25 hull · +10 cargo";
 * a stat the swap leaves alone is left out.
 */
export function formatShipGains(from: ShipId, to: ShipId): string {
  const gains = shipGains(from, to);
  const slots = slotsFor(to) - slotsFor(from);
  const parts: string[] = [];
  if (slots > 0) parts.push(`+${slots} slot${slots === 1 ? '' : 's'}`);
  if (gains.fuelMax > 0) parts.push(`+${gains.fuelMax} fuel`);
  if (gains.hullMax > 0) parts.push(`+${gains.hullMax} hull`);
  if (gains.cargoMax > 0) parts.push(`+${gains.cargoMax} cargo`);
  if (gains.drill > 0) parts.push(`+${gains.drill} drill`);
  return parts.join(' · ');
}

/** A loadout resized to a hull: fitted upgrades kept in place, empty slots padded or trimmed. */
export function fitEquipmentTo<T>(equipment: readonly (T | null)[], id: ShipId): (T | null)[] {
  const slots = slotsFor(id);
  return Array.from({length: slots}, (_, index) => equipment[index] ?? null);
}

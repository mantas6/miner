// Wrecks: the corpse loot a lost — or scrapped — ship leaves behind.
//
// When a run ends, the replacement ship deploys empty: the ore it was carrying and
// the upgrades fitted to its hull do not survive the wreck (see `respawnPlayer` in
// `core/state.ts`). Rather than delete them outright, the run drops them here — a
// wreck standing on the tile the old ship sat on, holding exactly what was lost, so
// a careful miner can fly back down and salvage their own cargo.
//
// A wreck is a thing standing on a tile with an inventory, like a cargo container,
// and it answers the same reach questions. What sets it apart is that it is never
// placed by hand and never restocked: it is built once from a dying ship, looted
// take-only, and removed the moment it is emptied. The mine holds a bounded number
// of them, the oldest dropping out past the cap, so a save can never grow an
// unbounded graveyard.
//
// Everything here is pure and DOM-free.

import {
  addItem,
  createInventory,
  findStack,
  oreStacks,
  removeItem,
  roomLeft,
  totalItems,
  type Inventory,
  type InventoryItemKind
} from './inventory';
import { itemForKind } from './items';
import type { Player } from './types';

export const WRECK = Object.freeze({
  /**
   * How many wrecks may stand in the mine at once. A soft cap, like the crate's:
   * a run that dies again and again would otherwise litter the map with corpses,
   * and the oldest is dropped to make room for the newest.
   */
  maxPlaced: 5,
  /**
   * How far the salvage hatch opens from. One tile in any direction — Chebyshev,
   * so the diagonals count — plus the wreck's own tile, which the ship can fly onto.
   */
  reach: 1
});

/** One wrecked ship standing in the mine, and everything it still holds. */
export interface Wreck {
  x: number;
  y: number;
  /** Its own slots. Immutable, like the ship's: a transfer replaces the array. */
  inventory: Inventory;
}

export function createWreck(x: number, y: number, inventory: Inventory = createInventory()): Wreck {
  return {x, y, inventory};
}

/**
 * The cargo a dying ship leaves behind: every ore stack aboard, plus one item per
 * fitted upgrade (the upgrades come back as unequipped bay items, so an `itemForKind`
 * of each slot is what the wreck holds). Non-ore bay equipment rides out with the
 * miner (see `respawnPlayer`), so it is deliberately not included.
 */
export function buildWreckInventory(player: Pick<Player, 'inventory' | 'equipment'>): Inventory {
  let inventory = createInventory();
  for (const stack of oreStacks(player.inventory)) inventory = addItem(inventory, stack.item, stack.count);
  for (const kind of player.equipment) {
    if (kind) inventory = addItem(inventory, itemForKind(kind));
  }
  return inventory;
}

/** The wreck standing on this tile, or `null`. */
export function wreckAt(wrecks: readonly Wreck[], x: number, y: number): Wreck | null {
  return wrecks.find(wreck => wreck.x === x && wreck.y === y) ?? null;
}

/** Whether a ship at `x`/`y` is close enough to loot this wreck. */
export function isWreckReachable(wreck: Wreck, x: number, y: number): boolean {
  return Math.max(Math.abs(wreck.x - x), Math.abs(wreck.y - y)) <= WRECK.reach;
}

/**
 * The wreck a ship at `x`/`y` would loot with no tile named — the keyboard's
 * answer. The one it is standing on wins, then the nearest neighbour, so a wreck
 * flown onto is never passed over for one beside it.
 */
export function reachableWreck(wrecks: readonly Wreck[], x: number, y: number): Wreck | null {
  let best: Wreck | null = null;
  let bestDistance = Infinity;
  for (const wreck of wrecks) {
    if (!isWreckReachable(wreck, x, y)) continue;
    const distance = Math.abs(wreck.x - x) + Math.abs(wreck.y - y);
    if (distance >= bestDistance) continue;
    best = wreck;
    bestDistance = distance;
  }
  return best;
}

/**
 * Drop a wreck at the ship's current tile holding everything a death would strip
 * from it, and push it onto `wrecks`, dropping the oldest past the cap. Returns the
 * new wreck, or `null` when there is nothing to leave behind — a ship carrying no
 * ore and flying no upgrades leaves no corpse worth the name.
 */
export function dropWreck(wrecks: Wreck[], player: Pick<Player, 'x' | 'y' | 'inventory' | 'equipment'>): Wreck | null {
  const inventory = buildWreckInventory(player);
  if (totalItems(inventory) <= 0) return null;
  const wreck = createWreck(player.x, player.y, inventory);
  wrecks.push(wreck);
  while (wrecks.length > WRECK.maxPlaced) wrecks.shift();
  return wreck;
}

/**
 * The outcome of one press on a stack in the salvage menu: the two inventories as
 * they now stand, or the line to show the player instead.
 */
export type WreckTransfer =
  | {ok: true; ship: Inventory; wreck: Inventory; moved: number; label: string}
  | {ok: false; refusal: string};

/**
 * Wreck → bay, capped by the cargo-bay upgrade. Room is measured against every item
 * already aboard, so equipment counts the same as ore. A partial haul is a success:
 * taking two of the ten ore a wreck holds is what a ship two short of `cargoMax`
 * should be able to do, and the rest stays in the wreck. `maxUnits` caps the move
 * below the whole stack — a single-unit press asks for exactly one.
 */
export function takeFromWreck(
  ship: Inventory,
  wreck: Inventory,
  kind: InventoryItemKind,
  cargoMax: number,
  maxUnits = Infinity
): WreckTransfer {
  const room = roomLeft(ship, cargoMax);
  if (room <= 0) {
    return {ok: false, refusal: `Cargo bay is full at ${cargoMax} items. Stow or unload before salvaging more.`};
  }
  const stack = findStack(wreck, kind);
  if (!stack) return {ok: false, refusal: 'Nothing of that kind is in the wreck.'};
  const moved = Math.min(stack.count, room, maxUnits);
  if (moved <= 0) return {ok: false, refusal: 'Nothing of that kind is in the wreck.'};
  return {
    ok: true,
    ship: addItem(ship, stack.item, moved),
    wreck: removeItem(wreck, kind, moved),
    moved,
    label: stack.item.label
  };
}

/**
 * Loot everything the bay will take, in one press, and report the wreck's new
 * contents. A partial haul is honest: a ship near full takes what fits and the
 * rest stays in the wreck.
 */
export function lootAll(ship: Inventory, wreck: Inventory, cargoMax: number): {ship: Inventory; wreck: Inventory; moved: number} {
  let nextShip = ship;
  let nextWreck = wreck;
  let moved = 0;
  for (const stack of wreck) {
    const room = roomLeft(nextShip, cargoMax);
    if (room <= 0) break;
    const take = Math.min(stack.count, room);
    nextShip = addItem(nextShip, stack.item, take);
    nextWreck = removeItem(nextWreck, stack.kind, take);
    moved += take;
  }
  return {ship: nextShip, wreck: nextWreck, moved};
}

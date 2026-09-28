// Chests: the loot buried in the mine, and what is left in the ones opened.
//
// A chest is a coordinate, nothing more (see `chestAt` in `world.ts`), and so is its
// loot: `chestLoot` rolls 2–4 stacks from the same coordinate — ore from the depth's
// own band, consumables, decorations, and now and then a ship upgrade whose mark
// rises with depth. There is never cash in a chest.
//
// The only stored thing is `state.chestLedger`: the contents of each chest the
// player has opened, written on first open and after every haul. An absent key is
// a chest still holding its rolled loot; an empty array is one looted bare, which
// is gone from the canvas and the observation for good.
//
// A chest opens like a wreck — take-only, from the tile it lies on or any of the
// eight around it — and its transfers are the wreck's (`takeLoot`/`lootAll`).
//
// Everything here is pure and DOM-free.

import { START_Y } from '../../shared/constants';
import { isTileExplored } from '../../shared/exploration-codec';
import { chestAt, oreForDepthRoll, rand, type Chest } from '../world/world';
import {
  addItem,
  createInventory,
  findStack,
  inventoryStacks,
  oreItem,
  type DecorKind,
  type Inventory,
  type InventoryItem,
  type InventoryItemKind,
  type UpgradeKind
} from './inventory';
import { itemForKind } from './items';
import type { ChestLedger, ChestLedgerStack } from './types';

export const CHEST = Object.freeze({
  /** How far the lid opens from: the chest's own tile and the eight around it. */
  reach: 1,
  /** Chance a chest holds a ship upgrade, on top of its other stacks. */
  upgradeChance: 0.07
});

/** The ledger key one chest is stored under. */
export function chestKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Whether the chest on this tile has been looted bare (and so is gone). */
export function isChestLooted(ledger: ChestLedger, x: number, y: number): boolean {
  return ledger[chestKey(x, y)]?.length === 0;
}

/**
 * The chest still lying on this tile, or `null` — none generated there, or it was
 * looted bare. With no ledger to hand, a generated chest counts as standing.
 */
export function chestStandsAt(x: number, y: number, ledger?: ChestLedger): Chest | null {
  const chest = chestAt(x, y);
  if (!chest || (ledger && isChestLooted(ledger, x, y))) return null;
  return chest;
}

/** Rebuild an inventory from ledger stacks, every item resolved through the catalog. */
export function inventoryFromLedger(stacks: readonly ChestLedgerStack[]): Inventory {
  return stacks.reduce((inventory, stack) => addItem(inventory, itemForKind(stack.kind), stack.count), createInventory());
}

/** Flatten an inventory to the ledger's `{kind, count}` stacks. */
export function ledgerStacks(inventory: Inventory): ChestLedgerStack[] {
  return inventoryStacks(inventory).map(stack => ({kind: stack.kind, count: stack.count}));
}

/** What a chest holds right now: its ledger entry once opened, its rolled loot before. */
export function chestContents(ledger: ChestLedger, x: number, y: number): Inventory {
  const saved = ledger[chestKey(x, y)];
  return saved ? inventoryFromLedger(saved) : chestLoot(x, y);
}

/** Whether a ship at `x`/`y` is close enough to open this chest. */
export function isChestReachable(chest: Chest, x: number, y: number): boolean {
  return Math.max(Math.abs(chest.x - x), Math.abs(chest.y - y)) <= CHEST.reach;
}

/**
 * The chest a ship at `x`/`y` would open with no tile named — the keyboard's
 * answer. Only a chest still standing on an explored tile counts (one under fog is
 * not one the player can see); the tile the ship is on wins, then the nearest
 * neighbour, a tie going to the first in row order.
 */
export function reachableChest(
  ledger: ChestLedger,
  explored: ReadonlySet<number>,
  x: number,
  y: number
): Chest | null {
  let best: Chest | null = null;
  let bestDistance = Infinity;
  for (let dy = -CHEST.reach; dy <= CHEST.reach; dy++) {
    for (let dx = -CHEST.reach; dx <= CHEST.reach; dx++) {
      const chest = chestStandsAt(x + dx, y + dy, ledger);
      if (!chest || !isTileExplored(explored, chest.x, chest.y)) continue;
      const distance = Math.abs(dx) + Math.abs(dy);
      if (distance >= bestDistance) continue;
      best = chest;
      bestDistance = distance;
    }
  }
  return best;
}

// --- Loot tables -------------------------------------------------------------

/** One weighted entry of a loot pool, and the most units a stack of it rolls. */
interface PoolEntry<K extends InventoryItemKind> {
  kind: K;
  weight: number;
  max: number;
}

/** Consumables: the everyday tools, and a rare teleporter charge. */
const CONSUMABLES: readonly PoolEntry<InventoryItemKind>[] = [
  {kind: 'repairKit', weight: 0.34, max: 2},
  {kind: 'dynamite', weight: 0.34, max: 3},
  {kind: 'scanner', weight: 0.26, max: 1},
  {kind: 'teleporter', weight: 0.06, max: 1}
];

/** Decorations, the lamp panel the scarcest. */
const DECOR: readonly PoolEntry<DecorKind>[] = [
  {kind: 'decor:steelPlate', weight: 1, max: 3},
  {kind: 'decor:stoneBlock', weight: 1, max: 3},
  {kind: 'decor:copperTrim', weight: 1, max: 3},
  {kind: 'decor:lampPanel', weight: 1, max: 2}
];

/** Below this depth (rows under the home row) a chest's upgrade is Mk II. */
export const CHEST_MID_DEPTH = 150;
/** Below this depth it is Mk III — or the Booster. */
export const CHEST_DEEP_DEPTH = 400;

/** The upgrades a chest at row `y` can hold: the mark rises with depth. */
export function chestUpgradePool(y: number): readonly UpgradeKind[] {
  const depth = y - START_Y;
  if (depth >= CHEST_DEEP_DEPTH) return ['upgrade:tank:3', 'upgrade:cargo:3', 'upgrade:drill:3', 'upgrade:hull:3', 'upgrade:booster:1'];
  if (depth >= CHEST_MID_DEPTH) return ['upgrade:tank:2', 'upgrade:cargo:2', 'upgrade:drill:2', 'upgrade:hull:2'];
  return ['upgrade:tank:1', 'upgrade:cargo:1', 'upgrade:drill:1', 'upgrade:hull:1'];
}

/** Pick an entry of a weighted pool with a roll in [0,1). */
function pickWeighted<K extends InventoryItemKind>(pool: readonly PoolEntry<K>[], roll: number): PoolEntry<K> {
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
  let target = roll * total;
  for (const entry of pool) {
    target -= entry.weight;
    if (target < 0) return entry;
  }
  return pool[pool.length - 1];
}

/** One rolled stack for attempt `n` of the chest at `x`/`y`. */
function rollStack(x: number, y: number, n: number): {item: InventoryItem; count: number} | null {
  const category = rand(x + n * 37 + 11, y + n * 53 + 97);
  const pick = rand(x + n * 41 + 613, y + n * 29 + 211);
  const amount = rand(x + n * 17 + 331, y + n * 61 + 1297);
  if (category < 0.5) {
    const ore = oreForDepthRoll(y, pick);
    if (!ore) return null;
    return {item: oreItem(ore), count: 2 + Math.floor(amount * 4)}; // 2–5
  }
  const entry = pickWeighted(category < 0.8 ? CONSUMABLES : DECOR, pick);
  return {item: itemForKind(entry.kind), count: 1 + Math.floor(amount * entry.max)};
}

/**
 * The loot a chest at `x`/`y` was buried with: 2–4 distinct stacks, deterministic
 * for the coordinate. Roughly one chest in fourteen also holds a single ship
 * upgrade from its depth's pool (`chestUpgradePool`), counted among the stacks.
 */
export function chestLoot(x: number, y: number): Inventory {
  let loot = createInventory();
  const wanted = 2 + Math.floor(rand(x + 3301, y + 1709) * 3); // 2–4
  if (rand(x + 1291, y + 577) < CHEST.upgradeChance) {
    const pool = chestUpgradePool(y);
    const kind = pool[Math.floor(rand(x + 947, y + 2203) * pool.length)];
    loot = addItem(loot, itemForKind(kind), 1);
  }
  // A roll that lands on a kind already in the chest is re-rolled, so the chest
  // always ends up with its full count of distinct stacks.
  for (let attempt = 0; loot.length < wanted && attempt < wanted * 8; attempt++) {
    const stack = rollStack(x, y, attempt);
    if (!stack || findStack(loot, stack.item.kind)) continue;
    loot = addItem(loot, stack.item, stack.count);
  }
  return loot;
}

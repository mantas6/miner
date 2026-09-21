// The ship's cargo bay. Pure, DOM-free, and immutable.
//
// The bay is a list of stacks, each holding one item kind. Items of the same
// kind always land in the stack that is already open for them, so a kind never
// occupies two stacks. What bounds the bay is not the number of stacks but the
// total number of *items* across them: capacity is an item count, so "is there
// room" is a question about the sum of every stack, not about how many kinds are
// aboard. A bay whose capacity is 20 holds twenty units, in one stack or ten.
//
// Every helper returns a new inventory rather than mutating the one it was given.
// That is what makes the 60 Hz HUD sync cheap: the array's identity changes
// exactly when its contents do, so the UI can skip rebuilding the panel by
// comparing one reference.
//
// Ores are the richest kind stored here, carrying their own label, colour and
// unit price so selling and the cargo readouts never have to look a name up in a
// table that a co-op peer's world might not agree with. `InventoryItemKind` is a
// namespaced string union, so equipment kinds — 'dynamite', 'scanner', 'gun',
// 'teleporter', 'container' — sit beside the ore stacks and count toward the same
// capacity: a bay full of dynamite has no room for ore, and vice versa.
//
// The module is deliberately not "the ship's bay" in its types: a cargo container
// left in the mine is another list of these stacks, obeying the same item-count
// capacity, so `core/cargo-container.ts` reuses every helper here rather than
// restating them.

import { STARTING } from './balance';
import type { Ore } from './types';

/** Total item count a fresh cargo bay can hold, before any Cargo Bay upgrade. */
export const INVENTORY_CAPACITY = STARTING.cargoMax;

/** Namespaces one ore type's stack; the suffix is the ore's own name. */
const ORE_KIND_PREFIX = 'ore:';

/** One ore type's stack key, e.g. `ore:Copper`. */
export type OreKind = `${typeof ORE_KIND_PREFIX}${string}`;

/** Everything the bay can hold. Extend the union as kinds move in. */
export type InventoryItemKind = OreKind | 'dynamite' | 'scanner' | 'gun' | 'teleporter' | 'container';

/** What one unit of a stack is: its identity and how it is shown and priced. */
export interface InventoryItem {
  kind: InventoryItemKind;
  /** Player-facing name of the item, e.g. `Copper`. */
  label: string;
  /** Swatch colour, matching the tile the item came out of. */
  color: string;
  /** Depot price of a single unit; zero for items that are not sold. */
  value: number;
}

export interface InventoryStack {
  kind: InventoryItemKind;
  /** Units held. Always at least 1; an emptied stack drops out of the list. */
  count: number;
  item: InventoryItem;
}

/** The whole bay: one stack per kind, in arrival order. Never holds empty gaps. */
export type Inventory = readonly InventoryStack[];

export function createInventory(): Inventory {
  return [];
}

export function oreKind(name: string): OreKind {
  return `${ORE_KIND_PREFIX}${name}`;
}

export function isOreKind(kind: InventoryItemKind): kind is OreKind {
  return kind.startsWith(ORE_KIND_PREFIX);
}

/** The stackable item one mined ore becomes. */
export function oreItem(ore: Ore): InventoryItem {
  return {kind: oreKind(ore.name), label: ore.name, color: ore.color, value: ore.value};
}

/** Every stack aboard, in arrival order. */
export function inventoryStacks(inventory: Inventory): InventoryStack[] {
  return [...inventory];
}

export function findStack(inventory: Inventory, kind: InventoryItemKind): InventoryStack | null {
  return inventory.find(stack => stack.kind === kind) ?? null;
}

export function countItem(inventory: Inventory, kind: InventoryItemKind): number {
  return findStack(inventory, kind)?.count ?? 0;
}

/** Units held across every stack — the number capacity is measured against. */
export function totalItems(inventory: Inventory): number {
  return inventory.reduce((sum, stack) => sum + stack.count, 0);
}

/** Units this bay could still take before it hits `capacity`. */
export function roomLeft(inventory: Inventory, capacity: number): number {
  return Math.max(0, capacity - totalItems(inventory));
}

/** Whether the bay is holding its whole capacity already. */
export function isFull(inventory: Inventory, capacity: number): boolean {
  return roomLeft(inventory, capacity) <= 0;
}

/**
 * Stack up to `count` units of `item`, growing its open stack or opening a new
 * one, without any capacity limit — callers that care enforce it first (see
 * `addOre` and the container transfers). A non-positive count changes nothing.
 */
export function addItem(inventory: Inventory, item: InventoryItem, count = 1): Inventory {
  if (count <= 0) return inventory;
  const index = inventory.findIndex(stack => stack.kind === item.kind);
  const next = [...inventory];
  if (index === -1) next.push({kind: item.kind, count, item});
  else next[index] = {...next[index], count: next[index].count + count};
  return next;
}

/** Take up to `count` units out; a stack drained to zero drops out of the list. */
export function removeItem(inventory: Inventory, kind: InventoryItemKind, count = 1): Inventory {
  const index = inventory.findIndex(stack => stack.kind === kind);
  if (index === -1 || count <= 0) return inventory;
  const stack = inventory[index];
  if (stack.count <= count) return inventory.filter((_, i) => i !== index);
  const next = [...inventory];
  next[index] = {...stack, count: stack.count - count};
  return next;
}

/** Drop every stack whose kind matches. */
export function removeMatching(inventory: Inventory, matches: (kind: InventoryItemKind) => boolean): Inventory {
  if (!inventory.some(stack => matches(stack.kind))) return inventory;
  return inventory.filter(stack => !matches(stack.kind));
}

// --- Ore, the sellable cargo the bay is measured for -----------------------

export function oreStacks(inventory: Inventory): InventoryStack[] {
  return inventory.filter(stack => isOreKind(stack.kind));
}

/** Ore units aboard, which is what the cargo value totals and the depot sells. */
export function countOres(inventory: Inventory): number {
  return oreStacks(inventory).reduce((sum, stack) => sum + stack.count, 0);
}

/** Sell-everything: the ore stacks leave, anything else stays put. */
export function removeOres(inventory: Inventory): Inventory {
  return removeMatching(inventory, isOreKind);
}

/**
 * Load one mined ore, refused once the bay is at capacity. Capacity counts every
 * item aboard, ore and equipment alike, so a bay crammed with tools mines less.
 * Returns `null` — and changes nothing — when there is no room.
 */
export function addOre(inventory: Inventory, ore: Ore, capacity: number): Inventory | null {
  if (isFull(inventory, capacity)) return null;
  return addItem(inventory, oreItem(ore));
}

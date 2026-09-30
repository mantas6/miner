// Ship equipment: the fitting slots, and the derived stats they produce.
//
// The four ship stats — `fuelMax`, `hullMax`, `cargoMax`, `drill` — and the boost
// flag are no longer stored. They are *derived*: `applyEquipment` recomputes them
// from the upgrades fitted in the ship's slots, over the base of the hull it flies
// (`core/ships.ts`), so a save only ever records the hull (`ship`) and which
// upgrades are fitted (`equipment`), and everything downstream — `move.ts`,
// `inventory.ts`, the HUD — reads the fields as before.
//
// Duplicates are allowed and their bonuses add, so two Fuel Tank Mk III fit
// together for the sum of both. `booster` is the odd one out: it has no stat, it
// only flips `boost` on, which gates the Shift sprint in `input.ts`.
//
// This module is where ship upgrades live now: the old cash-priced shop upgrades
// (`core/upgrades.ts`) were removed with the shop.

import {
  addItem,
  countItem,
  parseUpgradeKind,
  removeItem,
  totalItems,
  type Inventory,
  type UpgradeId,
  type UpgradeKind
} from './inventory';
import { itemForKind } from './items';
import { fitEquipmentTo, shipFor, type ShipId } from './ships';
import type { Player } from './types';

/**
 * The mark `stats.bestMarkCrafted` must reach before the last fitting slot opens:
 * crafting any Mk II upgrade unlocks it, on every hull, so the first Mk II is an
 * addition to the loadout rather than a trade against the Mk I it would otherwise
 * replace.
 */
export const SLOT_UNLOCK_MARK = 2;

/** How many of a hull's `slotCount` fitting slots are open, given the best mark ever crafted. */
export function unlockedSlotCount(slotCount: number, bestMarkCrafted: number): number {
  return bestMarkCrafted >= SLOT_UNLOCK_MARK ? slotCount : Math.max(0, slotCount - 1);
}

/** Whether `slot` of a `slotCount`-slot hull is still locked — the last one, before any Mk II. */
export function isSlotLocked(slot: number, slotCount: number, bestMarkCrafted: number): boolean {
  return slot >= unlockedSlotCount(slotCount, bestMarkCrafted);
}

/**
 * The slot a fit lands in when none is named: the first empty open slot, else
 * slot 0 (a swap). A locked slot is never picked.
 */
export function firstFittingSlot(equipment: readonly (UpgradeKind | null)[], bestMarkCrafted: number): number {
  const open = unlockedSlotCount(equipment.length, bestMarkCrafted);
  for (let slot = 0; slot < open; slot++) if (equipment[slot] === null) return slot;
  return 0;
}

/** Whether an open (unlocked) slot stands empty, so a fit would add rather than swap. */
export function hasEmptyOpenSlot(equipment: readonly (UpgradeKind | null)[], bestMarkCrafted: number): boolean {
  const open = unlockedSlotCount(equipment.length, bestMarkCrafted);
  for (let slot = 0; slot < open; slot++) if (equipment[slot] === null) return true;
  return false;
}

/** Which derived stat an upgrade family adds to; `null` for the boost-only booster. */
type UpgradeStat = 'fuelMax' | 'hullMax' | 'cargoMax' | 'drill' | null;

/** One upgrade family's effect: the stat it grows and the additive bonus per mark. */
interface UpgradeEffect {
  stat: UpgradeStat;
  /** Bonus by mark: index 0 is Mk I, 1 is Mk II, 2 is Mk III (3 is the drill's Core Drill). */
  bonuses: readonly number[];
}

/**
 * The single tunable table of what each upgrade does. Mk I/II/III bonuses are
 * additive over the hull's base; the booster carries no stat because its whole
 * effect is the `boost` flag it raises.
 */
export const UPGRADE_EFFECTS: Record<UpgradeId, UpgradeEffect> = {
  tank: {stat: 'fuelMax', bonuses: [50, 100, 200]},
  cargo: {stat: 'cargoMax', bonuses: [10, 20, 40]},
  // Fractional so every mark cuts the hit count on the dirt of its depth band:
  // single-slot power 1 / 1.75 / 2.75 / 4.5 takes 9-hp dirt in 9 / 6 / 4 / 2 hits.
  // Every bonus is a multiple of 1/4, so drill hp arithmetic stays exact in floats.
  // The fourth entry is the tier-4 Core Drill (single-slot power 8).
  drill: {stat: 'drill', bonuses: [0.75, 1.75, 3.5, 7]},
  hull: {stat: 'hullMax', bonuses: [50, 100, 200]},
  booster: {stat: null, bonuses: [0]}
};

/** The stats an equipment loadout derives, over its hull's base. */
export interface DerivedStats {
  fuelMax: number;
  hullMax: number;
  cargoMax: number;
  drill: number;
  /** Whether any booster is fitted, enabling the Shift sprint. */
  boost: boolean;
}

/** The additive bonus one fitted upgrade contributes to its stat (0 for a booster). */
export function upgradeBonus(kind: UpgradeKind): number {
  const {id, tier} = parseUpgradeKind(kind);
  return UPGRADE_EFFECTS[id].bonuses[tier - 1] ?? 0;
}

/**
 * Sum a loadout of fitted slots into the four maxima and the boost flag, over the
 * base of the `ship` it is fitted to. Empty slots (`null`) contribute nothing;
 * duplicates add.
 */
export function computeStats(ship: ShipId, equipment: readonly (UpgradeKind | null)[]): DerivedStats {
  const {base} = shipFor(ship);
  const stats: DerivedStats = {
    fuelMax: base.fuelMax,
    hullMax: base.hullMax,
    cargoMax: base.cargoMax,
    drill: base.drill,
    boost: false
  };
  for (const kind of equipment) {
    if (!kind) continue;
    const {id} = parseUpgradeKind(kind);
    const effect = UPGRADE_EFFECTS[id];
    if (effect.stat === null) { stats.boost = true; continue; }
    stats[effect.stat] += upgradeBonus(kind);
  }
  return stats;
}

/**
 * Recompute the ship's derived stats from its hull and fitted equipment, in place.
 * Fuel and hull are only clamped to their (possibly reduced) maxima, never topped
 * up: this is the load / respawn / hull-swap path, which sets the maxima for a
 * loadout it restores or a hull it moves into.
 * A fit or unfit goes through `equip` / `unequip`, which carry the change in each
 * maximum over to the current fuel and hull as well. Returns the same `player`,
 * so callers can chain.
 */
export function applyEquipment(player: Player): Player {
  const stats = computeStats(player.ship, player.equipment);
  player.fuelMax = stats.fuelMax;
  player.hullMax = stats.hullMax;
  player.cargoMax = stats.cargoMax;
  player.drill = stats.drill;
  player.boost = stats.boost;
  player.fuel = Math.min(player.fuel, player.fuelMax);
  player.hull = Math.min(player.hull, player.hullMax);
  return player;
}

/**
 * Move the ship into hull `id`: its slots resized to the new hull's count (every
 * fitted upgrade stays where it is, new slots come empty), the maxima re-derived
 * over the new base, and the current fuel and hull kept as they are — a swap is
 * not a refill. Every hull up the ladder is bigger on every stat, so nothing is
 * clamped away and the bay never overflows.
 */
export function swapHull(player: Player, id: ShipId): Player {
  player.ship = id;
  player.equipment = fitEquipmentTo(player.equipment, id);
  return applyEquipment(player);
}

/** The outcome of an equip/unequip: success, or a refusal the caller can toast. */
export type EquipResult = {ok: true} | {ok: false; reason: string};

/** The current fuel and hull a loadout change leaves, or the refusal it earns. */
type VitalsAfter = {ok: true; fuel: number; hull: number} | {ok: false; reason: string};

/**
 * Carry a loadout change over to the current fuel and hull: each moves by the
 * same amount its maximum does, so fitting a Fuel Tank Mk I adds its 50 fuel
 * once and unfitting it takes the 50 back — an unfit/refit cycle is neutral. A
 * change that would drain either below 1 is refused rather than emptying the
 * tank or breaking the hull on the spot.
 */
function vitalsAfter(player: Player, nextEquipment: readonly (UpgradeKind | null)[]): VitalsAfter {
  const next = computeStats(player.ship, nextEquipment);
  const fuelDelta = next.fuelMax - player.fuelMax;
  const hullDelta = next.hullMax - player.hullMax;
  const fuel = player.fuel + fuelDelta;
  const hull = player.hull + hullDelta;
  if (fuelDelta < 0 && fuel < 1) return {ok: false, reason: 'Not enough fuel to purge that tank.'};
  if (hullDelta < 0 && hull < 1) return {ok: false, reason: 'Not enough hull to strip that plating.'};
  return {ok: true, fuel: Math.min(fuel, next.fuelMax), hull: Math.min(hull, next.hullMax)};
}

/** Commit a loadout change: slots, derived stats, then the carried-over vitals. */
function commitLoadout(player: Player, nextEquipment: (UpgradeKind | null)[], vitals: {fuel: number; hull: number}): void {
  player.equipment = nextEquipment;
  applyEquipment(player);
  player.fuel = vitals.fuel;
  player.hull = vitals.hull;
}

/**
 * Whether the upgrade in `slot` can be taken off. Removing it hands the item back
 * to the bay (one more unit) and may *shrink* `cargoMax` (if it was a Cargo Hold),
 * so it is refused when the bay could no longer hold what it already carries plus
 * the returned upgrade.
 */
export function canUnequip(player: Player, slot: number): boolean {
  const kind = player.equipment[slot];
  if (!kind) return false;
  const next = player.equipment.slice();
  next[slot] = null;
  const cargoMax = computeStats(player.ship, next).cargoMax;
  return totalItems(player.inventory) + 1 <= cargoMax;
}

/** The bay after a move: `kind` leaves it and, if `previous` was fitted, it returns. */
function bayAfterEquip(inventory: Inventory, kind: UpgradeKind, previous: UpgradeKind | null): Inventory {
  let bay = removeItem(inventory, kind, 1);
  if (previous) bay = addItem(bay, itemForKind(previous));
  return bay;
}

/**
 * Fit `kind` into `slot`, moving one unit out of the bay. A slot that was already
 * occupied hands its upgrade back to the bay; the swap is refused when the smaller
 * post-swap `cargoMax` could not hold it, when `slot` is still locked
 * (`isSlotLocked` against `bestMarkCrafted`), and when swapping a tank or plating
 * out would drain the fuel or hull below 1 (`vitalsAfter`). Mutates `player`
 * (bay, slots, derived stats, fuel and hull) on success; changes nothing on
 * refusal.
 */
export function equip(player: Player, slot: number, kind: UpgradeKind, bestMarkCrafted: number): EquipResult {
  if (slot < 0 || slot >= player.equipment.length) return {ok: false, reason: 'No such upgrade slot.'};
  if (isSlotLocked(slot, player.equipment.length, bestMarkCrafted)) return {ok: false, reason: 'That slot is locked — craft a Mk II upgrade to open it.'};
  if (countItem(player.inventory, kind) <= 0) return {ok: false, reason: 'That upgrade is not in the cargo bay.'};
  // `slot` was bounds-checked above, so the fallback only reads an empty slot as one.
  const previous = player.equipment[slot] ?? null;
  const nextEquipment = player.equipment.slice();
  nextEquipment[slot] = kind;
  const cargoMax = computeStats(player.ship, nextEquipment).cargoMax;
  const bay = bayAfterEquip(player.inventory, kind, previous);
  if (totalItems(bay) > cargoMax) {
    return {ok: false, reason: 'Cargo bay has no room to swap that upgrade out.'};
  }
  const vitals = vitalsAfter(player, nextEquipment);
  if (!vitals.ok) return vitals;
  player.inventory = bay;
  commitLoadout(player, nextEquipment, vitals);
  return {ok: true};
}

/**
 * Take the upgrade in `slot` off and drop it back into the bay. Refused when the
 * slot is empty, when `canUnequip` says the bay could not hold the returned
 * upgrade at the reduced capacity, and when the smaller tank or hull would leave
 * less than 1 fuel or hull (`vitalsAfter`).
 */
export function unequip(player: Player, slot: number): EquipResult {
  const kind = player.equipment[slot];
  if (!kind) return {ok: false, reason: 'That slot is already empty.'};
  if (!canUnequip(player, slot)) return {ok: false, reason: 'Cargo bay is too full to unfit that upgrade.'};
  const nextEquipment = player.equipment.slice();
  nextEquipment[slot] = null;
  const vitals = vitalsAfter(player, nextEquipment);
  if (!vitals.ok) return vitals;
  player.inventory = addItem(player.inventory, itemForKind(kind));
  commitLoadout(player, nextEquipment, vitals);
  return {ok: true};
}

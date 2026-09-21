// Ship equipment: the fitting slots, and the derived stats they produce.
//
// The four ship stats — `fuelMax`, `hullMax`, `cargoMax`, `drill` — and the boost
// flag are no longer stored. They are *derived*: `applyEquipment` recomputes them
// from the upgrades fitted in the ship's slots, over the `STARTING` base, so a
// save only ever records which upgrades are fitted (`equipment`) and everything
// downstream — `move.ts`, `inventory.ts`, the HUD — reads the fields as before.
//
// Duplicates are allowed and their bonuses add, so two Fuel Tank Mk III fit
// together for the sum of both. `booster` is the odd one out: it has no stat, it
// only flips `boost` on, which gates the Shift sprint in `input.ts`.
//
// This module replaces the role of `core/upgrades.ts` (the old cash-priced shop
// upgrades); that file lives on until Phase 6 deletes it.

import { STARTING } from './balance';
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
import type { Player } from './types';

// Re-export rather than redefine: the slot count is a persistence-shaped constant
// that lives in `shared/constants.ts`, but it belongs to this module's vocabulary.
export { SHIP_UPGRADE_SLOTS } from '../../shared/constants';

/** Which derived stat an upgrade family adds to; `null` for the boost-only booster. */
type UpgradeStat = 'fuelMax' | 'hullMax' | 'cargoMax' | 'drill' | null;

/** One upgrade family's effect: the stat it grows and the additive bonus per mark. */
interface UpgradeEffect {
  stat: UpgradeStat;
  /** Bonus by mark: index 0 is Mk I, 1 is Mk II, 2 is Mk III. */
  bonuses: readonly number[];
}

/**
 * The single tunable table of what each upgrade does. Mk I/II/III bonuses are
 * additive over the `STARTING` base; the booster carries no stat because its whole
 * effect is the `boost` flag it raises.
 */
export const UPGRADE_EFFECTS: Record<UpgradeId, UpgradeEffect> = {
  tank: {stat: 'fuelMax', bonuses: [50, 100, 200]},
  cargo: {stat: 'cargoMax', bonuses: [10, 20, 40]},
  drill: {stat: 'drill', bonuses: [1, 2, 4]},
  hull: {stat: 'hullMax', bonuses: [50, 100, 200]},
  booster: {stat: null, bonuses: [0]}
};

/** The stats an equipment loadout derives, over the starting base. */
export interface DerivedStats {
  fuelMax: number;
  hullMax: number;
  cargoMax: number;
  drill: number;
  /** Whether any booster is fitted, enabling the Shift sprint. */
  boost: boolean;
}

/** The additive bonus one fitted upgrade contributes to its stat (0 for a booster). */
function upgradeBonus(kind: UpgradeKind): number {
  const {id, tier} = parseUpgradeKind(kind);
  return UPGRADE_EFFECTS[id].bonuses[tier - 1] ?? 0;
}

/**
 * Sum a loadout of fitted slots into the four maxima and the boost flag, over the
 * `STARTING` base. Empty slots (`null`) contribute nothing; duplicates add.
 */
export function computeStats(equipment: readonly (UpgradeKind | null)[]): DerivedStats {
  const stats: DerivedStats = {
    fuelMax: STARTING.fuelMax,
    hullMax: STARTING.hullMax,
    cargoMax: STARTING.cargoMax,
    drill: STARTING.drill,
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
 * Recompute the ship's derived stats from its fitted equipment, in place. Fuel and
 * hull are clamped to their (possibly reduced) maxima, so unfitting a tank or hull
 * upgrade cannot leave a ship holding more than the smaller tank can. Returns the
 * same `player`, so callers can chain.
 */
export function applyEquipment(player: Player): Player {
  const stats = computeStats(player.equipment);
  player.fuelMax = stats.fuelMax;
  player.hullMax = stats.hullMax;
  player.cargoMax = stats.cargoMax;
  player.drill = stats.drill;
  player.boost = stats.boost;
  player.fuel = Math.min(player.fuel, player.fuelMax);
  player.hull = Math.min(player.hull, player.hullMax);
  return player;
}

/** The outcome of an equip/unequip: success, or a refusal the caller can toast. */
export type EquipResult = {ok: true} | {ok: false; reason: string};

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
  const cargoMax = computeStats(next).cargoMax;
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
 * post-swap `cargoMax` could not hold it. Mutates `player` (bay, slots, derived
 * stats) on success; changes nothing on refusal.
 */
export function equip(player: Player, slot: number, kind: UpgradeKind): EquipResult {
  if (slot < 0 || slot >= player.equipment.length) return {ok: false, reason: 'No such upgrade slot.'};
  if (countItem(player.inventory, kind) <= 0) return {ok: false, reason: 'That upgrade is not in the cargo bay.'};
  const previous = player.equipment[slot];
  const nextEquipment = player.equipment.slice();
  nextEquipment[slot] = kind;
  const cargoMax = computeStats(nextEquipment).cargoMax;
  const bay = bayAfterEquip(player.inventory, kind, previous);
  if (totalItems(bay) > cargoMax) {
    return {ok: false, reason: 'Cargo bay has no room to swap that upgrade out.'};
  }
  player.inventory = bay;
  player.equipment = nextEquipment;
  applyEquipment(player);
  return {ok: true};
}

/**
 * Take the upgrade in `slot` off and drop it back into the bay. Refused when the
 * slot is empty, or when `canUnequip` says the bay could not hold the returned
 * upgrade at the reduced capacity.
 */
export function unequip(player: Player, slot: number): EquipResult {
  const kind = player.equipment[slot];
  if (!kind) return {ok: false, reason: 'That slot is already empty.'};
  if (!canUnequip(player, slot)) return {ok: false, reason: 'Cargo bay is too full to unfit that upgrade.'};
  const nextEquipment = player.equipment.slice();
  nextEquipment[slot] = null;
  player.equipment = nextEquipment;
  player.inventory = addItem(player.inventory, itemForKind(kind));
  applyEquipment(player);
  return {ok: true};
}

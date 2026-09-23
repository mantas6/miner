// The one place every carriable thing explains itself.
//
// `describeItem(kind)` turns any `InventoryItemKind` into a short title and a few
// lines of player-facing detail, derived from the same constants the simulation
// runs on — the upgrade effect table, the device configs, the ore table — so the
// text can never drift from behaviour. The tooltip component and the overlay
// observation (`info: string[]`) both read from here, so a human hovering a slot
// and an agent reading the JSON see the same words.
//
// It is exhaustive over the current kind union on purpose: ore is handled by the
// ore table, and every non-ore kind is routed to a branch that ends in a `never`
// check, so a kind added to `inventory.ts` without a description here fails to
// compile rather than shipping a blank tooltip.

import { DECOR_HP, ORES } from '../../shared/constants';
import { HULL } from './balance';
import { CARGO_CONTAINER } from './cargo-container';
import { DYNAMITE } from './dynamite';
import {
  isDecorKind,
  isOreKind,
  isUpgradeKind,
  parseUpgradeKind,
  type ConsumableKind,
  type DecorKind,
  type InventoryItemKind,
  type UpgradeId,
  type UpgradeKind
} from './inventory';
import { itemForKind } from './items';
import { formatDepthBandLabel } from './prospecting';
import { SCANNER_DEVICE } from './scanner-device';
import { UPGRADE_EFFECTS } from './ship-upgrades';
import { MIN_TELEPORT_DEPTH_METERS } from './teleporter';

/** A title and a few detail lines for one item kind. Never empty. */
export interface ItemInfo {
  title: string;
  lines: string[];
}

/** Exhaustiveness guard: a kind reaching here has no description branch. */
function assertNever(value: never): never {
  throw new Error(`Undescribed item kind: ${String(value)}`);
}

/** The bonus one fitted upgrade of `kind` adds to its stat (0 for the booster). */
function upgradeBonus(id: UpgradeId, tier: number): number {
  return UPGRADE_EFFECTS[id].bonuses[tier - 1] ?? 0;
}

/** How each upgrade family words the stat it grows. */
function upgradeEffectLine(id: UpgradeId, bonus: number): string {
  switch (id) {
    case 'tank': return `+${bonus} max fuel when fitted.`;
    case 'cargo': return `+${bonus} cargo capacity when fitted.`;
    case 'drill': return `+${bonus} drill power when fitted.`;
    case 'hull': return `+${bonus} max hull when fitted.`;
    case 'booster': return 'Enables the Shift sprint/boost while fitted.';
    default: return assertNever(id);
  }
}

/** The fitted-ship upgrades, described from `UPGRADE_EFFECTS`. */
function describeUpgrade(kind: UpgradeKind): ItemInfo {
  const {id, tier} = parseUpgradeKind(kind);
  const lines = [upgradeEffectLine(id, upgradeBonus(id, tier))];
  lines.push('Fit it from the Ship screen; duplicates stack.');
  return {title: itemForKind(kind).label, lines};
}

/** The placeable cosmetic tiles. */
function describeDecor(kind: DecorKind): ItemInfo {
  return {
    title: itemForKind(kind).label,
    lines: [
      'Decoration: set it down on a cleared tile to mark the mine.',
      `Takes ${DECOR_HP} drill hits to clear once placed.`
    ]
  };
}

/** The four devices and the repair kit, each from its own config. */
function describeConsumable(kind: ConsumableKind): ItemInfo {
  const title = itemForKind(kind).label;
  switch (kind) {
    case 'dynamite':
      return {
        title,
        lines: [
          `Blast radius ${DYNAMITE.radius} tiles; ${DYNAMITE.fuseSeconds} s fuse.`,
          'Plant it on a cleared tile and clear the radius before it goes off.'
        ]
      };
    case 'scanner':
      return {
        title,
        lines: [
          `Maps a ${SCANNER_DEVICE.size}×${SCANNER_DEVICE.size} square around it.`,
          `Reveals one fogged tile every ${SCANNER_DEVICE.intervalSeconds} s.`
        ]
      };
    case 'teleporter':
      return {
        title,
        lines: [
          'Returns you to the surface, or back down to where you left.',
          `Usable from ${MIN_TELEPORT_DEPTH_METERS} m deep or more.`
        ]
      };
    case 'container':
      return {
        title,
        lines: [
          `Holds up to ${CARGO_CONTAINER.capacity} items, kept through death and reload.`,
          `Up to ${CARGO_CONTAINER.maxPlaced} can stand in the mine at once.`
        ]
      };
    case 'repairKit':
      return {
        title,
        lines: [`Restores +${Math.round(HULL.repairKitFraction * 100)}% of max hull when used.`]
      };
    default:
      return assertNever(kind);
  }
}

/** One ore stack: its unit value and the depth band it is found in. */
function describeOre(kind: InventoryItemKind): ItemInfo {
  const item = itemForKind(kind);
  const name = kind.slice('ore:'.length);
  const ore = ORES.find(entry => entry.name === name);
  const lines = [`Sells for $${item.value} per unit.`];
  if (ore) lines.push(`Found ${formatDepthBandLabel(ore.min, ore.max)} deep.`);
  return {title: item.label, lines};
}

/**
 * The title and detail lines for any item kind. Ore is resolved through the ore
 * table; every non-ore kind flows to an exhaustive branch, so the union is fully
 * covered and a new kind must be described here to compile.
 */
export function describeItem(kind: InventoryItemKind): ItemInfo {
  if (isOreKind(kind)) return describeOre(kind);
  if (isUpgradeKind(kind)) return describeUpgrade(kind);
  if (isDecorKind(kind)) return describeDecor(kind);
  return describeConsumable(kind);
}

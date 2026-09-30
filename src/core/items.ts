// The one central item registry.
//
// Every stackable thing the bay can hold that is not ore is described here, once,
// so persistence, crafting, and the UI can resolve any `InventoryItemKind` to the
// `InventoryItem` that names, colours, and prices it. Ore is the deliberate
// exception: an ore stack carries its own record straight off the tile it was
// mined from, so `itemForKind` resolves ore kinds through `ORES` instead of this
// catalog.
//
// The consumable entries are the single source of truth for the four devices, the
// repair kit and the fuel cell (whose measure, `FUEL_CELL_FUEL`, lives here too); `dynamite.ts`, `scanner-device.ts`, `teleporter.ts`, and
// `cargo-container.ts` re-export their own item from here rather than restating
// it. The module depends only on `inventory.ts` types and the ore table, so it
// sits at the bottom of the import graph with nothing importing back into it.

import { ORES } from '../../shared/constants';
import {
  CORE_DRILL_KIND,
  isOreKind,
  oreItem,
  type DecorKind,
  type InventoryItem,
  type InventoryItemKind,
  type NonOreKind,
  type UpgradeId,
  type UpgradeKind,
  type UpgradeTier
} from './inventory';

/** Player-facing family names for the ship upgrades. */
const UPGRADE_LABELS: Record<UpgradeId, string> = {
  tank: 'Fuel Tank',
  cargo: 'Cargo Hold',
  drill: 'Drill',
  hull: 'Hull Plating',
  booster: 'Booster'
};

/** Swatch colours for the ship upgrades, matching the HUD upgrade icons. */
const UPGRADE_COLORS: Record<UpgradeId, string> = {
  tank: '#5ad1ff',
  cargo: '#c8912f',
  drill: '#d0d6de',
  hull: '#8fa2b5',
  booster: '#ff8a3d'
};

/** Roman numerals for the three marks. */
const MARKS: Record<UpgradeTier, string> = {1: 'Mk I', 2: 'Mk II', 3: 'Mk III'};

/** One upgrade stack's item: e.g. `upgrade:drill:3` → "Drill Mk III". */
function upgradeItem(id: UpgradeId, tier: UpgradeTier): InventoryItem {
  const kind: UpgradeKind = id === 'booster'
    ? 'upgrade:booster:1'
    : `upgrade:${id}:${tier}`;
  // Booster is Mk I only, so it drops the mark suffix its single tier would add.
  const label = id === 'booster' ? UPGRADE_LABELS.booster : `${UPGRADE_LABELS[id]} ${MARKS[tier]}`;
  return {kind, label, color: UPGRADE_COLORS[id], value: 0};
}

/** Every tiered upgrade stack, plus the lone Mk I booster and the tier-4 Core Drill. */
function upgradeItems(): Record<UpgradeKind, InventoryItem> {
  const out = {} as Record<UpgradeKind, InventoryItem>;
  for (const id of ['tank', 'cargo', 'drill', 'hull'] as const) {
    for (const tier of [1, 2, 3] as const) {
      out[`upgrade:${id}:${tier}`] = upgradeItem(id, tier);
    }
  }
  out['upgrade:booster:1'] = upgradeItem('booster', 1);
  out[CORE_DRILL_KIND] = {kind: CORE_DRILL_KIND, label: 'Core Drill', color: '#ff7a1f', value: 0};
  return out;
}

/** The decorations, keyed by their `decor:` kind. */
const DECOR_ITEMS: Record<DecorKind, InventoryItem> = {
  'decor:steelPlate': {kind: 'decor:steelPlate', label: 'Steel Plate', color: '#8fa2b5', value: 0},
  'decor:stoneBlock': {kind: 'decor:stoneBlock', label: 'Stone Block', color: '#7d7a72', value: 0},
  'decor:copperTrim': {kind: 'decor:copperTrim', label: 'Copper Trim', color: '#c47b45', value: 0},
  'decor:lampPanel': {kind: 'decor:lampPanel', label: 'Lamp Panel', color: '#ffdf7a', value: 0}
};

/**
 * Every non-ore item, resolvable by kind. Devices and the repair kit are spent or
 * placed on use; upgrades are fitted to the ship; decor is set down as a tile.
 * Everything here is equipment, never cargo, so `value` is zero across the board.
 */
export const ITEM_CATALOG: Record<NonOreKind, InventoryItem> = {
  dynamite: {kind: 'dynamite', label: 'Dynamite', color: '#e04a2f', value: 0},
  scanner: {kind: 'scanner', label: 'Scanner', color: '#6fe3ff', value: 0},
  teleporter: {kind: 'teleporter', label: 'Teleporter', color: '#72d9ff', value: 0},
  container: {kind: 'container', label: 'Container', color: '#c8912f', value: 0},
  repairKit: {kind: 'repairKit', label: 'Repair Kit', color: '#7be08a', value: 0},
  fuelCell: {kind: 'fuelCell', label: 'Fuel Cell', color: '#b7ff45', value: 0},
  'device:manufacturer': {kind: 'device:manufacturer', label: 'Manufacturing Station', color: '#8fa2b5', value: 0},
  'device:extractor': {kind: 'device:extractor', label: 'Fuel Extractor', color: '#7fd4c0', value: 0},
  'device:portal': {kind: 'device:portal', label: 'Portal', color: '#72d9ff', value: 0},
  toolkit: {kind: 'toolkit', label: 'Construction Toolkit', color: '#d9a441', value: 0},
  ...DECOR_ITEMS,
  ...upgradeItems()
};

/**
 * What one Fuel Cell pours into the tank: a fixed measure rather than a full
 * tank, so a stack of cells stretches a deep trip without making fuel irrelevant
 * to a 1000-unit late-game tank. One Uranium still makes two.
 */
export const FUEL_CELL_FUEL = 250;

/** The fuel one cell adds to a tank at `fuel` of `fuelMax`: its measure, capped by the room left. */
export function fuelCellFill(fuel: number, fuelMax: number): number {
  return Math.max(0, Math.min(FUEL_CELL_FUEL, fuelMax - fuel));
}

/** Whether a kind names a real non-ore item, so a save's stack can be trusted. */
export function isCatalogKind(kind: string): kind is NonOreKind {
  return Object.prototype.hasOwnProperty.call(ITEM_CATALOG, kind);
}

/**
 * The item one stack of `kind` is made of. Non-ore kinds come from the catalog;
 * ore kinds are resolved through `ORES`, and an unknown ore falls back to a plain
 * grey stack named after its own kind so a hand-edited or future save never
 * throws on load.
 */
export function itemForKind(kind: InventoryItemKind): InventoryItem {
  if (isOreKind(kind)) {
    const name = kind.slice('ore:'.length);
    const ore = ORES.find(entry => entry.name === name);
    return ore ? oreItem(ore) : {kind, label: name, color: '#8c9aa8', value: 0};
  }
  return ITEM_CATALOG[kind];
}

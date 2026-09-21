// The one description of everything the depot sells.
//
// Prices come from `economy.ts`, mechanical limits from `upgrades.ts`/`balance.ts`,
// and the shelf copy lives here — previously the same five upgrades were spelled
// out in the shop's DOM updater, the JSX template, and the upgrade table. Each
// `*RowState()` function is pure: give it a ship snapshot, the wallet, and whether
// the ship is docked, and it returns exactly the strings and the disabled flag the
// shop row paints.

import { ECONOMY } from './balance';
import { CARGO_CONTAINER } from './cargo-container';
import { DYNAMITE } from './dynamite';
import { cargoCost, drillCost, hullCost, refuelCost, repairCost, tankCost } from './economy';
import { SCANNER_DEVICE } from './scanner-device';
import { MIN_TELEPORT_DEPTH_METERS } from './teleporter';
import type { Player } from './types';
import { PLAYER_UPGRADES, getPlayerUpgradeProgress, type PlayerUpgradeId } from './upgrades';

export type ShopPlayer = Pick<
  Player,
  'fuel' | 'fuelMax' | 'hull' | 'hullMax' | 'cargoMax' | 'drill'
> & {
  /**
   * Consumable equipment in the cargo bay. Counted out of the inventory rather
   * than kept on the ship, because each occupies a slot the way ore does. Every
   * one of them is spent on use except the container, which is spent on being
   * put down and then stays where it was put.
   */
  scanners: number;
  dynamite: number;
  guns: number;
  teleporters: number;
  containers: number;
};

export interface ShopRowState {
  /** Sprite class suffix in `styles/icons.css`. */
  icon: string;
  title: string
  copy: string;
  /** The live "what you own now" line. */
  current: string;
  /** Upgrades only: what the next level buys. */
  benefit?: string;
  /** Short availability badge. */
  status: string;
  buttonLabel: string;
  buttonDisabled: boolean;
}

export interface ShopUpgradeEntry {
  id: PlayerUpgradeId;
  label: string;
  icon: string;
  purpose: string;
  unit: string;
  cost(player: ShopPlayer): number;
}

const UPGRADE_PRESENTATION: Record<PlayerUpgradeId, Omit<ShopUpgradeEntry, 'id' | 'label'>> = {
  cargo: {
    icon: 'cargo',
    purpose: 'Carry more cargo before returning to sell.',
    unit: 'items',
    cost: cargoCost
  },
  tank: {
    icon: 'tank',
    purpose: 'Extend safe range between depot refuels.',
    unit: 'fuel',
    cost: tankCost
  },
  hull: {
    icon: 'hull',
    purpose: 'Survive more rock, magma, and fiend damage.',
    unit: 'strength',
    cost: hullCost
  },
  drill: {
    icon: 'drill',
    purpose: 'Break tougher terrain and enemies faster.',
    unit: 'power',
    cost: drillCost
  }
};

// Built once at module load, so readability beats avoiding the spread.
// oxlint-disable-next-line oxc/no-map-spread
export const SHOP_UPGRADES: readonly ShopUpgradeEntry[] = PLAYER_UPGRADES.map(upgrade => ({
  id: upgrade.id,
  label: upgrade.label,
  ...UPGRADE_PRESENTATION[upgrade.id]
}));

export const SHOP_SERVICES = [
  {
    id: 'fuel',
    icon: 'fuel',
    title: 'Refuel',
    copy: 'Restore the current tank before descending.',
    verb: 'Refuel'
  },
  {
    id: 'repair',
    icon: 'repair',
    title: 'Hull Repair',
    copy: 'Restore damage without changing maximum strength.',
    verb: 'Repair'
  }
] as const;

export type ShopServiceId = typeof SHOP_SERVICES[number]['id'];

export const SHOP_ITEMS = [
  {
    id: 'dynamite',
    icon: 'dynamite',
    title: 'Dynamite',
    copy: `Plant it on cleared ground from the inventory panel and stand clear: it blows a ${ECONOMY.dynamite.radius}-tile radius after a ${DYNAMITE.fuseSeconds}-second fuse, destroying ore and artifacts without rewards — and damaging any ship still inside the blast.`,
    price: ECONOMY.dynamite.price
  },
  {
    id: 'teleporter',
    icon: 'teleporter',
    title: 'Teleporter',
    copy: `Single-use emergency round trip from ${MIN_TELEPORT_DEPTH_METERS} m or deeper to the depot and back to the same tile. Spent on the way up; the return trip is free.`,
    price: ECONOMY.teleporter.price
  },
  {
    id: 'scanner',
    icon: 'scanner',
    title: 'Scanner',
    copy: `Deployable survey unit. Drop it on cleared ground from the inventory panel and it maps its ${SCANNER_DEVICE.size}×${SCANNER_DEVICE.size} surroundings, one fogged tile every ${SCANNER_DEVICE.intervalSeconds} seconds, then goes inert.`,
    price: ECONOMY.scanner.price
  },
  {
    id: 'gun',
    icon: 'gun',
    title: 'Linebreaker Gun',
    copy: `Single-use precision weapon. Fires one round up to ${ECONOMY.gun.range} tiles and is spent with the shot; rock, depot structure, boundaries, and Motherlode are protected.`,
    price: ECONOMY.gun.price
  },
  {
    id: 'container',
    icon: 'container',
    title: 'Cargo Container',
    copy: `Permanent ${CARGO_CONTAINER.capacity}-item store. Set it down on cleared ground from the inventory panel, then press it from an adjacent tile to move stacks between it and the cargo bay. It keeps what it holds through death and reload; anything taken back aboard still obeys the cargo-bay limit.`,
    price: ECONOMY.container.price
  }
] as const;

export type ShopItemId = typeof SHOP_ITEMS[number]['id'];

/** What "Carried" counts for each consumable; every one of them lives in the bay. */
const ITEM_COUNTS: Record<ShopItemId, (player: ShopPlayer) => number> = {
  dynamite: player => player.dynamite,
  teleporter: player => player.teleporters,
  scanner: player => player.scanners,
  gun: player => player.guns,
  container: player => player.containers
};

/** The shared "can I buy this right now?" verdict for a fixed-price purchase. */
function purchaseState(cash: number, price: number, atSurface: boolean, unavailable = false): Pick<ShopRowState, 'status' | 'buttonDisabled'> {
  return {
    status: !atSurface ? 'Surface depot only' : unavailable ? 'Maximum' : cash >= price ? 'Ready' : `Need $${price - cash}`,
    buttonDisabled: !atSurface || unavailable || cash < price
  };
}

export function shopSummary(cash: number, atSurface: boolean): {cash: string; location: string} {
  return {
    cash: `$${Math.floor(cash)} available`,
    location: atSurface ? 'Surface depot' : 'Return to surface'
  };
}

export function upgradeRowState(id: PlayerUpgradeId, player: ShopPlayer, cash: number, atSurface: boolean): ShopRowState {
  const entry = SHOP_UPGRADES.find(upgrade => upgrade.id === id)!;
  const progress = getPlayerUpgradeProgress(player, id);
  const price = entry.cost(player);
  const stepValue = Math.min(progress.maxValue, progress.value + ECONOMY[id].step);
  return {
    icon: entry.icon,
    title: entry.label,
    copy: entry.purpose,
    current: `Level ${progress.level}/${progress.maxLevel} · ${progress.value}/${progress.maxValue} ${entry.unit}`,
    benefit: progress.atMax
      ? `Maximum ${progress.maxValue} ${entry.unit}`
      : `Next: ${progress.value} → ${stepValue} ${entry.unit}`,
    buttonLabel: progress.atMax ? 'Maximum' : `Buy · $${price}`,
    ...purchaseState(cash, price, atSurface, progress.atMax)
  };
}

export function serviceRowState(id: ShopServiceId, player: ShopPlayer, cash: number, atSurface: boolean): ShopRowState {
  const service = SHOP_SERVICES.find(entry => entry.id === id)!;
  const value = id === 'fuel' ? player.fuel : player.hull;
  const max = id === 'fuel' ? player.fuelMax : player.hullMax;
  const price = id === 'fuel' ? refuelCost(player) : repairCost(player);
  const full = value >= max;
  return {
    icon: service.icon,
    title: service.title,
    copy: service.copy,
    current: `${Math.ceil(value)}/${max} · full service $${price}`,
    status: !atSurface ? 'Surface depot only' : full ? 'Full' : cash > 0 ? (cash >= price ? 'Ready' : 'Partial service') : 'No cash',
    buttonLabel: `${service.verb} · $${price}`,
    buttonDisabled: !atSurface || full || cash <= 0
  };
}

export function itemRowState(id: ShopItemId, player: ShopPlayer, cash: number, atSurface: boolean): ShopRowState {
  const item = SHOP_ITEMS.find(entry => entry.id === id)!;
  const count = ITEM_COUNTS[id](player);
  return {
    icon: item.icon,
    title: item.title,
    copy: item.copy,
    current: `Carried: ${count}`,
    buttonLabel: `Buy one · $${item.price}`,
    ...purchaseState(cash, item.price, atSurface)
  };
}


// Player-initiated actions: selling, depot services, shop purchases, and the
// teleporter.
//
// The two deployables — scanners and dynamite — are only *bought* here; arming
// and placing them lives with the devices themselves, in `scanner-devices.ts`
// and `dynamite-sticks.ts`. The teleporter is bought the same way but spent from
// here, because it resolves in a single press instead of being left behind in
// the mine.
//
// Each one is a small transaction — validate, charge, mutate, toast, play a
// sound — so they are grouped here rather than scattered through the loop code.

import { TILE, WORLD_W } from '../../shared/constants';
import { ECONOMY, HULL } from '../core/balance';
import { CARGO_CONTAINER_ITEM } from '../core/cargo-container';
import { cargoValue, partialFill, refuelCost, repairCost } from '../core/economy';
import { DYNAMITE_ITEM } from '../core/dynamite';
import { addItem, countItem, isFull, removeItem, removeOres, type InventoryItem } from '../core/inventory';
import { ITEM_CATALOG } from '../core/items';
import { SCANNER_ITEM } from '../core/scanner-device';
import {
  MIN_TELEPORT_DEPTH_METERS,
  TELEPORTER_ITEM,
  canTeleport,
  createTeleportEffect,
  teleportPlayerToHome,
  teleportPlayerToReturn,
  teleportersCarried
} from '../core/teleporter';
import type { AudioController, GameState } from '../core/types';
import { applyPlayerUpgrade, getPlayerUpgradeProgress, type PlayerUpgradeId } from '../core/upgrades';
import { viewport } from './viewport';

/** A partial top-up bought at the depot: fuel or hull, same money math. */
interface ServicePurchase {
  /** Current amount of the resource. */
  amount: number;
  max: number;
  /** Cost of topping the resource all the way up. */
  cost: number;
  alreadyFullMessage: string;
  noCashMessage: string;
  filledMessage: string;
  partialMessage(spent: number): string;
  apply(value: number): void;
}

export interface GameActions {
  sell(): void;
  refuel(): void;
  repair(): void;
  /** Enter/Space at the depot: sell, else refuel, else repair. */
  surfaceService(): void;
  buyUpgrade(id: PlayerUpgradeId, cost: number, message: string): void;
  /** Buy one stick of dynamite into the cargo bay; refused when it has no room. */
  buyDynamite(): void;
  /** Buy one single-use teleporter into the cargo bay; refused when it has no room. */
  buyTeleporter(): void;
  /** Buy one scanner device into the cargo bay; refused when it has no room. */
  buyScanner(): void;
  /** Buy one cargo container into the cargo bay; refused when it has no room. */
  buyContainer(): void;
  useTeleporter(): void;
  /**
   * Spend one repair kit from the bay to restore a fraction of the hull. Refused
   * at full hull or with none aboard.
   */
  useRepairKit(): void;
}

export interface GameActionsDeps {
  state: GameState;
  audio: AudioController;
  toast(message: string): void;
  saveProgress(): void;
  addCash(amount: number): void;
  atSurface(): boolean;
}

export function createActions(deps: GameActionsDeps): GameActions {
  const {state, audio, toast, saveProgress, addCash, atSurface} = deps;

  function currentCargoValue(): number {
    return cargoValue(state.player.inventory);
  }

  function sell(): void {
    const value = currentCargoValue();
    if (!atSurface()) return toast('Depot is on the surface.');
    if (!value) return toast('Cargo is empty.');
    addCash(value);
    // Only the ore stacks leave; anything else the bay holds stays aboard.
    state.player.inventory = removeOres(state.player.inventory);
    saveProgress();
    toast(`Sold cargo for $${value}.`);
    audio.cash(value);
  }

  /** Charge a fixed price for an upgrade or consumable bought at the depot. */
  function spend(amount: number, apply: () => void, message: string): void {
    if (!atSurface()) return toast('Upgrades are at the surface.');
    if (state.cash < amount) { audio.alarm(); return toast(`Need $${amount}.`); }
    state.cash -= amount;
    apply();
    saveProgress();
    toast(message);
    audio.cash(amount);
  }

  function buyUpgrade(id: PlayerUpgradeId, cost: number, message: string): void {
    if (getPlayerUpgradeProgress(state.player, id).atMax) return toast('Upgrade already at maximum level.');
    spend(cost, () => {
      applyPlayerUpgrade(state.player, id);
    }, message);
  }

  /**
   * Buy as much of a top-up as the wallet allows: all the cash on hand fills the
   * resource proportionally rather than being refused outright.
   */
  function purchaseService(service: ServicePurchase): void {
    if (!atSurface()) return toast('Service depot is on the surface.');
    if (service.amount >= service.max) return toast(service.alreadyFullMessage);
    if (state.cash <= 0) { audio.alarm(); return toast(service.noCashMessage); }
    const {value, pay} = partialFill(service.amount, service.max, state.cash, service.cost);
    service.apply(value);
    state.cash -= pay;
    saveProgress();
    toast(value >= service.max ? service.filledMessage : service.partialMessage(pay));
    audio.cash(pay);
  }

  function refuel(): void {
    const p = state.player;
    purchaseService({
      amount: p.fuel,
      max: p.fuelMax,
      cost: refuelCost(p),
      alreadyFullMessage: 'Fuel tank already full.',
      noCashMessage: 'No cash to buy fuel.',
      filledMessage: 'Fuel tank full.',
      partialMessage: spent => `Partial refuel — spent $${Math.round(spent)} (all your cash).`,
      apply: value => { p.fuel = value; }
    });
  }

  function repair(): void {
    const p = state.player;
    purchaseService({
      amount: p.hull,
      max: p.hullMax,
      cost: repairCost(p),
      alreadyFullMessage: 'Hull already at full strength.',
      noCashMessage: 'No cash for repairs.',
      filledMessage: 'Hull repaired.',
      partialMessage: spent => `Partial repair — spent $${Math.round(spent)} (all your cash).`,
      apply: value => { p.hull = value; }
    });
  }

  function surfaceService(): void {
    const p = state.player;
    if (!atSurface()) return toast('Service depot is on the surface.');
    if (currentCargoValue() > 0) return sell();
    if (p.fuel < p.fuelMax) return refuel();
    if (p.hull < p.hullMax) return repair();
    toast('Cargo empty, hull and fuel are full.');
  }

  /**
   * Bought equipment — scanners, dynamite, teleporters, containers — counts
   * toward the same capacity as ore, so a full bay can refuse the sale. Checked
   * before the money changes hands, and only at the depot, so the "come back to
   * the surface" refusal still comes first.
   */
  function buyDeployable(item: InventoryItem, price: number, fullMessage: string, loadedMessage: string): void {
    if (atSurface() && isFull(state.player.inventory, state.player.cargoMax)) {
      audio.alarm();
      return toast(fullMessage);
    }
    spend(price, () => {
      state.player.inventory = addItem(state.player.inventory, item);
    }, loadedMessage);
  }

  function buyDynamite(): void {
    buyDeployable(
      DYNAMITE_ITEM,
      ECONOMY.dynamite.price,
      'Cargo bay is full. Sell the cargo before buying dynamite.',
      'Dynamite loaded. Press E or its inventory slot, then a mine tile, to plant it.'
    );
  }

  function buyTeleporter(): void {
    buyDeployable(
      TELEPORTER_ITEM,
      ECONOMY.teleporter.price,
      'Cargo bay is full. Sell the cargo before buying a teleporter.',
      `Teleporter loaded. Press T or Teleport at ${MIN_TELEPORT_DEPTH_METERS} m or deeper to spend it.`
    );
  }

  function buyScanner(): void {
    buyDeployable(
      SCANNER_ITEM,
      ECONOMY.scanner.price,
      'Cargo bay is full. Sell the cargo before buying a scanner.',
      'Scanner loaded. Press its inventory slot, then a mapped tile, to deploy it.'
    );
  }

  function buyContainer(): void {
    buyDeployable(
      CARGO_CONTAINER_ITEM,
      ECONOMY.container.price,
      'Cargo bay is full. Sell the cargo before buying a container.',
      'Container loaded. Press its inventory slot, then a mine tile, to set it down.'
    );
  }

  function useTeleporter(): void {
    const p = state.player;
    if (state.gameOver) return;
    const surf = atSurface();
    if (surf && !state.teleportReturnPosition) return toast('No underground teleport return point.');
    if (!surf && teleportersCarried(p) <= 0) { audio.alarm(); return toast('No teleporter aboard. Buy one at the surface depot.'); }
    if (!surf && !canTeleport(p)) { audio.alarm(); return toast(`Teleport requires a depth of at least ${MIN_TELEPORT_DEPTH_METERS} m.`); }
    const camX = Math.max(0, Math.min(WORLD_W - viewport.tilesX, state.camX));
    const camY = Math.max(0, state.camY);
    const originScreenX = (p.drawX - camX + .5) * TILE;
    const originScreenY = (p.drawY - camY + .5) * TILE;
    if (surf) {
      if (!teleportPlayerToReturn(p, state.teleportReturnPosition)) return;
      state.teleportReturnPosition = null;
    } else {
      const returnPosition = teleportPlayerToHome(p);
      if (!returnPosition) return;
      state.teleportReturnPosition = returnPosition;
    }
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    state.teleportEffect = createTeleportEffect(originScreenX, originScreenY, p.x, p.y, reducedMotion);
    state.input.keyImpulse = null;
    state.camX = Math.max(0, p.x - Math.floor(viewport.tilesX / 2));
    state.camY = Math.max(0, p.y - Math.floor(viewport.tilesY / 2));
    saveProgress();
    toast(surf
      ? 'Returned to the underground teleport point.'
      : 'Teleported safely home. Press T to return underground.');
  }

  function useRepairKit(): void {
    const p = state.player;
    if (state.gameOver) return;
    if (countItem(p.inventory, ITEM_CATALOG.repairKit.kind) <= 0) {
      audio.alarm();
      return toast('No repair kit aboard. Craft one at the Manufacturing Station.');
    }
    if (p.hull >= p.hullMax) {
      audio.alarm();
      return toast('Hull already at full strength.');
    }
    const restored = Math.min(p.hullMax - p.hull, Math.round(p.hullMax * HULL.repairKitFraction));
    p.hull += restored;
    p.inventory = removeItem(p.inventory, ITEM_CATALOG.repairKit.kind);
    saveProgress();
    audio.blip(540, .08, 'triangle', .05, 40);
    toast(`Repair kit used — hull +${restored}.`);
  }

  return {
    sell,
    refuel,
    repair,
    surfaceService,
    buyUpgrade,
    buyDynamite,
    buyTeleporter,
    buyScanner,
    buyContainer,
    useTeleporter,
    useRepairKit
  };
}

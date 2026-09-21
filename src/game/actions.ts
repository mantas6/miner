// Player-initiated actions: selling, depot services, shop purchases, the gun,
// and the teleporter.
//
// The two deployables — scanners and dynamite — are only *bought* here; arming
// and placing them lives with the devices themselves, in `scanner-devices.ts`
// and `dynamite-sticks.ts`. The Linebreaker and the teleporter are bought the
// same way but spent from here, because each resolves in a single press instead
// of being left behind in the mine.
//
// Each one is a small transaction — validate, charge, mutate, toast, play a
// sound — so they are grouped here rather than scattered through the loop code.

import { TILE, WORLD_W } from '../../shared/constants';
import { ECONOMY } from '../core/balance';
import { CARGO_CONTAINER_ITEM } from '../core/cargo-container';
import { cargoValue, partialFill, refuelCost, repairCost } from '../core/economy';
import { DYNAMITE_ITEM } from '../core/dynamite';
import { addItem, countItem, isFull, removeItem, removeOres, type InventoryItem } from '../core/inventory';
import { SCANNER_ITEM } from '../core/scanner-device';
import {
  MIN_TELEPORT_DEPTH_METERS,
  TELEPORTER_ITEM,
  canTeleportToSurface,
  createTeleportEffect,
  teleportPlayerToReturn,
  teleportPlayerToSurface,
  teleportersCarried
} from '../core/teleporter';
import type { AudioController, Direction, GameState } from '../core/types';
import { applyPlayerUpgrade, getPlayerUpgradeProgress, type PlayerUpgradeId } from '../core/upgrades';
import { GUN_ITEM, canFireGun, resolveShot } from '../core/weapon';
import { viewport } from './viewport';
import type { EnemySim } from './enemies';
import type { WorldGrid } from './world-grid';

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
  /** Buy one single-use Linebreaker into the cargo bay; refused when it has no room. */
  buyGun(): void;
  /** Buy one cargo container into the cargo bay; refused when it has no room. */
  buyContainer(): void;
  setGunArmed(armed: boolean): void;
  /** Fire the carried Linebreaker, spending it. Reports whether the shot went off. */
  fireGun(direction: Direction): boolean;
  useTeleporter(): void;
}

export interface GameActionsDeps {
  state: GameState;
  enemies: EnemySim;
  grid: WorldGrid;
  audio: AudioController;
  toast(message: string): void;
  saveProgress(): void;
  addCash(amount: number): void;
  atSurface(): boolean;
  spawnDust(x: number, y: number, color?: string, amount?: number): void;
  spawnShotTrail(path: {x: number; y: number}[]): void;
  /** Release held keys so a modal action does not resume movement. */
  clearKeys(): void;
}

export function createActions(deps: GameActionsDeps): GameActions {
  const {state, enemies, grid, audio, toast, saveProgress, addCash, atSurface} = deps;

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
   * Bought equipment — scanners, dynamite, guns, teleporters, containers — counts
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

  function buyGun(): void {
    buyDeployable(
      GUN_ITEM,
      ECONOMY.gun.price,
      'Cargo bay is full. Sell the cargo before buying a Linebreaker.',
      'Linebreaker loaded. Press G, then a direction, to spend it on one shot.'
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

  /** Linebreakers aboard; the gun is carried, so this is the whole ammunition question. */
  function gunsCarried(): number {
    return countItem(state.player.inventory, GUN_ITEM.kind);
  }

  function setGunArmed(armed: boolean): void {
    if (armed) {
      if (state.gameOver) return;
      if (atSurface()) return toast('The gun can only be fired underground.');
      if (gunsCarried() <= 0) { audio.alarm(); return toast('No Linebreaker aboard. Buy one at the surface shop.'); }
      deps.clearKeys();
      state.input.keyImpulse = null;
      state.input.gunArmed = true;
      toast('GUN ARMED — press a direction key. G or Escape cancels.');
      return;
    }
    if (state.input.gunArmed) toast('Gun aim cancelled. No Linebreaker used.');
    state.input.gunArmed = false;
  }

  function fireGun(direction: Direction): boolean {
    const p = state.player;
    if (state.gameOver || atSurface()) return false;
    if (!canFireGun(gunsCarried(), state.input.gunArmed, direction)) return false;
    if (direction[1] > 0) grid.ensureRow(p.y + ECONOMY.gun.range);
    const shot = resolveShot(grid.world, p.x, p.y, direction, ECONOMY.gun.range, state.enemies.filter(enemy => enemy.alive));
    if (!shot) return false;
    // The gun is the round: it leaves the bay whatever the shot ends up hitting.
    state.player.inventory = removeItem(state.player.inventory, GUN_ITEM.kind);
    const remaining = gunsCarried();
    state.input.gunArmed = false;
    p.drillDx = direction[0]; p.drillDy = direction[1];
    if (direction[0]) p.facing = direction[0];
    deps.spawnShotTrail(shot.path);
    audio.blip(520, .08, 'square', .055, -180);
    const target = shot.target;
    if (target?.kind === 'enemy') {
      enemies.damageEnemy(state.enemies.find(enemy => enemy.id === target.enemy.id), ECONOMY.gun.damage);
      toast(`Direct enemy hit. ${remaining} Linebreakers remain.`);
    } else if (target?.kind === 'tile') {
      if (target.tile.type === 'enemy') {
        enemies.destroyDormantEnemy(target.x, target.y);
      } else {
        grid.set(target.x, target.y, {type: 'air'});
        enemies.wakeEnemiesNear(target.x, target.y);
        deps.spawnDust(target.x, target.y, '#ffe58a', state.reducedMotion ? 3 : 12);
      }
      toast(`Shot destroyed ${target.tile.type}. No mining rewards. ${remaining} Linebreakers remain.`);
    } else if (shot.outcome === 'blocked') toast(`Shot blocked by protected terrain. ${remaining} Linebreakers remain.`);
    else toast(`Shot missed within ${ECONOMY.gun.range}-tile range. ${remaining} Linebreakers remain.`);
    saveProgress();
    return true;
  }

  function useTeleporter(): void {
    const p = state.player;
    if (state.gameOver) return;
    const surf = atSurface();
    if (surf && !state.teleportReturnPosition) return toast('No underground teleport return point.');
    if (!surf && teleportersCarried(p) <= 0) { audio.alarm(); return toast('No teleporter aboard. Buy one at the surface depot.'); }
    if (!surf && !canTeleportToSurface(p.y)) { audio.alarm(); return toast(`Teleport requires a depth of at least ${MIN_TELEPORT_DEPTH_METERS} m.`); }
    const camX = Math.max(0, Math.min(WORLD_W - viewport.tilesX, state.camX));
    const camY = Math.max(0, state.camY);
    const originScreenX = (p.drawX - camX + .5) * TILE;
    const originScreenY = (p.drawY - camY + .5) * TILE;
    if (surf) {
      if (!teleportPlayerToReturn(p, state.teleportReturnPosition)) return;
      state.teleportReturnPosition = null;
    } else {
      const returnPosition = teleportPlayerToSurface(p);
      if (!returnPosition) return;
      state.teleportReturnPosition = returnPosition;
    }
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    state.teleportEffect = createTeleportEffect(originScreenX, originScreenY, p.x, p.y, reducedMotion);
    state.input.keyImpulse = null;
    state.input.gunArmed = false;
    state.camX = Math.max(0, p.x - Math.floor(viewport.tilesX / 2));
    state.camY = surf ? Math.max(0, p.y - Math.floor(viewport.tilesY / 2)) : 0;
    saveProgress();
    toast(surf
      ? 'Returned to the underground teleport point.'
      : 'Teleported safely to the depot. Press T to return underground.');
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
    buyGun,
    buyContainer,
    setGunArmed,
    fireGun,
    useTeleporter
  };
}

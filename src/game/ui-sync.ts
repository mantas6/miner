// The once-per-frame publish of the simulation into the UI store.
//
// This is the only place the game talks to the chrome every frame, so it is built
// not to allocate when nothing moved: the HUD is filled into a reused scratch
// snapshot that the store copies only when a field changed, the objective text is
// rebuilt only when its inputs moved, and the inventory panel's and Info screen's
// rows are rebuilt only when the bay (replaced on every change) or the stats (bumped
// in place, so compared field by field) actually changed.

import { rowDepthMeters } from '../../shared/constants';
import { FUEL } from '../core/balance';
import { shouldCargoBarFlash, shouldFuelBarFlash, shouldHullBarFlash } from '../core/hud-alerts';
import { countItem, totalItems, type Inventory } from '../core/inventory';
import { createExpeditionObjectiveFormatter, type ObjectiveInput } from '../core/objective';
import { formatShipStatusAnnouncement } from '../core/ship-status';
import { isAtHome } from '../core/state';
import { manufacturerStock } from '../core/stations';
import { formatExpeditionStats } from '../core/stats';
import { TELEPORTER_ITEM, canUsePortableTeleporter } from '../core/teleporter';
import type { AudioController, GameState, GameStats } from '../core/types';
import { buildCargoRows, buildInventorySlots, buildShipSlots, uiStore, type HudSnapshot } from '../ui/store';
import { interactHint, nearestInteractable } from './interactables';
import type { HudReadouts } from './readouts';

export interface UiSyncDeps {
  state: GameState;
  audio: AudioController;
  readouts: HudReadouts;
  /** Whether the ship could land on a tile — what a teleporter's portal list is filtered by. */
  canLand(x: number, y: number): boolean;
}

export interface UiSync {
  /** Publish this frame's UI state. */
  sync(): void;
  /** Rebuild the Info screen's cargo and stat rows if they moved; `force` rebuilds regardless. */
  syncInfoDetails(force?: boolean): void;
  /** Push the current fitting slots for the Ship screen to paint. */
  syncShipUpgrades(): void;
}

export function createUiSync(deps: UiSyncDeps): UiSync {
  const {state, audio, readouts} = deps;

  // The nested `teleport` object is copied out, not shared, so mutating the scratch
  // in place each frame never touches the store's own snapshot behind the diff.
  const hudScratch: HudSnapshot = {...uiStore.getState().hud, teleport: {...uiStore.getState().hud.teleport}};
  /** The objective's inputs, refilled per frame; the formatter rebuilds its text only when they move. */
  const objectiveScratch: ObjectiveInput = {player: state.player, cargoCount: 0, atSurface: false, bay: [], station: []};
  const formatObjective = createExpeditionObjectiveFormatter();

  /**
   * What the info rows were last built from. The bay is replaced on every change,
   * so its reference is enough; the stats are bumped in place, so their fields are
   * copied and compared. Opening the screen forces a rebuild regardless.
   */
  let infoInventory: Inventory | null = null;
  let infoStats: GameStats | null = null;
  const infoStatValues: GameStats = {maxDepth: 0, totalCashEarned: 0, oreMined: 0, enemiesDestroyed: 0, deaths: 0};
  function statsUnchanged(stats: GameStats): boolean {
    return stats === infoStats
      && stats.maxDepth === infoStatValues.maxDepth
      && stats.totalCashEarned === infoStatValues.totalCashEarned
      && stats.oreMined === infoStatValues.oreMined
      && stats.enemiesDestroyed === infoStatValues.enemiesDestroyed
      && stats.deaths === infoStatValues.deaths;
  }
  function syncInfoDetails(force = false): void {
    const store = uiStore.getState();
    const {inventory} = state.player;
    if (force || inventory !== infoInventory) {
      infoInventory = inventory;
      store.setCargoRows(buildCargoRows(inventory));
    }
    if (force || !statsUnchanged(state.stats)) {
      infoStats = state.stats;
      Object.assign(infoStatValues, state.stats);
      store.setStatRows(formatExpeditionStats(state.stats));
    }
  }

  /**
   * The inventory panel is on screen the whole run, so this runs every frame.
   * The bay is immutable — every load, sale and respawn hands back a new array —
   * so one reference comparison is enough to skip rebuilding the slot views, and
   * a ship that mined nothing this frame allocates nothing.
   */
  let syncedInventory: Inventory | null = null;
  function syncInventory(): void {
    if (state.player.inventory === syncedInventory) return;
    syncedInventory = state.player.inventory;
    uiStore.getState().setInventorySlots(buildInventorySlots(syncedInventory));
  }

  function sync(): void {
    const p = state.player;
    const surf = isAtHome(p);
    const lowFuel = shouldFuelBarFlash(state);

    hudScratch.cash = state.cash;
    hudScratch.depthMeters = rowDepthMeters(p.y);
    hudScratch.fuel = p.fuel;
    hudScratch.fuelMax = p.fuelMax;
    hudScratch.hull = p.hull;
    hudScratch.hullMax = p.hullMax;
    hudScratch.cargo = totalItems(p.inventory);
    hudScratch.cargoMax = p.cargoMax;
    hudScratch.fuelAlert = lowFuel;
    hudScratch.hullAlert = shouldHullBarFlash(state);
    hudScratch.cargoAlert = shouldCargoBarFlash(state);
    objectiveScratch.player = p;
    objectiveScratch.cargoCount = hudScratch.cargo;
    objectiveScratch.atSurface = surf;
    objectiveScratch.bay = p.inventory;
    objectiveScratch.station = manufacturerStock(state.stations);
    hudScratch.objective = formatObjective(objectiveScratch);
    hudScratch.atSurface = surf;
    hudScratch.gameOver = state.gameOver;
    // The prompt names exactly what Space would open, from the same lookup the key uses.
    hudScratch.stationHint = interactHint(nearestInteractable(state, 'space'));
    // The teleporter is a carried charge that opens the portal list: the whole HUD
    // state is how many are aboard and whether a jump is available right now.
    hudScratch.teleport.count = countItem(p.inventory, TELEPORTER_ITEM.kind);
    hudScratch.teleport.usable = canUsePortableTeleporter(p, state.stations, deps.canLand);
    // The canvas, spoken: the one HUD field that exists for the live region rather
    // than the layout. Thresholds only, so it changes when the ship crosses one and
    // is byte-identical (and therefore silent) on every frame in between.
    hudScratch.announcement = formatShipStatusAnnouncement({
      gameOver: state.gameOver,
      atSurface: surf,
      cargoFull: hudScratch.cargoAlert,
      hullCritical: hudScratch.hullAlert
    });
    // Scanner line, return-fuel forecast, and depth landmark, each recomputed only
    // when its own inputs moved. Milestone crossings toast from in here.
    readouts.sync(hudScratch);

    const store = uiStore.getState();
    store.syncHud(hudScratch);
    syncInventory();
    if (store.overlay?.kind === 'info') syncInfoDetails();

    if (lowFuel && !surf && performance.now() - audio.lastLowFuel > FUEL.lowFuelWarnMs) {
      audio.lowFuel();
      audio.lastLowFuel = performance.now();
    }
  }

  return {
    sync,
    syncInfoDetails,
    syncShipUpgrades() {
      uiStore.getState().setShipEquipment(buildShipSlots(state.player.equipment));
    }
  };
}

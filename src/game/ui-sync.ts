// The once-per-frame publish of the simulation into the UI store.
//
// This is the only place the game talks to the chrome every frame, so it is built
// not to allocate when nothing moved: the HUD is filled into a reused scratch
// snapshot that the store copies only when a field changed, the objective text is
// rebuilt only when its inputs moved, and the inventory panel's and Info screen's
// rows are rebuilt only when the bay (replaced on every change), the stats (bumped
// in place, so compared field by field) or the explored map actually changed.

import { rowDepthMeters } from '../../shared/constants';
import { FUEL } from '../core/balance';
import { shouldBaseAlert, shouldCargoBarFlash, shouldFuelBarFlash, shouldHullBarFlash } from '../core/hud-alerts';
import { countItem, isUpgradeKind, totalItems, type Inventory } from '../core/inventory';
import { createExpeditionObjectiveFormatter, type ObjectiveInput } from '../core/objective';
import { discoveredTradingPosts, type DiscoveredTradingPost } from '../core/post-beacon';
import { formatShipStatusAnnouncement } from '../core/ship-status';
import { createDefaultStats, isAtHome } from '../core/state';
import { fieldPortalCount, homeExtractor, manufacturerStock } from '../core/stations';
import { formatExpeditionStats } from '../core/stats';
import { TELEPORTER_ITEM, canUsePortableTeleporter } from '../core/teleporter';
import type { AudioController, GameState, GameStats } from '../core/types';
import type { Wreck } from '../core/wreck';
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
  /** Rebuild the Info screen's cargo, stat and trading-post rows if they moved; `force` rebuilds regardless. */
  syncInfoDetails(force?: boolean): void;
  /** Push the current fitting slots for the Ship screen to paint. */
  syncShipUpgrades(): void;
}

/**
 * The newest standing wreck still holding a ship upgrade, or `null` — what the
 * objective's salvage rung points at. At most a handful of wrecks, each a few
 * stacks, walked without allocating.
 */
function latestWreckWithUpgrade(wrecks: readonly Wreck[]): Wreck | null {
  for (let i = wrecks.length - 1; i >= 0; i--) {
    const wreck = wrecks[i];
    if (!wreck) continue;
    for (const stack of wreck.inventory) if (isUpgradeKind(stack.kind)) return wreck;
  }
  return null;
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
  const infoStatValues: GameStats = createDefaultStats();
  function statsUnchanged(stats: GameStats): boolean {
    return stats === infoStats
      && stats.maxDepth === infoStatValues.maxDepth
      && stats.totalCashEarned === infoStatValues.totalCashEarned
      && stats.oreMined === infoStatValues.oreMined
      && stats.enemiesDestroyed === infoStatValues.enemiesDestroyed
      && stats.deaths === infoStatValues.deaths;
  }
  /**
   * The posts found only change when the map grows (a tile explored) or the search
   * floor drops (a deeper record, or the ship's row). The explored set only ever
   * gains tiles in place, so its size stands in for its contents; a reset hands
   * back a fresh set.
   */
  let postsExplored: ReadonlySet<number> | null = null;
  let postsExploredSize = -1;
  let postsMaxDepth = -1;
  let postsShipY = NaN;
  let posts: DiscoveredTradingPost[] = [];
  /** The posts found, shared by the Prospecting rows and the objective's post rungs. */
  function currentPosts(): DiscoveredTradingPost[] {
    if (state.exploredTiles !== postsExplored || state.exploredTiles.size !== postsExploredSize
      || state.stats.maxDepth !== postsMaxDepth || state.player.y !== postsShipY) {
      postsExplored = state.exploredTiles;
      postsExploredSize = state.exploredTiles.size;
      postsMaxDepth = state.stats.maxDepth;
      postsShipY = state.player.y;
      posts = discoveredTradingPosts(state);
    }
    return posts;
  }
  let publishedPosts: DiscoveredTradingPost[] | null = null;
  function syncInfoDetails(force = false): void {
    const store = uiStore.getState();
    const {inventory} = state.player;
    if (force || inventory !== infoInventory) {
      infoInventory = inventory;
      store.setCargoRows(buildCargoRows(inventory));
    }
    const found = currentPosts();
    if (force || found !== publishedPosts) {
      publishedPosts = found;
      store.setPostRows(found);
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
    // The base readout: what the home extractor has banked and queued. Whole units
    // of fuel, so a fractional top-up does not repaint the line every frame.
    const base = homeExtractor(state.stations);
    hudScratch.hasBase = base !== null;
    hudScratch.baseFuel = base ? Math.floor(base.fuel) : 0;
    hudScratch.baseCoal = base ? base.coal : 0;
    hudScratch.baseAlert = shouldBaseAlert(state);
    // Scanner line, return-fuel forecast, and depth landmark, each recomputed only
    // when its own inputs moved. Milestone crossings toast from in here. Run ahead
    // of the objective, which reads the exit the fuel forecast chose.
    readouts.sync(hudScratch);
    objectiveScratch.player = p;
    objectiveScratch.cargoCount = hudScratch.cargo;
    objectiveScratch.atSurface = surf;
    objectiveScratch.bay = p.inventory;
    objectiveScratch.station = manufacturerStock(state.stations);
    objectiveScratch.baseExtractor = base;
    objectiveScratch.fieldPortals = fieldPortalCount(state.stations);
    objectiveScratch.maxDepthMeters = state.stats.maxDepth;
    objectiveScratch.scannersObtained = state.stats.scannersObtained;
    objectiveScratch.bestMarkCrafted = state.stats.bestMarkCrafted;
    objectiveScratch.postsFound = currentPosts().length;
    objectiveScratch.nearestExit = readouts.fuelExit;
    objectiveScratch.gameOver = state.gameOver;
    objectiveScratch.wreckWithUpgrade = latestWreckWithUpgrade(state.wrecks);
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
      uiStore.getState().setShipEquipment(buildShipSlots(state.player.equipment, state.stats.bestMarkCrafted));
    }
  };
}

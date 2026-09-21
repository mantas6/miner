// The UI's single source of truth.
//
// The simulation still owns `GameState` and the canvas is still drawn
// imperatively; this store holds only what the React tree needs to paint the
// chrome around it. The game pushes into it, the components subscribe to it, and
// nothing in `src/game/` ever reads the DOM to find out what the UI is doing.
//
// The HUD slice is written once per animation frame, so `syncHud()` takes a
// caller-owned scratch snapshot and copies it into the store *only* when a field
// actually changed: one allocation per visible change instead of one per frame.
// Components then subscribe to individual fields (`s => s.hud.fuel`), so a cash
// change never re-renders the fuel meter.

import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand/react';
import { ECONOMY } from '../core/balance';
import { getDepthMilestone, type DepthMilestoneKind } from '../core/depth-milestone';
import { type FuelReserveStatus } from '../core/fuel-reserve';
import { formatExtractionPresentation } from '../core/extraction-presentation';
import { formatExpeditionObjective } from '../core/objective';
import { formatTerrainScanner } from '../core/scanner';
import { formatShipStatusAnnouncement } from '../core/ship-status';
import { createInitialState } from '../core/state';
import { formatExpeditionStats, type ExpeditionStatRow } from '../core/stats';
import { formatSurfaceActionHint } from '../core/surface-hint';
import { countItem, createInventory, oreStacks, type Inventory, type InventoryItemKind } from '../core/inventory';
import { CARGO_CONTAINER_ITEM } from '../core/cargo-container';
import { DYNAMITE_ITEM } from '../core/dynamite';
import { SCANNER_ITEM } from '../core/scanner-device';
import { TELEPORTER_ITEM } from '../core/teleporter';
import { GUN_ITEM } from '../core/weapon';
import type { Player } from '../core/types';
import { DEFAULT_INFO_TAB, type InfoTab } from './info-navigation';

/** Everything the HUD paints every frame. Primitives only, so diffing is cheap. */
export interface HudSnapshot {
  cash: number;
  depthMeters: number;
  fuel: number;
  fuelMax: number;
  hull: number;
  hullMax: number;
  cargo: number;
  cargoMax: number;
  cargoValue: number;
  fuelAlert: boolean;
  hullAlert: boolean;
  cargoAlert: boolean;
  objective: string;
  extractionHud: string | null;
  extractionInfo: string;
  atSurface: boolean;
  gameOver: boolean;
  gunArmed: boolean;
  /** Single-use Linebreakers in the bay: the gun button's whole availability. */
  guns: number;
  /** Single-use teleporters in the bay: the teleport button's whole availability. */
  teleporters: number;
  /** A stored underground return point exists. */
  teleportReturn: boolean;
  /** The ship is deep enough to teleport up. */
  teleportDepthReached: boolean;
  /** The teleport button would do something right now. */
  teleportUsable: boolean;
  /** Adjacent drill/flight target readout, refreshed when the target changes. */
  scanner: string;
  /** What one press of Space would do at the depot, or null when it would do nothing. */
  surfaceHint: string | null;
  /** Return-fuel forecast for the climb home. */
  fuelReserveStatus: FuelReserveStatus;
  fuelReserveNeeded: number;
  fuelReserveMargin: number;
  /** Next depth landmark: its name, kind, and how much deeper it is. */
  depthTarget: string;
  depthTargetKind: DepthMilestoneKind;
  depthTargetRemaining: number;
  /**
   * The canvas state a sighted player reads off the pixels, as one spoken line.
   * Deliberately built from thresholds only, never from a continuous value: it
   * feeds a live region, so it must change when the ship crosses something and
   * stay put for every frame in between.
   */
  announcement: string;
}

const HUD_KEYS = [
  'cash', 'depthMeters', 'fuel', 'fuelMax', 'hull', 'hullMax', 'cargo', 'cargoMax', 'cargoValue',
  'fuelAlert', 'hullAlert', 'cargoAlert', 'objective', 'extractionHud', 'extractionInfo',
  'atSurface', 'gameOver', 'gunArmed', 'guns', 'teleporters',
  'teleportReturn', 'teleportDepthReached', 'teleportUsable',
  'scanner', 'surfaceHint', 'fuelReserveStatus', 'fuelReserveNeeded', 'fuelReserveMargin',
  'depthTarget', 'depthTargetKind', 'depthTargetRemaining', 'announcement'
] as const satisfies readonly (keyof HudSnapshot)[];

/** The ship stats the shop and the developer panel price and label their rows from. */
export type PlayerSnapshot = Pick<
  Player,
  'fuel' | 'fuelMax' | 'hull' | 'hullMax' | 'cargoMax' | 'drill'
> & {
  /** Consumables in the cargo bay, counted out of the inventory for the shop rows. */
  scanners: number;
  dynamite: number;
  guns: number;
  teleporters: number;
  containers: number;
};

const PLAYER_KEYS = [
  'fuel', 'fuelMax', 'hull', 'hullMax', 'cargoMax', 'drill',
  'scanners', 'dynamite', 'guns', 'teleporters', 'containers'
] as const satisfies readonly (keyof PlayerSnapshot)[];

export interface CargoRow {
  name: string;
  color: string;
  count: number;
  value: number;
}

/**
 * One stack of the HUD inventory panel. The bay is capacity-bounded by item
 * count, not by a fixed row of slots, so the panel lists only what is aboard and
 * shows the room left as a number rather than as empty boxes.
 */
export interface InventorySlotView {
  /** Position in the stack list, and the stable React key. */
  index: number;
  kind: InventoryItemKind;
  label: string;
  color: string;
  count: number;
}

export interface ToastMessage {
  id: number;
  message: string;
}

/**
 * Which screen the player is on. The whole boot flow is this one field:
 *
 *   intro --(any press)---> playing
 *
 * React renders the overlay for the current phase and nothing else, so the game
 * only takes input once the run is live.
 */
export type UiPhase = 'intro' | 'playing';

/**
 * Whether the simulation behind the canvas is alive.
 *
 *   booting --(runtime constructed)--> ready
 *          --(constructor threw)-----> failed
 *
 * The phase machine above describes a *running* game; this describes whether
 * there is one at all. It exists because the runtime is now mounted by a React
 * effect that can fail (no canvas, no 2D context, a save that will not load), and
 * a silent failure used to leave a dead black rectangle with no explanation.
 */
export type RuntimeStatus = 'booting' | 'ready' | 'failed';

/** The modal overlays that cover the mine. Exactly one of them, or none. */
export type OverlayId = 'shop' | 'info' | 'container';

/**
 * Which overlay is up. One field rather than a flag per overlay, because
 * "shop and info at the same time" is not a state the game has any answer for:
 * they are both modal `<dialog>`s over the same canvas, so the second one to open
 * would steal focus while the first still claimed the top of the stack.
 */
export type ActiveOverlay = OverlayId | null;

export interface UiState {
  hud: HudSnapshot;
  player: PlayerSnapshot;
  /** The cargo bay's slots, painted by the always-visible inventory panel. */
  inventorySlots: InventorySlotView[];
  /**
   * The open cargo container's slots, in the same shape. Written only while the
   * transfer menu is up: the game pushes a crate's contents here when it opens one
   * and after every transfer, so the menu never reaches into the simulation.
   */
  containerSlots: InventorySlotView[];
  cargoRows: CargoRow[];
  statRows: ExpeditionStatRow[];
  activeOverlay: ActiveOverlay;
  infoTab: InfoTab;
  phase: UiPhase;
  runtimeStatus: RuntimeStatus;
  /** Why the runtime failed, when it did. Shown verbatim in the failure notice. */
  runtimeError: string | null;
  /** Soundtrack and sound effects mute independently, one button each. */
  musicOn: boolean;
  musicLabel: string;
  sfxOn: boolean;
  sfxLabel: string;
  /** Queue of transient status lines; the newest one is the one on screen. */
  toasts: ToastMessage[];
  /**
   * The kind of deployable waiting for the player to pick a tile for it, or
   * `null` when nothing is armed. The game owns that state — it is the game that
   * consumes the click — so this is only the paint of it: the armed slot, and
   * nothing else on screen, says so.
   *
   * One field rather than a flag per item, because only one press can be
   * outstanding: arming the dynamite has to stand the scanner down, or a press on
   * the mine would have two answers.
   */
  armedPlacement: InventoryItemKind | null;

  syncHud(next: Readonly<HudSnapshot>): void;
  syncPlayer(next: Readonly<PlayerSnapshot>): void;
  setInventorySlots(slots: InventorySlotView[]): void;
  setContainerSlots(slots: InventorySlotView[]): void;
  setCargoRows(rows: CargoRow[]): void;
  setStatRows(rows: ExpeditionStatRow[]): void;
  /** Show one overlay, replacing whatever was up; `null` closes them all. */
  setActiveOverlay(overlay: ActiveOverlay): void;
  /** Close an overlay, but only while it is the one on screen. */
  closeOverlay(overlay: OverlayId): void;
  setInfoTab(tab: InfoTab): void;
  setPhase(phase: UiPhase): void;
  setRuntimeStatus(status: RuntimeStatus, error?: string | null): void;
  setMusic(on: boolean, label: string): void;
  setSfx(on: boolean, label: string): void;
  pushToast(message: string): void;
  dismissToast(id: number): void;
  clearToasts(): void;
  setArmedPlacement(kind: InventoryItemKind | null): void;
}

/** Visible lifetime of one toast, matching the pre-store CSS timing. */
export const TOAST_VISIBLE_MS = 1800;

const initialState = createInitialState();

function initialHud(): HudSnapshot {
  const player = initialState.player;
  const milestone = getDepthMilestone(player.y);
  return {
    cash: initialState.cash,
    depthMeters: 0,
    fuel: player.fuel,
    fuelMax: player.fuelMax,
    hull: player.hull,
    hullMax: player.hullMax,
    cargo: 0,
    cargoMax: player.cargoMax,
    cargoValue: 0,
    fuelAlert: false,
    hullAlert: false,
    cargoAlert: false,
    objective: formatExpeditionObjective({
      player,
      cash: initialState.cash,
      cargoCount: 0,
      currentCargoValue: 0,
      atSurface: true,
      extractionPhase: 'none'
    }),
    extractionHud: null,
    extractionInfo: formatExtractionPresentation({
      phase: 'none',
      motherlodeExtractions: 0,
      reward: ECONOMY.artifactReward
    }).info,
    atSurface: true,
    gameOver: false,
    gunArmed: false,
    guns: countItem(player.inventory, GUN_ITEM.kind),
    teleporters: countItem(player.inventory, TELEPORTER_ITEM.kind),
    teleportReturn: false,
    teleportDepthReached: false,
    teleportUsable: false,
    // Nothing has been scanned before the first frame, which is exactly what the
    // scanner says about terrain it has not mapped yet.
    scanner: formatTerrainScanner({tile: {type: 'air'}, direction: [0, 1], explored: false}),
    surfaceHint: formatSurfaceActionHint({
      atSurface: true,
      gameOver: false,
      cargoValue: 0,
      cash: initialState.cash,
      fuel: player.fuel,
      fuelMax: player.fuelMax,
      hull: player.hull,
      hullMax: player.hullMax
    }),
    fuelReserveStatus: 'safe',
    fuelReserveNeeded: 0,
    fuelReserveMargin: Math.floor(player.fuel),
    depthTarget: milestone.target,
    depthTargetKind: milestone.kind,
    depthTargetRemaining: milestone.remainingMeters,
    announcement: formatShipStatusAnnouncement({
      gameOver: false,
      atSurface: true,
      cargoFull: false,
      hullCritical: false
    })
  };
}

function initialPlayer(): PlayerSnapshot {
  const player = initialState.player;
  return {
    fuel: player.fuel,
    fuelMax: player.fuelMax,
    hull: player.hull,
    hullMax: player.hullMax,
    cargoMax: player.cargoMax,
    drill: player.drill,
    teleporters: countItem(player.inventory, TELEPORTER_ITEM.kind),
    scanners: countItem(player.inventory, SCANNER_ITEM.kind),
    dynamite: countItem(player.inventory, DYNAMITE_ITEM.kind),
    guns: countItem(player.inventory, GUN_ITEM.kind),
    containers: countItem(player.inventory, CARGO_CONTAINER_ITEM.kind)
  };
}

function sameInventorySlots(a: InventorySlotView[], b: InventorySlotView[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((slot, index) => {
    const other = b[index];
    return slot.kind === other.kind && slot.count === other.count && slot.label === other.label && slot.color === other.color;
  });
}

function sameCargoRows(a: CargoRow[], b: CargoRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, index) => {
    const other = b[index];
    return row.name === other.name && row.count === other.count && row.value === other.value && row.color === other.color;
  });
}

function sameStatRows(a: ExpeditionStatRow[], b: ExpeditionStatRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, index) => {
    const other = b[index];
    return row.label === other.label && row.value === other.value && row.detail === other.detail;
  });
}

let nextToastId = 1;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const uiStore = createStore<UiState>((set, get) => ({
  hud: initialHud(),
  player: initialPlayer(),
  inventorySlots: buildInventorySlots(createInventory()),
  containerSlots: [],
  cargoRows: [],
  statRows: formatExpeditionStats({}),
  activeOverlay: null,
  infoTab: DEFAULT_INFO_TAB,
  phase: 'intro',
  runtimeStatus: 'booting',
  runtimeError: null,
  musicOn: false,
  musicLabel: 'Enable music',
  sfxOn: false,
  sfxLabel: 'Enable sound effects',
  toasts: [],
  armedPlacement: null,

  syncHud(next) {
    const current = get().hud;
    if (HUD_KEYS.every(key => current[key] === next[key])) return;
    set({hud: {...next}});
  },

  syncPlayer(next) {
    const current = get().player;
    if (PLAYER_KEYS.every(key => current[key] === next[key])) return;
    set({player: {...next}});
  },

  setInventorySlots(slots) {
    if (sameInventorySlots(get().inventorySlots, slots)) return;
    set({inventorySlots: slots});
  },

  setContainerSlots(slots) {
    if (sameInventorySlots(get().containerSlots, slots)) return;
    set({containerSlots: slots});
  },

  setCargoRows(rows) {
    if (sameCargoRows(get().cargoRows, rows)) return;
    set({cargoRows: rows});
  },

  setStatRows(rows) {
    if (sameStatRows(get().statRows, rows)) return;
    set({statRows: rows});
  },

  setActiveOverlay(overlay) {
    if (get().activeOverlay === overlay) return;
    // Info always opens on its first tab, as the imperative version did.
    set(overlay === 'info' ? {activeOverlay: 'info', infoTab: DEFAULT_INFO_TAB} : {activeOverlay: overlay});
  },

  /**
   * Swapping overlays closes the outgoing `<dialog>`, and that close request comes
   * back as a request to clear the state — after the incoming overlay already
   * claimed it. Ignoring a close for an overlay that is no longer up keeps the
   * swap from closing both.
   */
  closeOverlay(overlay) {
    if (get().activeOverlay === overlay) set({activeOverlay: null});
  },

  setInfoTab(tab) {
    if (get().infoTab !== tab) set({infoTab: tab});
  },

  setPhase(phase) {
    if (get().phase !== phase) set({phase});
  },

  setRuntimeStatus(status, error = null) {
    const state = get();
    if (state.runtimeStatus === status && state.runtimeError === error) return;
    set({runtimeStatus: status, runtimeError: error});
  },

  setMusic(on, label) {
    const state = get();
    if (state.musicOn === on && state.musicLabel === label) return;
    set({musicOn: on, musicLabel: label});
  },

  setSfx(on, label) {
    const state = get();
    if (state.sfxOn === on && state.sfxLabel === label) return;
    set({sfxOn: on, sfxLabel: label});
  },

  /** A newer message takes over the toast slot; the older one never reappears. */
  pushToast(message) {
    const entry = {id: nextToastId++, message};
    set({toasts: [entry]});
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => get().dismissToast(entry.id), TOAST_VISIBLE_MS);
  },

  dismissToast(id) {
    const toasts = get().toasts.filter(toast => toast.id !== id);
    if (toasts.length === get().toasts.length) return;
    clearTimeout(toastTimer);
    toastTimer = undefined;
    set({toasts});
  },

  /**
   * Drop the queue and the pending expiry together. Replacing the state wholesale
   * (`setState`) empties `toasts` but cannot cancel the timer `pushToast` armed,
   * so anything resetting the store goes through here instead.
   */
  clearToasts() {
    clearTimeout(toastTimer);
    toastTimer = undefined;
    if (get().toasts.length > 0) set({toasts: []});
  },

  setArmedPlacement(kind) {
    if (get().armedPlacement !== kind) set({armedPlacement: kind});
  }
}));

/** Subscribe a component to one slice of UI state. */
export function useUiStore<T>(selector: (state: UiState) => T): T {
  return useStore(uiStore, selector);
}

/** Paint the occupied stacks of the bay for the HUD panel and the transfer menu. */
export function buildInventorySlots(inventory: Inventory): InventorySlotView[] {
  return inventory.map((stack, index) => ({
    index,
    kind: stack.kind,
    label: stack.item.label,
    color: stack.item.color,
    count: stack.count
  }));
}

/** Build the cargo-bay rows shown in the Info overlay from the ore stacks. */
export function buildCargoRows(inventory: Inventory): CargoRow[] {
  return oreStacks(inventory).map(stack => ({
    name: stack.item.label,
    color: stack.item.color,
    count: stack.count,
    value: stack.item.value * stack.count
  }));
}

/** Push a transient status line. The game's `toast()` entry point. */
export function pushToast(message: string): void {
  uiStore.getState().pushToast(message);
}

/** Music button state, written by the audio controller. */
export function setMusicIcon(on: boolean): void {
  uiStore.getState().setMusic(on, on ? 'Mute music' : 'Enable music');
}

/** Sound-effects button state, written by the audio controller. */
export function setSfxIcon(on: boolean): void {
  uiStore.getState().setSfx(on, on ? 'Mute sound effects' : 'Enable sound effects');
}

export function setSoundUnavailableStatus(message = 'Sound unavailable in this browser'): void {
  const store = uiStore.getState();
  store.setMusic(store.musicOn, message);
  store.setSfx(store.sfxOn, message);
}

export function setSoundBlockedStatus(): void {
  const store = uiStore.getState();
  store.setMusic(false, 'Music blocked — press Music after a tap/click');
  store.setSfx(false, 'Sound blocked — press Sound after a tap/click');
}

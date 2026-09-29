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
import { getDepthMilestone, type DepthMilestoneKind } from '../core/depth-milestone';
import { HOME_FUEL_EXIT, fuelExitLabel, type FuelReserveStatus } from '../core/fuel-reserve';
import { formatExpeditionObjective } from '../core/objective';
import { formatTerrainScanner } from '../core/scanner';
import { formatShipStatusAnnouncement } from '../core/ship-status';
import { createInitialState } from '../core/state';
import { formatExpeditionStats, type ExpeditionStatRow } from '../core/stats';
import { countItem, createInventory, oreStacks, type Inventory, type InventoryItemKind, type UpgradeKind } from '../core/inventory';
import { itemForKind } from '../core/items';
import { isSlotLocked } from '../core/ship-upgrades';
import { shouldBaseAlert } from '../core/hud-alerts';
import { homeExtractor, manufacturerStock } from '../core/stations';
import { sellPrice } from '../core/trading';
import type { DiscoveredTradingPost } from '../core/post-beacon';
import { TELEPORTER_ITEM } from '../core/teleporter';
import type { Epitaph } from '../core/grave';
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
  fuelAlert: boolean;
  hullAlert: boolean;
  cargoAlert: boolean;
  objective: string;
  atSurface: boolean;
  gameOver: boolean;
  /**
   * What Space would open right now, e.g. "Space: Manufacturing Station" or
   * "Space: Trading Post" — a home station, a post or a grave; empty when none is in reach.
   */
  stationHint: string;
  /**
   * The carried teleporter's whole HUD state: how many charges are aboard, and
   * whether pressing the button would open the portal list right now (a charge is
   * aboard and at least one portal is out of reach).
   */
  teleport: {count: number; usable: boolean};
  /** Adjacent drill/flight target readout, refreshed when the target changes. */
  scanner: string;
  /**
   * The trading-post beacon, the scanner's second line: "Trading post ≈9 tiles ↙"
   * for the nearest post within `TRADING_POST_HINT_RADIUS`, fog or not; empty when
   * none is that near or one is already in reach (`stationHint` names it then).
   */
  postHint: string;
  /**
   * The base's fuel supply: whether an extractor still stands in the home cavern,
   * its stored fuel (whole units) and queued coal, and whether the two together
   * could no longer fill one tank (`shouldBaseAlert`).
   */
  hasBase: boolean;
  baseFuel: number;
  baseCoal: number;
  baseAlert: boolean;
  /** Return-fuel forecast for the trip to the cheapest exit, home or a portal. */
  fuelReserveStatus: FuelReserveStatus;
  fuelReserveNeeded: number;
  fuelReserveMargin: number;
  /** That exit, as the gauge names it: `Home` or `Portal "Deep"`. */
  fuelReserveExit: string;
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

// `teleport` is left out on purpose: it is a nested object, so it is diffed by
// value (below) rather than by the reference compare this list drives.
const HUD_KEYS = [
  'cash', 'depthMeters', 'fuel', 'fuelMax', 'hull', 'hullMax', 'cargo', 'cargoMax',
  'fuelAlert', 'hullAlert', 'cargoAlert', 'objective',
  'atSurface', 'gameOver', 'stationHint',
  'hasBase', 'baseFuel', 'baseCoal', 'baseAlert',
  'scanner', 'postHint', 'fuelReserveStatus', 'fuelReserveNeeded', 'fuelReserveMargin',
  'fuelReserveExit', 'depthTarget', 'depthTargetKind', 'depthTargetRemaining', 'announcement'
] as const satisfies readonly (keyof HudSnapshot)[];

/** One trading post the player has seen, as the Prospecting tab lists it. */
export type TradingPostRow = DiscoveredTradingPost;

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

/** One portal the travel/teleporter/respawn overlay lists as a destination. */
export interface PortalDestinationView {
  x: number;
  y: number;
  name: string;
  /** Depth below the home row, in metres, the same figure the HUD reports. */
  depthMeters: number;
  /** Manhattan distance from the ship (or the death tile), in tiles. */
  distance: number;
  /** Respawn mode only: the fuel a replacement ship would deploy with here. */
  respawnFuel?: number;
}

/**
 * The portal overlay's contents, painted while it is up. `travel` lists the other
 * portals a ship parked at `source` can jump to for free; `teleporter` lists the
 * portals out of reach that a carried teleporter charge could reach; `respawn` is
 * the no-close redeploy prompt a lost ship with two or more portals answers.
 */
export interface PortalView {
  mode: 'travel' | 'teleporter' | 'respawn';
  /** The portal the ship is standing at (travel mode only). */
  source?: {x: number; y: number; name: string};
  destinations: PortalDestinationView[];
}

/** One trading-post buy offer, as the trade screen paints it. */
export interface TradeOfferView {
  /** Position in the offer list, and the stable React key. */
  index: number;
  kind: InventoryItemKind;
  label: string;
  color: string;
  price: number;
  /** Units left to buy; a sold-out offer sits at zero. */
  stock: number;
}

/** The fuel extractor's buffers, as the extractor screen paints them, plus its tick progress. */
export interface ExtractorView {
  coal: number;
  fuel: number;
  /** Ticks toward the current coal, so the screen can word "next in Xs". */
  progress: number;
  /** The base's extractor: it takes fuel ordered for cash (`extractorBuyFuelBtn`). */
  supply: boolean;
}

/**
 * One ship-upgrade fitting slot, as the Ship screen paints it: the fitted upgrade,
 * or a placeholder when the slot is empty.
 */
export interface ShipSlotView {
  /** Slot position, and the stable React key. */
  index: number;
  /** The fitted upgrade kind, or `null` for an empty slot. */
  kind: UpgradeKind | null;
  /** The upgrade's name, or "Empty" for a vacant slot. */
  label: string;
  /** Swatch colour; transparent for an empty slot. */
  color: string;
  /** The slot is still locked (no Mk II crafted yet): nothing fits and nothing unfits. */
  locked: boolean;
}

/** The label a locked fitting slot reads, naming what opens it. */
export const LOCKED_SLOT_LABEL = 'Locked — craft a Mk II upgrade';

/**
 * The modal overlay covering the mine, and everything it paints. Exactly one of
 * them, or none: one field rather than a flag per overlay, because "ship and info
 * at the same time" is not a state the game has any answer for — they are both
 * modal `<dialog>`s over the same canvas, so the second one to open would steal
 * focus while the first still claimed the top of the stack.
 *
 * Each variant carries its own contents, pushed by the game on open and after
 * every change, so a screen never reaches into the simulation and a closed
 * screen's contents cannot linger to be mistaken for an open one's.
 */
export type Overlay =
  | {kind: 'info'}
  /** The fitting slots are `shipEquipment`: a replacement ship resets them while the screen is shut. */
  | {kind: 'ship'}
  /** The open cargo container's stacks, in the inventory-slot shape. */
  | {kind: 'container'; slots: InventorySlotView[]}
  /** The open wreck's contents, in the same shape (take-only), and the deaths it has left. */
  | {kind: 'wreck'; slots: InventorySlotView[]; deathsLeft: number}
  /** The open chest's contents, in the same shape. Take-only. */
  | {kind: 'chest'; slots: InventorySlotView[]}
  /**
   * The manufacturing station's stock, in the inventory-slot shape, and whether it
   * is the home-cavern one that runs the Supply counter (`SUPPLY_POOL`).
   */
  | {kind: 'station'; slots: InventorySlotView[]; supply: boolean}
  /** The fuel extractor's buffers. */
  | {kind: 'extractor'; extractor: ExtractorView}
  /** The open trading post's buy offers. The sell side is the bay's ore, read from `inventorySlots`. */
  | {kind: 'trade'; offers: TradeOfferView[]}
  /** The travel, teleporter or respawn list. */
  | {kind: 'portal'; portal: PortalView}
  /** The epitaph on the grave being read. */
  | {kind: 'grave'; epitaph: Epitaph};

/** The modal overlays that cover the mine, by name. */
export type OverlayId = Overlay['kind'];

/** One overlay variant, by name. */
export type OverlayOf<K extends OverlayId> = Extract<Overlay, {kind: K}>;

export type ActiveOverlay = Overlay | null;

/** The overlay up, narrowed to `kind`, or `null` when something else (or nothing) is. */
export function overlayOf<K extends OverlayId>(state: Pick<UiState, 'overlay'>, kind: K): OverlayOf<K> | null {
  const overlay = state.overlay;
  return overlay?.kind === kind ? overlay as OverlayOf<K> : null;
}

/** The name of the overlay up, or `null` when the mine is uncovered. */
export function activeOverlayId(state: Pick<UiState, 'overlay'>): OverlayId | null {
  return state.overlay?.kind ?? null;
}

export interface UiState {
  hud: HudSnapshot;
  /** The cargo bay's slots, painted by the always-visible inventory panel. */
  inventorySlots: InventorySlotView[];
  /**
   * The ship's fitting slots, painted by the Ship screen. Written when the screen
   * opens and after each equip/unequip, so the menu never reads the simulation.
   */
  shipEquipment: ShipSlotView[];
  cargoRows: CargoRow[];
  statRows: ExpeditionStatRow[];
  /** The trading posts found so far, shallowest first (Info → Prospecting). */
  postRows: TradingPostRow[];
  /** The overlay covering the mine, with its contents, or `null`. */
  overlay: ActiveOverlay;
  infoTab: InfoTab;
  /**
   * The save file the last export produced, shown in Settings for copying. Only
   * lives while the Settings tab it was exported from is up: opening Info or
   * switching tab drops it, so a stale export is never mistaken for the run.
   */
  saveExport: string | null;
  /**
   * The Settings tab's disclosure and its two inline confirms: the cheat menu
   * expanded, "Reset game…" asking, "Import save…" asking. Store flags rather than
   * component state so the observation can report what the panel shows; they
   * still live only as long as the tab does — opening Info or switching tab drops
   * all three, so leaving Settings always cancels a pending confirm.
   */
  cheatsOpen: boolean;
  confirmingReset: boolean;
  confirmingImport: boolean;
  /** The HUD inventory panel folded shut to its header. Never persisted. */
  inventoryCollapsed: boolean;
  phase: UiPhase;
  runtimeStatus: RuntimeStatus;
  /** Why the runtime failed, when it did. Shown verbatim in the failure notice. */
  runtimeError: string | null;
  /**
   * Soundtrack and sound effects mute independently, one button each. The labels
   * are the buttons' tooltips — the next action, or why sound is blocked — not
   * their accessible names, which stay fixed with the state in `aria-pressed`.
   */
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
  setInventorySlots(slots: InventorySlotView[]): void;
  setShipEquipment(slots: ShipSlotView[]): void;
  setCargoRows(rows: CargoRow[]): void;
  setStatRows(rows: ExpeditionStatRow[]): void;
  setPostRows(rows: TradingPostRow[]): void;
  /**
   * Show one overlay with its contents, replacing whatever was up; `null` closes
   * them all. Republishing the overlay already up with unchanged contents writes
   * nothing, so a repaint after every transfer costs no render when nothing moved.
   */
  showOverlay(overlay: ActiveOverlay): void;
  /** Close an overlay, but only while it is the one on screen. */
  closeOverlay(kind: OverlayId): void;
  setInfoTab(tab: InfoTab): void;
  setSaveExport(json: string | null): void;
  setCheatsOpen(open: boolean): void;
  setConfirmingReset(confirming: boolean): void;
  setConfirmingImport(confirming: boolean): void;
  setInventoryCollapsed(collapsed: boolean): void;
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
  const base = homeExtractor(initialState.stations);
  return {
    cash: initialState.cash,
    depthMeters: 0,
    fuel: player.fuel,
    fuelMax: player.fuelMax,
    hull: player.hull,
    hullMax: player.hullMax,
    cargo: 0,
    cargoMax: player.cargoMax,
    fuelAlert: false,
    hullAlert: false,
    cargoAlert: false,
    objective: formatExpeditionObjective({
      player,
      cargoCount: 0,
      atSurface: true,
      bay: initialState.player.inventory,
      station: manufacturerStock(initialState.stations)
    }),
    atSurface: true,
    gameOver: false,
    stationHint: '',
    teleport: {count: countItem(player.inventory, TELEPORTER_ITEM.kind), usable: false},
    hasBase: base !== null,
    baseFuel: Math.floor(base?.fuel ?? 0),
    baseCoal: base?.coal ?? 0,
    baseAlert: shouldBaseAlert(initialState),
    // Nothing has been scanned before the first frame, which is exactly what the
    // scanner says about terrain it has not mapped yet.
    scanner: formatTerrainScanner({tile: {type: 'air'}, direction: [0, 1], explored: false}),
    // The home cavern is far above the shallowest post, so the beacon starts silent.
    postHint: '',
    fuelReserveStatus: 'safe',
    fuelReserveNeeded: 0,
    fuelReserveMargin: Math.floor(player.fuel),
    fuelReserveExit: fuelExitLabel(HOME_FUEL_EXIT),
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

function sameInventorySlots(a: InventorySlotView[], b: InventorySlotView[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((slot, index) => {
    const other = b[index];
    return other !== undefined && slot.kind === other.kind && slot.count === other.count && slot.label === other.label && slot.color === other.color;
  });
}

function sameTradeOffers(a: TradeOfferView[], b: TradeOfferView[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((offer, index) => {
    const other = b[index];
    return other !== undefined && offer.kind === other.kind && offer.price === other.price && offer.stock === other.stock;
  });
}

function sameCargoRows(a: CargoRow[], b: CargoRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, index) => {
    const other = b[index];
    return other !== undefined && row.name === other.name && row.count === other.count && row.value === other.value && row.color === other.color;
  });
}

function samePostRows(a: TradingPostRow[], b: TradingPostRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, index) => {
    const other = b[index];
    return other !== undefined && row.x === other.x && row.y === other.y && row.depthMeters === other.depthMeters;
  });
}

function sameStatRows(a: ExpeditionStatRow[], b: ExpeditionStatRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, index) => {
    const other = b[index];
    return other !== undefined && row.label === other.label && row.value === other.value && row.detail === other.detail;
  });
}

/**
 * Whether `next` would repaint nothing over `current`: the same screen with the
 * same contents. Screens whose contents are pushed wholesale on each change (the
 * portal list, the epitaph) compare by reference, as their old slices did.
 */
function sameOverlay(current: ActiveOverlay, next: ActiveOverlay): boolean {
  if (current === next) return true;
  if (!current || !next || current.kind !== next.kind) return false;
  switch (next.kind) {
    case 'info':
    case 'ship':
      return true;
    case 'container':
    case 'chest':
      return sameInventorySlots((current as typeof next).slots, next.slots);
    case 'wreck':
      return (current as typeof next).deathsLeft === next.deathsLeft && sameInventorySlots((current as typeof next).slots, next.slots);
    case 'station':
      return (current as typeof next).supply === next.supply && sameInventorySlots((current as typeof next).slots, next.slots);
    case 'extractor': {
      const a = (current as typeof next).extractor, b = next.extractor;
      return a.coal === b.coal && a.fuel === b.fuel && a.progress === b.progress && a.supply === b.supply;
    }
    case 'trade':
      return sameTradeOffers((current as typeof next).offers, next.offers);
    case 'portal':
      return (current as typeof next).portal === next.portal;
    case 'grave':
      return (current as typeof next).epitaph === next.epitaph;
  }
}

/** The Settings tab's transient flags as a fresh visit finds them. */
const CLOSED_SETTINGS = {cheatsOpen: false, confirmingReset: false, confirmingImport: false} as const;

let nextToastId = 1;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const uiStore = createStore<UiState>((set, get) => ({
  hud: initialHud(),
  inventorySlots: buildInventorySlots(createInventory()),
  shipEquipment: buildShipSlots(initialState.player.equipment, initialState.stats.bestMarkCrafted),
  cargoRows: [],
  statRows: formatExpeditionStats({}),
  postRows: [],
  overlay: null,
  infoTab: DEFAULT_INFO_TAB,
  saveExport: null,
  ...CLOSED_SETTINGS,
  inventoryCollapsed: false,
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
    if (HUD_KEYS.every(key => current[key] === next[key])
      && current.teleport.count === next.teleport.count
      && current.teleport.usable === next.teleport.usable) return;
    // Copy the nested teleport object so the store never shares it with the
    // caller's reused scratch snapshot, which mutates it in place every frame.
    set({hud: {...next, teleport: {...next.teleport}}});
  },

  setInventorySlots(slots) {
    if (sameInventorySlots(get().inventorySlots, slots)) return;
    set({inventorySlots: slots});
  },

  setShipEquipment(slots) {
    set({shipEquipment: slots});
  },

  setCargoRows(rows) {
    if (sameCargoRows(get().cargoRows, rows)) return;
    set({cargoRows: rows});
  },

  setStatRows(rows) {
    if (sameStatRows(get().statRows, rows)) return;
    set({statRows: rows});
  },

  setPostRows(rows) {
    if (samePostRows(get().postRows, rows)) return;
    set({postRows: rows});
  },

  showOverlay(overlay) {
    const current = get().overlay;
    if (sameOverlay(current, overlay)) return;
    // Info always opens on its first tab, as the imperative version did — but a
    // repaint of the Info screen already up keeps the tab the player is on.
    const next = overlay?.kind === 'extractor' ? {...overlay, extractor: {...overlay.extractor}} : overlay;
    set(overlay?.kind === 'info' && current?.kind !== 'info'
      ? {overlay: next, infoTab: DEFAULT_INFO_TAB, saveExport: null, ...CLOSED_SETTINGS}
      : {overlay: next});
  },

  /**
   * Swapping overlays closes the outgoing `<dialog>`, and that close request comes
   * back as a request to clear the state — after the incoming overlay already
   * claimed it. Ignoring a close for an overlay that is no longer up keeps the
   * swap from closing both.
   */
  closeOverlay(kind) {
    if (get().overlay?.kind === kind) set({overlay: null});
  },

  setInfoTab(tab) {
    if (get().infoTab !== tab) set({infoTab: tab, saveExport: null, ...CLOSED_SETTINGS});
  },

  setSaveExport(json) {
    set({saveExport: json});
  },

  setCheatsOpen(open) {
    if (get().cheatsOpen !== open) set({cheatsOpen: open});
  },

  setConfirmingReset(confirming) {
    if (get().confirmingReset !== confirming) set({confirmingReset: confirming});
  },

  setConfirmingImport(confirming) {
    if (get().confirmingImport !== confirming) set({confirmingImport: confirming});
  },

  setInventoryCollapsed(collapsed) {
    if (get().inventoryCollapsed !== collapsed) set({inventoryCollapsed: collapsed});
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

/**
 * Paint the ship's fitting slots for the Ship screen; empty slots read "Empty",
 * and a slot `isSlotLocked` still holds shut reads `LOCKED_SLOT_LABEL`.
 */
export function buildShipSlots(equipment: readonly (UpgradeKind | null)[], bestMarkCrafted: number): ShipSlotView[] {
  return equipment.map((kind, index) => {
    const locked = isSlotLocked(index, bestMarkCrafted);
    if (!kind) return {index, kind: null, label: locked ? LOCKED_SLOT_LABEL : 'Empty', color: 'transparent', locked};
    const item = itemForKind(kind);
    return {index, kind, label: item.label, color: item.color, locked};
  });
}

/** Build the cargo-bay rows shown in the Info overlay from the ore stacks. */
export function buildCargoRows(inventory: Inventory): CargoRow[] {
  return oreStacks(inventory).map(stack => ({
    name: stack.item.label,
    color: stack.item.color,
    count: stack.count,
    // Priced like the trading post prices it, from the ore table.
    value: sellPrice(stack.kind) * stack.count
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

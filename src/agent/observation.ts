// The programmatic-play observation: exactly what a sighted player sees, as JSON.
//
// A human reads the mine off the canvas and the HUD off the React chrome; an LLM
// agent reads this one object instead. So it is built from the same two sources
// the player's eyes are: the simulation's `GameState` for the world, and the UI
// store (`src/ui/store.ts`) for the HUD and the open overlay, which is already the
// "what the player sees" projection the components paint from.
//
// Two rules keep it honest. Fog: a tile the player has not explored is `?` and
// never appears in `notable`, using the very gate the renderer paints fog with
// (`isTileExplored`). Overlays: the station stock, the extractor buffers and the
// rest are mirrored only while that screen is actually open, because that is the
// only time the player can see them.
//
// Everything here is pure. The toast ring buffer is the one piece of state the
// observation carries across calls, so it is passed in rather than kept here; the
// bridge (`src/agent/bridge.ts`) owns it and feeds it from `uiStore.subscribe`.

import { MAX_WORLD_ROW, WORLD_W } from '../../shared/constants';
import { isTileExplored } from '../../shared/exploration-codec';
import { canCraft, missingInputs, pooledShortfall, recipeId, recipeLabel, unlockedRecipes } from '../core/crafting';
import { getEnemyType } from '../core/enemy-types';
import { describeItem, recipeInputLines } from '../core/item-info';
import { isScannerDone } from '../core/scanner-device';
import { nextShip, nextShipShortfall, shipFor, shipGains, type ShipBase, type ShipId } from '../core/ships';
import { manufacturerStock, stationAt } from '../core/stations';
import { itemForKind } from '../core/items';
import { formatWreckLifetime } from '../core/wreck';
import { SUPPLY_POOL, extractorFuelOrder, fuelPurchase, fuelUnitPrice, hullRepair, sellPrice, supplyPrice } from '../core/trading';
import { chestAt, graveAt, tradingPostAt } from '../world/world';
import { chestContents, isChestLooted } from '../core/chest';
import {
  addItem,
  createInventory,
  isOreKind,
  isUpgradeKind,
  totalItems,
  type Inventory,
  type InventoryItemKind,
  type UpgradeKind
} from '../core/inventory';
import { DANGER_TIP, buildDangerGuideRows, type DangerGuideRow } from '../core/danger';
import type { DepthMilestoneKind } from '../core/depth-milestone';
import type { FuelReserveStatus } from '../core/fuel-reserve';
import { isPlaceableKind, isPlacementValid, placementOverlayCells, type PlacementOverlayWorld } from '../core/placement-overlay';
import { GALLERY_TIP, PROSPECTING_TIP, SHIP_LADDER_TIP, buildProspectingGuideRows } from '../core/prospecting';
import type { ExpeditionStatRow } from '../core/stats';
import type { GameState, GameStats, Tile } from '../core/types';
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM } from '../game/zoom';
import { ORE_NOT_SAVED_NOTE } from '../persistence';
import { CONTROL_ROWS, controlKeysText } from '../ui/info-controls';
import { getInfoNavigationSections, type InfoTab } from '../ui/info-navigation';
import type { InventorySlotView, OverlayId, RuntimeStatus, UiPhase, UiState } from '../ui/store';

/** Horizontal radius of the default view window; 2·r+1 = 15 tiles across. */
export const DEFAULT_VIEW_RADIUS = 7;

/** The widest view an observation will build (81 tiles across), however much is asked. */
export const MAX_VIEW_RADIUS = 40;

/** Cap on the toast ring buffer carried in an observation. */
export const TOAST_RING_CAP = 10;

/** The single-glyph legend for the ASCII view. Keyed by the character it maps to. */
export const VIEW_LEGEND: Readonly<Record<string, string>> = Object.freeze({
  '.': 'air',
  '#': 'dirt',
  R: 'rock',
  o: 'ore',
  '!': 'hazard',
  E: 'enemy',
  D: 'decor',
  M: 'manufacturer',
  X: 'fuel extractor',
  P: 'portal',
  T: 'trading post',
  C: 'container',
  W: 'wreck',
  H: 'chest',
  '+': 'grave',
  S: 'scanner',
  '*': 'dynamite',
  '@': 'ship',
  '?': 'fogged'
});

/** One toast, tagged with the tick it was shown on. */
export interface AgentToast {
  tick: number;
  message: string;
}

/** One stack, as the bay/stock/container panels list it. */
export interface AgentSlot {
  kind: InventoryItemKind;
  label: string;
  count: number;
  /**
   * The `describeItem` lines a human reads off the row's tooltip. Present only on
   * slots inside an overlay (station stock/bay, container, wreck, chest, ship fittable);
   * the top-level `bay` stays lean and omits it.
   */
  info?: string[];
}

/** One recipe input line, resolved to a label. */
export interface AgentRecipeInput {
  kind: InventoryItemKind;
  count: number;
  label: string;
}

/**
 * One station recipe the screen lists (locked ones are left out), with the
 * affordances derived from the station stock.
 */
export interface AgentRecipe {
  /**
   * The row's `data-craft` value: the output kind, or the output plus `:alt` for
   * a deep alternate (e.g. "device:portal:alt", the Deep Portal).
   */
  id: string;
  output: InventoryItemKind;
  /** The row's name: the output's label, or the alternate's own ("Deep Portal"). */
  label: string;
  inputs: AgentRecipeInput[];
  /** The station holds every input right now. */
  craftable: boolean;
  /** The shortfall when it does not — empty when `craftable`. */
  missing: AgentRecipeInput[];
  /** The tooltip lines: the output item's description followed by each input's have/need count. */
  info: string[];
}

/** One home Supply row: an item bought for cash into the station stock (`data-supply` = kind). */
export interface AgentSupplyRow {
  kind: InventoryItemKind;
  label: string;
  price: number;
  /** The wallet covers the price (the button is live). */
  affordable: boolean;
  info: string[];
}

/** A hull on the ship ladder, as the Shipyard and the Ship screen heading name it. */
export interface AgentShipClass {
  id: ShipId;
  label: string;
  /** Fitting slots it carries; the last stays `locked` until a Mk II is crafted. */
  slots: number;
}

/**
 * The station's Shipyard: the hull flown now, and the next one up the one-way
 * ladder with its build cost from the station stock — click `data-craft-ship` with
 * its `id`. `next` is `null` on the top rung.
 */
export interface AgentShipyard {
  current: AgentShipClass;
  next: (AgentShipClass & {
    /** The station stock covers `inputs` (the Build button is live). */
    craftable: boolean;
    inputs: AgentRecipeInput[];
    /**
     * What neither the stock nor the bay holds — still to mine. The ore aboard
     * counts toward the bill, as the screen's shortfall line counts it.
     */
    missing: AgentRecipeInput[];
    /** What the stock lacks but the bay carries: stow it (data-station) before building. */
    stow: AgentRecipeInput[];
    /** What the swap adds to each base stat (fitted upgrades carry over on top). */
    gains: ShipBase;
  }) | null;
}

/** One ship fitting slot, as the Ship screen paints it. */
export interface AgentShipSlot {
  index: number;
  kind: UpgradeKind | null;
  label: string;
  /**
   * Still locked (no Mk II crafted yet, `stats.bestMarkCrafted < 2`): its unequip
   * button is disabled and `data-ship-equip` never fits into it.
   */
  locked: boolean;
  /** The fitted upgrade's tooltip lines; empty for a vacant slot. */
  info: string[];
}

/** What a notable tile is. Dirt, rock, air and decor are not notable. */
export type NotableKind = 'ore' | 'hazard' | 'enemy' | 'container' | 'wreck' | 'chest' | 'grave' | 'scanner' | 'dynamite' | 'station' | 'tradingPost';

/** One thing worth the agent's attention, at a world coordinate. */
export interface NotableTile {
  x: number;
  y: number;
  what: NotableKind;
  /** Human detail: ore/enemy/station name, crate/scanner state, wreck/chest item count, or fuse seconds. */
  detail?: string;
}

/** The one open overlay, mirrored only while it is up. */
export type AgentOverlay =
  | {
      kind: 'station';
      bay: AgentSlot[];
      stock: AgentSlot[];
      /**
       * The recipes the stock can craft right now. The screen lists every unlocked
       * recipe (`recipeCount` of them); `observe` with `detail: 'recipes'` mirrors
       * them all, the unaffordable ones with their `missing` shortfall.
       */
      recipes: AgentRecipe[];
      /** How many recipes the screen lists (every unlocked one), craftable or not. */
      recipeCount: number;
      /** The home Supply counter's rows; empty at a Manufacturer outside the home cavern. */
      supply: AgentSupplyRow[];
      shipyard: AgentShipyard;
    }
  | {
      kind: 'extractor';
      coal: number;
      fuel: number;
      progress: number;
      /**
       * What extractorBuyFuelBtn would order into the store right now (whole
       * dollars; `amount` 0 when the store is full or the wallet short). `null`
       * away from the base's extractor, where the button is not shown.
       */
      fuelOrder: {amount: number; cost: number} | null;
      /**
       * Dollars per unit a fuel order pays — the home price, which the button
       * quotes even while it has nothing to buy. `null` away from the base.
       */
      fuelPrice: number | null;
    }
  /** `ship`: the hull whose slots these are, as the screen's heading names it. */
  | {kind: 'ship'; ship: AgentShipClass; slots: AgentShipSlot[]; fittable: AgentSlot[]}
  | {kind: 'container'; ship: AgentSlot[]; container: AgentSlot[]}
  /** `deathsLeft`: each further death (a scuttle included) takes one off; the one that reaches 0 crumbles it. */
  | {kind: 'wreck'; ship: AgentSlot[]; wreck: AgentSlot[]; deathsLeft: number}
  | {kind: 'chest'; ship: AgentSlot[]; chest: AgentSlot[]}
  /** A grave's stone: who lies there, the years they lived, and how the mine took them. */
  | {kind: 'grave'; name: string; born: number; died: number; cause: string}
  | {
      kind: 'trade';
      cash: number;
      sell: {kind: InventoryItemKind; label: string; count: number; price: number; info: string[]}[];
      buy: {kind: InventoryItemKind; label: string; price: number; stock: number; info: string[]}[];
      /** Dollars per unit of fuel at this post, as the header quotes it: dearer the deeper the post. */
      fuelPrice: number;
      /**
       * The fuel row (tradeFuelBtn): the price of one unit, and the fill it would
       * buy right now — `amount` 0 when the tank is full or the wallet short.
       */
      fuel: {unitPrice: number; amount: number; cost: number};
    }
  | {
      kind: 'portal';
      mode: 'travel' | 'teleporter' | 'respawn';
      /** The portal the ship stands at (travel mode only). */
      source?: {x: number; y: number; name: string};
      /** The source portal's current name, echoed in travel mode for rename feedback. */
      name?: string;
      /**
       * Travel mode only: the paid hull repair row (portalRepairBtn), priced like a
       * post's Repair Kits. `missing` is the hull short of whole; `amount`/`cost`
       * what a press restores and charges right now (a partial repair when the
       * wallet is short); `affordable` whether the press does anything. `null`
       * while the hull is whole, when the row is not shown.
       */
      repair?: {missing: number; amount: number; cost: number; affordable: boolean} | null;
      /**
       * `respawnFuel` (respawn mode only): the absolute fuel units the replacement
       * ship deploys with at that portal — at home what the extractor's store
       * covers of the base tank (never under half of it), half of it at a field
       * portal.
       */
      destinations: {x: number; y: number; name: string; depth: number; distance: number; respawnFuel?: number}[];
    }
  | AgentInfoOverlay;

/**
 * The Info screen: its tabs, which one is up, and the contents of that one tab —
 * exactly one of the per-tab fields is present, the one matching `tab`, because
 * only the selected panel is on screen.
 */
export interface AgentInfoOverlay {
  kind: 'info';
  tab: InfoTab;
  /** Every tab, in tablist order; click one with `data-info-section` = its `id`. */
  sections: {id: InfoTab; label: string}[];
  /** Objective & Cargo: the objective line and the ore aboard, priced at trading-post value. */
  objective?: {status: string; cargo: {name: string; count: number; value: number}[]};
  /** Stats: the saved career rows. */
  stats?: ExpeditionStatRow[];
  /**
   * Prospecting: the tip, the galleries hint (dig sideways off the shaft), the
   * ship-ladder line, every ore's value and depth band, and the trading posts found
   * so far (explored post tiles, shallowest first; depth in metres).
   */
  prospecting?: {
    tip: string;
    galleries: string;
    ladder: string;
    ores: {name: string; value: string; depth: string}[];
    posts: {x: number; y: number; depth: number}[];
  };
  /** Hazards: the tip and the survival guide. */
  hazards?: {tip: string; rows: DangerGuideRow[]};
  /** Controls: every row of the controls list, keys as plain text. */
  controls?: {keys: string; action: string}[];
  /**
   * Settings: whether the cheat menu is expanded (its grants are then clickable),
   * and whether Reset game or Import save is waiting on its inline confirm. The
   * audio switches are the top-level `audio`. `oreNote` is the warning the Save
   * data box (and the import confirm) shows while ore is aboard — a save leaves
   * the bay's ore out, so stow it before exporting or reloading — else `null`.
   */
  settings?: {cheatsOpen: boolean; confirmingReset: boolean; confirmingImport: boolean; oreNote: string | null};
  /** The save text Export just produced (Settings only, once there is one). */
  saveExport?: string;
  /**
   * Where the harness saved Export's file download, when it caught one (set by
   * `agent/session.ts`, never by the game). Settings only, beside `saveExport`.
   */
  saveExportPath?: string;
}

/** What the tile under the ship is, and anything notable standing on it. */
export interface AgentShipTile {
  tile: Tile['type'];
  /** The notable thing on the ship's own tile (a portal, a trading post, a wreck…), if any. */
  what?: NotableKind;
  detail?: string;
}

/**
 * The armed device's placement preview, as the canvas grid paints it: the kind
 * armed, the valid sites the grid tints green around the ship, and the tile the
 * pointer last targeted with whether the device would go there.
 */
export interface AgentPlacement {
  kind: InventoryItemKind;
  /** The hovered/last-pressed tile, or `null` when the pointer targets none. */
  target: {x: number; y: number} | null;
  /** Whether the device fits on `target`; `null` with no target. */
  valid: boolean | null;
  /** Every explored tile in the grid around the ship where the device would go. */
  sites: {x: number; y: number}[];
}

export interface AgentObservation {
  tick: number;
  phase: UiPhase;
  activeOverlay: OverlayId | null;
  gameOver: boolean;
  ship: {
    x: number;
    y: number;
    /** The hull on the ship ladder (`scout` … `corebreaker`). */
    class: ShipId;
    /** Its display name, e.g. "Hauler". */
    shipLabel: string;
    /** Fitting slots the hull carries (`equipment.length`), the Mk II-locked last one included. */
    slots: number;
    depthMeters: number;
    fuel: number;
    fuelMax: number;
    hull: number;
    hullMax: number;
    cargo: number;
    cargoMax: number;
    drill: number;
    boost: boolean;
    equipment: (UpgradeKind | null)[];
    atSurface: boolean;
    /** The tile the ship stands on (the `@` cell), and what is on it. */
    on: AgentShipTile;
  };
  cash: number;
  stats: GameStats;
  bay: AgentSlot[];
  armedPlacement: InventoryItemKind | null;
  /** The placement grid while a placeable device is armed; `null` otherwise (toolkit included). */
  placement: AgentPlacement | null;
  /** The two audio switches (HUD and Settings), each with the label its button carries. */
  audio: {music: boolean; sfx: boolean; musicLabel: string; sfxLabel: string};
  /** Whether the simulation runtime is up (`ready`), and why it failed when it did. */
  runtime: {status: RuntimeStatus; error: string | null};
  hud: {
    cash: number;
    objective: string;
    scanner: string;
    /**
     * The trading-post beacon under the scanner line: "Trading post ≈9 tiles ↙" for
     * the nearest post within 12 tiles (fog ignored); empty when none is near or one
     * is already in reach (then `stationHint` names it).
     */
    postHint: string;
    /**
     * The return forecast, priced to the cheapest exit: `exit` is `Home` or a
     * field portal to jump home from (`Portal "Deep"`), `needed` the fuel the
     * trip there costs and `margin` what is left after it.
     */
    fuelReserve: {status: FuelReserveStatus; needed: number; margin: number; exit: string};
    /**
     * The next depth landmark below the career record (`stats.maxDepth`) or the
     * ship, whichever is deeper, and how far below the ship it is. `record` is a
     * depth record already set that the ship has climbed back above — the HUD then
     * reads "record: 9000 m reached" instead of the countdown — else `null`.
     */
    depthTarget: {name: string; kind: DepthMilestoneKind; remaining: number; record: number | null};
    stationHint: string;
    teleport: {count: number; usable: boolean};
    /**
     * The base's fuel supply (the HUD's "Base" line): the home extractor's stored
     * fuel and queued coal, and `alert` when the two could no longer fill a tank.
     * `null` once no extractor stands in the home cavern.
     */
    base: {fuel: number; coal: number; alert: boolean} | null;
    /**
     * The Shipyard at a glance: the next hull up the ladder, what neither the
     * (first) Manufacturer's stock nor the bay holds for it (`missing`, still to
     * mine), and what the bay carries that the stock lacks (`stow`) — both empty
     * means it is buildable now. `null` on the top rung. The same figures the
     * objective's "build the …" rung quotes.
     */
    nextShip: {id: ShipId; label: string; missing: AgentRecipeInput[]; stow: AgentRecipeInput[]} | null;
    alerts: {fuel: boolean; hull: boolean; cargo: boolean};
    announcement: string;
    /** The HUD inventory panel is folded shut (inventoryToggleBtn opens it again). */
    inventoryCollapsed: boolean;
  };
  view: {
    origin: {x: number; y: number};
    rows: string[];
    legend: Readonly<Record<string, string>>;
    /**
     * The camera zoom: the level the view is at (or gliding to), and the range.
     * `+`/`-` step it by a quarter; the ASCII window above does not change with it.
     */
    zoom: {level: number; min: number; max: number};
  };
  notable: NotableTile[];
  overlay: AgentOverlay | null;
  toasts: AgentToast[];
}

export interface BuildObservationOptions {
  state: GameState;
  ui: UiState;
  get(x: number, y: number): Tile;
  /** Horizontal view radius; the window is 2·r+1 wide by a ~11:15 tall. */
  radius?: number;
  /** The bridge's toast ring buffer; the last few lines the player saw. */
  toasts?: readonly AgentToast[];
  /** The camera zoom level (`viewport.targetZoom`); the baseline when absent. */
  zoom?: number;
  /** Ask for the parts left out by default: `'recipes'` mirrors every recipe the station lists. */
  detail?: ObservationDetail;
}

/**
 * The extra detail an observation can be asked for. `'recipes'`: an open
 * Manufacturer's full recipe list, not only the craftable rows.
 */
export type ObservationDetail = 'recipes';

/** Every `ObservationDetail`, for a harness validating what it was asked for. */
export const OBSERVATION_DETAILS: readonly ObservationDetail[] = ['recipes'];

/** Append a toast to a capped ring buffer, dropping the oldest past the cap. */
export function appendToast(
  ring: readonly AgentToast[],
  toast: AgentToast,
  cap = TOAST_RING_CAP
): AgentToast[] {
  const next = [...ring, toast];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function toSlots(slots: readonly InventorySlotView[]): AgentSlot[] {
  return slots.map(slot => ({kind: slot.kind, label: slot.label, count: slot.count}));
}

/** Like `toSlots`, but carrying each row's tooltip lines — for slots shown inside an overlay. */
function toSlotsWithInfo(slots: readonly InventorySlotView[]): AgentSlot[] {
  return slots.map(slot => ({kind: slot.kind, label: slot.label, count: slot.count, info: describeItem(slot.kind).lines}));
}

/** Rebuild an inventory from its slot views, to check recipe affordances. */
function slotsToInventory(slots: readonly InventorySlotView[]) {
  return slots.reduce((inventory, slot) => addItem(inventory, itemForKind(slot.kind), slot.count), createInventory());
}

function resolveInputs(inputs: readonly {kind: InventoryItemKind; count: number}[]): AgentRecipeInput[] {
  return inputs.map(input => ({kind: input.kind, count: input.count, label: itemForKind(input.kind).label}));
}

/** A hull, as the observation names it. */
function shipClass(id: ShipId): AgentShipClass {
  const ship = shipFor(id);
  return {id, label: ship.label, slots: ship.slots};
}

/**
 * The Shipyard the station screen paints: the store's hull, and the next one
 * priced from the stock with the bay counted toward it, as its shortfall line is.
 */
function buildShipyard(current: ShipId, stock: Inventory, bay: Inventory): AgentShipyard {
  const next = nextShip(current);
  if (!next) return {current: shipClass(current), next: null};
  const def = shipFor(next);
  const {missing, stow} = pooledShortfall(bay, stock, def);
  return {
    current: shipClass(current),
    next: {
      ...shipClass(next),
      craftable: canCraft(stock, def),
      inputs: resolveInputs(def.inputs),
      missing: resolveInputs(missing),
      stow: resolveInputs(stow),
      gains: shipGains(current, next)
    }
  };
}

/** `hud.nextShip`: the next hull up and what the first Manufacturer's stock and the bay still lack for it. */
function buildNextShip(state: GameState): AgentObservation['hud']['nextShip'] {
  const next = nextShipShortfall(state.player.ship, manufacturerStock(state.stations), state.player.inventory);
  return next
    ? {id: next.id, label: shipFor(next.id).label, missing: resolveInputs(next.missing), stow: resolveInputs(next.stow)}
    : null;
}

/** A fuel price as the screens print it: dollars per unit, to the cent. */
function centsPerUnit(unitPrice: number): number {
  return Math.round(unitPrice * 100) / 100;
}

/** The trade screen's fuel row: the post's unit price, and what a fill would pour and cost. */
function tradeFuel(state: GameState, cash: number, unitPrice: number): {unitPrice: number; amount: number; cost: number} {
  const {amount, cost} = fuelPurchase(state.player.fuel, state.player.fuelMax, cash, unitPrice);
  return {unitPrice: centsPerUnit(unitPrice), amount: Math.round(amount), cost};
}

/** The travel list's hull-repair row, as the screen paints it: `null` while the hull is whole. */
function portalRepair(state: GameState, cash: number): {missing: number; amount: number; cost: number; affordable: boolean} | null {
  const {hull, hullMax} = state.player;
  if (hullMax - hull < 1) return null;
  const {amount, cost} = hullRepair(hull, hullMax, cash);
  return {missing: Math.round(hullMax - hull), amount: Math.round(amount), cost, affordable: amount > 0};
}

/** The one open overlay's mirror, or `null` when the mine is uncovered. */
function buildOverlay(state: GameState, ui: UiState, detail: ObservationDetail | undefined): AgentOverlay | null {
  const overlay = ui.overlay;
  if (!overlay) return null;
  switch (overlay.kind) {
    case 'station': {
      const stock = slotsToInventory(overlay.slots);
      const listed = unlockedRecipes(overlay.bestMarkCrafted);
      // The full list runs to dozens of rows the stock mostly cannot pay for, so by
      // default only the craftable ones are mirrored; `detail: 'recipes'` asks for all.
      const shown = detail === 'recipes' ? listed : listed.filter(recipe => canCraft(stock, recipe));
      return {
        kind: 'station',
        bay: toSlotsWithInfo(ui.inventorySlots),
        stock: toSlotsWithInfo(overlay.slots),
        recipes: shown.map(recipe => {
          const craftable = canCraft(stock, recipe);
          return {
            id: recipeId(recipe),
            output: recipe.output,
            label: recipeLabel(recipe),
            inputs: resolveInputs(recipe.inputs),
            craftable,
            missing: craftable ? [] : resolveInputs(missingInputs(stock, recipe)),
            info: [...describeItem(recipe.output).lines, ...recipeInputLines(recipe, stock)]
          };
        }),
        recipeCount: listed.length,
        supply: overlay.supply
          ? SUPPLY_POOL.map(kind => {
              const price = supplyPrice(kind);
              return {kind, label: itemForKind(kind).label, price, affordable: ui.hud.cash >= price, info: describeItem(kind).lines};
            })
          : [],
        shipyard: buildShipyard(ui.ship.id, stock, slotsToInventory(ui.inventorySlots))
      };
    }
    case 'extractor': {
      const {coal, fuel, progress, supply} = overlay.extractor;
      const order = supply ? extractorFuelOrder(fuel, ui.hud.cash) : null;
      return {
        kind: 'extractor',
        coal,
        fuel,
        progress,
        fuelOrder: order ? {amount: Math.round(order.amount), cost: order.cost} : null,
        fuelPrice: supply ? centsPerUnit(fuelUnitPrice()) : null
      };
    }
    case 'ship':
      return {
        kind: 'ship',
        ship: shipClass(ui.ship.id),
        slots: ui.shipEquipment.map(slot => ({
          index: slot.index,
          kind: slot.kind,
          label: slot.label,
          locked: slot.locked,
          info: slot.kind ? describeItem(slot.kind).lines : []
        })),
        fittable: toSlotsWithInfo(ui.inventorySlots.filter(slot => isUpgradeKind(slot.kind)))
      };
    case 'container':
      return {kind: 'container', ship: toSlotsWithInfo(ui.inventorySlots), container: toSlotsWithInfo(overlay.slots)};
    case 'wreck':
      return {kind: 'wreck', ship: toSlotsWithInfo(ui.inventorySlots), wreck: toSlotsWithInfo(overlay.slots), deathsLeft: overlay.deathsLeft};
    case 'chest':
      return {kind: 'chest', ship: toSlotsWithInfo(ui.inventorySlots), chest: toSlotsWithInfo(overlay.slots)};
    case 'trade':
      return {
        kind: 'trade',
        cash: ui.hud.cash,
        // The sell side is the bay's ore, priced at the ore table's own value.
        sell: ui.inventorySlots
          .filter(slot => isOreKind(slot.kind))
          .map(slot => ({kind: slot.kind, label: slot.label, count: slot.count, price: sellPrice(slot.kind), info: describeItem(slot.kind).lines})),
        buy: overlay.offers.map(offer => ({kind: offer.kind, label: offer.label, price: offer.price, stock: offer.stock, info: describeItem(offer.kind).lines})),
        fuelPrice: centsPerUnit(overlay.fuelPrice),
        fuel: tradeFuel(state, ui.hud.cash, overlay.fuelPrice)
      };
    case 'portal': {
      const {portal} = overlay;
      const travel = portal.mode === 'travel' && portal.source !== undefined;
      return {
        kind: 'portal',
        mode: portal.mode,
        source: portal.source,
        name: portal.source?.name,
        ...(travel ? {repair: portalRepair(state, ui.hud.cash)} : {}),
        destinations: portal.destinations.map(destination => {
          const row: {x: number; y: number; name: string; depth: number; distance: number; respawnFuel?: number} = {
            x: destination.x,
            y: destination.y,
            name: destination.name,
            depth: destination.depthMeters,
            distance: destination.distance
          };
          // Only the respawn prompt prices a redeploy; travel rows stay as they were.
          if (destination.respawnFuel !== undefined) row.respawnFuel = destination.respawnFuel;
          return row;
        })
      };
    }
    case 'grave': {
      const grave = overlay.epitaph;
      return {kind: 'grave', name: grave.name, born: grave.born, died: grave.died, cause: grave.cause};
    }
    case 'info':
      return buildInfoOverlay(ui);
  }
}

/** The Info screen's mirror: its tabs, and the one visible tab's contents. */
function buildInfoOverlay(ui: UiState): AgentInfoOverlay {
  const overlay: AgentInfoOverlay = {
    kind: 'info',
    tab: ui.infoTab,
    sections: getInfoNavigationSections().map(section => ({id: section.id, label: section.label}))
  };
  switch (ui.infoTab) {
    case 'info-objective':
      overlay.objective = {
        status: ui.hud.objective,
        cargo: ui.cargoRows.map(row => ({name: row.name, count: row.count, value: row.value}))
      };
      break;
    case 'info-stats':
      overlay.stats = ui.statRows.map(row => ({...row}));
      break;
    case 'info-prospecting':
      overlay.prospecting = {
        tip: PROSPECTING_TIP,
        galleries: GALLERY_TIP,
        ladder: SHIP_LADDER_TIP,
        ores: buildProspectingGuideRows().map(row => ({name: row.name, value: row.valueLabel, depth: row.depthLabel})),
        posts: ui.postRows.map(row => ({x: row.x, y: row.y, depth: row.depthMeters}))
      };
      break;
    case 'info-hazards':
      overlay.hazards = {tip: DANGER_TIP, rows: buildDangerGuideRows()};
      break;
    case 'info-controls':
      overlay.controls = CONTROL_ROWS.map(row => ({keys: controlKeysText(row), action: row.action}));
      break;
    case 'info-settings':
      overlay.settings = {
        cheatsOpen: ui.cheatsOpen,
        confirmingReset: ui.confirmingReset,
        confirmingImport: ui.confirmingImport,
        oreNote: ui.inventorySlots.some(slot => isOreKind(slot.kind)) ? ORE_NOT_SAVED_NOTE : null
      };
      if (ui.saveExport !== null) overlay.saveExport = ui.saveExport;
      break;
  }
  return overlay;
}

/** The placement preview while a placeable device is armed, or `null`. */
function buildPlacement(state: GameState, get: (x: number, y: number) => Tile): AgentPlacement | null {
  const kind = state.armedPlacement;
  // The toolkit is armed but never placed: it paints no grid, so there is none here.
  if (kind === null || !isPlaceableKind(kind)) return null;
  // The same world snapshot the renderer's grid reads, so the two cannot disagree.
  const world: PlacementOverlayWorld = {
    explored: state.exploredTiles,
    scannerDevices: state.scannerDevices,
    placedDynamite: state.placedDynamite,
    cargoContainers: state.cargoContainers,
    wrecks: state.wrecks,
    stations: state.stations,
    chestLedger: state.chestLedger,
    player: state.player,
    world: state.world,
    isOpen: (x, y) => get(x, y).type === 'air'
  };
  const cells = placementOverlayCells(kind, state.player.x, state.player.y, world);
  const target = state.hoverTile ? {x: state.hoverTile.x, y: state.hoverTile.y} : null;
  return {
    kind,
    target,
    valid: target ? isPlacementValid(kind, target.x, target.y, world) : null,
    sites: cells.filter(cell => cell.valid).map(cell => ({x: cell.x, y: cell.y}))
  };
}

export function buildObservation({state, ui, get, radius = DEFAULT_VIEW_RADIUS, toasts = [], zoom = DEFAULT_ZOOM, detail}: BuildObservationOptions): AgentObservation {
  const player = state.player;
  // Clamped both ways: a huge (or non-finite) radius must not build a giant grid.
  const radiusX = Number.isFinite(radius) ? Math.min(MAX_VIEW_RADIUS, Math.max(1, Math.floor(radius))) : DEFAULT_VIEW_RADIUS;
  // The window is wider than it is tall to match the canvas; keep the ~11:15 ratio.
  const radiusY = Math.max(1, Math.round(radiusX * 11 / 15));
  const originX = player.x - radiusX;
  const originY = player.y - radiusY;

  // Entity lookups, keyed by tile, so the view and notable passes are one map hit
  // each rather than a scan per tile.
  const enemyAt = new Map<string, GameState['enemies'][number]>();
  for (const enemy of state.enemies) {
    if (enemy.alive) enemyAt.set(key(Math.round(enemy.x), Math.round(enemy.y)), enemy);
  }
  const dynamiteAt = new Map<string, GameState['placedDynamite'][number]>();
  for (const stick of state.placedDynamite) dynamiteAt.set(key(stick.x, stick.y), stick);
  const scannerAt = new Map<string, GameState['scannerDevices'][number]>();
  for (const device of state.scannerDevices) scannerAt.set(key(device.x, device.y), device);
  const containerAt = new Map<string, GameState['cargoContainers'][number]>();
  for (const container of state.cargoContainers) containerAt.set(key(container.x, container.y), container);
  const wreckAt = new Map<string, GameState['wrecks'][number]>();
  for (const wreck of state.wrecks) wreckAt.set(key(wreck.x, wreck.y), wreck);

  /**
   * One explored, in-world tile: its glyph, and what makes it notable if anything
   * does. Entities stand over the terrain in a fixed order — the same order the
   * glyphs have always been drawn in — so the first match wins.
   */
  function classify(x: number, y: number): {glyph: string; tile: Tile['type']; what?: NotableKind; detail?: string} {
    const tile = get(x, y);
    const on = (glyph: string, what: NotableKind, detail?: string) =>
      detail === undefined ? {glyph, tile: tile.type, what} : {glyph, tile: tile.type, what, detail};
    const at = key(x, y);
    const enemy = enemyAt.get(at);
    if (enemy) return on('E', 'enemy', getEnemyType(enemy.kind).name);
    const stick = dynamiteAt.get(at);
    if (stick) return on('*', 'dynamite', `${Math.ceil(stick.fuse / 60)}s`);
    const device = scannerAt.get(at);
    if (device) return on('S', 'scanner', isScannerDone(device, state.exploredTiles) ? 'spent' : 'active');
    const container = containerAt.get(at);
    if (container) return on('C', 'container', totalItems(container.inventory) > 0 ? 'loaded' : 'empty');
    const wreck = wreckAt.get(at);
    if (wreck) {
      const items = totalItems(wreck.inventory);
      return on('W', 'wreck', `${items} item${items === 1 ? '' : 's'}, ${formatWreckLifetime(wreck.deathsLeft)}`);
    }
    const station = stationAt(state.stations, x, y);
    if (station?.kind === 'manufacturer') return on('M', 'station', 'Manufacturer');
    if (station?.kind === 'extractor') return on('X', 'station', 'Fuel Extractor');
    if (station?.kind === 'portal') return on('P', 'station', `Portal "${station.name}"`);
    if (tradingPostAt(x, y)) return on('T', 'tradingPost');
    // A chest looted bare is gone; before its first open it holds its rolled loot.
    if (chestAt(x, y) && !isChestLooted(state.chestLedger, x, y)) {
      const items = totalItems(chestContents(state.chestLedger, x, y));
      return on('H', 'chest', `${items} item${items === 1 ? '' : 's'}`);
    }
    if (graveAt(x, y)) return on('+', 'grave');
    switch (tile.type) {
      case 'air': return {glyph: '.', tile: tile.type};
      case 'dirt': return {glyph: '#', tile: tile.type};
      case 'rock': return {glyph: 'R', tile: tile.type};
      case 'decor': return {glyph: 'D', tile: tile.type};
      case 'ore': return on('o', 'ore', tile.ore.name);
      case 'hazard': return on('!', 'hazard');
      case 'enemy': return on('E', 'enemy', getEnemyType(tile.kind).name);
    }
  }

  const rows: string[] = [];
  const notable: NotableTile[] = [];

  for (let y = originY; y < originY + radiusY * 2 + 1; y++) {
    let row = '';
    for (let x = originX; x < originX + radiusX * 2 + 1; x++) {
      if (x === player.x && y === player.y) {
        row += '@';
        continue;
      }
      // Past the world's edges is solid wall, drawn as rock. It must be caught
      // before the fog lookup: the exploration index is `y·WORLD_W + x`, so an
      // off-world column would alias a real tile on the neighbouring row.
      if (x < 0 || x >= WORLD_W || y < 0 || y > MAX_WORLD_ROW) {
        row += 'R';
        continue;
      }
      if (!isTileExplored(state.exploredTiles, x, y)) {
        row += '?';
        continue;
      }
      const cell = classify(x, y);
      row += cell.glyph;
      if (cell.what) notable.push(cell.detail === undefined ? {x, y, what: cell.what} : {x, y, what: cell.what, detail: cell.detail});
    }
    rows.push(row);
  }

  // The `@` hides whatever the ship stands on, so it is spelled out instead. The
  // ship's own tile is always in the world and always explored.
  const under = classify(player.x, player.y);
  const shipOn: AgentShipTile = {tile: under.tile};
  if (under.what) shipOn.what = under.what;
  if (under.detail !== undefined) shipOn.detail = under.detail;

  const hud = ui.hud;
  return {
    tick: state.tick,
    phase: ui.phase,
    activeOverlay: ui.overlay?.kind ?? null,
    gameOver: state.gameOver,
    ship: {
      x: player.x,
      y: player.y,
      class: player.ship,
      shipLabel: shipFor(player.ship).label,
      slots: player.equipment.length,
      depthMeters: hud.depthMeters,
      // Ship vitals come from the live simulation, not the UI snapshot:
      // `state.player` is the ground truth, and the HUD's copy is a frame behind it.
      fuel: player.fuel,
      fuelMax: player.fuelMax,
      hull: player.hull,
      hullMax: player.hullMax,
      cargo: hud.cargo,
      cargoMax: player.cargoMax,
      drill: player.drill,
      boost: player.boost,
      equipment: [...player.equipment],
      atSurface: hud.atSurface,
      on: shipOn
    },
    cash: hud.cash,
    stats: {...state.stats, oresMined: {...state.stats.oresMined}},
    bay: toSlots(ui.inventorySlots),
    armedPlacement: ui.armedPlacement,
    placement: buildPlacement(state, get),
    audio: {music: ui.musicOn, sfx: ui.sfxOn, musicLabel: ui.musicLabel, sfxLabel: ui.sfxLabel},
    runtime: {status: ui.runtimeStatus, error: ui.runtimeError},
    hud: {
      cash: hud.cash,
      objective: hud.objective,
      scanner: hud.scanner,
      postHint: hud.postHint,
      fuelReserve: {
        status: hud.fuelReserveStatus,
        needed: hud.fuelReserveNeeded,
        margin: hud.fuelReserveMargin,
        exit: hud.fuelReserveExit
      },
      depthTarget: {name: hud.depthTarget, kind: hud.depthTargetKind, remaining: hud.depthTargetRemaining, record: hud.depthTargetRecord},
      stationHint: hud.stationHint,
      teleport: {count: hud.teleport.count, usable: hud.teleport.usable},
      base: hud.hasBase ? {fuel: hud.baseFuel, coal: hud.baseCoal, alert: hud.baseAlert} : null,
      nextShip: buildNextShip(state),
      alerts: {fuel: hud.fuelAlert, hull: hud.hullAlert, cargo: hud.cargoAlert},
      announcement: hud.announcement,
      inventoryCollapsed: ui.inventoryCollapsed
    },
    view: {
      origin: {x: originX, y: originY},
      rows,
      legend: VIEW_LEGEND,
      zoom: {level: zoom, min: MIN_ZOOM, max: MAX_ZOOM}
    },
    notable,
    overlay: buildOverlay(state, ui, detail),
    toasts: [...toasts]
  };
}

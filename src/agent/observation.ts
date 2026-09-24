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

import { isTileExplored } from '../../shared/exploration-codec';
import { canCraft, missingInputs, RECIPES } from '../core/crafting';
import { getEnemyType } from '../core/enemy-types';
import { describeItem, recipeInputLines } from '../core/item-info';
import { isScannerDone } from '../core/scanner-device';
import { stationAt } from '../core/stations';
import { itemForKind } from '../core/items';
import { sellPrice } from '../core/trading';
import { tradingPostAt } from '../world/world';
import {
  addItem,
  createInventory,
  isOreKind,
  isUpgradeKind,
  totalItems,
  type InventoryItemKind,
  type UpgradeKind
} from '../core/inventory';
import type { DepthMilestoneKind } from '../core/depth-milestone';
import type { FuelReserveStatus } from '../core/fuel-reserve';
import type { GameState, GameStats, Tile } from '../core/types';
import type { InfoTab } from '../ui/info-navigation';
import type { ActiveOverlay, InventorySlotView, UiPhase, UiState } from '../ui/store';

/** Horizontal radius of the default view window; 2·r+1 = 15 tiles across. */
export const DEFAULT_VIEW_RADIUS = 7;

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
  X: 'oil extractor',
  P: 'portal',
  T: 'trading post',
  C: 'container',
  W: 'wreck',
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
   * slots inside an overlay (station stock/bay, container, wreck, ship fittable);
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

/** One station recipe, with the affordances derived from the station stock. */
export interface AgentRecipe {
  output: InventoryItemKind;
  label: string;
  inputs: AgentRecipeInput[];
  /** The station holds every input right now. */
  craftable: boolean;
  /** The shortfall when it does not — empty when `craftable`. */
  missing: AgentRecipeInput[];
  /** The tooltip lines: the output item's description followed by each input's have/need count. */
  info: string[];
}

/** One ship fitting slot, as the Ship screen paints it. */
export interface AgentShipSlot {
  index: number;
  kind: UpgradeKind | null;
  label: string;
  /** The fitted upgrade's tooltip lines; empty for a vacant slot. */
  info: string[];
}

/** What a notable tile is. Decor, dirt, rock and air are not notable. */
export type NotableKind = 'ore' | 'hazard' | 'enemy' | 'container' | 'wreck' | 'scanner' | 'dynamite' | 'station' | 'tradingPost';

/** One thing worth the agent's attention, at a world coordinate. */
export interface NotableTile {
  x: number;
  y: number;
  what: NotableKind;
  /** Human detail: ore/enemy/station name, crate/scanner state, or fuse seconds. */
  detail?: string;
}

/** The one open overlay, mirrored only while it is up. */
export type AgentOverlay =
  | {kind: 'station'; bay: AgentSlot[]; stock: AgentSlot[]; recipes: AgentRecipe[]}
  | {kind: 'extractor'; coal: number; fuel: number; progress: number; refuelAmount: number}
  | {kind: 'ship'; slots: AgentShipSlot[]; fittable: AgentSlot[]}
  | {kind: 'container'; ship: AgentSlot[]; container: AgentSlot[]}
  | {kind: 'wreck'; ship: AgentSlot[]; wreck: AgentSlot[]}
  | {
      kind: 'trade';
      cash: number;
      sell: {kind: InventoryItemKind; label: string; count: number; price: number; info: string[]}[];
      buy: {kind: InventoryItemKind; label: string; price: number; stock: number; info: string[]}[];
    }
  | {
      kind: 'portal';
      mode: 'travel' | 'teleporter' | 'respawn';
      /** The portal the ship stands at (travel mode only). */
      source?: {x: number; y: number; name: string};
      /** The source portal's current name, echoed in travel mode for rename feedback. */
      name?: string;
      destinations: {x: number; y: number; name: string; depth: number; distance: number}[];
    }
  | {kind: 'info'; tab: InfoTab};

export interface AgentObservation {
  tick: number;
  phase: UiPhase;
  activeOverlay: ActiveOverlay;
  gameOver: boolean;
  ship: {
    x: number;
    y: number;
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
  };
  cash: number;
  stats: GameStats;
  bay: AgentSlot[];
  armedPlacement: InventoryItemKind | null;
  hud: {
    cash: number;
    objective: string;
    scanner: string;
    fuelReserve: {status: FuelReserveStatus; needed: number; margin: number};
    depthTarget: {name: string; kind: DepthMilestoneKind; remaining: number};
    stationHint: string;
    teleport: {count: number; usable: boolean};
    alerts: {fuel: boolean; hull: boolean; cargo: boolean};
    announcement: string;
  };
  view: {
    origin: {x: number; y: number};
    rows: string[];
    legend: Readonly<Record<string, string>>;
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
}

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

function resolveInputs(inputs: {kind: InventoryItemKind; count: number}[]): AgentRecipeInput[] {
  return inputs.map(input => ({kind: input.kind, count: input.count, label: itemForKind(input.kind).label}));
}

/** The one open overlay's mirror, or `null` when the mine is uncovered. */
function buildOverlay(state: GameState, ui: UiState): AgentOverlay | null {
  switch (ui.activeOverlay) {
    case 'station': {
      const stock = slotsToInventory(ui.stationSlots);
      return {
        kind: 'station',
        bay: toSlotsWithInfo(ui.inventorySlots),
        stock: toSlotsWithInfo(ui.stationSlots),
        recipes: RECIPES.map(recipe => {
          const craftable = canCraft(stock, recipe);
          return {
            output: recipe.output,
            label: itemForKind(recipe.output).label,
            inputs: resolveInputs(recipe.inputs),
            craftable,
            missing: craftable ? [] : resolveInputs(missingInputs(stock, recipe)),
            info: [...describeItem(recipe.output).lines, ...recipeInputLines(recipe, stock)]
          };
        })
      };
    }
    case 'extractor': {
      const {coal, fuel, progress} = ui.extractor;
      const refuelAmount = Math.round(Math.min(fuel, Math.max(0, ui.player.fuelMax - ui.player.fuel)));
      return {kind: 'extractor', coal, fuel, progress, refuelAmount};
    }
    case 'ship':
      return {
        kind: 'ship',
        slots: ui.shipEquipment.map(slot => ({
          index: slot.index,
          kind: slot.kind,
          label: slot.label,
          info: slot.kind ? describeItem(slot.kind).lines : []
        })),
        fittable: toSlotsWithInfo(ui.inventorySlots.filter(slot => isUpgradeKind(slot.kind)))
      };
    case 'container':
      return {kind: 'container', ship: toSlotsWithInfo(ui.inventorySlots), container: toSlotsWithInfo(ui.containerSlots)};
    case 'wreck':
      return {kind: 'wreck', ship: toSlotsWithInfo(ui.inventorySlots), wreck: toSlotsWithInfo(ui.wreckSlots)};
    case 'trade':
      return {
        kind: 'trade',
        cash: ui.hud.cash,
        // The sell side is the bay's ore, priced at the ore table's own value.
        sell: ui.inventorySlots
          .filter(slot => isOreKind(slot.kind))
          .map(slot => ({kind: slot.kind, label: slot.label, count: slot.count, price: sellPrice(slot.kind), info: describeItem(slot.kind).lines})),
        buy: ui.tradeBuy.map(offer => ({kind: offer.kind, label: offer.label, price: offer.price, stock: offer.stock, info: describeItem(offer.kind).lines}))
      };
    case 'portal': {
      const portal = ui.portal;
      if (!portal) return null;
      return {
        kind: 'portal',
        mode: portal.mode,
        source: portal.source,
        name: portal.source?.name,
        destinations: portal.destinations.map(destination => ({
          x: destination.x,
          y: destination.y,
          name: destination.name,
          depth: destination.depthMeters,
          distance: destination.distance
        }))
      };
    }
    case 'info':
      return {kind: 'info', tab: ui.infoTab};
    default:
      return null;
  }
}

export function buildObservation({state, ui, get, radius = DEFAULT_VIEW_RADIUS, toasts = []}: BuildObservationOptions): AgentObservation {
  const player = state.player;
  const radiusX = Math.max(1, Math.floor(radius));
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

  const rows: string[] = [];
  const notable: NotableTile[] = [];

  for (let y = originY; y < originY + radiusY * 2 + 1; y++) {
    let row = '';
    for (let x = originX; x < originX + radiusX * 2 + 1; x++) {
      if (x === player.x && y === player.y) {
        row += '@';
        continue;
      }
      if (!isTileExplored(state.exploredTiles, x, y)) {
        row += '?';
        continue;
      }
      const at = key(x, y);
      const enemy = enemyAt.get(at);
      if (enemy) {
        row += 'E';
        notable.push({x, y, what: 'enemy', detail: getEnemyType(enemy.kind).name});
        continue;
      }
      const stick = dynamiteAt.get(at);
      if (stick) {
        row += '*';
        notable.push({x, y, what: 'dynamite', detail: `${Math.ceil(stick.fuse / 60)}s`});
        continue;
      }
      const device = scannerAt.get(at);
      if (device) {
        row += 'S';
        notable.push({x, y, what: 'scanner', detail: isScannerDone(device, state.exploredTiles) ? 'spent' : 'active'});
        continue;
      }
      const container = containerAt.get(at);
      if (container) {
        row += 'C';
        notable.push({x, y, what: 'container', detail: totalItems(container.inventory) > 0 ? 'loaded' : 'empty'});
        continue;
      }
      const wreck = wreckAt.get(at);
      if (wreck) {
        row += 'W';
        const items = totalItems(wreck.inventory);
        notable.push({x, y, what: 'wreck', detail: `${items} item${items === 1 ? '' : 's'}`});
        continue;
      }
      const station = stationAt(state.stations, x, y);
      if (station?.kind === 'manufacturer') {
        row += 'M';
        notable.push({x, y, what: 'station', detail: 'Manufacturer'});
        continue;
      }
      if (station?.kind === 'extractor') {
        row += 'X';
        notable.push({x, y, what: 'station', detail: 'Oil Extractor'});
        continue;
      }
      if (station?.kind === 'portal') {
        row += 'P';
        notable.push({x, y, what: 'station', detail: `Portal "${station.name}"`});
        continue;
      }
      if (tradingPostAt(x, y)) {
        row += 'T';
        notable.push({x, y, what: 'tradingPost'});
        continue;
      }
      const tile = get(x, y);
      switch (tile.type) {
        case 'air':
          row += '.';
          break;
        case 'dirt':
          row += '#';
          break;
        case 'rock':
          row += 'R';
          break;
        case 'ore':
          row += 'o';
          notable.push({x, y, what: 'ore', detail: tile.ore.name});
          break;
        case 'hazard':
          row += '!';
          notable.push({x, y, what: 'hazard'});
          break;
        case 'decor':
          row += 'D';
          break;
        case 'enemy':
          row += 'E';
          notable.push({x, y, what: 'enemy', detail: getEnemyType(tile.kind).name});
          break;
      }
    }
    rows.push(row);
  }

  const hud = ui.hud;
  return {
    tick: state.tick,
    phase: ui.phase,
    activeOverlay: ui.activeOverlay,
    gameOver: state.gameOver,
    ship: {
      x: player.x,
      y: player.y,
      depthMeters: hud.depthMeters,
      // Ship vitals come from the live simulation, not the UI snapshot: `ui.player`
      // is only re-synced while an overlay is open (`syncUi` in `src/game/game.ts`),
      // so reading fuel/hull/etc. from it would freeze them during normal mining —
      // an agent would never see its fuel drop. `state.player` is the ground truth.
      fuel: player.fuel,
      fuelMax: player.fuelMax,
      hull: player.hull,
      hullMax: player.hullMax,
      cargo: hud.cargo,
      cargoMax: player.cargoMax,
      drill: player.drill,
      boost: player.boost,
      equipment: [...player.equipment],
      atSurface: hud.atSurface
    },
    cash: hud.cash,
    stats: {...state.stats},
    bay: toSlots(ui.inventorySlots),
    armedPlacement: ui.armedPlacement,
    hud: {
      cash: hud.cash,
      objective: hud.objective,
      scanner: hud.scanner,
      fuelReserve: {status: hud.fuelReserveStatus, needed: hud.fuelReserveNeeded, margin: hud.fuelReserveMargin},
      depthTarget: {name: hud.depthTarget, kind: hud.depthTargetKind, remaining: hud.depthTargetRemaining},
      stationHint: hud.stationHint,
      teleport: {count: hud.teleport.count, usable: hud.teleport.usable},
      alerts: {fuel: hud.fuelAlert, hull: hud.hullAlert, cargo: hud.cargoAlert},
      announcement: hud.announcement
    },
    view: {origin: {x: originX, y: originY}, rows, legend: VIEW_LEGEND},
    notable,
    overlay: buildOverlay(state, ui),
    toasts: [...toasts]
  };
}

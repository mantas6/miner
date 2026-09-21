import { MAX_WORLD_ROW, SHIP_UPGRADE_SLOTS, START_Y, WORLD_W } from '../shared/constants';
import {
  CARGO_CONTAINER,
  createPlacedContainer,
  type PlacedContainer
} from './core/cargo-container';
import { EXTRACTOR } from './core/balance';
import { DYNAMITE, type PlacedDynamite } from './core/dynamite';
import {
  addItem,
  createInventory,
  inventoryStacks,
  isOreKind,
  isUpgradeKind,
  type Inventory,
  type InventoryItem,
  type InventoryItemKind,
  type UpgradeKind
} from './core/inventory';
import { isCatalogKind, itemForKind } from './core/items';
import { SCANNER_DEVICE, type ScannerDevice } from './core/scanner-device';
import { applyEquipment } from './core/ship-upgrades';
import { createDefaultStats } from './core/state';
import { createHomeState, type HomeState } from './core/home';
import { encodeExploration, mergeExploration } from '../shared/exploration-codec';
import { capTileEntries, createTileDiff, parseTileEntries, tileDiffEntries } from './world/tile-diff';
import type { GameState, GameStats } from './core/types';

// Local save file for a solo miner: the wallet, the ship, the fog, and the mine
// itself.
//
// Terrain is not stored tile by tile — it regenerates from its seed — so the
// world is saved the way the relay saves the shared one: as the list of
// `shared/world-schema.ts` tile entries that differ from the generated terrain
// (see `src/world/tile-diff.ts`).
//
// Version 15 is a clean break. The underground-home rework changed too much for a
// migration to be honest — the four ship stats became derived from fitted
// equipment, the four consumable counters became one `bay` of stacks, and the home
// base gained persisted state — so every save written before it is discarded on
// load (see the version gate in `load`). A returning player from an older build
// simply starts fresh.
//
// The v15 shape:
//   * `x`/`y`     — the tile the ship parked on.
//   * `cash`      — the wallet.
//   * `tiles`     — the solo world's tile diff, in the relay world format.
//   * `explored`  — run-length-encoded explored tiles.
//   * `stats`     — the progress statistics.
//   * `bay`       — the non-ore stacks aboard (equipment, upgrades, decor), as
//     `{kind, count}`. Ore is deliberately not saved: it is lost with the run.
//   * `equipment` — the fitted ship upgrades, one entry per upgrade slot, each a
//     `upgrade:*` kind or `null`. The ship's `fuelMax`/`hullMax`/`cargoMax`/`drill`
//     are derived from these, not stored.
//   * `home`      — the home base: the manufacturing station's stock (`{kind,count}`
//     stacks, ore included) and the oil extractor's queued coal and stored fuel.
//   * `scannerDevices`/`dynamiteSticks`/`cargoContainers` — the hardware left
//     running in the mine, crates saved with their contents.

/** The persisted save file. Every field is re-validated on load. */
interface SavedProgress {
  version?: unknown;
  tiles?: unknown;
  x?: unknown;
  y?: unknown;
  cash?: unknown;
  bay?: unknown;
  equipment?: unknown;
  home?: unknown;
  dynamiteSticks?: unknown;
  scannerDevices?: unknown;
  cargoContainers?: unknown;
  explored?: unknown;
  stats?: Partial<Record<keyof GameStats, unknown>>;
}

export const SAVE_KEY = 'moleload-progress-v1';
export const SAVE_VERSION = 15;
/** A stored stack is a count, not a licence to write an unbounded number. */
const MAX_SAVED_STACK = 9999;

export function numeric(value: unknown, fallback: number, min=0, max=Number.MAX_SAFE_INTEGER): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * The tile a saved device sat on, or `null` when a corrupt or hand-edited save
 * put it somewhere the mine does not reach.
 */
function parsePlacedTile(entry: unknown): {x: number; y: number} | null {
  if (!entry || typeof entry !== 'object') return null;
  const saved = entry as {x?: unknown; y?: unknown};
  const x = Math.floor(numeric(saved.x, -1, -1, WORLD_W - 1));
  const y = Math.floor(numeric(saved.y, -1, -1, MAX_WORLD_ROW));
  if (x < 0 || y < 0) return null;
  return {x, y};
}

/**
 * Rebuild the deployed scanners. The count is capped the way the game caps it,
 * so a save can never restore more hardware than the player could have placed.
 */
export function parseScannerDevices(value: unknown): ScannerDevice[] {
  if (!Array.isArray(value)) return [];
  const devices: ScannerDevice[] = [];
  for (const entry of value) {
    if (devices.length >= SCANNER_DEVICE.maxPlaced) break;
    const tile = parsePlacedTile(entry);
    if (!tile) continue;
    const {timer} = entry as {timer?: unknown};
    devices.push({...tile, timer: Math.floor(numeric(timer, 0, 0, SCANNER_DEVICE.intervalTicks))});
  }
  return devices;
}

/**
 * Rebuild the burning sticks, fuses included: a charge planted before a reload
 * is still a charge, and finding one already lit is the point of planting it.
 * A fuse of zero would go off on the first step of the next run, so the clamp
 * starts at one step.
 */
export function parsePlacedDynamite(value: unknown): PlacedDynamite[] {
  if (!Array.isArray(value)) return [];
  const sticks: PlacedDynamite[] = [];
  for (const entry of value) {
    if (sticks.length >= DYNAMITE.maxPlaced) break;
    const tile = parsePlacedTile(entry);
    if (!tile) continue;
    const {fuse} = entry as {fuse?: unknown};
    sticks.push({...tile, fuse: Math.floor(numeric(fuse, DYNAMITE.fuseTicks, 1, DYNAMITE.fuseTicks))});
  }
  return sticks;
}

/**
 * One stack out of a saved container. Unlike a bay or station stack, this one
 * carries its own label, colour and price: an ore stack has to come back sellable,
 * and the ore table a future build ships may not agree with the one the stack was
 * mined from.
 */
function parseStoredStack(entry: unknown): {item: InventoryItem; count: number} | null {
  if (!entry || typeof entry !== 'object') return null;
  const saved = entry as {kind?: unknown; count?: unknown; label?: unknown; color?: unknown; value?: unknown};
  if (typeof saved.kind !== 'string' || saved.kind === '') return null;
  const count = Math.floor(numeric(saved.count, 0, 0, MAX_SAVED_STACK));
  if (count <= 0) return null;
  const kind = saved.kind as InventoryItemKind;
  return {
    item: {
      kind,
      label: typeof saved.label === 'string' && saved.label !== '' ? saved.label : kind,
      color: typeof saved.color === 'string' && saved.color !== '' ? saved.color : '#8c9aa8',
      value: numeric(saved.value, 0, 0)
    },
    count
  };
}

/**
 * Rebuild the crates and what is in them. Contents go back through `addItem`
 * rather than being written into slots directly, so a hand-edited save cannot
 * produce a container the game's own stacking rules could never have built.
 */
export function parseCargoContainers(value: unknown): PlacedContainer[] {
  if (!Array.isArray(value)) return [];
  const containers: PlacedContainer[] = [];
  for (const entry of value) {
    if (containers.length >= CARGO_CONTAINER.maxPlaced) break;
    const tile = parsePlacedTile(entry);
    if (!tile) continue;
    const container = createPlacedContainer(tile.x, tile.y);
    const {items} = entry as {items?: unknown};
    if (Array.isArray(items)) {
      for (const rawStack of items) {
        const stack = parseStoredStack(rawStack);
        if (!stack) continue;
        container.inventory = addItem(container.inventory, stack.item, stack.count) ?? container.inventory;
      }
    }
    containers.push(container);
  }
  return containers;
}

/**
 * Rebuild an inventory from `{kind, count}` stacks, resolving each kind's item
 * through the catalog (or the ore table) so its label, colour and price never have
 * to be stored. Any stack whose kind `allow` rejects — junk, or ore where only
 * equipment belongs — is dropped, and stacking obeys the game's own rules because
 * every unit goes back in through `addItem`.
 */
function parseKindCountStacks(value: unknown, allow: (kind: string) => boolean): Inventory {
  let inventory = createInventory();
  if (!Array.isArray(value)) return inventory;
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const {kind, count} = entry as {kind?: unknown; count?: unknown};
    if (typeof kind !== 'string' || !allow(kind)) continue;
    const n = Math.floor(numeric(count, 0, 0, MAX_SAVED_STACK));
    if (n <= 0) continue;
    inventory = addItem(inventory, itemForKind(kind as InventoryItemKind), n);
  }
  return inventory;
}

/** A saved kind belongs at the manufacturing station if it is ore or a real item. */
function isStationKind(kind: string): boolean {
  return kind.startsWith('ore:') || isCatalogKind(kind);
}

/** The fitted upgrades, one slot each, dropping anything that is not a real upgrade. */
function parseEquipment(value: unknown): (UpgradeKind | null)[] {
  const slots: (UpgradeKind | null)[] = Array.from({length: SHIP_UPGRADE_SLOTS}, () => null);
  if (!Array.isArray(value)) return slots;
  for (let i = 0; i < SHIP_UPGRADE_SLOTS && i < value.length; i++) {
    const kind = value[i];
    if (typeof kind === 'string' && isCatalogKind(kind) && isUpgradeKind(kind)) {
      slots[i] = kind;
    }
  }
  return slots;
}

/** The home base, rebuilt with only the station stock and extractor buffers a save may hold. */
function parseHome(value: unknown): HomeState {
  const home = createHomeState();
  if (!value || typeof value !== 'object') return home;
  const saved = value as {station?: unknown; extractor?: unknown};
  home.station.inventory = parseKindCountStacks(saved.station, isStationKind);
  if (saved.extractor && typeof saved.extractor === 'object') {
    const {coal, fuel, progress} = saved.extractor as {coal?: unknown; fuel?: unknown; progress?: unknown};
    home.extractor.coal = Math.floor(numeric(coal, 0, 0, MAX_SAVED_STACK));
    home.extractor.fuel = Math.floor(numeric(fuel, 0, 0, MAX_SAVED_STACK));
    // Progress is optional: a save written before it was tracked simply resumes at 0.
    home.extractor.progress = Math.floor(numeric(progress, 0, 0, EXTRACTOR.ticksPerCoal));
  }
  return home;
}

/** One crate, flattened: where it stands and one entry per stack inside it. */
function serializeContainer(container: PlacedContainer) {
  return {
    x: container.x,
    y: container.y,
    items: inventoryStacks(container.inventory).map(stack => ({
      kind: stack.kind,
      count: stack.count,
      label: stack.item.label,
      color: stack.item.color,
      value: stack.item.value
    }))
  };
}

/** A bay or station stack, flattened to just the kind and how many. */
function serializeStacks(inventory: Inventory): {kind: InventoryItemKind; count: number}[] {
  return inventoryStacks(inventory).map(stack => ({kind: stack.kind, count: stack.count}));
}

export function load(state: GameState): void {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const save: SavedProgress = JSON.parse(raw);
    // Version 15 is a clean break: anything older is discarded, so the state keeps
    // the pristine defaults `createInitialState` gave it.
    if (numeric(save.version, 0, 0) < SAVE_VERSION) return;
    const p = state.player;
    state.cash = numeric(save.cash, state.cash, 0);
    // The four ship stats are derived from fitted equipment, not stored: restore
    // the fitted slots, then `applyEquipment` recomputes `fuelMax`/`hullMax`/
    // `cargoMax`/`drill` and `boost` from them (done once the bay is back, since it
    // clamps fuel/hull to their derived maxima).
    p.equipment = parseEquipment(save.equipment);
    // The bay comes back one stack at a time; ore is never among it, so a fresh run
    // starts with only the equipment the last one carried.
    p.inventory = parseKindCountStacks(save.bay, isCatalogKind);
    applyEquipment(p);
    state.home = parseHome(save.home);
    state.scannerDevices = parseScannerDevices(save.scannerDevices);
    state.placedDynamite = parsePlacedDynamite(save.dynamiteSticks);
    state.cargoContainers = parseCargoContainers(save.cargoContainers);
    // The ship resumes on the tile it parked on, render position included so it
    // appears there instead of easing in from home. The clamps are the ones
    // `movementDestination` enforces, so no save can park a miner in a wall.
    const x = Math.floor(numeric(save.x, p.x, 1, WORLD_W - 2));
    const y = Math.floor(numeric(save.y, p.y, START_Y, MAX_WORLD_ROW));
    Object.assign(p, {x, y, drawX: x, drawY: y});
    mergeExploration(state.exploredTiles, typeof save.explored === 'string' ? save.explored : '');
    state.soloTileDiff = createTileDiff(parseTileEntries(save.tiles));
    const defaultStats = createDefaultStats();
    const savedStats = save.stats || {};
    state.stats = defaultStats;
    for (const key of Object.keys(defaultStats) as (keyof GameStats)[]) {
      state.stats[key] = numeric(savedStats[key], defaultStats[key], 0);
    }
  } catch (err) {
    console.warn('Could not load saved Stalinload progress:', err);
  }
}

export function save(state: GameState): void {
  const p = state.player;
  const progress = {
    version: SAVE_VERSION,
    cash: Math.floor(state.cash),
    x: p.x,
    y: p.y,
    // Ore is lost with the run, so only the non-ore stacks — equipment, upgrades,
    // decor — are written out of the bay.
    bay: serializeStacks(p.inventory).filter(stack => !isOreKind(stack.kind)),
    equipment: p.equipment.slice(0, SHIP_UPGRADE_SLOTS),
    home: {
      station: serializeStacks(state.home.station.inventory),
      extractor: {
        coal: Math.floor(state.home.extractor.coal),
        fuel: Math.floor(state.home.extractor.fuel),
        progress: Math.floor(state.home.extractor.progress)
      }
    },
    scannerDevices: state.scannerDevices.slice(0, SCANNER_DEVICE.maxPlaced).map(({x, y, timer}) => ({x, y, timer})),
    dynamiteSticks: state.placedDynamite.slice(0, DYNAMITE.maxPlaced).map(({x, y, fuse}) => ({x, y, fuse})),
    cargoContainers: state.cargoContainers.slice(0, CARGO_CONTAINER.maxPlaced).map(serializeContainer),
    explored: encodeExploration(state.exploredTiles),
    tiles: capTileEntries(tileDiffEntries(state.soloTileDiff)),
    stats: state.stats,
    savedAt: Date.now()
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(progress));
  } catch (err) {
    // The mine is the one part of the save that can grow without bound, and the
    // only part the world can regenerate. Losing a player's cash and equipment to
    // a full quota would be far worse, so drop the terrain and keep the rest.
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({...progress, tiles: []}));
      console.warn('Saved Stalinload progress without the dug terrain:', err);
    } catch (fallbackErr) {
      console.warn('Could not save Stalinload progress:', fallbackErr);
    }
  }
}

import { MAX_WORLD_ROW, START_Y, SURFACE_HEIGHT, WORLD_W } from '../shared/constants';
import { ECONOMY, LIMITS, STARTING } from './core/balance';
import {
  CARGO_CONTAINER,
  CARGO_CONTAINER_ITEM,
  createPlacedContainer,
  type PlacedContainer
} from './core/cargo-container';
import { DYNAMITE, DYNAMITE_ITEM, type PlacedDynamite } from './core/dynamite';
import { addItem, countItem, inventoryStacks, type InventoryItem, type InventoryItemKind } from './core/inventory';
import { SCANNER_DEVICE, SCANNER_ITEM, type ScannerDevice } from './core/scanner-device';
import { TELEPORTER_ITEM } from './core/teleporter';
import { createDefaultStats } from './core/state';
import { encodeExploration, mergeExploration } from '../shared/exploration-codec';
import { capTileEntries, createTileDiff, parseTileEntries, tileDiffEntries } from './world/tile-diff';
import type { GameState, GameStats } from './core/types';

// Local save file for a solo miner: the wallet, the ship, the fog, and the mine
// itself.
//
// Terrain is not stored tile by tile — it regenerates from its seed — so the
// world is saved the way the relay saves the shared one: as the list of
// `shared/world-schema.ts` tile entries that differ from the generated terrain
// (see `src/world/tile-diff.ts`). Version history:
//   * v1: cash, upgrades, inventory, stats.
//   * v2: rebalanced cargo capacity.
//   * v3: run-length encoded explored tiles.
//   * v4: `tiles`, the solo world's tile diff.
//   * v5: `x`/`y`, the tile the ship was parked on.
//   * v6: `scanners` and `scannerDevices` — the survey scanners carried, and the
//     ones left running in the mine.
//   * v7: `dynamiteSticks`, the charges still burning in the mine. `dynamite`
//     keeps its meaning — the number carried — but is now counted out of the
//     cargo bay rather than off the ship.
//   * v8: `guns`, the single-use Linebreakers in the bay. It replaces `gunOwned`
//     and `bullets`, which are ignored on load: there is no permanent fitting to
//     restore any more, and a magazine that no longer exists cannot be refunded.
//   * v9: `teleporters` keeps its meaning — the number carried — but is now
//     counted out of the cargo bay rather than off the ship, so an older save's
//     teleporters simply come back as a stack.
//   * v10: `containers` — the crates carried in the bay — and `cargoContainers`,
//     the ones standing in the mine *with their contents*, which is the one place
//     a save records individual stacks rather than a count.
//   * v11: cargo capacity became a total item count rather than a slot count, so
//     its base and per-level step both moved. `cargoMax` is no longer trusted
//     verbatim on load: the number of cargo-bay upgrades the save paid for is
//     recovered and rebuilt on the new scale, so older saves keep their levels.
//   * v12: the Sensor Array upgrade was removed. `visibility` is no longer stored;
//     the fog-reveal footprint is fixed at its base 3x3 for every ship. Older
//     saves that carried a `visibility` level simply drop it on load — no refund,
//     because the cash it cost was never tracked separately from the wallet.
//   * v13: oil patches and the placeable oil extractor were removed. Any
//     `extractors`/`oilExtractors` a save from that build carried are ignored on
//     load, and an `oil` tile in the world diff is dropped with the rest of that
//     diff by the shared schema — no crash, just a pristine mine.
//   * v14: the Linebreaker gun was removed. Any `guns` a save from that build
//     carried — along with the pre-v8 `gunOwned`/`bullets` a much older save
//     might still hold — are ignored on load: there is no weapon to restore and
//     nothing to refund. No crash, just a bay without a gun in it.
// Older blobs still load; they just restore a pristine mine, and pre-v5 saves
// start at the depot the way they always did.
//
// The cargo bay itself is deliberately *not* saved: ore is lost with the run.
// Scanners, dynamite, teleporters and containers are equipment rather than
// cargo, so they are stored as counts and re-stacked into the bay on load. Ore
// inside a placed container is the exception, and deliberately so: it is not
// aboard, so it is not lost with the run either.

/** The persisted save file. Every field is re-validated on load. */
interface SavedProgress {
  version?: unknown;
  tiles?: unknown;
  x?: unknown;
  y?: unknown;
  cash?: unknown;
  fuelMax?: unknown;
  hullMax?: unknown;
  cargoMax?: unknown;
  drill?: unknown;
  dynamite?: unknown;
  dynamiteSticks?: unknown;
  teleporters?: unknown;
  scanners?: unknown;
  scannerDevices?: unknown;
  containers?: unknown;
  cargoContainers?: unknown;
  explored?: unknown;
  stats?: Partial<Record<keyof GameStats, unknown>>;
}

export const SAVE_KEY = 'moleload-progress-v1';
export const SAVE_VERSION = 14;
/** A stored stack is a count, not a licence to write an unbounded number. */
const MAX_SAVED_STACK = 9999;
/** Cargo-bay upgrade maths as older saves stored it, so a save keeps its levels. */
const LEGACY_CARGO_START = 10;      // starting capacity before the item-count rebalance
const LEGACY_CARGO_STEP = 10;       // per-level step in v1 saves
const V2_CARGO_STEP = 5;            // per-level step in v2..v10 saves
const CARGO_BALANCE_SAVE_VERSION = 2;   // v1 → v2: cargo step 10 → 5
const CARGO_REBALANCE_SAVE_VERSION = 11; // v10 → v11: slots → total item count

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
  if (x < 0 || y < SURFACE_HEIGHT) return null;
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
 * One stack out of a saved container. Unlike every other item the save records,
 * this one carries its own label, colour and price: an ore stack has to come back
 * sellable, and the ore table a future build ships may not agree with the one the
 * stack was mined from.
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

export function load(state: GameState): void {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const save: SavedProgress = JSON.parse(raw);
    const p = state.player;
    state.cash = numeric(save.cash, state.cash, 0);
    p.fuelMax = numeric(save.fuelMax, p.fuelMax, LIMITS.fuelMax.min, LIMITS.fuelMax.max);
    p.hullMax = numeric(save.hullMax, p.hullMax, LIMITS.hullMax.min, LIMITS.hullMax.max);
    // Cargo capacity is a total item count now, and its base and step both moved
    // in the rebalance. Rather than trust the stored number, recover how many
    // cargo-bay upgrades the save paid for — using the base/step that save's
    // version used — and rebuild the capacity on today's scale, so a returning
    // player keeps every level they bought.
    const version = numeric(save.version, 1, 1);
    // A save with no `cargoMax` at all cannot say how many upgrades were bought,
    // so it starts at the base rather than being run through the migration — which
    // would otherwise read the stand-in default as if it were a stored capacity
    // and inflate it a level or two.
    if (Number.isFinite(Number(save.cargoMax))) {
      const rawCargoMax = numeric(save.cargoMax, STARTING.cargoMax, 0, LIMITS.cargoMax.max);
      const cargoLevel = version < CARGO_REBALANCE_SAVE_VERSION
        ? Math.max(0, Math.round((rawCargoMax - LEGACY_CARGO_START) / (version < CARGO_BALANCE_SAVE_VERSION ? LEGACY_CARGO_STEP : V2_CARGO_STEP)))
        : Math.max(0, Math.round((rawCargoMax - STARTING.cargoMax) / ECONOMY.cargo.step));
      p.cargoMax = Math.max(LIMITS.cargoMax.min, Math.min(LIMITS.cargoMax.max, STARTING.cargoMax + cargoLevel * ECONOMY.cargo.step));
    }
    p.drill = numeric(save.drill, p.drill, LIMITS.drill.min, LIMITS.drill.max);
    // The Sensor Array upgrade is gone: any stored `visibility` is ignored and the
    // reveal footprint stays fixed at its base for every ship.
    // Equipment comes back into the bay the run starts with; `run.resume()` clears
    // the ore around it and leaves it alone.
    const scanners = Math.floor(numeric(save.scanners, 0, LIMITS.scanners.min, LIMITS.scanners.max));
    if (scanners > 0) p.inventory = addItem(p.inventory, SCANNER_ITEM, scanners) ?? p.inventory;
    const dynamite = Math.floor(numeric(save.dynamite, 0, LIMITS.dynamite.min, LIMITS.dynamite.max));
    if (dynamite > 0) p.inventory = addItem(p.inventory, DYNAMITE_ITEM, dynamite) ?? p.inventory;
    const teleporters = Math.floor(numeric(save.teleporters, 0, LIMITS.teleporters.min, LIMITS.teleporters.max));
    if (teleporters > 0) p.inventory = addItem(p.inventory, TELEPORTER_ITEM, teleporters) ?? p.inventory;
    const containers = Math.floor(numeric(save.containers, 0, LIMITS.containers.min, LIMITS.containers.max));
    if (containers > 0) p.inventory = addItem(p.inventory, CARGO_CONTAINER_ITEM, containers) ?? p.inventory;
    state.scannerDevices = parseScannerDevices(save.scannerDevices);
    state.placedDynamite = parsePlacedDynamite(save.dynamiteSticks);
    state.cargoContainers = parseCargoContainers(save.cargoContainers);
    // The ship resumes on the tile it parked on, render position included so it
    // appears there instead of easing in from the depot. The clamps are the ones
    // `movementDestination` enforces, so no save can park a miner in a wall.
    const x = Math.floor(numeric(save.x, p.x, 1, WORLD_W - 2));
    const y = Math.floor(numeric(save.y, p.y, START_Y, MAX_WORLD_ROW));
    Object.assign(p, {x, y, drawX: x, drawY: y});
    mergeExploration(state.exploredTiles, typeof save.explored === 'string' ? save.explored : '');
    // Saves written before version 4 carry no terrain, so they simply restore an
    // untouched mine. `run.resume()` lays these entries back over it.
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
    fuelMax: p.fuelMax,
    hullMax: p.hullMax,
    cargoMax: p.cargoMax,
    drill: p.drill,
    dynamite: countItem(p.inventory, DYNAMITE_ITEM.kind),
    teleporters: countItem(p.inventory, TELEPORTER_ITEM.kind),
    scanners: countItem(p.inventory, SCANNER_ITEM.kind),
    scannerDevices: state.scannerDevices.slice(0, SCANNER_DEVICE.maxPlaced).map(({x, y, timer}) => ({x, y, timer})),
    dynamiteSticks: state.placedDynamite.slice(0, DYNAMITE.maxPlaced).map(({x, y, fuse}) => ({x, y, fuse})),
    containers: countItem(p.inventory, CARGO_CONTAINER_ITEM.kind),
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
    // only part the world can regenerate. Losing a player's cash and upgrades to
    // a full quota would be far worse, so drop the terrain and keep the rest.
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({...progress, tiles: []}));
      console.warn('Saved Stalinload progress without the dug terrain:', err);
    } catch (fallbackErr) {
      console.warn('Could not save Stalinload progress:', fallbackErr);
    }
  }
}

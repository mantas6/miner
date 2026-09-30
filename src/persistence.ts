import { MAX_SAVED_TILE_ENTRIES, MAX_WORLD_ROW, ORES, START_Y, WORLD_W } from '../shared/constants';
import { tileKey } from '../shared/tile-key';
import type { TileEntry } from '../shared/world-schema';
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
  roomLeft,
  type Inventory,
  type InventoryItemKind,
  type UpgradeKind
} from './core/inventory';
import { isCatalogKind, itemForKind } from './core/items';
import { SCANNER_DEVICE, type ScannerDevice } from './core/scanner-device';
import { WRECK, createWreck, type Wreck } from './core/wreck';
import { chestKey, ledgerStacks } from './core/chest';
import { chestAt } from './world/world';
import { applyEquipment, isSlotLocked } from './core/ship-upgrades';
import { STARTER_SHIP, isShipId, slotsFor, type ShipId } from './core/ships';
import { createDefaultStats } from './core/state';
import { BEST_MARK_MAX } from './core/stats';
import {
  STATION_CAPACITY,
  STATION_DEVICE,
  createExtractor,
  createManufacturer,
  createPortal,
  portals,
  type PlacedStation
} from './core/stations';
import { defaultPortalName, sanitizePortalName } from './core/portal';
import { encodeExploration, mergeExploration } from '../shared/exploration-codec';
import { capTileEntries, createTileDiff, parseTileEntries, tileDiffEntries, type TileDiff } from './world/tile-diff';
import type { ChestLedger, GameState, GameStats } from './core/types';

// The local save file: the wallet, the ship, the fog, and the mine itself.
//
// Terrain is not stored tile by tile — it regenerates from its seed — so the
// world is saved as the list of `shared/world-schema.ts` tile entries that
// differ from the generated terrain (see `src/world/tile-diff.ts`).
//
// Breaking changes always deprecate the save rather than migrating it: when the
// on-disk shape changes incompatibly, bump `SAVE_VERSION`, and the version gate in
// `load` discards any save whose version is not exactly this build's — older or
// newer — so a returning player starts fresh (see AGENTS.md). There is
// deliberately no migration path.
//
// `load` parses the whole file into a staging object before it touches the
// state, so a save that throws halfway through leaves the pristine defaults
// rather than a half-restored run.
//
// The current shape's fields:
//   * `x`/`y`     — the tile the ship parked on.
//   * `fuel`/`hull` — the ship's current vitals, clamped on load to the maxima the
//     fitted equipment derives. Either at 0 is a save taken while dead, which
//     `run.resume` settles as that death (see `game/run.ts`).
//   * `cash`      — the wallet.
//   * `tiles`     — the world's tile diff, as `{x, y, tile}` entries.
//   * `explored`  — run-length-encoded explored tiles.
//   * `stats`     — the progress statistics.
//   * `bay`       — the non-ore stacks aboard (equipment, upgrades, decor), as
//     `{kind, count}`. Ore is deliberately not saved: it is lost with the run.
//   * `ship`      — the hull on the ship ladder (`core/ships.ts`), e.g. `scout`. An
//     id this build does not know discards the whole save; a hand-written file
//     without one loads the Scout.
//   * `equipment` — the fitted ship upgrades, one entry per slot of that hull, each
//     a `upgrade:*` kind or `null`. The ship's `fuelMax`/`hullMax`/`cargoMax`/`drill`
//     are derived from the hull's base and these, not stored.
//   * `stations`  — the stations standing in the mine: each manufacturer with its
//     own `{kind,count}` stock (ore included), each extractor with its queued coal,
//     stored fuel, and tick progress, each portal with its name. One of each is
//     seeded on the home-cavern floor.
//   * `scannerDevices`/`dynamiteSticks`/`cargoContainers`/`wrecks` — the hardware
//     and corpse loot left standing in the mine, crates and wrecks saved with their
//     contents as `{kind, count}` stacks (prices and labels come from the ore table
//     and the catalog on load, never from the file). An emptied wreck is not saved;
//     each wreck also carries `deathsLeft`, the deaths it outlasts before crumbling.
//   * `tradeLedger` — the drawn-down buy stock per trading post, keyed `"x,y"`.
//   * `chestLedger` — what is left in each opened chest, keyed `"x,y"`, as
//     `{kind, count}` stacks; `[]` is a chest looted bare. Optional: a save without
//     it loads with every chest still full.

/** The persisted save file. Every field is re-validated on load. */
interface SavedProgress {
  version?: unknown;
  tiles?: unknown;
  x?: unknown;
  y?: unknown;
  fuel?: unknown;
  hull?: unknown;
  cash?: unknown;
  bay?: unknown;
  ship?: unknown;
  equipment?: unknown;
  stations?: unknown;
  dynamiteSticks?: unknown;
  scannerDevices?: unknown;
  cargoContainers?: unknown;
  wrecks?: unknown;
  tradeLedger?: unknown;
  chestLedger?: unknown;
  explored?: unknown;
  stats?: Partial<Record<keyof GameStats, unknown>>;
}

export const SAVE_KEY = 'stalinload:progress:v1';
export const SAVE_VERSION = 22;
/** The file name an exported save downloads as. */
export const SAVE_EXPORT_FILENAME = 'stalinload-save.json';
/** A stored stack is a count, not a licence to write an unbounded number. */
const MAX_SAVED_STACK = 9999;

export function numeric(value: unknown, fallback: number, min=0, max=Number.MAX_SAFE_INTEGER): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * The per-ore mined tally: whole, non-negative counts keyed by an ore this build
 * knows. Anything else — a missing field, a stray key, a junk count — is dropped.
 */
function parseOresMined(value: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return counts;
  const saved = value as Record<string, unknown>;
  for (const ore of ORES) {
    const count = Math.floor(numeric(saved[ore.name], 0, 0));
    if (count > 0) counts[ore.name] = count;
  }
  return counts;
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
 * Rebuild the crates and what is in them. Contents go back through
 * `parseKindCountStacks`, so a hand-edited save cannot produce a container the
 * game's own stacking rules — or its capacity — could never have built.
 */
export function parseCargoContainers(value: unknown): PlacedContainer[] {
  if (!Array.isArray(value)) return [];
  const containers: PlacedContainer[] = [];
  for (const entry of value) {
    if (containers.length >= CARGO_CONTAINER.maxPlaced) break;
    const tile = parsePlacedTile(entry);
    if (!tile) continue;
    const container = createPlacedContainer(tile.x, tile.y);
    container.inventory = parseKindCountStacks((entry as {items?: unknown}).items, isSavedItemKind, CARGO_CONTAINER.capacity);
    containers.push(container);
  }
  return containers;
}

/**
 * Rebuild the wrecks and what they still hold. Like the crates, contents are
 * clamped to what a wreck could ever hold, and the count is capped the way the
 * game caps it so a save can never restore more than could have been dropped. A
 * wreck with nothing left in it is dropped: the game retires one the moment it
 * is emptied, so an empty one in a save is junk.
 */
export function parseWrecks(value: unknown): Wreck[] {
  if (!Array.isArray(value)) return [];
  const wrecks: Wreck[] = [];
  for (const entry of value) {
    if (wrecks.length >= WRECK.maxPlaced) break;
    const tile = parsePlacedTile(entry);
    if (!tile) continue;
    const {items, deathsLeft} = entry as {items?: unknown; deathsLeft?: unknown};
    // Every wreck this version writes carries its lifetime; one without it is
    // junk, and one past the range is clamped into what the game could produce.
    const lifetime = Math.floor(numeric(deathsLeft, 0, 0, WRECK.lifetimeDeaths));
    if (lifetime <= 0) continue;
    const inventory = parseKindCountStacks(items, isSavedItemKind, WRECK.capacity);
    if (inventory.length === 0) continue;
    wrecks.push(createWreck(tile.x, tile.y, inventory, lifetime));
  }
  return wrecks;
}

/**
 * Rebuild an inventory from `{kind, count}` stacks, resolving each kind's item
 * through the catalog (or the ore table) so its label, colour and price never have
 * to be stored. Any stack whose kind `allow` rejects — junk, or ore where only
 * equipment belongs — is dropped, stacking obeys the game's own rules because
 * every unit goes back in through `addItem`, and nothing past `capacity` total
 * items is restored.
 */
function parseKindCountStacks(value: unknown, allow: (kind: string) => boolean, capacity = Infinity): Inventory {
  let inventory = createInventory();
  if (!Array.isArray(value)) return inventory;
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const {kind, count} = entry as {kind?: unknown; count?: unknown};
    if (typeof kind !== 'string' || !allow(kind)) continue;
    const n = Math.min(Math.floor(numeric(count, 0, 0, MAX_SAVED_STACK)), roomLeft(inventory, capacity));
    if (n <= 0) continue;
    inventory = addItem(inventory, itemForKind(kind as InventoryItemKind), n);
  }
  return inventory;
}

/**
 * Whether a saved kind names something real: an item in the catalog, or an ore
 * in this build's ore table. An ore the table does not know would come back as a
 * worthless grey stack, so it is dropped with the rest of the junk.
 */
function isSavedItemKind(kind: string): boolean {
  if (isCatalogKind(kind)) return true;
  if (!isOreKind(kind as InventoryItemKind)) return false;
  const name = kind.slice('ore:'.length);
  return ORES.some(ore => ore.name === name);
}

/**
 * The fitted upgrades, one slot each, dropping anything that is not a real
 * upgrade. The game always writes `slotsFor(ship)` entries; a shorter hand-edited
 * array is padded with empty slots rather than refused, a longer one trimmed to
 * the hull, and a slot the career has not unlocked yet (`isSlotLocked`) comes back
 * empty: the game never fits one, so only a hand-edited save could.
 */
function parseEquipment(value: unknown, ship: ShipId, bestMarkCrafted: number): (UpgradeKind | null)[] {
  const count = slotsFor(ship);
  const slots: (UpgradeKind | null)[] = Array.from({length: count}, () => null);
  if (!Array.isArray(value)) return slots;
  for (let i = 0; i < count && i < value.length; i++) {
    const kind = value[i];
    if (isSlotLocked(i, count, bestMarkCrafted)) continue;
    if (typeof kind === 'string' && isCatalogKind(kind) && isUpgradeKind(kind)) {
      slots[i] = kind;
    }
  }
  return slots;
}

/**
 * Rebuild the stations standing in the mine. Each kind is capped the way the game
 * caps it, so a save can never restore more stations than the player could have
 * placed; a manufacturer's stock and an extractor's buffers come back clamped.
 */
function parseStations(value: unknown): PlacedStation[] {
  if (!Array.isArray(value)) return [];
  const stations: PlacedStation[] = [];
  const counts: Record<'manufacturer' | 'extractor' | 'portal', number> = {
    manufacturer: 0,
    extractor: 0,
    portal: 0
  };
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const kind = (entry as {kind?: unknown}).kind;
    if (kind !== 'manufacturer' && kind !== 'extractor' && kind !== 'portal') continue;
    if (counts[kind] >= STATION_DEVICE[kind].maxPlaced) continue;
    const tile = parsePlacedTile(entry);
    if (!tile) continue;
    if (kind === 'manufacturer') {
      const station = createManufacturer(tile.x, tile.y);
      station.inventory = parseKindCountStacks((entry as {items?: unknown}).items, isSavedItemKind, STATION_CAPACITY);
      stations.push(station);
    } else if (kind === 'extractor') {
      const station = createExtractor(tile.x, tile.y);
      const {coal, fuel, progress} = entry as {coal?: unknown; fuel?: unknown; progress?: unknown};
      // The hopper holds what a manufacturer's stock does, and the tank its cap.
      station.coal = Math.floor(numeric(coal, 0, 0, STATION_CAPACITY));
      station.fuel = Math.floor(numeric(fuel, 0, 0, EXTRACTOR.fuelCap));
      // A missing or corrupt progress value clamps to 0 rather than throwing.
      station.progress = Math.floor(numeric(progress, 0, 0, EXTRACTOR.ticksPerCoal));
      stations.push(station);
    } else {
      // A blank or hand-edited name falls back to a deterministic unused preset,
      // picked over the portals parsed so far so a nameless save is never left blank.
      const {name} = entry as {name?: unknown};
      const fallback = defaultPortalName(portals(stations), () => 0);
      const sanitized = sanitizePortalName(typeof name === 'string' ? name : '', fallback);
      stations.push(createPortal(tile.x, tile.y, sanitized));
    }
    counts[kind]++;
  }
  return stations;
}

/**
 * Rebuild the trading-post ledger: the remaining buy stock per offer, keyed by the
 * post's `"x,y"` coordinate. A hand-edited key that is not a coordinate pair, or a
 * value that is not an array of counts, is dropped; every count is floored and
 * clamped, so a corrupt save can never restore negative or unbounded stock.
 */
function parseTradeLedger(value: unknown): Record<string, number[]> {
  const ledger: Record<string, number[]> = {};
  if (!value || typeof value !== 'object') return ledger;
  for (const [key, stocks] of Object.entries(value as Record<string, unknown>)) {
    if (!/^-?\d+,-?\d+$/.test(key) || !Array.isArray(stocks)) continue;
    ledger[key] = stocks.map(count => Math.floor(numeric(count, 0, 0, MAX_SAVED_STACK)));
  }
  return ledger;
}

/**
 * Rebuild the opened-chest ledger. Only a key naming a real generated chest is
 * kept, and its stacks go back through the catalog and `addItem`, so junk kinds
 * drop, duplicate kinds merge and every count is clamped — a hand-edited save can
 * never conjure a chest the mine does not hold, or loot it could never have held.
 * An empty list is kept verbatim: it is a chest looted bare.
 */
export function parseChestLedger(value: unknown): ChestLedger {
  const ledger: ChestLedger = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ledger;
  for (const [key, stacks] of Object.entries(value as Record<string, unknown>)) {
    const match = /^(\d+),(\d+)$/.exec(key);
    if (!match || !Array.isArray(stacks)) continue;
    const x = Number(match[1]), y = Number(match[2]);
    if (!chestAt(x, y)) continue;
    ledger[chestKey(x, y)] = ledgerStacks(parseKindCountStacks(stacks, isSavedItemKind));
  }
  return ledger;
}

/** One station, flattened: where it stands and either its stock or its buffers. */
function serializeStation(station: PlacedStation): Record<string, unknown> {
  if (station.kind === 'manufacturer') {
    return {kind: 'manufacturer', x: station.x, y: station.y, items: serializeStacks(station.inventory)};
  }
  if (station.kind === 'extractor') {
    return {
      kind: 'extractor',
      x: station.x,
      y: station.y,
      coal: Math.floor(station.coal),
      fuel: Math.floor(station.fuel),
      progress: Math.floor(station.progress)
    };
  }
  return {kind: 'portal', x: station.x, y: station.y, name: station.name};
}

/** One placed inventory (a crate or a wreck), flattened: where it stands and its stacks. */
function serializePlacedInventory(entity: {x: number; y: number; inventory: Inventory}) {
  return {x: entity.x, y: entity.y, items: serializeStacks(entity.inventory)};
}

/** A wreck: its tile and stacks, plus the deaths it has left before it crumbles. */
function serializeWreck(wreck: Wreck) {
  return {...serializePlacedInventory(wreck), deathsLeft: Math.floor(wreck.deathsLeft)};
}

/** A bay or station stack, flattened to just the kind and how many. */
function serializeStacks(inventory: Inventory): {kind: InventoryItemKind; count: number}[] {
  return inventoryStacks(inventory).map(stack => ({kind: stack.kind, count: stack.count}));
}

/**
 * Everything a save restores, parsed and validated but not yet applied. `load`
 * builds one of these in full before it writes a single field of the state.
 */
interface StagedProgress {
  cash: number;
  ship: ShipId;
  equipment: (UpgradeKind | null)[];
  bay: Inventory;
  /** `undefined` keeps the seeded stations: the save recorded none. */
  stations: PlacedStation[] | undefined;
  scannerDevices: ScannerDevice[];
  placedDynamite: PlacedDynamite[];
  cargoContainers: PlacedContainer[];
  wrecks: Wreck[];
  tradeLedger: Record<string, number[]>;
  chestLedger: ChestLedger;
  x: number;
  y: number;
  /** Unbounded above until `applyEquipment` clamps it to the restored `fuelMax`. */
  fuel: number;
  /** Likewise, until clamped to the restored `hullMax`. */
  hull: number;
  explored: Set<number>;
  tileDiff: TileDiff;
  stats: GameStats;
}

/**
 * Parse a raw save into a staged restore, or `null` when there is nothing this
 * build should load: no save, not an object, any version but exactly
 * `SAVE_VERSION`, or a hull this build does not know. Reads `state` only for
 * fallbacks and never writes it; may throw
 * on a pathological file, which `load` turns into a fresh start.
 */
function parseProgress(raw: string | null, state: GameState): StagedProgress | null {
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const save = parsed as SavedProgress;
  // Deprecation gate: any save not written by exactly this version — older, or
  // from a newer build that may not mean what this one thinks — is discarded,
  // never migrated, so the state keeps the pristine defaults it was created with.
  if (save.version !== SAVE_VERSION) return null;
  // The hull decides the slot count and every base stat, so a hull this build has
  // never heard of cannot be loaded in part: the whole save goes. Only a
  // hand-written file leaves it out, and that one flies the Scout.
  const ship = save.ship === undefined ? STARTER_SHIP : save.ship;
  if (!isShipId(ship)) return null;
  const p = state.player;
  const explored = new Set<number>();
  mergeExploration(explored, typeof save.explored === 'string' ? save.explored : '');
  const defaultStats = createDefaultStats();
  const savedStats = save.stats && typeof save.stats === 'object' ? save.stats : {};
  const stats = createDefaultStats();
  // Read by key with defaults, so a counter added since the save was written
  // (`scannersObtained`, `bestMarkCrafted`, `oresMined`) loads as zero without a
  // version bump.
  for (const key of Object.keys(defaultStats) as (keyof GameStats)[]) {
    if (key !== 'oresMined') stats[key] = numeric(savedStats[key], defaultStats[key], 0);
  }
  stats.bestMarkCrafted = Math.min(BEST_MARK_MAX, Math.floor(stats.bestMarkCrafted));
  stats.oresMined = parseOresMined(savedStats.oresMined);
  return {
    cash: numeric(save.cash, state.cash, 0),
    ship,
    equipment: parseEquipment(save.equipment, ship, stats.bestMarkCrafted),
    // The bay comes back one stack at a time; ore is never among it, so a fresh run
    // starts with only the equipment the last one carried.
    bay: parseKindCountStacks(save.bay, isCatalogKind),
    // Absent leaves the seeded stations `createInitialState` set up; a present
    // (even empty) array is a save that recorded the mine's stations verbatim.
    stations: save.stations !== undefined ? parseStations(save.stations) : undefined,
    scannerDevices: parseScannerDevices(save.scannerDevices),
    placedDynamite: parsePlacedDynamite(save.dynamiteSticks),
    cargoContainers: parseCargoContainers(save.cargoContainers),
    wrecks: parseWrecks(save.wrecks),
    tradeLedger: parseTradeLedger(save.tradeLedger),
    chestLedger: parseChestLedger(save.chestLedger),
    // The clamps are the ones `movementDestination` enforces, so no save can park
    // a miner outside the walls; `run.resume` sends one parked in rock home.
    x: Math.floor(numeric(save.x, p.x, 1, WORLD_W - 2)),
    y: Math.floor(numeric(save.y, p.y, START_Y, MAX_WORLD_ROW)),
    // Clamped at zero here and to the restored maxima by `applyEquipment` in
    // `load`. A file without them (only a hand-written one) loads with a full
    // tank and hull, as a fresh ship would.
    fuel: numeric(save.fuel, Infinity, 0, Infinity),
    hull: numeric(save.hull, Infinity, 0, Infinity),
    explored,
    tileDiff: createTileDiff(parseTileEntries(save.tiles)),
    stats
  };
}

export function load(state: GameState): void {
  let staged: StagedProgress | null;
  try {
    staged = parseProgress(localStorage.getItem(SAVE_KEY), state);
  } catch (err) {
    console.warn('Could not load saved Stalinload progress:', err);
    return;
  }
  if (!staged) return;
  // Everything parsed: apply it in one go.
  const p = state.player;
  state.cash = staged.cash;
  // The four ship stats are derived from the hull and its fitted equipment, not
  // stored: restore the hull, the fitted slots and the bay, then `applyEquipment` recomputes `fuelMax`/
  // `hullMax`/`cargoMax`/`drill` and `boost` from them. The saved fuel and hull
  // go in first so its clamp bounds them by the restored maxima — the fit-time
  // delta `equip` carries over is never re-applied, so a reload grants nothing.
  p.ship = staged.ship;
  p.equipment = staged.equipment;
  p.inventory = staged.bay;
  p.fuel = staged.fuel;
  p.hull = staged.hull;
  applyEquipment(p);
  if (staged.stations) state.stations = staged.stations;
  state.scannerDevices = staged.scannerDevices;
  state.placedDynamite = staged.placedDynamite;
  state.cargoContainers = staged.cargoContainers;
  state.wrecks = staged.wrecks;
  state.tradeLedger = staged.tradeLedger;
  state.chestLedger = staged.chestLedger;
  // The ship resumes on the tile it parked on, render position included so it
  // appears there instead of easing in from home.
  Object.assign(p, {x: staged.x, y: staged.y, drawX: staged.x, drawY: staged.y});
  for (const index of staged.explored) state.exploredTiles.add(index);
  state.tileDiff = staged.tileDiff;
  state.stats = staged.stats;
}

/**
 * The saved tile budget. It starts at `MAX_SAVED_TILE_ENTRIES` and halves each
 * time storage refuses a save for size, and it stays halved for the rest of the
 * session: a quota that refused one save will refuse the next one the same size,
 * and retrying the full diff every few seconds would just fail again.
 */
let savedTileCap = MAX_SAVED_TILE_ENTRIES;

/** The current saved tile budget (see `savedTileCap`). */
export function savedTileBudget(): number {
  return savedTileCap;
}

/** Restore the full tile budget — a fresh session's; for tests. */
export function resetSavedTileBudget(): void {
  savedTileCap = MAX_SAVED_TILE_ENTRIES;
}

/**
 * The tile diff as it is written, capped to `cap` entries. Tiles something the
 * player owns stands on — a station, a crate, a wreck — and placed decorations
 * are never the ones dropped: losing those would bury the thing back in rock.
 */
function savedTiles(state: GameState, cap: number): TileEntry[] {
  const standing = new Set<string>();
  for (const thing of [...state.stations, ...state.cargoContainers, ...state.wrecks]) standing.add(tileKey(thing.x, thing.y));
  return capTileEntries(
    tileDiffEntries(state.tileDiff),
    cap,
    entry => entry.tile.type === 'decor' || standing.has(tileKey(entry.x, entry.y))
  );
}

/**
 * What Settings tells a player about to export a save or reload into an imported
 * one while ore is aboard: the save leaves ore out of the bay (below), by design,
 * so only what is stowed survives.
 */
export const ORE_NOT_SAVED_NOTE = 'Ore aboard is not saved — stow it first.';

/**
 * The save file for this state, as the object `save` writes and `load` reads
 * back. Also what an export hands the player, so a downloaded save and the one in
 * `localStorage` are the same thing.
 */
export function serializeProgress(state: GameState): SavedProgress & {version: number; savedAt: number} {
  const p = state.player;
  return {
    version: SAVE_VERSION,
    cash: Math.floor(state.cash),
    x: p.x,
    y: p.y,
    // The vitals ride along, so a reload or an import is never a free refill. A
    // save written at game over holds an empty tank or hull; `run.resume` settles it.
    fuel: Math.max(0, p.fuel),
    hull: Math.max(0, p.hull),
    // Ore is lost with the run, so only the non-ore stacks — equipment, upgrades,
    // decor — are written out of the bay.
    bay: serializeStacks(p.inventory).filter(stack => !isOreKind(stack.kind)),
    ship: p.ship,
    equipment: p.equipment.slice(0, slotsFor(p.ship)),
    stations: state.stations.map(serializeStation),
    scannerDevices: state.scannerDevices.slice(0, SCANNER_DEVICE.maxPlaced).map(({x, y, timer}) => ({x, y, timer})),
    dynamiteSticks: state.placedDynamite.slice(0, DYNAMITE.maxPlaced).map(({x, y, fuse}) => ({x, y, fuse})),
    cargoContainers: state.cargoContainers.slice(0, CARGO_CONTAINER.maxPlaced).map(serializePlacedInventory),
    // An emptied wreck is retired on the spot, so one here would only be junk.
    wrecks: state.wrecks.filter(wreck => wreck.inventory.length > 0).slice(0, WRECK.maxPlaced).map(serializeWreck),
    tradeLedger: state.tradeLedger,
    chestLedger: state.chestLedger,
    explored: encodeExploration(state.exploredTiles),
    tiles: savedTiles(state, savedTileCap),
    stats: state.stats,
    savedAt: Date.now()
  };
}

/** The outcome of checking a pasted or chosen save before it replaces the run. */
export type ImportedSave = {ok: true; json: string} | {ok: false; reason: string};

/**
 * Check a save a player brings back — pasted, or read from a file — before it
 * replaces the one on disk. Only the envelope is checked here: it must be JSON,
 * an object, and exactly this build's `SAVE_VERSION`. Every field inside is
 * re-validated by `load` on the reload that follows, as for any save.
 *
 * The version check is stricter than `load`'s gate on purpose. An older save
 * would be silently discarded on boot, and a newer one written by a later build
 * may not mean what this one thinks — either way the player would lose the run
 * they are standing in for nothing, so both are refused up front.
 */
export function parseImportedSave(text: string): ImportedSave {
  if (text.trim() === '') return {ok: false, reason: 'Paste a save or choose a save file first.'};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {ok: false, reason: 'That is not a save file: it is not valid JSON.'};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {ok: false, reason: 'That is not a save file: it is not a JSON object.'};
  }
  const {version} = parsed as {version?: unknown};
  if (version !== SAVE_VERSION) {
    const found = typeof version === 'number' ? `version ${version}` : 'no version';
    return {ok: false, reason: `That save has ${found}; this build only reads save version ${SAVE_VERSION}.`};
  }
  return {ok: true, json: JSON.stringify(parsed)};
}

/**
 * Drop the saved run, ahead of writing a wiped one over it: should storage then
 * refuse that write, a reload still finds nothing rather than the old progress.
 */
export function discardSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Storage may be unavailable; the save that follows still gets its chance.
  }
}

export function save(state: GameState): void {
  const progress = serializeProgress(state);
  for (;;) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(progress));
      return;
    } catch (err) {
      // The mine is the one part of the save that can grow without bound, and the
      // only part the world can regenerate. Losing a player's cash and equipment to
      // a full quota would be far worse, so the tile budget halves — oldest tunnels
      // first — and the save retries. With no budget left the last attempt drops
      // the terrain outright; only if even that is refused is the save abandoned.
      const tiles = progress.tiles as TileEntry[];
      if (savedTileCap === 0 && tiles.length === 0) {
        console.warn('Could not save Stalinload progress:', err);
        return;
      }
      if (savedTileCap > 0) {
        savedTileCap = Math.floor(savedTileCap / 2);
        progress.tiles = savedTiles(state, savedTileCap);
      } else {
        progress.tiles = [];
      }
      console.warn(`Storage refused the save; retrying with at most ${savedTileCap} dug tiles:`, err);
    }
  }
}

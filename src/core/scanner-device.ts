// The deployable survey scanner: the depot's third consumable.
//
// Not to be confused with `scanner.ts`, which is the HUD readout for the tile the
// drill is pointed at. This is a physical device: bought at the depot, carried in
// the cargo bay, dropped onto a tile of the mine, and left behind to map the fog
// around itself while the ship goes elsewhere.
//
// Everything here is pure and DOM-free. A device is three numbers — where it
// sits and how long since it last reported — because the interesting part of its
// state is not stored at all: what is left to map is *derived* from the shared
// explored set every time it is asked. That is what keeps a device honest in
// co-op, where a partner's own footprint can clear tiles it was still working on;
// storing a private to-do list would leave it counting down to reveals that had
// already happened.

import { MAX_WORLD_ROW, WORLD_W } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';
import type { InventoryItem } from './inventory';
import { placementRefusal, type PlacementCopy } from './placement';

export const SCANNER_DEVICE = Object.freeze({
  /** Side of the square it maps, centred on the device. */
  size: 7,
  /** Seconds between reveals, as the shop and the toasts word it. */
  intervalSeconds: 3.75,
  /** The same wait in fixed 60 Hz simulation steps. */
  intervalTicks: 3.75 * 60,
  /**
   * Devices that may be deployed at once. A soft cap: it exists so a save can
   * never grow without bound, and so a stack of scanners cannot be emptied into
   * the mine faster than the player can keep track of them.
   */
  maxPlaced: 12
});

/** The stackable item the depot sells and the cargo bay carries. */
export const SCANNER_ITEM: InventoryItem = {
  kind: 'scanner',
  label: 'Scanner',
  color: '#6fe3ff',
  // Depot equipment is not cargo, so the sell-everything button never prices it.
  value: 0
};

/** One deployed device. `timer` counts simulation steps since its last reveal. */
export interface ScannerDevice {
  x: number;
  y: number;
  timer: number;
}

export function createScannerDevice(x: number, y: number): ScannerDevice {
  return {x, y, timer: 0};
}

/**
 * Row-major exploration indexes of the tiles this device covers, clamped to the
 * world. Rows above the world top are skipped so a device parked near the top is
 * not left permanently "unfinished" by tiles it can never claim.
 */
export function scannerFootprint(device: ScannerDevice): number[] {
  const reach = Math.floor(SCANNER_DEVICE.size / 2);
  const indexes: number[] = [];
  for (let y = device.y - reach; y <= device.y + reach; y++) {
    if (y < 0 || y > MAX_WORLD_ROW) continue;
    for (let x = device.x - reach; x <= device.x + reach; x++) {
      if (x < 0 || x >= WORLD_W) continue;
      indexes.push(explorationIndex(x, y));
    }
  }
  return indexes;
}

/** The footprint tiles still under fog, in the order the footprint lists them. */
export function scannerPendingTiles(device: ScannerDevice, explored: ReadonlySet<number>): number[] {
  return scannerFootprint(device).filter(index => !explored.has(index));
}

/** Nothing left to map: the device has finished and is inert from here on. */
export function isScannerDone(device: ScannerDevice, explored: ReadonlySet<number>): boolean {
  return scannerFootprint(device).every(index => explored.has(index));
}

/** How much of the square is mapped, for the shop copy and the HUD toasts. */
export function scannerProgress(device: ScannerDevice, explored: ReadonlySet<number>): {mapped: number; total: number} {
  const footprint = scannerFootprint(device);
  return {mapped: footprint.filter(index => explored.has(index)).length, total: footprint.length};
}

/**
 * How far the device has charged toward its next reveal, as a fraction in
 * `[0, 1)`: `0` on the step just after a reveal, approaching `1` as the wait
 * runs out. Derived purely from the timer so the canvas can draw a progress arc
 * for the tile currently being surveyed without the renderer knowing the tick
 * budget. The value never reaches `1` — the step that would hit it is the reveal
 * itself, which resets the timer to `0`.
 */
export function scannerTileProgress(device: ScannerDevice): number {
  const fraction = device.timer / SCANNER_DEVICE.intervalTicks;
  return fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
}

/**
 * One fixed 60 Hz step. Returns the tile index to reveal, or `null` on every
 * step in between — including the firing step of a device that has nothing left
 * to map, which simply reports nothing for the rest of its life.
 *
 * The pick is drawn from the *pending* tiles rather than the whole square, so a
 * device never spends an interval revealing something already visible, and the
 * caller can inject `random` to make the choice deterministic in tests.
 *
 * Mutates `device.timer`: this runs for every deployed device on every step, and
 * the alternative is a fresh object 60 times a second per device.
 */
export function tickScannerDevice(
  device: ScannerDevice,
  explored: ReadonlySet<number>,
  random: () => number = Math.random
): number | null {
  if (++device.timer < SCANNER_DEVICE.intervalTicks) return null;
  device.timer = 0;
  const pending = scannerPendingTiles(device, explored);
  if (pending.length === 0) return null;
  const pick = Math.floor(random() * pending.length);
  return pending[Math.min(pending.length - 1, Math.max(0, pick))];
}

export interface ScannerPlacementContext {
  explored: ReadonlySet<number>;
  /** Whether the target tile is open space the device can be dropped into. */
  open: boolean;
  devices: readonly ScannerDevice[];
}

/** How a scanner words each of the shared placement refusals. */
const SCANNER_PLACEMENT_COPY: PlacementCopy = {
  full: `Only ${SCANNER_DEVICE.maxPlaced} scanners can be deployed at once.`,
  offMine: 'Scanners deploy underground, inside the mine.',
  unexplored: 'Deploy the scanner on a tile you have already explored.',
  blocked: 'Deploy the scanner in cleared space, not inside terrain.',
  occupied: 'A scanner is already deployed on that tile.'
};

/** Why this tile cannot take a device, or `null` when it can. */
export function scannerPlacementRefusal(x: number, y: number, context: ScannerPlacementContext): string | null {
  return placementRefusal(x, y, {
    explored: context.explored,
    open: context.open,
    occupied: context.devices.some(device => device.x === x && device.y === y),
    full: context.devices.length >= SCANNER_DEVICE.maxPlaced
  }, SCANNER_PLACEMENT_COPY);
}

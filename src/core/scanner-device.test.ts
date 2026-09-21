import { describe, expect, it } from 'vitest';
import { MAX_WORLD_ROW, SURFACE_HEIGHT, WORLD_W } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';
import {
  SCANNER_DEVICE,
  SCANNER_ITEM,
  createScannerDevice,
  isScannerDone,
  scannerFootprint,
  scannerPendingTiles,
  scannerPlacementRefusal,
  scannerProgress,
  scannerTileProgress,
  tickScannerDevice
} from './scanner-device';

/** Step a device until it reports a tile, or through one whole silent interval. */
function runToReveal(device: Parameters<typeof tickScannerDevice>[0], explored: Set<number>, random = () => 0): number | null {
  for (let step = 0; step < SCANNER_DEVICE.intervalTicks; step++) {
    const revealed = tickScannerDevice(device, explored, random);
    if (revealed !== null) return revealed;
  }
  return null;
}

describe('scanner footprint', () => {
  it('covers the square it is centred on', () => {
    const footprint = scannerFootprint(createScannerDevice(40, 100));

    expect(footprint).toHaveLength(SCANNER_DEVICE.size * SCANNER_DEVICE.size);
    expect(footprint).toContain(explorationIndex(37, 97));
    expect(footprint).toContain(explorationIndex(43, 103));
    expect(footprint).not.toContain(explorationIndex(44, 100));
  });

  it('clips at the side walls and at the top of the mine', () => {
    // A device on the wall keeps its own column plus the reach that falls inside.
    const clipped = (Math.floor(SCANNER_DEVICE.size / 2) + 1) * SCANNER_DEVICE.size;
    expect(scannerFootprint(createScannerDevice(0, 200))).toHaveLength(clipped);
    expect(scannerFootprint(createScannerDevice(WORLD_W - 1, 200))).toHaveLength(clipped);
    // Surface rows are visible by definition, so a device parked just below them
    // is not left permanently unfinished by tiles it can never claim.
    const shallow = scannerFootprint(createScannerDevice(40, SURFACE_HEIGHT));
    expect(shallow).toHaveLength(clipped);
    expect(shallow.every(index => Math.floor(index / WORLD_W) >= SURFACE_HEIGHT)).toBe(true);
  });
});

describe('scanner surveying', () => {
  it('reveals one fogged tile per interval and never the same one twice', () => {
    const device = createScannerDevice(40, 100);
    const explored = new Set<number>();

    // Nothing at all happens in between: the wait is the whole cost.
    expect(tickScannerDevice(device, explored)).toBeNull();
    expect(device.timer).toBe(1);

    const first = runToReveal(device, explored);
    expect(first).toBe(scannerFootprint(device)[0]);
    expect(device.timer).toBe(0);
    explored.add(first!);

    const second = runToReveal(device, explored);
    expect(second).not.toBe(first);
    expect(scannerFootprint(device)).toContain(second);
  });

  it('picks from the fogged tiles only, wherever the roll lands', () => {
    const device = createScannerDevice(40, 100);
    const explored = new Set(scannerFootprint(device).slice(0, 48));

    const revealed = runToReveal(device, explored, () => 0.999999);

    expect(revealed).toBe(scannerPendingTiles(device, explored)[0]);
  });

  it('goes quiet once the whole square is mapped', () => {
    const device = createScannerDevice(40, 100);
    const explored = new Set(scannerFootprint(device));

    expect(isScannerDone(device, explored)).toBe(true);
    expect(scannerProgress(device, explored)).toEqual({mapped: 49, total: 49});
    expect(runToReveal(device, explored)).toBeNull();
  });

  it('counts a partner clearing the fog first as work it no longer has to do', () => {
    const device = createScannerDevice(40, 100);
    const explored = new Set<number>();

    expect(scannerProgress(device, explored).mapped).toBe(0);
    // The peer's own footprint lands on most of the square.
    for (const index of scannerFootprint(device).slice(0, 40)) explored.add(index);

    expect(scannerProgress(device, explored)).toEqual({mapped: 40, total: 49});
    expect(isScannerDone(device, explored)).toBe(false);
    expect(scannerPendingTiles(device, explored)).toHaveLength(9);
  });

  it('waits the advertised interval of simulation time', () => {
    expect(SCANNER_DEVICE.intervalTicks).toBe(SCANNER_DEVICE.intervalSeconds * 60);
  });

  it('charges from nothing toward — but never up to — a full tile', () => {
    const device = createScannerDevice(40, 100);
    const explored = new Set<number>();

    // Freshly placed: nothing charged yet.
    expect(scannerTileProgress(device)).toBe(0);

    // One step in, the arc has moved off zero but is nowhere near full.
    tickScannerDevice(device, explored);
    expect(scannerTileProgress(device)).toBeCloseTo(1 / SCANNER_DEVICE.intervalTicks);
    expect(scannerTileProgress(device)).toBeGreaterThan(0);

    // The last silent step sits just under a whole tile.
    device.timer = SCANNER_DEVICE.intervalTicks - 1;
    const almost = scannerTileProgress(device);
    expect(almost).toBeLessThan(1);
    expect(almost).toBeGreaterThan(0.9);

    // The reveal step resets the timer, so the arc snaps back to empty.
    runToReveal(device, explored);
    expect(scannerTileProgress(device)).toBe(0);
  });
});

describe('scanner placement rules', () => {
  const context = (overrides: Partial<Parameters<typeof scannerPlacementRefusal>[2]> = {}) => ({
    explored: new Set([explorationIndex(40, 100)]),
    open: true,
    devices: [],
    ...overrides
  });

  it('accepts an explored, cleared tile in the mine', () => {
    expect(scannerPlacementRefusal(40, 100, context())).toBeNull();
  });

  it.each([
    ['above the mine', 40, SURFACE_HEIGHT - 1, {}, 'underground'],
    ['past the side wall', WORLD_W, 100, {}, 'underground'],
    ['below the deepest row', 40, MAX_WORLD_ROW + 1, {}, 'underground'],
    ['still under fog', 41, 100, {}, 'already explored'],
    ['inside terrain', 40, 100, {open: false}, 'cleared space'],
    ['already taken', 40, 100, {devices: [createScannerDevice(40, 100)]}, 'already deployed']
  ])('refuses a tile %s', (_name, x, y, overrides, reason) => {
    expect(scannerPlacementRefusal(x, y, context(overrides))).toContain(reason);
  });

  it('stops at the deployment cap, whatever the tile', () => {
    const devices = Array.from({length: SCANNER_DEVICE.maxPlaced}, (_, index) => createScannerDevice(index, 500));

    expect(scannerPlacementRefusal(40, 100, context({devices}))).toContain(`${SCANNER_DEVICE.maxPlaced} scanners`);
  });
});

describe('the carried item', () => {
  it('is a bay item with no sale value, so selling cargo leaves it aboard', () => {
    expect(SCANNER_ITEM).toMatchObject({kind: 'scanner', label: 'Scanner', value: 0});
  });
});

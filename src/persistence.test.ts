import { afterEach, describe, it, expect, vi } from 'vitest';
import { SAVE_KEY, SAVE_VERSION, load, numeric, save } from './persistence';
import { SURFACE_SPAWN_X, createInitialState } from './core/state';
import { ECONOMY, LIMITS } from './core/balance';
import { cargoCost } from './core/economy';
import { CARGO_CONTAINER, CARGO_CONTAINER_ITEM, createPlacedContainer } from './core/cargo-container';
import { DYNAMITE, DYNAMITE_ITEM, createPlacedDynamite } from './core/dynamite';
import { addItem, countItem, countOres, oreItem } from './core/inventory';
import { SCANNER_DEVICE, SCANNER_ITEM, createScannerDevice } from './core/scanner-device';
import { TELEPORTER_ITEM } from './core/teleporter';
import { claimArtifact } from './core/artifacts';
import { ARTIFACTS, MAX_SAVED_TILE_ENTRIES, START_Y } from '../shared/constants';
import { explorationIndex } from '../shared/exploration-codec';
import type { TileEntry } from '../shared/world-schema';
import { createTileDiff, tileDiffEntries } from './world/tile-diff';

afterEach(() => vi.unstubAllGlobals());

/** One ore with a full price/colour record, for the stacks a crate has to keep. */
const GOLD = {name: 'Gold', color: '#ffd65c', value: 70, min: 152, max: 602, chance: 0.04};

/** Stub localStorage with an in-memory store, optionally pre-seeded with a save. */
function stubStorage(existingSave?: unknown): Map<string, string> {
  const stored = new Map<string, string>();
  if (existingSave !== undefined) stored.set(SAVE_KEY, JSON.stringify(existingSave));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value)
  });
  return stored;
}

describe('numeric clamp', () => {
  it.each([
    ['passes through a finite value within range', 50, 0, 0, 100, 50],
    ['clamps a value below min to min', -5, 0, 10, 100, 10],
    ['clamps a value above max to max', 150, 0, 0, 100, 100],
    ['returns the fallback for non-finite input', NaN, 7, undefined, undefined, 7],
    ['coerces a numeric string', '5', 0, undefined, undefined, 5],
    ['returns the fallback for a non-numeric string', 'abc', 42, undefined, undefined, 42],
    ['applies a default min of 0', -3, 99, undefined, undefined, 0]
  ])('%s', (_name, value, fallback, min, max, expected) => {
    expect(min === undefined ? numeric(value, fallback) : numeric(value, fallback, min, max)).toBe(expected);
  });
});

describe('Motherlode extraction save compatibility', () => {
  it('gives legacy saves a zero completed-extraction counter', () => {
    stubStorage({ version: SAVE_VERSION, stats: { motherlodeClaims: 1 } });
    const state = createInitialState();

    load(state);

    expect(state.stats).toMatchObject({ motherlodeClaims: 1, motherlodeExtractions: 0 });
  });
});

describe('artifact payout persistence', () => {
  it('round-trips immediately banked cash and artifact count without cargo', () => {
    stubStorage();
    const state = createInitialState();
    claimArtifact(state, ARTIFACTS[0]);
    save(state);

    const restored = createInitialState();
    load(restored);
    expect(restored.cash).toBe(240);
    expect(restored.stats.artifactsFound).toBe(1);
    expect(restored.stats.totalCashEarned).toBe(180);
    expect(countOres(restored.player.inventory)).toBe(0);
  });
});

describe('cargo balance persistence', () => {
  it.each([
    [10, 20, 120],
    [20, 30, 159],
    [30, 40, 210],
    [40, 50, 276]
  ])('maps legacy capacity %i to rebalanced capacity %i at the same price level', (legacyCapacity, capacity, nextCost) => {
    stubStorage({ version: 1, cargoMax: legacyCapacity });
    const state = createInitialState();

    load(state);

    expect(state.player.cargoMax).toBe(capacity);
    expect(cargoCost(state.player)).toBe(nextCost);
  });

  it('round-trips rebalanced cargo capacity without migrating it again', () => {
    const stored = stubStorage();
    const state = createInitialState();
    state.player.cargoMax += ECONOMY.cargo.step * 2;
    save(state);

    const restored = createInitialState();
    load(restored);

    expect(restored.player.cargoMax).toBe(40);
    expect(JSON.parse(stored.get(SAVE_KEY) || '{}')).toMatchObject({
      version: SAVE_VERSION,
      cargoMax: 40
    });
  });
});

describe('teleporter persistence', () => {
  it('round-trips the carried teleporters as a count and re-stacks them into the bay', () => {
    const stored = stubStorage();
    const state = createInitialState();
    state.player.inventory = addItem(state.player.inventory, TELEPORTER_ITEM, 2)!;
    save(state);

    const restored = createInitialState();
    load(restored);

    expect(countItem(restored.player.inventory, TELEPORTER_ITEM.kind)).toBe(2);
    expect(JSON.parse(stored.get(SAVE_KEY) || '{}')).toMatchObject({teleporters: 2});
  });

  it('re-stacks a pre-v9 save\'s ship-borne teleporters into the bay', () => {
    // `teleporters` never changed meaning — it is still the number carried — so a
    // save written while they were counted on the ship simply arrives as a stack.
    stubStorage({ cash: 90, teleporters: 3 });
    const state = createInitialState();

    load(state);

    expect(countItem(state.player.inventory, TELEPORTER_ITEM.kind)).toBe(3);
  });

  it('gives a legacy save without the field no teleporters', () => {
    stubStorage({ cash: 90 });
    const state = createInitialState();

    load(state);

    expect(countItem(state.player.inventory, TELEPORTER_ITEM.kind)).toBe(0);
  });
});

describe('removed Linebreaker fields', () => {
  it('loads a save that still carries gun fields without restoring a weapon', () => {
    // The Linebreaker is gone: `guns` (the single-use item), and the pre-v8
    // `gunOwned`/`bullets` a much older save might still hold, are all ignored on
    // load — no weapon to restore, and nothing to crash on.
    stubStorage({ cash: 90, guns: 3, gunOwned: true, bullets: 17 });
    const state = createInitialState();

    load(state);

    expect(state.cash).toBe(90);
    // The bay comes back with nothing the removed feature would have added.
    expect(state.player.inventory).toHaveLength(0);
  });
});

describe('scanner persistence', () => {
  it('round-trips carried scanners into the cargo bay and the devices left running', () => {
    const stored = stubStorage();
    const state = createInitialState();
    state.player.inventory = addItem(state.player.inventory, SCANNER_ITEM, 2)!;
    state.scannerDevices = [createScannerDevice(12, 640), {x: 44, y: 700, timer: 123}];

    save(state);

    expect(JSON.parse(stored.get(SAVE_KEY) || '{}')).toMatchObject({
      version: SAVE_VERSION,
      scanners: 2,
      scannerDevices: [{x: 12, y: 640, timer: 0}, {x: 44, y: 700, timer: 123}]
    });

    const restored = createInitialState();
    load(restored);
    expect(countItem(restored.player.inventory, SCANNER_ITEM.kind)).toBe(2);
    expect(restored.scannerDevices).toEqual(state.scannerDevices);
  });

  it('gives a save written before scanners existed neither one', () => {
    stubStorage({version: 5, cash: 90});
    const state = createInitialState();

    load(state);

    expect(countItem(state.player.inventory, SCANNER_ITEM.kind)).toBe(0);
    expect(state.scannerDevices).toEqual([]);
  });

  it.each([
    ['a device outside the side walls', [{x: -3, y: 400}]],
    ['a device above the mine', [{x: 10, y: 0}]],
    ['a nonsense device', [{x: 'deep', y: null}]],
    ['something that is not a device at all', ['scanner']],
    ['a device list that is not a list', 'scanner']
  ])('drops %s on load', (_name, scannerDevices) => {
    stubStorage({version: SAVE_VERSION, scannerDevices});
    const state = createInitialState();

    load(state);

    expect(state.scannerDevices).toEqual([]);
  });

  it('clamps a hand-edited save to what the game could have deployed and carried', () => {
    stubStorage({
      version: SAVE_VERSION,
      scanners: 10_000,
      scannerDevices: Array.from({length: SCANNER_DEVICE.maxPlaced + 5}, (_, index) => ({x: index, y: 400, timer: 999_999}))
    });
    const state = createInitialState();

    load(state);

    expect(countItem(state.player.inventory, SCANNER_ITEM.kind)).toBe(LIMITS.scanners.max);
    expect(state.scannerDevices).toHaveLength(SCANNER_DEVICE.maxPlaced);
    expect(state.scannerDevices.every(device => device.timer === SCANNER_DEVICE.intervalTicks)).toBe(true);
  });
});

describe('dynamite persistence', () => {
  it('round-trips carried sticks into the cargo bay and the fuses still burning', () => {
    const stored = stubStorage();
    const state = createInitialState();
    state.player.inventory = addItem(state.player.inventory, DYNAMITE_ITEM, 3)!;
    state.placedDynamite = [createPlacedDynamite(12, 640), {x: 44, y: 700, fuse: 42}];

    save(state);

    expect(JSON.parse(stored.get(SAVE_KEY) || '{}')).toMatchObject({
      version: SAVE_VERSION,
      dynamite: 3,
      dynamiteSticks: [{x: 12, y: 640, fuse: DYNAMITE.fuseTicks}, {x: 44, y: 700, fuse: 42}]
    });

    const restored = createInitialState();
    load(restored);
    expect(countItem(restored.player.inventory, DYNAMITE_ITEM.kind)).toBe(3);
    expect(restored.placedDynamite).toEqual(state.placedDynamite);
  });

  it('re-stacks the count a pre-inventory save kept on the ship', () => {
    stubStorage({version: 6, dynamite: 2});
    const state = createInitialState();

    load(state);

    expect(countItem(state.player.inventory, DYNAMITE_ITEM.kind)).toBe(2);
    expect(state.placedDynamite).toEqual([]);
  });

  it.each([
    ['a stick outside the side walls', [{x: -3, y: 400}]],
    ['a stick above the mine', [{x: 10, y: 0}]],
    ['a nonsense stick', [{x: 'deep', y: null}]],
    ['something that is not a stick at all', ['boom']],
    ['a stick list that is not a list', 'boom']
  ])('drops %s on load', (_name, dynamiteSticks) => {
    stubStorage({version: SAVE_VERSION, dynamiteSticks});
    const state = createInitialState();

    load(state);

    expect(state.placedDynamite).toEqual([]);
  });

  it('clamps a hand-edited save to what the game could have planted and carried', () => {
    stubStorage({
      version: SAVE_VERSION,
      dynamite: 10_000,
      dynamiteSticks: Array.from({length: DYNAMITE.maxPlaced + 5}, (_, index) => ({x: index, y: 400, fuse: 0}))
    });
    const state = createInitialState();

    load(state);

    expect(countItem(state.player.inventory, DYNAMITE_ITEM.kind)).toBe(LIMITS.dynamite.max);
    expect(state.placedDynamite).toHaveLength(DYNAMITE.maxPlaced);
    // A zero fuse would go off on the first step of the resumed run.
    expect(state.placedDynamite.every(stick => stick.fuse === 1)).toBe(true);
  });
});

describe('cargo container persistence', () => {
  it('round-trips carried crates into the bay and the placed ones with their contents', () => {
    const stored = stubStorage();
    const state = createInitialState();
    state.player.inventory = addItem(state.player.inventory, CARGO_CONTAINER_ITEM, 2)!;
    const crate = createPlacedContainer(12, 640);
    crate.inventory = addItem(addItem(crate.inventory, oreItem(GOLD), 4)!, DYNAMITE_ITEM, 3)!;
    state.cargoContainers = [crate, createPlacedContainer(44, 700)];

    save(state);

    expect(JSON.parse(stored.get(SAVE_KEY) || '{}')).toMatchObject({
      version: SAVE_VERSION,
      containers: 2,
      cargoContainers: [
        {x: 12, y: 640, items: [
          {kind: 'ore:Gold', count: 4, label: 'Gold', color: GOLD.color, value: GOLD.value},
          {kind: 'dynamite', count: 3, label: 'Dynamite', color: DYNAMITE_ITEM.color, value: 0}
        ]},
        {x: 44, y: 700, items: []}
      ]
    });

    const restored = createInitialState();
    load(restored);
    expect(countItem(restored.player.inventory, CARGO_CONTAINER_ITEM.kind)).toBe(2);
    expect(restored.cargoContainers).toEqual(state.cargoContainers);
  });

  /**
   * Ore in the bay is lost with the run; ore in a crate is not aboard at all, so
   * it comes back exactly as it was left — which is the whole point of the crate.
   */
  it('keeps stored ore across a reload that empties the bay', () => {
    stubStorage();
    const state = createInitialState();
    const crate = createPlacedContainer(12, 640);
    crate.inventory = addItem(crate.inventory, oreItem(GOLD), 7)!;
    state.cargoContainers = [crate];
    state.player.inventory = addItem(state.player.inventory, oreItem(GOLD), 5)!;

    save(state);

    const restored = createInitialState();
    load(restored);
    expect(countOres(restored.player.inventory)).toBe(0);
    expect(countOres(restored.cargoContainers[0].inventory)).toBe(7);
    expect(restored.cargoContainers[0].inventory[0]?.item).toEqual(oreItem(GOLD));
  });

  it('gives a save written before containers existed neither one', () => {
    stubStorage({version: 9, cash: 90});
    const state = createInitialState();

    load(state);

    expect(countItem(state.player.inventory, CARGO_CONTAINER_ITEM.kind)).toBe(0);
    expect(state.cargoContainers).toEqual([]);
  });

  it.each([
    ['a crate outside the side walls', [{x: -3, y: 400}]],
    ['a crate above the mine', [{x: 10, y: 0}]],
    ['a nonsense crate', [{x: 'deep', y: null}]],
    ['something that is not a crate at all', ['crate']],
    ['a crate list that is not a list', 'crate']
  ])('drops %s on load', (_name, cargoContainers) => {
    stubStorage({version: SAVE_VERSION, cargoContainers});
    const state = createInitialState();

    load(state);

    expect(state.cargoContainers).toEqual([]);
  });

  it('clamps a hand-edited save to what the game could have placed and carried', () => {
    stubStorage({
      version: SAVE_VERSION,
      containers: 10_000,
      cargoContainers: Array.from({length: CARGO_CONTAINER.maxPlaced + 4}, (_, index) => ({x: index, y: 400}))
    });
    const state = createInitialState();

    load(state);

    expect(countItem(state.player.inventory, CARGO_CONTAINER_ITEM.kind)).toBe(LIMITS.containers.max);
    expect(state.cargoContainers).toHaveLength(CARGO_CONTAINER.maxPlaced);
  });

  it('drops junk stacks but keeps the sound ones beside them', () => {
    stubStorage({
      version: SAVE_VERSION,
      cargoContainers: [{
        x: 12, y: 640,
        items: [
          {kind: '', count: 4},
          {kind: 'dynamite', count: 0},
          {kind: 'ore:Gold', count: '2', label: 'Gold', color: GOLD.color, value: GOLD.value},
          'not a stack',
          // No label or colour: it still comes back, named after its own kind.
          {kind: 'scanner', count: 1}
        ]
      }]
    });
    const state = createInitialState();

    load(state);

    const crate = state.cargoContainers[0].inventory;
    expect(countOres(crate)).toBe(2);
    expect(countItem(crate, 'scanner')).toBe(1);
    expect(countItem(crate, 'dynamite')).toBe(0);
    expect(crate.filter(slot => slot !== null)).toHaveLength(2);
  });
});

describe('ship position persistence', () => {
  it('round-trips the tile the ship parked on, render position included', () => {
    const stored = stubStorage();
    const state = createInitialState();
    Object.assign(state.player, {x: 12, y: 640, drawX: 12, drawY: 640});

    save(state);

    expect(JSON.parse(stored.get(SAVE_KEY) || '{}')).toMatchObject({version: SAVE_VERSION, x: 12, y: 640});

    const restored = createInitialState();
    load(restored);
    expect(restored.player).toMatchObject({x: 12, y: 640, drawX: 12, drawY: 640});
  });

  it('leaves a save written before positions were kept at the depot', () => {
    stubStorage({ version: 4, cash: 90 });
    const state = createInitialState();

    load(state);

    expect(state.player).toMatchObject({x: SURFACE_SPAWN_X, y: START_Y});
  });

  it.each([
    ['a position outside the side walls', {x: -40, y: 30}, {x: 1, y: 30}],
    ['a position above the surface airspace', {x: 12, y: -9}, {x: 12, y: START_Y}],
    ['a fractional position', {x: 12.7, y: 30.7}, {x: 12, y: 30}],
    ['a nonsense position', {x: 'deep', y: null}, {x: SURFACE_SPAWN_X, y: START_Y}]
  ])('refuses to park a ship at %s', (_name, saved, expected) => {
    stubStorage({ version: SAVE_VERSION, ...saved });
    const state = createInitialState();

    load(state);

    expect(state.player).toMatchObject(expected);
  });
});

describe('fog exploration persistence', () => {
  it('round-trips compact explored ranges', () => {
    const stored = stubStorage();
    const state = createInitialState();
    state.exploredTiles.add(explorationIndex(10, 10));
    state.exploredTiles.add(explorationIndex(11, 10));
    save(state);

    const serialized = JSON.parse(stored.get(SAVE_KEY) || '{}');
    expect(serialized).toMatchObject({version: SAVE_VERSION, explored: '910-911'});

    const restored = createInitialState();
    load(restored);
    expect(restored.exploredTiles).toEqual(state.exploredTiles);
  });

  it('drops a legacy sensor level and no explored coordinates from older saves', () => {
    stubStorage({ version: 2, cargoMax: 20, cash: 90, visibility: 6 });
    const state = createInitialState();
    load(state);

    expect(state.cash).toBe(90);
    // A v2 save's cargoMax of 20 was two upgrades on the old scale, rebuilt to 40.
    expect(state.player.cargoMax).toBe(40);
    // The Sensor Array upgrade is gone, so a stored level does not resurrect a field.
    expect('visibility' in state.player).toBe(false);
    expect(state.exploredTiles.size).toBe(0);
  });
});

describe('solo terrain persistence', () => {
  const dug: TileEntry = { x: 44, y: 61, tile: { type: 'air' } };
  const cracked: TileEntry = { x: 45, y: 61, tile: { type: 'dirt', hp: 1, maxHp: 4 } };
  const mined: TileEntry = {
    x: 46, y: 61,
    tile: { type: 'ore', ore: { name: 'Gold', color: '#ffd65c', value: 70, min: 152, max: 602, chance: 0.04 }, hp: 2, maxHp: 5 }
  };

  it('round-trips the tile diff in the relay world format', () => {
    const stored = stubStorage();
    const state = createInitialState();
    state.soloTileDiff = createTileDiff([dug, cracked, mined]);

    save(state);

    expect(JSON.parse(stored.get(SAVE_KEY) || '{}')).toMatchObject({
      version: SAVE_VERSION,
      tiles: [dug, cracked, mined]
    });

    const restored = createInitialState();
    load(restored);
    expect(restored.soloTileDiff).toEqual(state.soloTileDiff);
  });

  it('gives a version 3 save an untouched mine', () => {
    stubStorage({ version: 3, cash: 90, explored: '910-911' });
    const state = createInitialState();

    load(state);

    expect(state.cash).toBe(90);
    expect(state.exploredTiles.has(explorationIndex(10, 10))).toBe(true);
    expect(state.soloTileDiff.size).toBe(0);
  });

  it('ignores a malformed tile list instead of failing the whole load', () => {
    stubStorage({ version: SAVE_VERSION, cash: 90, tiles: [{ x: 1, y: 2, tile: { type: 'lava' } }] });
    const state = createInitialState();

    load(state);

    expect(state.cash).toBe(90);
    expect(state.soloTileDiff.size).toBe(0);
  });

  it('drops the terrain rather than the wallet when storage is full', () => {
    const stored = new Map<string, string>();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (value.includes('"tiles":[{')) throw new Error('QuotaExceededError');
        stored.set(key, value);
      }
    });
    const state = createInitialState();
    state.cash = 4200;
    state.soloTileDiff = createTileDiff([dug]);

    save(state);

    expect(JSON.parse(stored.get(SAVE_KEY) || '{}')).toMatchObject({ cash: 4200, tiles: [] });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('forgets the oldest mutations once the save budget is spent', () => {
    stubStorage();
    const state = createInitialState();
    const entries: TileEntry[] = Array.from({ length: MAX_SAVED_TILE_ENTRIES + 2 }, (_, index) => ({
      x: index % 90, y: 10 + index, tile: { type: 'air' }
    }));
    state.soloTileDiff = createTileDiff(entries);

    save(state);

    const restored = createInitialState();
    load(restored);
    const kept = tileDiffEntries(restored.soloTileDiff);
    expect(kept).toHaveLength(MAX_SAVED_TILE_ENTRIES);
    expect(kept[0]).toEqual(entries[2]);
    expect(kept.at(-1)).toEqual(entries.at(-1));
  });
});

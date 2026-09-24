import { afterEach, describe, it, expect, vi } from 'vitest';
import { SAVE_KEY, SAVE_VERSION, load, numeric, save } from './persistence';
import { HOME_SPAWN_X, createInitialState } from './core/state';
import { CARGO_CONTAINER, CARGO_CONTAINER_ITEM, createPlacedContainer } from './core/cargo-container';
import { DYNAMITE, DYNAMITE_ITEM, createPlacedDynamite } from './core/dynamite';
import { addItem, addOre, countItem, countOres, createInventory, oreItem, oreKind } from './core/inventory';
import { ITEM_CATALOG } from './core/items';
import { SCANNER_DEVICE, SCANNER_ITEM, createScannerDevice } from './core/scanner-device';
import { WRECK, createWreck } from './core/wreck';
import { STATION_DEVICE, type PortalStation } from './core/stations';
import { MAX_PORTAL_NAME_LENGTH } from './core/portal';
import { TELEPORTER_ITEM } from './core/teleporter';
import { DECOR_HP, MAX_SAVED_TILE_ENTRIES, ORES, START_Y } from '../shared/constants';
import { explorationIndex } from '../shared/exploration-codec';
import type { TileEntry } from '../shared/world-schema';
import { createTileDiff, tileDiffEntries } from './world/tile-diff';

afterEach(() => vi.unstubAllGlobals());

/** One ore with a full price/colour record, for the stacks a crate has to keep. */
const GOLD = {name: 'Gold', color: '#ffd65c', value: 70, min: 152, max: 602, chance: 0.04};

/** Read back the JSON the last `save` wrote. */
function readSave(stored: Map<string, string>): Record<string, unknown> {
  return JSON.parse(stored.get(SAVE_KEY) || '{}');
}

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

describe('version gate', () => {
  it('discards a save older than the current version, keeping pristine defaults', () => {
    stubStorage({version: SAVE_VERSION - 1, cash: 9000, x: 12, y: 640, bay: [{kind: 'dynamite', count: 5}]});
    const state = createInitialState();
    const fresh = createInitialState();

    load(state);

    expect(state.cash).toBe(fresh.cash);
    expect(state.player.inventory).toHaveLength(0);
    expect(state.player).toMatchObject({x: fresh.player.x, y: fresh.player.y});
  });

  it('discards a save with no version at all', () => {
    stubStorage({cash: 9000, bay: [{kind: 'scanner', count: 2}]});
    const state = createInitialState();
    const fresh = createInitialState();

    load(state);

    expect(state.cash).toBe(fresh.cash);
    expect(state.player.inventory).toHaveLength(0);
  });
});

describe('legacy stat save compatibility', () => {
  it('drops removed stat counters and keeps the surviving ones', () => {
    stubStorage({ version: SAVE_VERSION, stats: { oreMined: 7, motherlodeClaims: 1, artifactsFound: 3 } });
    const state = createInitialState();

    load(state);

    expect(state.stats).toEqual({ maxDepth: 0, totalCashEarned: 0, oreMined: 7, enemiesDestroyed: 0, deaths: 0 });
  });
});

describe('cargo bay persistence', () => {
  it('round-trips the non-ore stacks aboard and re-stacks them on load', () => {
    const stored = stubStorage();
    const state = createInitialState();
    state.player.inventory = addItem(addItem(state.player.inventory, TELEPORTER_ITEM, 2)!, DYNAMITE_ITEM, 3)!;

    save(state);

    expect(readSave(stored)).toMatchObject({
      version: SAVE_VERSION,
      bay: [{kind: 'teleporter', count: 2}, {kind: 'dynamite', count: 3}]
    });

    const restored = createInitialState();
    load(restored);
    expect(countItem(restored.player.inventory, TELEPORTER_ITEM.kind)).toBe(2);
    expect(countItem(restored.player.inventory, DYNAMITE_ITEM.kind)).toBe(3);
  });

  it('carries upgrade and decor stacks in the bay too', () => {
    const stored = stubStorage();
    const state = createInitialState();
    state.player.inventory = addItem(addItem(state.player.inventory, ITEM_CATALOG['upgrade:drill:2'], 1)!, ITEM_CATALOG['decor:lampPanel'], 4)!;

    save(state);

    expect(readSave(stored)).toMatchObject({
      bay: [{kind: 'upgrade:drill:2', count: 1}, {kind: 'decor:lampPanel', count: 4}]
    });

    const restored = createInitialState();
    load(restored);
    expect(countItem(restored.player.inventory, 'upgrade:drill:2')).toBe(1);
    expect(countItem(restored.player.inventory, 'decor:lampPanel')).toBe(4);
  });

  it('never saves ore in the bay — it is lost with the run', () => {
    const stored = stubStorage();
    const state = createInitialState();
    state.player.inventory = addItem(addOre(createInventory(), GOLD, 5)!, SCANNER_ITEM, 1)!;

    save(state);

    expect(readSave(stored).bay).toEqual([{kind: 'scanner', count: 1}]);

    const restored = createInitialState();
    load(restored);
    expect(countOres(restored.player.inventory)).toBe(0);
    expect(countItem(restored.player.inventory, SCANNER_ITEM.kind)).toBe(1);
  });

  it('clamps a hand-edited stack and drops unknown or ore kinds from the bay', () => {
    stubStorage({
      version: SAVE_VERSION,
      bay: [{kind: 'dynamite', count: 10_000}, {kind: 'bogus', count: 3}, {kind: 'ore:Gold', count: 4}]
    });
    const state = createInitialState();

    load(state);

    expect(countItem(state.player.inventory, DYNAMITE_ITEM.kind)).toBe(9999);
    // Unknown kinds and ore never belong in the restored bay.
    expect(state.player.inventory).toHaveLength(1);
  });
});

describe('equipment persistence', () => {
  it('round-trips the fitted upgrade slots', () => {
    const stored = stubStorage();
    const state = createInitialState();
    state.player.equipment = ['upgrade:tank:1', 'upgrade:drill:3'];

    save(state);

    expect(readSave(stored)).toMatchObject({version: SAVE_VERSION, equipment: ['upgrade:tank:1', 'upgrade:drill:3']});

    const restored = createInitialState();
    load(restored);
    expect(restored.player.equipment).toEqual(['upgrade:tank:1', 'upgrade:drill:3']);
    // The four maxima and the boost flag are derived from the fitted slots on load,
    // not stored: Tank Mk I adds +50 fuel, Drill Mk III adds +4.
    expect(restored.player.fuelMax).toBe(150);
    expect(restored.player.drill).toBe(5);
    expect(restored.player.cargoMax).toBe(20);
    expect(restored.player.hullMax).toBe(100);
    expect(restored.player.boost).toBe(false);
  });

  it('raises the boost flag on load when a booster is fitted', () => {
    stubStorage({version: SAVE_VERSION, equipment: ['upgrade:booster:1', 'upgrade:cargo:2']});
    const state = createInitialState();

    load(state);

    expect(state.player.boost).toBe(true);
    // Cargo Hold Mk II adds +20 to the starting 20.
    expect(state.player.cargoMax).toBe(40);
  });

  it('keeps only real, catalogued upgrades and only the first two slots', () => {
    stubStorage({version: SAVE_VERSION, equipment: ['upgrade:hull:2', 'upgrade:booster:1', 'upgrade:tank:3']});
    const state = createInitialState();

    load(state);

    expect(state.player.equipment).toEqual(['upgrade:hull:2', 'upgrade:booster:1']);
  });

  it('drops a non-upgrade, an uncatalogued tier, and a nonsense slot to null', () => {
    stubStorage({version: SAVE_VERSION, equipment: ['dynamite', 'upgrade:booster:2']});
    const state = createInitialState();

    load(state);

    // Slot 0 is a consumable, slot 1 is a mark the catalog does not hold.
    expect(state.player.equipment).toEqual([null, null]);
  });
});

describe('station persistence', () => {
  /** The first manufacturer standing in the mine, or `undefined` when none is. */
  function manufacturer(state: ReturnType<typeof createInitialState>) {
    return state.stations.find(s => s.kind === 'manufacturer');
  }
  /** The first extractor standing in the mine, or `undefined` when none is. */
  function extractor(state: ReturnType<typeof createInitialState>) {
    return state.stations.find(s => s.kind === 'extractor');
  }
  /** Every portal standing in the mine. */
  function portalStations(state: ReturnType<typeof createInitialState>) {
    return state.stations.filter((s): s is PortalStation => s.kind === 'portal');
  }

  it('round-trips the manufacturer stock, the extractor buffers, and the portal', () => {
    const stored = stubStorage();
    const state = createInitialState();
    manufacturer(state)!.inventory = addItem(addItem(createInventory(), oreItem(ORES[0]), 20)!, ITEM_CATALOG.repairKit, 2)!;
    Object.assign(extractor(state)!, {coal: 9, fuel: 40, progress: 120});
    const home = portalStations(state)[0]!;

    save(state);

    expect(readSave(stored)).toMatchObject({
      version: SAVE_VERSION,
      stations: [
        {kind: 'manufacturer', items: [{kind: 'ore:Coal', count: 20}, {kind: 'repairKit', count: 2}]},
        {kind: 'extractor', coal: 9, fuel: 40, progress: 120},
        {kind: 'portal', x: home.x, y: home.y, name: 'Home'}
      ]
    });

    const restored = createInitialState();
    load(restored);
    expect(extractor(restored)).toMatchObject({coal: 9, fuel: 40, progress: 120});
    expect(countItem(manufacturer(restored)!.inventory, oreKind('Coal'))).toBe(20);
    expect(countItem(manufacturer(restored)!.inventory, 'repairKit')).toBe(2);
    // The seeded Home portal comes back with its tile and name intact.
    expect(portalStations(restored)).toEqual([{kind: 'portal', x: home.x, y: home.y, name: 'Home'}]);
  });

  it('drops junk manufacturer stacks and clamps the extractor buffers', () => {
    stubStorage({
      version: SAVE_VERSION,
      stations: [
        {kind: 'manufacturer', x: 44, y: 20, items: [{kind: 'bogus', count: 5}, {kind: 'ore:Iron', count: '3'}]},
        {kind: 'extractor', x: 46, y: 20, coal: -4, fuel: 'nope'}
      ]
    });
    const state = createInitialState();

    load(state);

    expect(countItem(manufacturer(state)!.inventory, oreKind('Iron'))).toBe(3);
    expect(manufacturer(state)!.inventory).toHaveLength(1);
    expect(extractor(state)).toMatchObject({coal: 0, fuel: 0, progress: 0});
  });

  it('defaults extractor progress to 0 when a save predates the field', () => {
    stubStorage({version: SAVE_VERSION, stations: [{kind: 'extractor', x: 46, y: 20, coal: 3, fuel: 20}]});
    const state = createInitialState();

    load(state);

    expect(state.stations).toHaveLength(1);
    expect(extractor(state)).toMatchObject({coal: 3, fuel: 20, progress: 0});
  });

  it('keeps the seeded stations when a save records none', () => {
    stubStorage({version: SAVE_VERSION, cash: 100});
    const state = createInitialState();

    load(state);

    // Manufacturer, extractor, and the seeded Home portal.
    expect(state.stations).toHaveLength(3);
    expect(manufacturer(state)!.inventory).toHaveLength(0);
    expect(extractor(state)).toMatchObject({coal: 0, fuel: 0, progress: 0});
  });

  it('records an emptied mine as an empty station array, not the seeded default', () => {
    const stored = stubStorage();
    const state = createInitialState();
    state.stations = [];

    save(state);
    expect(readSave(stored)).toMatchObject({stations: []});

    const restored = createInitialState();
    load(restored);
    expect(restored.stations).toHaveLength(0);
  });

  it('round-trips a renamed portal at its tile', () => {
    stubStorage({version: SAVE_VERSION, stations: [{kind: 'portal', x: 44, y: 20, name: 'Depot'}]});
    const state = createInitialState();

    load(state);

    expect(portalStations(state)).toEqual([{kind: 'portal', x: 44, y: 20, name: 'Depot'}]);
  });

  it.each([
    ['an empty name', '', 'Depot'],
    ['a whitespace-only name', '   ', 'Depot'],
    ['a non-string name', 42, 'Depot']
  ])('sanitizes %s to a deterministic default', (_name, raw, expected) => {
    stubStorage({version: SAVE_VERSION, stations: [{kind: 'portal', x: 44, y: 20, name: raw}]});
    const state = createInitialState();

    load(state);

    expect(portalStations(state)).toEqual([{kind: 'portal', x: 44, y: 20, name: expected}]);
  });

  it('truncates an over-long portal name to the max length', () => {
    stubStorage({version: SAVE_VERSION, stations: [{kind: 'portal', x: 44, y: 20, name: 'x'.repeat(40)}]});
    const state = createInitialState();

    load(state);

    expect(portalStations(state)[0]!.name).toBe('x'.repeat(MAX_PORTAL_NAME_LENGTH));
  });

  it('drops portals beyond the cap the game enforces', () => {
    stubStorage({
      version: SAVE_VERSION,
      stations: Array.from({length: STATION_DEVICE.portal.maxPlaced + 3}, (_, index) => ({
        kind: 'portal', x: index + 1, y: 20, name: `P${index}`
      }))
    });
    const state = createInitialState();

    load(state);

    expect(portalStations(state)).toHaveLength(STATION_DEVICE.portal.maxPlaced);
  });

  it('skips a malformed portal entry but keeps the sound one beside it', () => {
    stubStorage({
      version: SAVE_VERSION,
      stations: [
        {kind: 'portal', x: 'deep', y: 20, name: 'Bad'},
        {kind: 'portal', x: 44, y: 20, name: 'Good'}
      ]
    });
    const state = createInitialState();

    load(state);

    expect(portalStations(state)).toEqual([{kind: 'portal', x: 44, y: 20, name: 'Good'}]);
  });
});

describe('scanner persistence', () => {
  it('round-trips carried scanners in the bay and the devices left running', () => {
    const stored = stubStorage();
    const state = createInitialState();
    state.player.inventory = addItem(state.player.inventory, SCANNER_ITEM, 2)!;
    state.scannerDevices = [createScannerDevice(12, 640), {x: 44, y: 700, timer: 123}];

    save(state);

    expect(readSave(stored)).toMatchObject({
      version: SAVE_VERSION,
      bay: [{kind: 'scanner', count: 2}],
      scannerDevices: [{x: 12, y: 640, timer: 0}, {x: 44, y: 700, timer: 123}]
    });

    const restored = createInitialState();
    load(restored);
    expect(countItem(restored.player.inventory, SCANNER_ITEM.kind)).toBe(2);
    expect(restored.scannerDevices).toEqual(state.scannerDevices);
  });

  it.each([
    ['a device outside the side walls', [{x: -3, y: 400}]],
    ['a device above the mine', [{x: 10, y: -1}]],
    ['a nonsense device', [{x: 'deep', y: null}]],
    ['something that is not a device at all', ['scanner']],
    ['a device list that is not a list', 'scanner']
  ])('drops %s on load', (_name, scannerDevices) => {
    stubStorage({version: SAVE_VERSION, scannerDevices});
    const state = createInitialState();

    load(state);

    expect(state.scannerDevices).toEqual([]);
  });

  it('clamps a hand-edited save to what the game could have deployed', () => {
    stubStorage({
      version: SAVE_VERSION,
      scannerDevices: Array.from({length: SCANNER_DEVICE.maxPlaced + 5}, (_, index) => ({x: index, y: 400, timer: 999_999}))
    });
    const state = createInitialState();

    load(state);

    expect(state.scannerDevices).toHaveLength(SCANNER_DEVICE.maxPlaced);
    expect(state.scannerDevices.every(device => device.timer === SCANNER_DEVICE.intervalTicks)).toBe(true);
  });
});

describe('dynamite persistence', () => {
  it('round-trips carried sticks in the bay and the fuses still burning', () => {
    const stored = stubStorage();
    const state = createInitialState();
    state.player.inventory = addItem(state.player.inventory, DYNAMITE_ITEM, 3)!;
    state.placedDynamite = [createPlacedDynamite(12, 640), {x: 44, y: 700, fuse: 42}];

    save(state);

    expect(readSave(stored)).toMatchObject({
      version: SAVE_VERSION,
      bay: [{kind: 'dynamite', count: 3}],
      dynamiteSticks: [{x: 12, y: 640, fuse: DYNAMITE.fuseTicks}, {x: 44, y: 700, fuse: 42}]
    });

    const restored = createInitialState();
    load(restored);
    expect(countItem(restored.player.inventory, DYNAMITE_ITEM.kind)).toBe(3);
    expect(restored.placedDynamite).toEqual(state.placedDynamite);
  });

  it.each([
    ['a stick outside the side walls', [{x: -3, y: 400}]],
    ['a stick above the mine', [{x: 10, y: -1}]],
    ['a nonsense stick', [{x: 'deep', y: null}]],
    ['something that is not a stick at all', ['boom']],
    ['a stick list that is not a list', 'boom']
  ])('drops %s on load', (_name, dynamiteSticks) => {
    stubStorage({version: SAVE_VERSION, dynamiteSticks});
    const state = createInitialState();

    load(state);

    expect(state.placedDynamite).toEqual([]);
  });

  it('clamps a hand-edited save to what the game could have planted', () => {
    stubStorage({
      version: SAVE_VERSION,
      dynamiteSticks: Array.from({length: DYNAMITE.maxPlaced + 5}, (_, index) => ({x: index, y: 400, fuse: 0}))
    });
    const state = createInitialState();

    load(state);

    expect(state.placedDynamite).toHaveLength(DYNAMITE.maxPlaced);
    // A zero fuse would go off on the first step of the resumed run.
    expect(state.placedDynamite.every(stick => stick.fuse === 1)).toBe(true);
  });
});

describe('cargo container persistence', () => {
  it('round-trips carried crates in the bay and the placed ones with their contents', () => {
    const stored = stubStorage();
    const state = createInitialState();
    state.player.inventory = addItem(state.player.inventory, CARGO_CONTAINER_ITEM, 2)!;
    const crate = createPlacedContainer(12, 640);
    crate.inventory = addItem(addItem(crate.inventory, oreItem(GOLD), 4)!, DYNAMITE_ITEM, 3)!;
    state.cargoContainers = [crate, createPlacedContainer(44, 700)];

    save(state);

    expect(readSave(stored)).toMatchObject({
      version: SAVE_VERSION,
      bay: [{kind: 'container', count: 2}],
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

  it.each([
    ['a crate outside the side walls', [{x: -3, y: 400}]],
    ['a crate above the mine', [{x: 10, y: -1}]],
    ['a nonsense crate', [{x: 'deep', y: null}]],
    ['something that is not a crate at all', ['crate']],
    ['a crate list that is not a list', 'crate']
  ])('drops %s on load', (_name, cargoContainers) => {
    stubStorage({version: SAVE_VERSION, cargoContainers});
    const state = createInitialState();

    load(state);

    expect(state.cargoContainers).toEqual([]);
  });

  it('clamps a hand-edited save to what the game could have placed', () => {
    stubStorage({
      version: SAVE_VERSION,
      cargoContainers: Array.from({length: CARGO_CONTAINER.maxPlaced + 4}, (_, index) => ({x: index, y: 400}))
    });
    const state = createInitialState();

    load(state);

    expect(state.cargoContainers).toHaveLength(CARGO_CONTAINER.maxPlaced);
  });
});

describe('wreck persistence', () => {
  it('round-trips wrecks with their salvageable contents', () => {
    const stored = stubStorage();
    const state = createInitialState();
    const wreck = createWreck(20, 640);
    wreck.inventory = addItem(addItem(wreck.inventory, oreItem(GOLD), 4)!, ITEM_CATALOG['upgrade:tank:1'], 1)!;
    state.wrecks = [wreck, createWreck(44, 700)];

    save(state);

    expect(readSave(stored)).toMatchObject({
      version: SAVE_VERSION,
      wrecks: [
        {x: 20, y: 640, items: [
          {kind: 'ore:Gold', count: 4, label: 'Gold', color: GOLD.color, value: GOLD.value},
          {kind: 'upgrade:tank:1', count: 1, label: 'Fuel Tank Mk I', color: ITEM_CATALOG['upgrade:tank:1'].color, value: 0}
        ]},
        {x: 44, y: 700, items: []}
      ]
    });

    const restored = createInitialState();
    load(restored);
    expect(restored.wrecks).toEqual(state.wrecks);
  });

  it('keeps a wreck through a reload that empties the bay, ore intact', () => {
    stubStorage();
    const state = createInitialState();
    const wreck = createWreck(12, 640);
    wreck.inventory = addItem(wreck.inventory, oreItem(GOLD), 7)!;
    state.wrecks = [wreck];
    state.player.inventory = addItem(state.player.inventory, oreItem(GOLD), 5)!;

    save(state);

    const restored = createInitialState();
    load(restored);
    expect(countOres(restored.player.inventory)).toBe(0);
    expect(countOres(restored.wrecks[0].inventory)).toBe(7);
  });

  it.each([
    ['a wreck outside the side walls', [{x: -3, y: 400}]],
    ['a wreck above the mine', [{x: 10, y: -1}]],
    ['a nonsense wreck', [{x: 'deep', y: null}]],
    ['something that is not a wreck at all', ['wreck']],
    ['a wreck list that is not a list', 'wreck']
  ])('drops %s on load', (_name, wrecks) => {
    stubStorage({version: SAVE_VERSION, wrecks});
    const state = createInitialState();

    load(state);

    expect(state.wrecks).toEqual([]);
  });

  it('clamps a hand-edited save to the wreck cap', () => {
    stubStorage({
      version: SAVE_VERSION,
      wrecks: Array.from({length: WRECK.maxPlaced + 4}, (_, index) => ({x: index, y: 400}))
    });
    const state = createInitialState();

    load(state);

    expect(state.wrecks).toHaveLength(WRECK.maxPlaced);
  });
});

describe('trading ledger persistence', () => {
  it('round-trips the drawn-down trading stock', () => {
    const stored = stubStorage();
    const state = createInitialState();
    state.tradeLedger = {'40,120': [2, 0, 1], '55,300': [3]};

    save(state);
    const restored = createInitialState();
    load(restored);

    expect(restored.tradeLedger).toEqual({'40,120': [2, 0, 1], '55,300': [3]});
    expect(readSave(stored).tradeLedger).toEqual({'40,120': [2, 0, 1], '55,300': [3]});
  });

  it('drops keys that are not coordinate pairs and clamps the counts', () => {
    stubStorage({version: SAVE_VERSION, tradeLedger: {bad: [1], '1,2': [3, -5, 'x']}});
    const state = createInitialState();

    load(state);

    expect(state.tradeLedger).toEqual({'1,2': [3, 0, 0]});
  });

  it('defaults to an empty ledger when the save has none', () => {
    stubStorage({version: SAVE_VERSION});
    const state = createInitialState();

    load(state);

    expect(state.tradeLedger).toEqual({});
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

    expect(readSave(stored)).toMatchObject({version: SAVE_VERSION, x: 12, y: 640});

    const restored = createInitialState();
    load(restored);
    expect(restored.player).toMatchObject({x: 12, y: 640, drawX: 12, drawY: 640});
  });

  it.each([
    ['a position outside the side walls', {x: -40, y: 30}, {x: 1, y: 30}],
    ['a position above the home row', {x: 12, y: -9}, {x: 12, y: START_Y}],
    ['a fractional position', {x: 12.7, y: 30.7}, {x: 12, y: 30}],
    ['a nonsense position', {x: 'deep', y: null}, {x: HOME_SPAWN_X, y: START_Y}]
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

    expect(readSave(stored)).toMatchObject({version: SAVE_VERSION, explored: '910-911'});

    const restored = createInitialState();
    load(restored);
    expect(restored.exploredTiles).toEqual(state.exploredTiles);
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

    expect(readSave(stored)).toMatchObject({
      version: SAVE_VERSION,
      tiles: [dug, cracked, mined]
    });

    const restored = createInitialState();
    load(restored);
    expect(restored.soloTileDiff).toEqual(state.soloTileDiff);
  });

  it('round-trips a placed decoration tile with its durability', () => {
    stubStorage();
    const decor: TileEntry = { x: 40, y: 61, tile: { type: 'decor', decor: 'lampPanel', hp: 12, maxHp: DECOR_HP } };
    const state = createInitialState();
    state.soloTileDiff = createTileDiff([decor]);

    save(state);
    const restored = createInitialState();
    load(restored);

    expect(tileDiffEntries(restored.soloTileDiff)).toEqual([decor]);
  });

  it('defaults durability on a decor tile saved before it existed', () => {
    stubStorage({
      version: SAVE_VERSION,
      tiles: [{ x: 40, y: 61, tile: { type: 'decor', decor: 'steelPlate' } }]
    });
    const state = createInitialState();

    load(state);

    expect(tileDiffEntries(state.soloTileDiff)).toEqual([
      { x: 40, y: 61, tile: { type: 'decor', decor: 'steelPlate', hp: DECOR_HP, maxHp: DECOR_HP } }
    ]);
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

    expect(readSave(stored)).toMatchObject({ cash: 4200, tiles: [] });
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

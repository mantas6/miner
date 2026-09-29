import { describe, expect, it } from 'vitest';
import { EXTRACTOR, STARTING } from './balance';
import {
  POST_OBJECTIVE_DEPTH,
  SCANNER_OBJECTIVE_DEPTH,
  createExpeditionObjectiveFormatter,
  formatExpeditionObjective,
  nextOreMilestone,
  type ObjectiveInput
} from './objective';
import { addItem, createInventory, oreItem, type Inventory, type InventoryItemKind, type UpgradeKind } from './inventory';
import { itemForKind } from './items';
import { ORES, START_Y } from '../../shared/constants';

const player = {
  y: START_Y,
  fuel: STARTING.fuel,
  fuelMax: STARTING.fuelMax,
  cargoMax: STARTING.cargoMax,
  equipment: [null, null, null] as (UpgradeKind | null)[]
};

const empty = createInventory();

/** A station stock holding `count` of a named ore. */
function withOre(name: string, count: number, base: Inventory = createInventory()): Inventory {
  const ore = ORES.find(entry => entry.name === name)!;
  return addItem(base, oreItem(ore), count);
}

/** A stock holding `count` of a non-ore item. */
function withItem(kind: InventoryItemKind, count = 1, base: Inventory = createInventory()): Inventory {
  return addItem(base, itemForKind(kind), count);
}

/** The materials a Fuel Tank Mk I needs: 4 Iron + 2 Copper. */
function tankMaterials(): Inventory {
  return withOre('Copper', 2, withOre('Iron', 4));
}

/** The materials a Mk II upgrade (and a Portal, less the Iron) needs: 3 Silver + 3 Gold. */
function markTwoMaterials(): Inventory {
  return withOre('Gold', 3, withOre('Silver', 3));
}

/** A row `meters` below the home floor. */
function rowAt(meters: number): number {
  return START_Y + meters / 10;
}

/** A career past its first upgrade, every earlier rung satisfied: the depth rung is what is left. */
const upgraded = {...player, equipment: ['upgrade:tank:1', null, null] as (UpgradeKind | null)[]};
const veteran: ObjectiveInput = {
  player: upgraded,
  cargoCount: 0,
  atSurface: false,
  bay: empty,
  station: empty,
  baseExtractor: {fuel: EXTRACTOR.fuelCap, coal: 0},
  fieldPortals: 0,
  maxDepthMeters: 0,
  scannersObtained: 1,
  bestMarkCrafted: 1,
  postsFound: 1,
  nearestExit: null
};

describe('expedition objective helper', () => {
  it('nudges a fresh save toward mining the first upgrade materials', () => {
    expect(formatExpeditionObjective({
      player,
      cargoCount: 0,
      atSurface: true,
      bay: empty,
      station: empty
    })).toBe('Objective: mine Iron and Copper for Fuel Tank Mk I.');
  });

  it('switches to crafting once the station holds the materials', () => {
    expect(formatExpeditionObjective({
      player,
      cargoCount: 0,
      atSurface: true,
      bay: empty,
      station: tankMaterials()
    })).toBe('Objective: craft Fuel Tank Mk I at the Manufacturing Station.');
  });

  it('prioritizes low fuel return warnings underground', () => {
    expect(formatExpeditionObjective({
      player: { ...player, y: START_Y + 12, fuel: 20 },
      cargoCount: 0,
      atSurface: false,
      bay: empty,
      station: empty
    })).toBe('Objective: fly home and refuel at the Fuel Extractor.');
  });

  it('sends a ship low on fuel to the portal its reserve is priced to, then home', () => {
    const low = {...veteran, player: {...upgraded, y: rowAt(900), fuel: 5}, cargoCount: upgraded.cargoMax};
    expect(formatExpeditionObjective({...low, nearestExit: {kind: 'portal', name: 'Deep'}}))
      .toBe('Objective: fly to Portal "Deep" and jump home to refuel.');
    expect(formatExpeditionObjective({...low, nearestExit: {kind: 'home', name: 'Home'}}))
      .toBe('Objective: fly home and refuel at the Fuel Extractor.');
  });

  it('sends a full bay home to stow', () => {
    expect(formatExpeditionObjective({
      player: { ...player, y: START_Y + 12 },
      cargoCount: player.cargoMax,
      atSurface: false,
      bay: empty,
      station: empty
    })).toBe('Objective: return home and stow cargo at the Manufacturing Station.');
  });

  it('offers a known trading post as the other place to unload a full bay', () => {
    expect(formatExpeditionObjective({...veteran, cargoCount: upgraded.cargoMax, postsFound: 2}))
      .toBe('Objective: stow cargo at home, or sell it at a trading post.');
  });

  describe('the base running dry, at home', () => {
    const home = {...veteran, atSurface: true, maxDepthMeters: 900};
    const dry = {fuel: 12.7, coal: 0};

    it('loads the coal aboard into the extractor', () => {
      expect(formatExpeditionObjective({...home, baseExtractor: dry, bay: withOre('Coal', 4)}))
        .toBe('Objective: load the 4 coal aboard into the Fuel Extractor.');
    });

    it('sends the ship for coal when none is aboard', () => {
      expect(formatExpeditionObjective({...home, baseExtractor: dry}))
        .toBe('Objective: mine Coal — the Fuel Extractor is down to 12 fuel.');
    });

    it('asks for an extractor when the home cavern has none', () => {
      expect(formatExpeditionObjective({...home, baseExtractor: null}))
        .toBe('Objective: set a Fuel Extractor down in the home cavern.');
    });

    it('counts queued coal toward the base, and stays quiet underground', () => {
      const queued = {fuel: 0, coal: Math.ceil(upgraded.fuelMax / EXTRACTOR.fuelPerCoal)};
      expect(formatExpeditionObjective({...home, baseExtractor: queued})).toContain('dig toward');
      expect(formatExpeditionObjective({...home, atSurface: false, baseExtractor: dry})).toContain('dig toward');
    });
  });

  it('points players with an upgrade fitted toward the next ore band', () => {
    expect(nextOreMilestone(80)).toEqual({ name: 'Silver', depthMeters: 600 });
    expect(formatExpeditionObjective({
      player: { ...player, y: START_Y + 8, equipment: ['upgrade:tank:1', null, null] },
      cargoCount: 0,
      atSurface: false,
      bay: empty,
      station: empty
    })).toBe('Objective: dig toward Silver around 600 m while keeping fuel for the trip home.');
  });

  it('counts an upgrade waiting in the bay or station as progress made', () => {
    const bay = addItem(createInventory(), oreItem(ORES.find(o => o.name === 'Iron')!), 0);
    const withUpgrade = addItem(createInventory(), {kind: 'upgrade:tank:1', label: 'Fuel Tank Mk I', color: '#000', value: 0});
    expect(formatExpeditionObjective({
      player: { ...player, y: START_Y + 8 },
      cargoCount: 0,
      atSurface: false,
      bay,
      station: withUpgrade
    })).toBe('Objective: dig toward Silver around 600 m while keeping fuel for the trip home.');
  });

  it('asks for a Mk II once one is craftable and none has been made', () => {
    expect(formatExpeditionObjective({...veteran, station: markTwoMaterials()}))
      .toBe('Objective: craft a Mk II upgrade at the Manufacturing Station.');
    expect(formatExpeditionObjective({...veteran, station: markTwoMaterials(), bestMarkCrafted: 2}))
      .not.toContain('Mk II');
  });

  it('asks for a field portal once one is craftable, or set down once one is held', () => {
    const portalStock = withOre('Iron', 2, markTwoMaterials());
    const made = {...veteran, bestMarkCrafted: 2};
    expect(formatExpeditionObjective({...made, station: portalStock}))
      .toBe('Objective: craft a Portal and set it down deep — a free ride home.');
    expect(formatExpeditionObjective({...made, bay: withItem('device:portal')}))
      .toBe('Objective: set the Portal down deep — a free ride home.');
    expect(formatExpeditionObjective({...made, station: portalStock, fieldPortals: 1})).not.toContain('Portal');
  });

  it('asks for a Scanner past the Silver line when the career never had one', () => {
    const deep = {...veteran, maxDepthMeters: SCANNER_OBJECTIVE_DEPTH, scannersObtained: 0};
    expect(formatExpeditionObjective(deep))
      .toBe('Objective: craft a Scanner (2 Copper + 1 Silver) — ore hides in the fog.');
    // One aboard from a chest counts, and so does any obtained before.
    expect(formatExpeditionObjective({...deep, bay: withItem('scanner')})).not.toContain('Scanner');
    expect(formatExpeditionObjective({...deep, scannersObtained: 1})).not.toContain('Scanner');
    expect(formatExpeditionObjective({...deep, maxDepthMeters: SCANNER_OBJECTIVE_DEPTH - 10})).not.toContain('Scanner');
  });

  it('sends a career past 400 m with no post found to find one', () => {
    const deep = {...veteran, maxDepthMeters: POST_OBJECTIVE_DEPTH, postsFound: 0};
    expect(formatExpeditionObjective(deep)).toBe('Objective: find a trading post below 400 m to turn ore into cash.');
    expect(formatExpeditionObjective({...deep, maxDepthMeters: POST_OBJECTIVE_DEPTH - 10})).toContain('dig toward');
  });

  it('drops the fuel caveat from the depth target once a field portal stands', () => {
    expect(formatExpeditionObjective({...veteran, fieldPortals: 1, player: {...upgraded, y: rowAt(80)}}))
      .toBe('Objective: dig toward Silver around 600 m.');
  });

  it('names the band below the career record at home, not the first band (stale-at-home regression)', () => {
    const home = {...veteran, atSurface: true, player: {...upgraded, y: START_Y}, maxDepthMeters: 900};
    const objective = formatExpeditionObjective(home);
    expect(objective).toBe(`Objective: dig toward ${nextOreMilestone(900)!.name} around ${nextOreMilestone(900)!.depthMeters} m while keeping fuel for the trip home.`);
    expect(objective).not.toContain('Iron around 30 m');
  });

  it('keeps hauling the richest seam once every ore band is unlocked', () => {
    expect(nextOreMilestone(8600)).toBeNull();
    // The mine has no bottom, so the deep-run objective must never name a final
    // target such as the old Motherlode-core-at-10,000 m goal.
    const objective = formatExpeditionObjective({...veteran, player: {...upgraded, y: START_Y + 860}});

    expect(objective).toBe('Objective: work the Core Shard depths, fill the bay, and get home alive.');
    expect(objective).not.toContain('Motherlode');
  });
});

describe('memoised expedition objective', () => {
  /**
   * A per-frame caller walks the ship through every branch; the memo must agree
   * with the pure formatter on every step, including the steps it answers from
   * its cache (small moves that cross no gate) and the ones that cross a gate.
   */
  it('agrees with the pure formatter on every frame of a run', () => {
    const format = createExpeditionObjectiveFormatter();
    const ship = {...player, equipment: [null, null, null] as (UpgradeKind | null)[]};
    const input: ObjectiveInput = {player: ship, cargoCount: 0, atSurface: true, bay: empty, station: createInventory()};
    const frames: string[] = [];
    const check = () => {
      const text = format(input);
      expect(text).toBe(formatExpeditionObjective(input));
      frames.push(text);
    };

    check();
    // No manufacturer hands a fresh empty stock every frame: still the same objective.
    input.station = createInventory();
    check();
    input.station = tankMaterials();
    check();
    input.station = empty;
    // Descending with an upgrade fitted, row by row, through an ore band boundary.
    ship.equipment = ['upgrade:tank:1', null];
    input.atSurface = false;
    for (let row = START_Y; row < START_Y + 400; row += 7) {
      ship.y = row;
      check();
    }
    // Fuel draining below the warning, then a refuel.
    for (let fuel = ship.fuelMax; fuel >= 0; fuel -= ship.fuelMax / 20) {
      ship.fuel = fuel;
      check();
    }
    // The reserve's exit moving from home to a portal and back, and the portal renamed.
    input.nearestExit = {kind: 'portal', name: 'Deep'};
    check();
    input.nearestExit = {kind: 'portal', name: 'Deeper'};
    check();
    input.nearestExit = null;
    check();
    ship.fuel = ship.fuelMax;
    check();
    // Filling the bay to the brim, with and without a post found.
    for (let count = 0; count <= ship.cargoMax; count++) {
      input.cargoCount = count;
      check();
    }
    input.postsFound = 1;
    check();
    input.cargoCount = 0;
    // Home with the base draining a unit at a time, then coal aboard.
    ship.y = START_Y;
    input.atSurface = true;
    input.baseExtractor = {fuel: 30, coal: 0};
    for (let fuel = 30; fuel >= 25; fuel -= 0.5) {
      input.baseExtractor = {fuel, coal: 0};
      check();
    }
    input.bay = withOre('Coal', 2);
    check();
    input.baseExtractor = null;
    check();
    input.baseExtractor = {fuel: EXTRACTOR.fuelCap, coal: 0};
    // The craft rungs appear and clear as the stock and the counters change.
    input.station = markTwoMaterials();
    check();
    input.bestMarkCrafted = 2;
    check();
    input.station = withOre('Iron', 2, markTwoMaterials());
    check();
    input.fieldPortals = 1;
    check();
    // The career record deepening past the Scanner line, then a scanner obtained.
    input.maxDepthMeters = 900;
    check();
    input.scannersObtained = 1;
    check();
    input.postsFound = 0;
    check();
    input.postsFound = 1;
    check();
    // Unfitting leaves an upgrade in the bay (a new bay array), then nowhere.
    ship.equipment = [null, null, null];
    input.bay = addItem(createInventory(), {kind: 'upgrade:tank:1', label: 'Fuel Tank Mk I', color: '#000', value: 0});
    check();
    input.bay = empty;
    check();

    expect(new Set(frames).size).toBeGreaterThan(12);
  });

  it('hands back the same string on a steady frame', () => {
    const format = createExpeditionObjectiveFormatter();
    const input: ObjectiveInput = {...veteran, player: {...upgraded, y: rowAt(80)}};
    const first = format(input);
    input.player = {...upgraded, y: rowAt(90)};
    expect(format(input)).toBe(first);
  });
});

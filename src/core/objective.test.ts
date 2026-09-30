import { describe, expect, it } from 'vitest';
import { EXTRACTOR, HULL, STARTING } from './balance';
import {
  BAND_ORE_TARGET,
  POST_OBJECTIVE_DEPTH,
  SCANNER_OBJECTIVE_DEPTH,
  createExpeditionObjectiveFormatter,
  formatExpeditionObjective,
  nextOreMilestone,
  type ObjectiveInput
} from './objective';
import { addItem, createInventory, oreItem, type Inventory, type InventoryItemKind, type UpgradeKind } from './inventory';
import { itemForKind } from './items';
import type { ShipId } from './ships';
import { ORES, START_Y } from '../../shared/constants';

const player = {
  y: START_Y,
  fuel: STARTING.fuel,
  fuelMax: STARTING.fuelMax,
  hull: STARTING.hull,
  hullMax: STARTING.hullMax,
  cargoMax: STARTING.cargoMax,
  equipment: [null, null, null] as (UpgradeKind | null)[],
  ship: 'scout' as ShipId
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
function markTwoMaterials(base: Inventory = createInventory()): Inventory {
  return withOre('Gold', 3, withOre('Silver', 3, base));
}

/** A row `meters` below the home floor. */
function rowAt(meters: number): number {
  return START_Y + meters / 10;
}

/**
 * A career past its first upgrade, every earlier rung satisfied: the depth rung is
 * what is left. It flies the Hauler, so the Scout's "build the Hauler" rung is past
 * too; the ore bands are left out (`oresMined`), so none waits to be worked.
 */
const upgraded = {...player, ship: 'hauler' as ShipId, equipment: ['upgrade:tank:1', null, null] as (UpgradeKind | null)[]};
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

    it('measures a tank bigger than the store against the store, so a full one is enough', () => {
      // A Leviathan with two Tank Mk IIIs: far more tank than the extractor can bank.
      const leviathan = {...home, player: {...upgraded, ship: 'leviathan' as ShipId, fuelMax: 875}};
      expect(formatExpeditionObjective({...leviathan, baseExtractor: {fuel: EXTRACTOR.fuelCap, coal: 0}})).toContain('dig toward');
      expect(formatExpeditionObjective({...leviathan, baseExtractor: {fuel: EXTRACTOR.fuelCap - 1, coal: 0}}))
        .toBe(`Objective: mine Coal — the Fuel Extractor is down to ${EXTRACTOR.fuelCap - 1} fuel.`);
    });

    it('orders fuel instead once the career is deeper than Coal grows', () => {
      const coal = ORES.find(ore => ore.name === 'Coal')!;
      const coalFloor = (coal.max - START_Y) * 10;
      const deep = {...home, maxDepthMeters: coalFloor};
      expect(formatExpeditionObjective({...deep, baseExtractor: dry}))
        .toBe('Objective: order fuel into the Fuel Extractor ($29 per 100) or fill up at a trading post.');
      // Coal still aboard is loaded all the same, and short of the floor it is still mined.
      expect(formatExpeditionObjective({...deep, baseExtractor: dry, bay: withOre('Coal', 2)}))
        .toBe('Objective: load the 2 coal aboard into the Fuel Extractor.');
      expect(formatExpeditionObjective({...home, maxDepthMeters: coalFloor - 10, baseExtractor: dry})).toContain('mine Coal');
    });
  });

  it('points players with an upgrade fitted toward the next ore band', () => {
    expect(nextOreMilestone(80)).toEqual({ name: 'Silver', depthMeters: 600 });
    expect(formatExpeditionObjective({
      player: { ...upgraded, y: START_Y + 8 },
      cargoCount: 0,
      atSurface: false,
      bay: empty,
      station: empty
    })).toBe('Objective: dig toward Silver around 600 m while keeping fuel for the trip home.');
  });

  it('names the Hauler to a Scout with a Mk I fitted, before the next ore band', () => {
    const scout = {...player, y: START_Y + 8, equipment: ['upgrade:tank:1', null, null] as (UpgradeKind | null)[]};
    const input: ObjectiveInput = {player: scout, cargoCount: 0, atSurface: false, bay: empty, station: empty};
    expect(formatExpeditionObjective(input))
      .toBe('Objective: build the Hauler at the Manufacturing Station (still needs 16 Iron, 10 Copper, 6 Silver).');
    expect(formatExpeditionObjective({...input, station: withOre('Iron', 6)}))
      .toBe('Objective: build the Hauler at the Manufacturing Station (still needs 10 Iron, 10 Copper, 6 Silver).');
    // Only a Mk I fitted names it: a Mk II alone leaves the ore band in charge.
    const markTwo = {...scout, equipment: ['upgrade:drill:2', null, null] as (UpgradeKind | null)[]};
    expect(formatExpeditionObjective({...input, player: markTwo, bestMarkCrafted: 2})).toContain('dig toward Silver');
    // The Scanner and trading-post nudges still come first.
    expect(formatExpeditionObjective({...input, maxDepthMeters: SCANNER_OBJECTIVE_DEPTH})).toContain('craft a Scanner');
    expect(formatExpeditionObjective({...input, maxDepthMeters: POST_OBJECTIVE_DEPTH})).toContain('find a trading post');
  });

  it('counts an upgrade waiting in the station as progress made once no slot is free', () => {
    const full = {...player, y: START_Y + 8, equipment: ['upgrade:drill:1', 'upgrade:hull:1', null] as (UpgradeKind | null)[]};
    expect(formatExpeditionObjective({
      player: full,
      cargoCount: 0,
      atSurface: false,
      bay: empty,
      station: withItem('upgrade:tank:1'),
      bestMarkCrafted: 1
    })).toContain('build the Hauler');
  });

  describe('the next hull on the ladder', () => {
    it('names it once half its bill is stocked, and says what is still short', () => {
      // The Prospector takes 12 Silver, 10 Gold and 4 Ruby: 26 ore, so 13 is half.
      expect(formatExpeditionObjective({...veteran, station: withOre('Gold', 1, withOre('Silver', 12))}))
        .toBe('Objective: build the Prospector at the Manufacturing Station (still needs 9 Gold, 4 Ruby).');
      expect(formatExpeditionObjective({...veteran, station: withOre('Gold', 1, withOre('Silver', 11))})).toContain('dig toward');
    });

    it('drops the shortfall once the whole bill is in stock, ahead of a portal', () => {
      const bill = withOre('Ruby', 4, withOre('Gold', 10, withOre('Silver', 12, withOre('Iron', 2))));
      expect(formatExpeditionObjective({...veteran, station: bill, bestMarkCrafted: 2}))
        .toBe('Objective: build the Prospector at the Manufacturing Station.');
    });

    it('counts the ore aboard toward the bill, and says to stow it once that covers the rest', () => {
      // 12 Silver stocked, 1 Gold aboard: half the Prospector between them, and the
      // Gold aboard is not reported as missing.
      const stocked = {...veteran, station: withOre('Silver', 12)};
      expect(formatExpeditionObjective({...stocked, bay: withOre('Gold', 1)}))
        .toBe('Objective: build the Prospector at the Manufacturing Station (still needs 9 Gold, 4 Ruby).');
      expect(formatExpeditionObjective(stocked)).toContain('dig toward');
      // The rest of the bill in the bay: stow it, then build.
      expect(formatExpeditionObjective({...stocked, bay: withOre('Ruby', 4, withOre('Gold', 10))}))
        .toBe('Objective: stow your ore and build the Prospector at the Manufacturing Station.');
      // The per-frame formatter re-reads the bay too.
      const format = createExpeditionObjectiveFormatter();
      expect(format(stocked)).toContain('dig toward');
      expect(format({...stocked, bay: withOre('Ruby', 4, withOre('Gold', 10))})).toContain('stow your ore and build the Prospector');
    });

    it('has nothing to name on the top rung', () => {
      const top = {...veteran, player: {...upgraded, ship: 'corebreaker' as ShipId}};
      expect(formatExpeditionObjective({...top, station: withOre('Core Shard', 3, withOre('Uranium', 4))})).not.toContain('build the');
    });
  });

  describe('the ore band reached', () => {
    const atGold = {...veteran, player: {...upgraded, y: rowAt(1100)}, maxDepthMeters: 1100, oresMined: {}};

    it('stays on Gold at 1100 m until some is mined, rather than jumping to Ruby', () => {
      expect(formatExpeditionObjective(atGold)).toBe('Objective: mine 3 Gold here for a Mk II upgrade.');
      expect(formatExpeditionObjective({...atGold, oresMined: {Gold: 1}}))
        .toBe('Objective: work the Gold depths around 1100 m — 1 of 3 mined.');
      // Back home, the band is still the one to work.
      expect(formatExpeditionObjective({...atGold, atSurface: true, player: {...upgraded, y: START_Y}}))
        .toBe('Objective: work the Gold depths around 1100 m — 0 of 3 mined.');
    });

    it(`moves on to the next band once ${BAND_ORE_TARGET} of its ore are mined`, () => {
      expect(formatExpeditionObjective({...atGold, oresMined: {Gold: BAND_ORE_TARGET}}))
        .toBe('Objective: dig toward Ruby around 2300 m while keeping fuel for the trip home.');
    });

    it('names what each band\'s ore is for', () => {
      const at = (meters: number) => ({...atGold, player: {...upgraded, y: rowAt(meters)}, maxDepthMeters: meters});
      expect(formatExpeditionObjective(at(2300))).toBe('Objective: mine 3 Ruby here for a Mk III upgrade.');
      expect(formatExpeditionObjective(at(7000))).toBe('Objective: mine 3 Uranium here for the Core Drill.');
    });
  });

  describe('a crafted upgrade waiting to be fitted', () => {
    it('sends a stored one from the station to the Ship screen', () => {
      expect(formatExpeditionObjective({...veteran, atSurface: true, station: withItem('upgrade:drill:1')}))
        .toBe('Objective: take the Drill Mk I from the station and fit it from the Ship screen.');
      // A bare ship too: the fresh-save nudge gives way to fitting what was made.
      expect(formatExpeditionObjective({player, cargoCount: 0, atSurface: true, bay: empty, station: withItem('upgrade:tank:1')}))
        .toBe('Objective: take the Fuel Tank Mk I from the station and fit it from the Ship screen.');
    });

    it('asks for one aboard to be fitted, ahead of one in stock', () => {
      expect(formatExpeditionObjective({...veteran, bay: withItem('upgrade:cargo:1'), station: withItem('upgrade:drill:1')}))
        .toBe('Objective: fit the Cargo Hold Mk I from the Ship screen.');
    });

    it('waits for a free slot: the locked third does not count', () => {
      const full = {...upgraded, equipment: ['upgrade:tank:1', 'upgrade:drill:1', null] as (UpgradeKind | null)[]};
      expect(formatExpeditionObjective({...veteran, player: full, bay: withItem('upgrade:cargo:1')})).toContain('dig toward');
      expect(formatExpeditionObjective({...veteran, player: full, bay: withItem('upgrade:cargo:1'), bestMarkCrafted: 2}))
        .toBe('Objective: fit the Cargo Hold Mk I from the Ship screen.');
    });

    it('leaves the Core Drill to its own rung', () => {
      expect(formatExpeditionObjective({...veteran, station: withItem('upgrade:drill:4')}))
        .toBe('Objective: fit the Core Drill from the Ship screen.');
      // Past the Scanner line with none ever held, that rung still comes first.
      const deep = {...veteran, maxDepthMeters: SCANNER_OBJECTIVE_DEPTH, scannersObtained: 0};
      expect(formatExpeditionObjective({...deep, bay: withItem('upgrade:drill:4')})).toContain('craft a Scanner');
    });
  });

  it('points a bare ship at the wreck holding its upgrades', () => {
    const bare: ObjectiveInput = {player, cargoCount: 0, atSurface: true, bay: empty, station: empty, wreckWithUpgrade: {x: 48, y: 96}};
    expect(formatExpeditionObjective(bare)).toBe('Objective: salvage the wreck at (48, 96) — it holds your upgrades.');
    // Something fitted already, or no such wreck: the ladder carries on.
    expect(formatExpeditionObjective({...veteran, wreckWithUpgrade: {x: 48, y: 96}})).toContain('dig toward');
    expect(formatExpeditionObjective({...bare, wreckWithUpgrade: null})).toBe('Objective: mine Iron and Copper for Fuel Tank Mk I.');
  });

  it('asks for the ore aboard to be stowed when bay and stock cover the first upgrade', () => {
    const input: ObjectiveInput = {player, cargoCount: 6, atSurface: true, bay: tankMaterials(), station: empty};
    expect(formatExpeditionObjective(input)).toBe('Objective: stow your ore and craft Fuel Tank Mk I.');
    expect(formatExpeditionObjective({...input, bay: withOre('Iron', 4), station: withOre('Copper', 2)}))
      .toBe('Objective: stow your ore and craft Fuel Tank Mk I.');
    // Still short between them: keep mining.
    expect(formatExpeditionObjective({...input, bay: withOre('Iron', 3), station: withOre('Copper', 2)}))
      .toBe('Objective: mine Iron and Copper for Fuel Tank Mk I.');
  });

  it('tells a lost ship to deploy a new one, over every other rung', () => {
    const dead = {...veteran, gameOver: true, player: {...upgraded, y: rowAt(760), fuel: 0}, cargoCount: upgraded.cargoMax};
    expect(formatExpeditionObjective(dead)).toBe('Objective: press R (or tap the mine) to deploy a new ship.');
    expect(formatExpeditionObjective({...dead, gameOver: false})).toBe('Objective: fly home and refuel at the Fuel Extractor.');
  });

  it('asks for a Mk II once one is craftable and none has been made', () => {
    expect(formatExpeditionObjective({...veteran, station: markTwoMaterials()}))
      .toBe('Objective: craft a Mk II upgrade at the Manufacturing Station.');
    expect(formatExpeditionObjective({...veteran, station: markTwoMaterials(), bestMarkCrafted: 2}))
      .not.toContain('Mk II');
  });

  it('asks for a Mk II from the Silver band alone: the Fuel Tank Mk II takes no Gold', () => {
    expect(formatExpeditionObjective({...veteran, station: withOre('Copper', 2, withOre('Silver', 4))}))
      .toBe('Objective: craft a Mk II upgrade at the Manufacturing Station.');
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

  it('names the Deep Portal and its bill once the deep recipes are unlocked and it is stocked', () => {
    const deepStock = withOre('Iron', 2, withOre('Emerald', 2, withOre('Ruby', 2)));
    expect(formatExpeditionObjective({...veteran, station: deepStock, bestMarkCrafted: 2}))
      .toBe('Objective: craft a Deep Portal (2 Ruby + 2 Emerald + 2 Iron) and set it down deep — a free ride home.');
    // Still locked before the first Mk II: the ladder carries on.
    expect(formatExpeditionObjective({...veteran, station: deepStock, bestMarkCrafted: 1})).not.toContain('Portal');
    // The standard bill stocked too: the plain Portal is named first.
    expect(formatExpeditionObjective({...veteran, station: withOre('Iron', 2, markTwoMaterials(deepStock)), bestMarkCrafted: 2}))
      .toBe('Objective: craft a Portal and set it down deep — a free ride home.');
    expect(formatExpeditionObjective({...veteran, station: deepStock, bestMarkCrafted: 2, fieldPortals: 1})).not.toContain('Portal');
  });

  it('asks for a Scanner past the Silver line when the career never had one', () => {
    const deep = {...veteran, maxDepthMeters: SCANNER_OBJECTIVE_DEPTH, scannersObtained: 0};
    expect(formatExpeditionObjective(deep))
      .toBe('Objective: craft a Scanner (2 Copper + 1 Silver) or buy one from Supply for $136 — Silver hides beside shafts, so dig sideways galleries.');
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

  it('turns Uranium the Core Drill can spare into a Fuel Cell nudge until a cell is held', () => {
    const text = 'Objective: craft Fuel Cells (1 Uranium → 2 cells, +250 fuel each) for the deep runs.';
    // The Core Drill still to make keeps back the 2 Uranium it takes.
    expect(formatExpeditionObjective({...veteran, bay: withOre('Uranium', 2)})).toContain('dig toward');
    expect(formatExpeditionObjective({...veteran, bay: withOre('Uranium', 3)})).toBe(text);
    // Aboard and stocked count together.
    expect(formatExpeditionObjective({...veteran, bay: withOre('Uranium', 2), station: withOre('Uranium', 1)})).toBe(text);
    // A cell aboard or in the stock settles it.
    expect(formatExpeditionObjective({...veteran, bay: withItem('fuelCell', 1, withOre('Uranium', 3))})).toContain('dig toward');
    expect(formatExpeditionObjective({...veteran, bay: withOre('Uranium', 3), station: withItem('fuelCell')})).toContain('dig toward');
  });

  it('keeps back the Uranium the next hull takes too', () => {
    // A Leviathan's next hull, the Core Breaker, takes 8 more on top of the drill's 2.
    const leviathan = {...veteran, player: {...upgraded, ship: 'leviathan' as ShipId}};
    expect(formatExpeditionObjective({...leviathan, station: withOre('Uranium', 10)})).not.toContain('Fuel Cells');
    expect(formatExpeditionObjective({...leviathan, station: withOre('Uranium', 11)})).toContain('Fuel Cells');
    // With the drill made and fitted, only the hull's 8 are kept.
    const drilled = {...leviathan, player: {...leviathan.player, equipment: ['upgrade:drill:4', null, null] as (UpgradeKind | null)[]}};
    expect(formatExpeditionObjective({...drilled, station: withOre('Uranium', 8)})).toContain('build the Core Breaker');
    expect(formatExpeditionObjective({...drilled, station: withOre('Uranium', 9)})).toContain('Fuel Cells');
  });

  it('asks for the Core Drill once its ores are stocked, ahead of spending the Uranium on cells', () => {
    const stock = withOre('Alienite', 2, withOre('Uranium', 2, withOre('Core Shard', 3)));
    expect(formatExpeditionObjective({...veteran, station: stock}))
      .toBe('Objective: craft the Core Drill at the Manufacturing Station.');
    // One ore short: the Uranium is still kept for the drill, not spent on cells.
    const short = withOre('Alienite', 1, withOre('Uranium', 2, withOre('Core Shard', 3)));
    expect(formatExpeditionObjective({...veteran, station: short})).not.toContain('Fuel Cells');
  });

  it('asks for a Mk III once one is craftable and none has been made', () => {
    const stock = withOre('Alienite', 1, withOre('Emerald', 2, withOre('Ruby', 2)));
    expect(formatExpeditionObjective({...veteran, station: stock, bestMarkCrafted: 2}))
      .toBe('Objective: craft a Mk III upgrade at the Manufacturing Station.');
    expect(formatExpeditionObjective({...veteran, station: stock, bestMarkCrafted: 3})).not.toContain('Mk III');
  });

  describe('a low hull', () => {
    const low = HULL.lowHullFraction * upgraded.hullMax;
    const hurt = {...veteran, player: {...upgraded, y: rowAt(900), hull: low}};

    it('spends a Repair Kit aboard', () => {
      expect(formatExpeditionObjective({...hurt, bay: withItem('repairKit')}))
        .toBe('Objective: hull is low — use a Repair Kit from its bay slot.');
    });

    it('sends a ship with no kit home for one, or to any trading post (every one keeps kits) once one is known', () => {
      expect(formatExpeditionObjective({...hurt, postsFound: 0}))
        .toBe('Objective: hull is low — return home: craft a Repair Kit (2 Iron + 1 Copper) or buy one ($80).');
      expect(formatExpeditionObjective(hurt))
        .toBe('Objective: hull is low — buy a Repair Kit at any trading post ($60), or return home to craft one (2 Iron + 1 Copper).');
    });

    it('at home, takes a stocked kit, or crafts or buys one', () => {
      const home = {...hurt, atSurface: true, player: {...hurt.player, y: START_Y}};
      expect(formatExpeditionObjective({...home, station: withItem('repairKit')}))
        .toBe('Objective: hull is low — take the Repair Kit from the station and use it.');
      expect(formatExpeditionObjective(home))
        .toBe('Objective: hull is low — craft a Repair Kit (2 Iron + 1 Copper) or buy one from Supply ($80).');
    });

    it('comes after low fuel, ahead of a full bay, and not a point above the line', () => {
      expect(formatExpeditionObjective({...hurt, player: {...hurt.player, fuel: 5}})).toContain('refuel');
      expect(formatExpeditionObjective({...hurt, cargoCount: upgraded.cargoMax})).toContain('hull is low');
      expect(formatExpeditionObjective({...hurt, player: {...hurt.player, hull: low + 1}})).toContain('dig toward');
    });
  });

  it('asks for a crafted Core Drill to be fitted', () => {
    expect(formatExpeditionObjective({...veteran, bay: withItem('upgrade:drill:4')}))
      .toBe('Objective: fit the Core Drill from the Ship screen.');
    expect(formatExpeditionObjective({...veteran, station: withItem('upgrade:drill:4')}))
      .toBe('Objective: fit the Core Drill from the Ship screen.');
  });

  it('with the Core Drill fitted, names the next hull before anything else', () => {
    const drilled = {...veteran, player: {...upgraded, ship: 'leviathan' as ShipId, equipment: ['upgrade:drill:4', null, null] as (UpgradeKind | null)[]}};
    expect(formatExpeditionObjective({...drilled, maxDepthMeters: 9840}))
      .toBe('Objective: build the Core Breaker at the Manufacturing Station (still needs 12 Alienite, 8 Uranium, 6 Core Shard).');
  });

  it('with the Core Drill fitted in the last hull, points past the depth record at the next 1000 m', () => {
    const drilled = {...veteran, player: {...upgraded, ship: 'corebreaker' as ShipId, equipment: ['upgrade:drill:4', null, null] as (UpgradeKind | null)[]}};
    expect(formatExpeditionObjective({...drilled, maxDepthMeters: 9840}))
      .toBe('Objective: you have the deepest rig there is — set a depth record past 10000 m.');
    // A record already on the round number points at the next one.
    expect(formatExpeditionObjective({...drilled, maxDepthMeters: 10000}))
      .toBe('Objective: you have the deepest rig there is — set a depth record past 11000 m.');
    // Fitted, it no longer asks to craft or fit another, and the ship's own depth counts.
    const stock = withOre('Alienite', 2, withOre('Uranium', 2, withOre('Core Shard', 3)));
    expect(formatExpeditionObjective({...drilled, station: withItem('fuelCell', 1, stock), player: {...drilled.player, y: rowAt(1230)}}))
      .toBe('Objective: you have the deepest rig there is — set a depth record past 2000 m.');
    // With nothing left to build, any Uranium with no cell still asks for cells first.
    expect(formatExpeditionObjective({...drilled, bay: withOre('Uranium', 1)})).toContain('Fuel Cells');
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
    // Lost with a wreck holding the upgrades, redeployed bare, salvaged, stowed.
    input.gameOver = true;
    check();
    input.gameOver = false;
    input.wreckWithUpgrade = {x: 48, y: 96};
    check();
    input.wreckWithUpgrade = {x: 40, y: 96};
    check();
    input.wreckWithUpgrade = null;
    input.bay = tankMaterials();
    check();
    input.station = input.bay;
    input.bay = empty;
    check();
    input.station = withItem('upgrade:tank:1');
    check();
    input.station = empty;
    check();
    // The late game: Uranium, then a cell, then the Core Drill's ores, crafted,
    // fitted, and the record deepening under it.
    ship.equipment = ['upgrade:tank:1', null, null];
    input.bay = withOre('Uranium', 1);
    check();
    input.bay = withItem('fuelCell', 2, input.bay);
    check();
    input.station = withOre('Alienite', 2, withOre('Uranium', 2, withOre('Core Shard', 3)));
    check();
    input.station = withItem('upgrade:drill:4');
    check();
    input.station = empty;
    ship.equipment = ['upgrade:drill:4', null, null];
    check();
    input.maxDepthMeters = 1500;
    check();
    // Up the ladder in place (same stock, same slots): the Hauler, the Prospector,
    // then the last hull and the record.
    ship.ship = 'hauler';
    check();
    input.station = withOre('Gold', 1, withOre('Silver', 12));
    check();
    input.station = withOre('Gold', 1, withOre('Silver', 11));
    check();
    input.station = empty;
    ship.ship = 'corebreaker';
    check();
    // The band rung: the tally arrives, grows in place, then fills.
    ship.equipment = ['upgrade:tank:1', null, null];
    ship.ship = 'hauler';
    input.bay = empty;
    ship.y = START_Y + 150;
    input.oresMined = {};
    check();
    input.oresMined = {Gold: 1};
    check();
    input.oresMined = {Gold: BAND_ORE_TARGET};
    check();
    // The hull wearing down past the line, with a kit aboard, then at home.
    for (let hull = ship.hullMax; hull >= 10; hull -= 10) {
      ship.hull = hull;
      check();
    }
    input.bay = withItem('repairKit');
    check();
    input.bay = empty;
    input.atSurface = true;
    ship.y = START_Y;
    check();
    ship.hull = ship.hullMax;
    // The base draining below the Coal floor, and a Mk III in stock.
    input.maxDepthMeters = 2000;
    input.baseExtractor = {fuel: 10, coal: 0};
    check();
    input.baseExtractor = {fuel: EXTRACTOR.fuelCap, coal: 0};
    input.station = withOre('Alienite', 1, withOre('Emerald', 2, withOre('Ruby', 2)));
    check();
    input.bestMarkCrafted = 3;
    check();

    expect(new Set(frames).size).toBeGreaterThan(20);
  });

  it('hands back the same string on a steady frame', () => {
    const format = createExpeditionObjectiveFormatter();
    const input: ObjectiveInput = {...veteran, player: {...upgraded, y: rowAt(80)}};
    const first = format(input);
    input.player = {...upgraded, y: rowAt(90)};
    expect(format(input)).toBe(first);
  });
});

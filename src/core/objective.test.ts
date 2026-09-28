import { describe, expect, it } from 'vitest';
import { STARTING } from './balance';
import { createExpeditionObjectiveFormatter, formatExpeditionObjective, nextOreMilestone, type ObjectiveInput } from './objective';
import { addItem, createInventory, oreItem, type Inventory, type UpgradeKind } from './inventory';
import { ORES, START_Y } from '../../shared/constants';

const player = {
  y: START_Y,
  fuel: STARTING.fuel,
  fuelMax: STARTING.fuelMax,
  cargoMax: STARTING.cargoMax,
  equipment: [null, null] as (UpgradeKind | null)[]
};

const empty = createInventory();

/** A station stock holding `count` of a named ore. */
function withOre(name: string, count: number, base: Inventory = createInventory()): Inventory {
  const ore = ORES.find(entry => entry.name === name)!;
  return addItem(base, oreItem(ore), count);
}

/** The materials a Fuel Tank Mk I needs: 4 Iron + 2 Copper. */
function tankMaterials(): Inventory {
  return withOre('Copper', 2, withOre('Iron', 4));
}

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
    })).toBe('Objective: return home and refuel at the Fuel Extractor.');
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

  it('points players with an upgrade fitted toward the next ore band', () => {
    expect(nextOreMilestone(80)).toEqual({ name: 'Silver', depthMeters: 600 });
    expect(formatExpeditionObjective({
      player: { ...player, y: START_Y + 8, equipment: ['upgrade:tank:1', null] },
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

  it('keeps hauling the richest seam once every ore band is unlocked', () => {
    expect(nextOreMilestone(8600)).toBeNull();
    // The mine has no bottom, so the deep-run objective must never name a final
    // target such as the old Motherlode-core-at-10,000 m goal.
    const objective = formatExpeditionObjective({
      player: { ...player, y: START_Y + 860, equipment: ['upgrade:tank:1', null] },
      cargoCount: 0,
      atSurface: false,
      bay: empty,
      station: empty
    });

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
    const ship = {...player, equipment: [null, null] as (UpgradeKind | null)[]};
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
    ship.fuel = ship.fuelMax;
    check();
    // Filling the bay to the brim.
    for (let count = 0; count <= ship.cargoMax; count++) {
      input.cargoCount = count;
      check();
    }
    input.cargoCount = 0;
    // Unfitting leaves an upgrade in the bay (a new bay array), then nowhere.
    ship.equipment = [null, null];
    input.bay = addItem(createInventory(), {kind: 'upgrade:tank:1', label: 'Fuel Tank Mk I', color: '#000', value: 0});
    check();
    input.bay = empty;
    check();

    expect(new Set(frames).size).toBeGreaterThan(4);
  });
});

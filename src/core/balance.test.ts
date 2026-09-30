import { describe, expect, it } from 'vitest';
import { ORES } from '../../shared/constants';
import { dirtHpAtRow, oreSpawnChanceAtDepth } from '../world/world';
import { EXTRACTOR, FUEL, STARTING } from './balance';
import { hitsLeft } from './scanner';
import { UPGRADE_EFFECTS } from './ship-upgrades';

/** Fuel one downward drill hit burns: `move()`'s `(baseMove + vertical + dig) × digMult`. */
const DIG_HIT_FUEL = (FUEL.baseMove + FUEL.vertical + FUEL.dig.dig) * FUEL.digMult;

/** The drill a coal run sweeps with: the Scout's own, plus a Drill Mk I. */
const SWEEP_DRILL = STARTING.drill + UPGRADE_EFFECTS.drill.bonuses[0]!;

/** The stretch of mine one sweep is measured over. */
const SWEEP_TILES = 100;

/** How many times over the coal a sweep turns up must repay the fuel it burns. */
const COAL_PAYBACK = 1.2;

describe('the coal → fuel economy', () => {
  // The sweep model, as the 2026-09-30 playtest measured coal runs: the ship digs
  // through the band's dirt and keeps the coal that happens to lie in its path.
  // Coal is not a target it digs to through a few tiles of overburden — it is a
  // share of the ore that rolls in the tiles it digs anyway.
  const coal = ORES.find(ore => ore.name === 'Coal')!;
  const midRow = Math.round((coal.min + coal.max) / 2);

  /** Coal's share of an ore roll at `row`: its weight among the ores in band there. */
  function coalShare(row: number): number {
    const inBand = ORES.filter(ore => row >= ore.min && row <= ore.max);
    return coal.chance / inBand.reduce((sum, ore) => sum + ore.chance, 0);
  }

  it('pays a mid-band sweep back at least 1.2 times over at drill 1.75', () => {
    const coalFound = SWEEP_TILES * oreSpawnChanceAtDepth(midRow) * coalShare(midRow);
    const fuelBurned = SWEEP_TILES * hitsLeft(dirtHpAtRow(midRow), SWEEP_DRILL) * DIG_HIT_FUEL;

    expect(SWEEP_DRILL).toBe(1.75);
    expect(coalFound * EXTRACTOR.fuelPerCoal).toBeGreaterThanOrEqual(COAL_PAYBACK * fuelBurned);
  });

  it('runs the Coal band past the top of the Gold band', () => {
    // Coal overlaps the Gold depths (and the first Portal's), so a Gold run still
    // passes through coal to feed the extractor with.
    const gold = ORES.find(ore => ore.name === 'Gold')!;
    expect(coal.max).toBeGreaterThan(gold.min);
  });
});

describe('the hover side-dig surcharge', () => {
  it('charges a hover side hit at most a quarter over a braced one', () => {
    // About one visible ore in three sits in the row above a tunnel, reachable only
    // from a hover; a steeper surcharge made those ores cost more fuel than they paid.
    expect(FUEL.hoverDrillMult).toBeGreaterThan(1);
    expect(FUEL.hoverDrillMult).toBeLessThanOrEqual(1.25);
  });
});

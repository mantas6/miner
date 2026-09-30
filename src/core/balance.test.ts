import { describe, expect, it } from 'vitest';
import { ORES } from '../../shared/constants';
import { oreHpAtRow } from '../world/world';
import { EXTRACTOR, FUEL } from './balance';

/** Fuel one downward drill hit burns: `move()`'s `(baseMove + vertical + dig) × digMult`. */
const DIG_HIT_FUEL = (FUEL.baseMove + FUEL.vertical + FUEL.dig.dig) * FUEL.digMult;

/** Tiles of overburden a coal run digs through on top of the coal itself. */
const OVERHEAD_TILES = 3;

/** How many times over a coal must repay the fuel spent harvesting it. */
const COAL_PAYBACK = 2.5;

describe('the coal → fuel economy', () => {
  it('pays back harvesting a mid-band coal at least 2.5 times over', () => {
    const coal = ORES.find(ore => ore.name === 'Coal')!;
    const midRow = Math.round((coal.min + coal.max) / 2);
    const harvestCost = (oreHpAtRow(midRow) + OVERHEAD_TILES) * DIG_HIT_FUEL;

    expect(EXTRACTOR.fuelPerCoal).toBeGreaterThanOrEqual(COAL_PAYBACK * harvestCost);
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

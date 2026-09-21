import { describe, expect, it } from 'vitest';
import { STARTING } from './balance';
import { formatExpeditionObjective, nextOreMilestone } from './objective';
import { ORES, START_Y } from '../../shared/constants';

const player = {
  y: START_Y,
  fuel: STARTING.fuel,
  fuelMax: STARTING.fuelMax,
  hull: STARTING.hull,
  hullMax: STARTING.hullMax,
  cargoMax: STARTING.cargoMax,
  drill: STARTING.drill
};

describe('expedition objective helper', () => {
  it('starts new runs with starter seam guidance', () => {
    expect(formatExpeditionObjective({
      player,
      cash: STARTING.cash,
      cargoCount: 0,
      currentCargoValue: 0,
      atSurface: true
    })).toBe('Objective: mine the starter Coal/Copper seam below the depot, then return to sell.');
  });

  it('turns starter Coal/Iron cargo into return-and-upgrade guidance', () => {
    const cargoValue = ORES[0].value + ORES[1].value;

    expect(formatExpeditionObjective({
      player: { ...player, y: START_Y + 4 },
      cash: 100,
      cargoCount: 2,
      currentCargoValue: cargoValue,
      atSurface: false
    })).toBe(`Objective: return and sell $${cargoValue}; Cargo +10 is ready after sale.`);
  });

  it('prioritizes low fuel return warnings underground', () => {
    expect(formatExpeditionObjective({
      player: { ...player, y: START_Y + 12, fuel: 20 },
      cash: 20,
      cargoCount: 0,
      currentCargoValue: 0,
      atSurface: false
    })).toBe('Objective: return to the surface now — fuel is 20/100.');
  });

  it('points deeper players toward the next ore band', () => {
    expect(nextOreMilestone(80)).toEqual({ name: 'Silver', depthMeters: 600 });
    expect(formatExpeditionObjective({
      player: { ...player, y: START_Y + 8 },
      cash: 20,
      cargoCount: 0,
      currentCargoValue: 0,
      atSurface: false
    })).toBe('Objective: dig toward Silver around 600 m while keeping fuel for the trip home.');
  });

  it('keeps hauling the richest seam once every ore band is unlocked', () => {
    expect(nextOreMilestone(8600)).toBeNull();
    // The mine has no bottom, so the deep-run objective must never name a final
    // target such as the old Motherlode-core-at-10,000 m goal.
    const objective = formatExpeditionObjective({
      player: { ...player, y: START_Y + 860 },
      cash: 200,
      cargoCount: 0,
      currentCargoValue: 0,
      atSurface: false
    });

    expect(objective).toBe('Objective: work the Core Shard depths, fill the bay, and get home alive.');
    expect(objective).not.toContain('Motherlode');
  });
});

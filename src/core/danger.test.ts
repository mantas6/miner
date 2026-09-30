import { describe, expect, it } from 'vitest';
import { ENEMY, FUEL, HULL, RESPAWN } from './balance';
import { DANGER, START_Y } from '../../shared/constants';
import { buildDangerGuideRows } from './danger';
import { EXTRACTOR_FUEL_ORDER } from './trading';
import { WRECK } from './wreck';

describe('danger guide helpers', () => {
  it('derives every survival topic from the configured world and balance rules', () => {
    const rows = buildDangerGuideRows();
    const byTitle = new Map(rows.map(row => [row.title, row.detail]));

    expect(rows).toHaveLength(9);
    expect(byTitle.get('Solid rock')).toContain(`≈${(DANGER.rockMinRow - START_Y) * 10} m`);
    expect(byTitle.get('Solid rock')).toContain(`${HULL.rockBump}-hull`);
    expect(byTitle.get('Magma pockets')).toContain(`≈${(DANGER.hazardMinRow - START_Y) * 10} m`);
    expect(byTitle.get('Dormant tunnel fiends')).toContain(`≈${(DANGER.enemyMinRow - START_Y) * 10} m`);
    expect(byTitle.get('Active fiends')).toContain(`${HULL.enemyBite.base} hull damage`);
    expect(byTitle.get('Fiend bounties')).toContain(`$${ENEMY.bounty.base}`);
    expect(byTitle.get('Fiend bounties')).toContain(`$${ENEMY.bounty.step}`);
    expect(byTitle.get('Fuel discipline')).toContain(`${FUEL.lowFuelFraction * 100}% fuel`);
    expect(byTitle.get('Fuel discipline')).toContain('falling is free');
    expect(byTitle.get('Magma pockets')).toContain('per hit');
    expect(byTitle.get('Buying fuel')).toContain(`$29 per ${EXTRACTOR_FUEL_ORDER}`);
    expect(byTitle.get('Losing a ship')).toContain(`crumbles after ${WRECK.lifetimeDeaths} more deaths`);
    expect(byTitle.get('Losing a ship')).toContain(`${RESPAWN.hullFraction * 100}% hull`);
    expect(byTitle.get('Losing a ship')).toContain(`${RESPAWN.portalFuelFraction * 100}% of a tank`);
  });

  it('teaches the counters to a biting fiend: fight from above, and an awake one overhead can be drilled', () => {
    const detail = buildDangerGuideRows().find(row => row.title === 'Fighting fiends')?.detail ?? '';
    expect(detail).toContain('Fight from above in a one-tile shaft');
    expect(detail).toContain('hold Up into it');
    expect(detail).not.toContain('cannot be drilled');
  });
});

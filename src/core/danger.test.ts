import { describe, expect, it } from 'vitest';
import { ENEMY, FUEL, HULL } from './balance';
import { DANGER, START_Y } from '../../shared/constants';
import { buildDangerGuideRows } from './danger';

describe('danger guide helpers', () => {
  it('derives every survival topic from the configured world and balance rules', () => {
    const rows = buildDangerGuideRows();
    const byTitle = new Map(rows.map(row => [row.title, row.detail]));

    expect(rows).toHaveLength(6);
    expect(byTitle.get('Solid rock')).toContain(`≈${(DANGER.rockMinRow - START_Y) * 10} m`);
    expect(byTitle.get('Solid rock')).toContain(`${HULL.rockBump}-hull`);
    expect(byTitle.get('Magma pockets')).toContain(`≈${(DANGER.hazardMinRow - START_Y) * 10} m`);
    expect(byTitle.get('Dormant tunnel fiends')).toContain(`≈${(DANGER.enemyMinRow - START_Y) * 10} m`);
    expect(byTitle.get('Active fiends')).toContain(`${HULL.enemyBite.base} hull damage`);
    expect(byTitle.get('Fiend bounties')).toContain(`$${ENEMY.bounty.base}`);
    expect(byTitle.get('Fiend bounties')).toContain(`$${ENEMY.bounty.step}`);
    expect(byTitle.get('Fuel discipline')).toContain(`${FUEL.lowFuelFraction * 100}% fuel`);
  });
});

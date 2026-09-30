import { describe, expect, it } from 'vitest';
import { ENEMY, FUEL, HULL, RESPAWN, STARTING, TERRAIN } from './balance';
import { DANGER, START_Y } from '../../shared/constants';
import { buildDangerGuideRows, magmaHitDamage, magmaPocketDamage } from './danger';
import { COCOON_WAKE_RADIUS } from './enemy-exposure';
import { hitsLeft } from './scanner';
import { EXTRACTOR_FUEL_ORDER } from './trading';
import { WRECK } from './wreck';

describe('danger guide helpers', () => {
  it('derives every survival topic from the configured world and balance rules', () => {
    const rows = buildDangerGuideRows();
    const byTitle = new Map(rows.map(row => [row.title, row.detail]));

    expect(rows).toHaveLength(10);
    expect(byTitle.get('Solid rock')).toContain(`≈${(DANGER.rockMinRow - START_Y) * 10} m`);
    expect(byTitle.get('Solid rock')).toContain(`${HULL.rockBump}-hull`);
    expect(byTitle.get('Magma pockets')).toContain(`≈${(DANGER.hazardMinRow - START_Y) * 10} m`);
    expect(byTitle.get('Dormant tunnel fiends')).toContain(`≈${(DANGER.enemyMinRow - START_Y) * 10} m`);
    expect(byTitle.get('Active fiends')).toContain(`${HULL.enemyBite.base} hull damage`);
    expect(byTitle.get('Fiend bounties')).toContain(`$${ENEMY.bounty.base}`);
    expect(byTitle.get('Fiend bounties')).toContain(`$${ENEMY.bounty.step}`);
    expect(byTitle.get('Fuel discipline')).toContain(`${FUEL.lowFuelFraction * 100}% fuel`);
    expect(byTitle.get('Fuel discipline')).toContain('falling is free');
    // Magma is charged per pocket: the breach once, then a small tail per hit.
    expect(byTitle.get('Magma pockets')).toContain(`scorches the hull once — ${magmaHitDamage(DANGER.hazardMinRow, true)} hull there`);
    expect(byTitle.get('Magma pockets')).toContain(`(${magmaHitDamage(DANGER.hazardMinRow, false)} hull there)`);
    expect(byTitle.get('Magma pockets')).toContain('never immune');
    expect(byTitle.get('Magma pockets')).not.toContain('per hit');
    expect(byTitle.get('Dormant tunnel fiends')).toContain(`within ${COCOON_WAKE_RADIUS} tiles`);
    expect(byTitle.get('Patching the hull')).toContain(`${HULL.repairKitFraction * 100}% of the hull`);
    expect(byTitle.get('Patching the hull')).toContain('any trading post ($60)');
    expect(byTitle.get('Patching the hull')).toContain('Supply ($80)');
    expect(byTitle.get('Patching the hull')).toContain('Any portal');
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

describe('the magma curve', () => {
  /** A pocket's hit points at `row`, as the generator rolls them (`makeTile`). */
  const pocketHp = (row: number) => Math.max(TERRAIN.hazard.hpMin, Math.ceil(TERRAIN.hazard.hpBase + row / TERRAIN.hazard.hpRowDivisor));
  /** What venting a whole pocket at `metres` costs a drill of `drill` power. */
  const pocket = (metres: number, drill: number) => {
    const row = START_Y + metres / 10;
    return magmaPocketDamage(row, hitsLeft(pocketHp(row), drill));
  };

  it('charges the burst on the breaching hit and only the tail after it', () => {
    const row = START_Y + 150;
    expect(magmaHitDamage(row, true)).toBe(HULL.hazardBase + Math.floor(row / HULL.hazardDepthDivisor));
    expect(magmaHitDamage(row, false)).toBe(HULL.hazardTail.base + Math.floor(row / HULL.hazardTail.depthDivisor));
    expect(magmaHitDamage(row, false)).toBeLessThan(magmaHitDamage(row, true) / 4);
    expect(magmaPocketDamage(row, 1)).toBe(magmaHitDamage(row, true));
    expect(magmaPocketDamage(row, 4)).toBe(magmaHitDamage(row, true) + 3 * magmaHitDamage(row, false));
    expect(magmaPocketDamage(row, 0)).toBe(0);
  });

  it('rises with depth, both the burst and the tail', () => {
    for (let metres = 1500; metres < 9000; metres += 500) {
      const row = START_Y + metres / 10;
      expect(magmaHitDamage(row + 50, true)).toBeGreaterThanOrEqual(magmaHitDamage(row, true));
      expect(magmaHitDamage(row + 50, false)).toBeGreaterThanOrEqual(magmaHitDamage(row, false));
    }
    expect(magmaHitDamage(START_Y + 700, true)).toBeGreaterThan(magmaHitDamage(START_Y + 150, true));
  });

  it('pins the documented pocket totals (HULL.hazardBase)', () => {
    expect(pocket(1500, 1)).toBe(15);
    expect(pocket(1500, 1.75)).toBe(12);
    expect(pocket(1500, 3.5)).toBe(10);
    expect(pocket(4000, 1.75)).toBe(24);
    expect(pocket(4000, 3.75)).toBe(16);
    expect(pocket(4000, 10)).toBe(14);
    expect(pocket(5400, 3.75)).toBe(20);
    expect(pocket(5400, 10)).toBe(16);
    expect(pocket(7000, 3.75)).toBe(28);
    expect(pocket(7000, 10)).toBe(19);
  });

  it('never leaves a top drill immune, nor shreds a starter drill', () => {
    // Drill 10 deep still loses a real share of a starting hull to every pocket…
    for (const metres of [4000, 5400, 7000, 9000]) expect(pocket(metres, 10)).toBeGreaterThanOrEqual(12);
    // …and a bare drill 1 at the first pockets keeps most of its hull.
    expect(pocket(1500, 1)).toBeLessThanOrEqual(STARTING.hullMax * 0.2);
    // A stronger drill always takes less from the same pocket, but only the tail less.
    expect(pocket(4000, 1.75)).toBeGreaterThan(pocket(4000, 3.75));
    expect(pocket(4000, 3.75) - pocket(4000, 10)).toBe(magmaHitDamage(START_Y + 400, false));
  });
});

import { describe, expect, it } from 'vitest';
import { HULL } from './balance';
import { DANGER } from '../../shared/constants';
import { ENEMY_TYPES, enemyBiteCooldown, enemyBiteDamage, enemyHealth, enemyKindForDepthRoll, enemyMoveDelay } from './enemy-types';
import { makeTile } from '../world/world';

describe('enemy variants', () => {
  const sampledKinds = (row: number) => new Set(
    Array.from({length: 1000}, (_, index) => enemyKindForDepthRoll(row, (index + .5) / 1000))
  );

  it('keeps shallow enemies approachable and gates variety by depth', () => {
    expect(sampledKinds(DANGER.enemyMinRow)).toEqual(new Set(['tunnelFiend']));
    expect(sampledKinds(ENEMY_TYPES.skitterling.minRow)).toEqual(new Set(['tunnelFiend', 'skitterling']));
    expect(sampledKinds(ENEMY_TYPES.ironback.minRow)).toEqual(new Set(['tunnelFiend', 'skitterling', 'ironback']));
    expect(sampledKinds(ENEMY_TYPES.abyssStalker.minRow)).toEqual(new Set(['tunnelFiend', 'skitterling', 'ironback', 'abyssStalker']));
  });

  it('shifts unlimited-world encounters toward stronger deep variants after 20 km', () => {
    const count = (row: number, kind: string) => Array.from({length: 1000}, (_, index) =>
      enemyKindForDepthRoll(row, (index + .5) / 1000)
    ).filter(candidate => candidate === kind).length;

    expect(count(2002, 'tunnelFiend')).toBeLessThan(count(1002, 'tunnelFiend'));
    expect(count(2002, 'ironback')).toBeGreaterThanOrEqual(count(1002, 'ironback'));
    expect(count(2002, 'abyssStalker')).toBeGreaterThan(count(1002, 'abyssStalker'));
  });

  it('assigns deterministic kinds to generated dormant enemies beyond 10,000 m', () => {
    const enemies = [];
    for (let y = 1002; y < 1150; y++) for (let x = 0; x < 90; x++) {
      const tile = makeTile(x, y);
      if (tile.type === 'enemy') enemies.push(tile);
    }

    expect(enemies.length).toBeGreaterThan(100);
    expect(new Set(enemies.map(enemy => enemy.kind))).toEqual(new Set(['tunnelFiend', 'skitterling', 'ironback', 'abyssStalker']));
    expect(makeTile(17, 1105)).toEqual(makeTile(17, 1105));
  });

  it('gives each variant a distinct health, movement, and attack profile while preserving fiend bites', () => {
    const row = 420;
    expect(enemyHealth('skitterling', 10)).toBeLessThan(enemyHealth('tunnelFiend', 10));
    expect(enemyHealth('ironback', 10)).toBeGreaterThan(enemyHealth('abyssStalker', 10));
    expect(enemyMoveDelay('skitterling', row)).toBeLessThan(enemyMoveDelay('tunnelFiend', row));
    expect(enemyMoveDelay('ironback', row)).toBeGreaterThan(enemyMoveDelay('tunnelFiend', row));
    expect(enemyMoveDelay('tunnelFiend', 10_000)).toBe(7);
    expect(enemyBiteCooldown('skitterling')).toBeLessThan(enemyBiteCooldown('tunnelFiend'));
    expect(enemyBiteDamage('ironback', row)).toBeGreaterThan(enemyBiteDamage('abyssStalker', row));
    expect(enemyBiteDamage('tunnelFiend', row)).toBe(
      HULL.enemyBite.base + Math.floor(row / HULL.enemyBite.perDepth) * HULL.enemyBite.step
    );
  });
});

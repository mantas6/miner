import { describe, expect, it } from 'vitest';
import { HULL, TERRAIN } from './balance';
import { DANGER, START_Y, rowDepthMeters } from '../../shared/constants';
import { ENEMY_TYPES, enemyBiteCooldown, enemyBiteDamage, enemyHealth, enemyKindForDepthRoll, enemyMoveDelay } from './enemy-types';
import { FIXED_STEP_MS } from './fixed-step';
import { computeStats } from './ship-upgrades';
import { createInitialState } from './state';
import { makeTile } from '../world/world';

/** Every kind a row's dormant-enemy roll can come up with. */
const sampledKinds = (row: number) => new Set(
  Array.from({length: 1000}, (_, index) => enemyKindForDepthRoll(row, (index + .5) / 1000))
);

describe('enemy variants', () => {
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

describe('Abyss Stalkers against the Core Breaker', () => {
  /** A stalker's hp where it wakes, as worldgen rolls it (`makeTile`). */
  const stalkerHp = (row: number) => enemyHealth('abyssStalker', Math.max(
    TERRAIN.enemy.hpMin, Math.ceil(TERRAIN.enemy.hpBase + row / TERRAIN.enemy.hpRowDivisor)
  ));
  // The last hull with Hull Plating Mk III and the Core Drill: 450 hull, drill 11.
  const rig = computeStats('corebreaker', ['upgrade:hull:3', 'upgrade:drill:4']);
  const kit = rig.hullMax * HULL.repairKitFraction;
  /** Steps between two drill hits under a held key. */
  const hitSteps = createInitialState().input.keyboardRepeatMs / FIXED_STEP_MS;
  /** Half a second to turn onto a stalker and start drilling once it is alongside. */
  const reactionSteps = 30;

  /** The hull one stalker at `row` chews off before the drill kills it. */
  function fightCost(row: number): number {
    const hits = Math.ceil(stalkerHp(row) / rig.drill);
    const fightSteps = reactionSteps + (hits - 1) * hitSteps;
    // It bites on contact, then again every time its cooldown runs out.
    const bites = 1 + Math.floor(fightSteps / (enemyBiteCooldown('abyssStalker') + 1));
    return bites * enemyBiteDamage('abyssStalker', row);
  }

  it('wakes inside the deepest ore bands, from 8800 m', () => {
    expect(ENEMY_TYPES.abyssStalker.minRow).toBe(START_Y + 880);
    expect(rowDepthMeters(ENEMY_TYPES.abyssStalker.minRow)).toBe(8800);
    expect(sampledKinds(START_Y + 879).has('abyssStalker')).toBe(false);
    expect(sampledKinds(START_Y + 880).has('abyssStalker')).toBe(true);
  });

  it('lets a 450-hull Core Breaker take three on a full hull and a fourth with a kit', () => {
    expect(rig).toMatchObject({hullMax: 450, drill: 11});
    const row = ENEMY_TYPES.abyssStalker.minRow;
    expect(stalkerHp(row)).toBe(37);
    expect(enemyBiteDamage('abyssStalker', row)).toBe(38);
    // Two or three bites a fight: it hurts, and a careless pilot feels it.
    expect(fightCost(row)).toBeGreaterThanOrEqual(2 * 38);
    expect(3 * fightCost(row)).toBeLessThan(rig.hullMax);
    expect(4 * fightCost(row)).toBeGreaterThan(rig.hullMax);
    expect(4 * fightCost(row)).toBeLessThan(rig.hullMax + kit);
    // A thousand metres deeper they bite harder, and three still leave the hull standing.
    expect(3 * fightCost(START_Y + 980)).toBeLessThan(rig.hullMax);
  });
});


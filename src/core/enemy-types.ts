import { HULL } from './balance';
import { DANGER, START_Y } from '../../shared/constants';
import type { EnemyKind, NonEmpty } from './types';

export interface EnemyTypeDefinition {
  kind: EnemyKind;
  name: string;
  minRow: number;
  healthMultiplier: number;
  moveDelayAdjustment: number;
  biteMultiplier: number;
  biteCooldown: number;
  colors: readonly [string, string, string];
  glow: string;
}

// Rows are `START_Y + n` offsets, like `DANGER` and the ore table, so a shifted
// home row leaves the enemy mix exactly where it was balanced.
export const ENEMY_TYPES: Record<EnemyKind, EnemyTypeDefinition> = {
  tunnelFiend: {
    kind: 'tunnelFiend', name: 'Tunnel Fiend', minRow: DANGER.enemyMinRow,
    healthMultiplier: 1, moveDelayAdjustment: 0, biteMultiplier: 1, biteCooldown: 22,
    colors: ['#c5ff62', '#4fa23d', '#17391e'], glow: '#72ff4a'
  },
  skitterling: {
    kind: 'skitterling', name: 'Skitterling', minRow: START_Y + 132,
    healthMultiplier: .72, moveDelayAdjustment: -3, biteMultiplier: .7, biteCooldown: 15,
    colors: ['#fff38a', '#d16a31', '#54201d'], glow: '#ffb34f'
  },
  ironback: {
    kind: 'ironback', name: 'Ironback', minRow: START_Y + 382,
    healthMultiplier: 1.65, moveDelayAdjustment: 4, biteMultiplier: 1.55, biteCooldown: 30,
    colors: ['#d9ecff', '#657b91', '#202b3a'], glow: '#8ec9ff'
  },
  // Stalkers wake from 8800 m, inside the Uranium and Core Shard bands the Core
  // Drill and the Core Breaker are mined from, so the last hull has something to
  // fight (they used to start at 9820 m, below every ore band). At their
  // shallowest a stalker has 37 hp and bites for 38 every 19 steps: a Core Breaker
  // with Hull Plating Mk III and the Core Drill (450 hull, drill 11) kills one in
  // four hits and takes two or three bites doing it, so it survives three on a
  // full hull and a fourth with a Repair Kit — `enemy-types.test.ts` pins that.
  abyssStalker: {
    kind: 'abyssStalker', name: 'Abyss Stalker', minRow: START_Y + 880,
    healthMultiplier: 1.25, moveDelayAdjustment: -2, biteMultiplier: 1.25, biteCooldown: 18,
    colors: ['#f6b8ff', '#8749ba', '#27123e'], glow: '#df76ff'
  }
};

// The mix of dormant kinds by row: each band opens where its newest kind first
// appears, and the deepest band a row reaches decides.
type DepthBand = {minRow: number; weights: ReadonlyArray<readonly [EnemyKind, number]>};
// Non-empty by type, so the shallowest band is always there to fall back on.
const DEPTH_BANDS: NonEmpty<DepthBand> = [
  {minRow: DANGER.enemyMinRow, weights: [['tunnelFiend', 1]]},
  {minRow: ENEMY_TYPES.skitterling.minRow, weights: [['tunnelFiend', .7], ['skitterling', .3]]},
  {minRow: ENEMY_TYPES.ironback.minRow, weights: [['tunnelFiend', .45], ['skitterling', .3], ['ironback', .25]]},
  {minRow: ENEMY_TYPES.abyssStalker.minRow, weights: [['tunnelFiend', .25], ['skitterling', .28], ['ironback', .27], ['abyssStalker', .2]]},
  {minRow: START_Y + 1982, weights: [['tunnelFiend', .12], ['skitterling', .28], ['ironback', .3], ['abyssStalker', .3]]}
];

export function enemyKindForDepthRoll(row: number, roll: number): EnemyKind {
  // Not a `find`: the deepest matching band wins, not the first one.
  // oxlint-disable-next-line unicorn/prefer-array-find
  const band = DEPTH_BANDS.filter(candidate => row >= candidate.minRow).at(-1) || DEPTH_BANDS[0];
  let target = Math.max(0, Math.min(.999999999, roll));
  for (const [kind, weight] of band.weights) {
    target -= weight;
    if (target < 0) return kind;
  }
  return band.weights.at(-1)![0];
}

export function getEnemyType(kind?: EnemyKind): EnemyTypeDefinition {
  return kind ? ENEMY_TYPES[kind] : ENEMY_TYPES.tunnelFiend;
}

export function enemyHealth(kind: EnemyKind, baseHealth: number): number {
  return Math.max(1, Math.ceil(baseHealth * getEnemyType(kind).healthMultiplier));
}

export function enemyMoveDelay(kind: EnemyKind, row: number): number {
  const fiendDelay = Math.max(7, 14 - Math.floor(row / 70));
  return Math.max(4, fiendDelay + getEnemyType(kind).moveDelayAdjustment);
}

export function enemyBiteCooldown(kind: EnemyKind): number {
  return getEnemyType(kind).biteCooldown;
}

export function enemyBiteDamage(kind: EnemyKind, row: number): number {
  const base = HULL.enemyBite.base + Math.floor(row / HULL.enemyBite.perDepth) * HULL.enemyBite.step;
  return Math.max(1, Math.round(base * getEnemyType(kind).biteMultiplier));
}

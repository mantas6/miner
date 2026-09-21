import { describe, expect, it, vi } from 'vitest';
import { ENEMY } from '../core/balance';
import { createInitialState } from '../core/state';
import type { Enemy, GameState } from '../core/types';
import { createEnemySim, type EnemySim } from './enemies';
import {
  createAudioStub,
  createFakeGrid,
  createToastLog,
  type FakeGrid
} from './test-support';

const bountyAt = (y: number) => ENEMY.bounty.base + Math.floor(y / ENEMY.bounty.depthDivisor) * ENEMY.bounty.step;

interface Harness {
  state: GameState;
  grid: FakeGrid;
  sim: EnemySim;
  addCash: ReturnType<typeof vi.fn>;
  saveProgress: ReturnType<typeof vi.fn>;
  toasts: ReturnType<typeof createToastLog>;
  spawnExplosion: ReturnType<typeof vi.fn>;
}

function harness(): Harness {
  const state = createInitialState();
  const context = {
    state,
    grid: createFakeGrid(),
    addCash: vi.fn((amount: number) => { state.cash += amount; }),
    saveProgress: vi.fn(),
    toasts: createToastLog(),
    spawnExplosion: vi.fn()
  };
  const sim = createEnemySim({
    state,
    grid: context.grid,
    audio: createAudioStub(),
    toast: context.toasts.toast,
    addCash: context.addCash,
    saveProgress: context.saveProgress,
    damagePlayer: vi.fn(),
    spawnDust: vi.fn(),
    spawnExplosion: context.spawnExplosion
  });
  return {...context, sim};
}

function spawnEnemy(state: GameState, overrides: Partial<Enemy> = {}): Enemy {
  const enemy: Enemy = {
    id: 7, kind: 'tunnelFiend', x: 10, y: 70, drawX: 10, drawY: 70,
    hp: 4, maxHp: 4, alive: true, moveTick: 0, biteTick: 0, flash: 0,
    ...overrides
  };
  state.enemies.push(enemy);
  return enemy;
}

describe('killing a live enemy', () => {
  it('pays the bounty, counts the kill, and removes the enemy', () => {
    const h = harness();
    const enemy = spawnEnemy(h.state, {hp: 3, y: 70});

    h.sim.damageEnemy(enemy, 3);

    expect(enemy.alive).toBe(false);
    expect(h.addCash).toHaveBeenCalledWith(bountyAt(70));
    expect(h.state.stats.enemiesDestroyed).toBe(1);
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.spawnExplosion).toHaveBeenCalledWith(10, 70);
  });

  it('scales the bounty with depth', () => {
    const shallow = harness();
    shallow.sim.damageEnemy(spawnEnemy(shallow.state, {hp: 1, y: 10}), 1);

    const deep = harness();
    const deepEnemy = spawnEnemy(deep.state, {hp: 1, y: 700});
    deep.sim.damageEnemy(deepEnemy, 1);

    expect(shallow.addCash).toHaveBeenCalledWith(bountyAt(10));
    expect(deep.addCash).toHaveBeenCalledWith(bountyAt(700));
    expect(bountyAt(700)).toBeGreaterThan(bountyAt(10));
  });

  it('only wounds an enemy that survives the hit', () => {
    const h = harness();
    const enemy = spawnEnemy(h.state, {hp: 4});

    h.sim.damageEnemy(enemy, 1);

    expect(enemy).toMatchObject({hp: 3, alive: true, flash: 1});
    expect(h.addCash).not.toHaveBeenCalled();
    expect(h.toasts.saw('3 HP left')).toBe(true);
  });

  it('ignores a missing or already dead target', () => {
    const h = harness();
    const dead = spawnEnemy(h.state, {alive: false});

    h.sim.damageEnemy(undefined);
    h.sim.damageEnemy(dead, 5);

    expect(h.addCash).not.toHaveBeenCalled();
  });
});

describe('dormant cocoons', () => {
  it('drills a cocoon down before clearing the tile and paying the bounty', () => {
    const h = harness();
    h.state.player.drill = 2;
    h.grid.put(4, 80, {type: 'enemy', kind: 'tunnelFiend', hp: 4, maxHp: 4});

    expect(h.sim.damageEnemyTile(4, 80)).toBe(true);
    expect(h.grid.get(4, 80)).toMatchObject({type: 'enemy', hp: 2});
    expect(h.addCash).not.toHaveBeenCalled();

    h.sim.damageEnemyTile(4, 80);
    expect(h.grid.get(4, 80)).toEqual({type: 'air'});
    expect(h.addCash).toHaveBeenCalledWith(bountyAt(80));
    expect(h.toasts.saw('Dormant enemy drilled out')).toBe(true);
  });

  it('reports a coordinate that holds no cocoon', () => {
    const h = harness();

    expect(h.sim.damageEnemyTile(4, 80)).toBe(false);
  });
});

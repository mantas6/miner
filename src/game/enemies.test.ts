import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { START_Y, WORLD_W } from '../../shared/constants';
import { ENEMY } from '../core/balance';
import { createInitialState } from '../core/state';
import type { Enemy, GameState } from '../core/types';
import { load, save } from '../persistence';
import { applyTileEntries, recordTileDiff, tileDiffEntries } from '../world/tile-diff';
import { ensureWorldRow, makeTile } from '../world/world';
import { createEnemySim, type EnemySim } from './enemies';
import { createWorldGrid } from './world-grid';
import {
  createAudioStub,
  createFakeGrid,
  createToastLog,
  type AudioStub,
  type FakeGrid
} from './test-support';

const bountyAt = (y: number) => ENEMY.bounty.base + Math.floor(y / ENEMY.bounty.depthDivisor) * ENEMY.bounty.step;

interface Harness {
  state: GameState;
  grid: FakeGrid;
  sim: EnemySim;
  audio: AudioStub;
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
    audio: createAudioStub(),
    spawnExplosion: vi.fn()
  };
  const sim = createEnemySim({
    state,
    grid: context.grid,
    audio: context.audio,
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
    hp: 4, maxHp: 4, alive: true, moveTick: 0, biteTick: 0, flash: 0, origin: {x: 10, y: 70},
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
    expect(h.audio.played).toContain('bounty');
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
    expect(h.audio.played).not.toContain('bounty');
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
    expect(h.audio.played).toContain('bounty');
  });

  it('reports a coordinate that holds no cocoon', () => {
    const h = harness();

    expect(h.sim.damageEnemyTile(4, 80)).toBe(false);
  });
});

describe('a cocoon hatching', () => {
  /** A seeded cocoon, with a diggable neighbour to its left to expose it from. */
  function findSeedCocoon(): {x: number; y: number} {
    for (let y = START_Y + 10; y < START_Y + 400; y++) {
      for (let x = 2; x < WORLD_W - 2; x++) {
        if (makeTile(x, y).type === 'enemy' && makeTile(x - 1, y).type !== 'enemy') return {x, y};
      }
    }
    throw new Error('no seeded cocoon found');
  }

  /** A real grid recording into the tile diff, as game.ts wires it, and a real sim. */
  function mine(state: GameState) {
    const grid = createWorldGrid({
      state,
      invalidateTerrain: () => {},
      onTileSet: (x, y, tile) => recordTileDiff(state.tileDiff, {x, y, tile})
    });
    const sim = createEnemySim({
      state, grid, audio: createAudioStub(), toast: () => {}, addCash: vi.fn(), saveProgress: vi.fn(),
      damagePlayer: vi.fn(), spawnDust: vi.fn(), spawnExplosion: vi.fn()
    });
    return {grid, sim};
  }

  /** Dig beside a seeded cocoon and park there, so it is exposed and hatches. */
  function hatchSeedCocoon() {
    const state = createInitialState();
    const {grid, sim} = mine(state);
    const cocoon = findSeedCocoon();
    grid.set(cocoon.x - 1, cocoon.y, {type: 'air'});
    Object.assign(state.player, {x: cocoon.x - 1, y: cocoon.y});
    sim.resetExposure();
    const enemy = state.enemies.find(e => e.x === cocoon.x && e.y === cocoon.y);
    expect(grid.get(cocoon.x, cocoon.y)).toEqual({type: 'air'});
    expect(enemy?.origin).toEqual(cocoon);
    return {state, sim, cocoon, enemy: enemy!};
  }

  /** Save, load into a fresh state, rebuild the mine and re-run the boot exposure pass. */
  function reload(state: GameState): GameState {
    save(state);
    const reloaded = createInitialState();
    load(reloaded);
    applyTileEntries(reloaded.world, tileDiffEntries(reloaded.tileDiff));
    mine(reloaded).sim.resetExposure();
    return reloaded;
  }

  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); }
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is not a dig: a woken, living enemy regrows its cocoon across a save and reload', () => {
    const {state, cocoon} = hatchSeedCocoon();

    save(state);
    const loaded = createInitialState();
    load(loaded);
    applyTileEntries(loaded.world, tileDiffEntries(loaded.tileDiff));
    // The dug neighbour is a real change and survives; the hatch does not.
    expect(ensureWorldRow(loaded.world, cocoon.y)![cocoon.x - 1]).toEqual({type: 'air'});
    expect(ensureWorldRow(loaded.world, cocoon.y)![cocoon.x]).toEqual(makeTile(cocoon.x, cocoon.y));
    expect(loaded.world[cocoon.y]?.[cocoon.x]?.type).toBe('enemy');

    // Booted with the ship where it parked, the regrown cocoon hatches again.
    const reloaded = reload(state);
    expect(reloaded.enemies.some(e => e.x === cocoon.x && e.y === cocoon.y)).toBe(true);
  });

  it('a killed enemy stays dead: its cocoon tile is recorded as air, so a reload regrows nothing', () => {
    const {state, sim, cocoon, enemy} = hatchSeedCocoon();
    // It crawled off its cocoon before the drill caught it: the kill still clears
    // the tile it hatched from, not the one it died on.
    Object.assign(enemy, {x: cocoon.x - 1, drawX: cocoon.x - 1});
    sim.damageEnemy(enemy, 999);
    expect(enemy.alive).toBe(false);
    expect(tileDiffEntries(state.tileDiff)).toContainEqual({...cocoon, tile: {type: 'air'}});

    const reloaded = reload(state);

    expect(reloaded.world[cocoon.y]?.[cocoon.x]).toEqual({type: 'air'});
    expect(reloaded.enemies.some(e => e.origin.x === cocoon.x && e.origin.y === cocoon.y)).toBe(false);
  });
});

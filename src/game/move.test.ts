import { describe, expect, it, vi } from 'vitest';
import { ORES, START_Y, WORLD_W } from '../../shared/constants';
import { FUEL, HULL, STARTING } from '../core/balance';
import { addOre, countOres, createInventory, oreKind } from '../core/inventory';
import { createInitialState } from '../core/state';
import type { Enemy, GameState, Tile } from '../core/types';
import { createMovement, type GameMovement } from './move';
import {
  createAudioStub,
  createEnemySimStub,
  createFakeGrid,
  createToastLog,
  type AudioStub,
  type EnemySimStub,
  type FakeGrid
} from './test-support';

const DIG_COST = (extra: number, dy: number) => (FUEL.baseMove + Math.abs(dy)*FUEL.vertical + extra) * FUEL.digMult;

interface Harness {
  state: GameState;
  grid: FakeGrid;
  enemies: EnemySimStub;
  audio: AudioStub;
  toasts: ReturnType<typeof createToastLog>;
  movement: GameMovement;
  damage: ReturnType<typeof vi.fn>;
  gameOver: ReturnType<typeof vi.fn>;
  saveProgress: ReturnType<typeof vi.fn>;
  scheduleSave: ReturnType<typeof vi.fn>;
  revealAtPlayer: ReturnType<typeof vi.fn>;
}

function harness(): Harness {
  const state = createInitialState();
  // Start well underground and off the surface so nothing special applies.
  Object.assign(state.player, {x: 10, y: 40, drawX: 10, drawY: 40});
  const grid = createFakeGrid();
  const enemies = createEnemySimStub();
  const audio = createAudioStub();
  const toasts = createToastLog();
  const context = {
    state, grid, enemies, audio,
    toasts,
    damage: vi.fn(),
    gameOver: vi.fn(),
    saveProgress: vi.fn(),
    scheduleSave: vi.fn(),
    revealAtPlayer: vi.fn()
  };
  const movement = createMovement({
    state,
    grid,
    enemies,
    audio,
    toast: toasts.toast,
    saveProgress: context.saveProgress,
    scheduleSave: context.scheduleSave,
    revealAtPlayer: context.revealAtPlayer,
    damage: context.damage,
    gameOver: context.gameOver,
    spawnDust: vi.fn(),
    spawnExplosion: vi.fn()
  });
  return {...context, movement};
}

function liveEnemy(x: number, y: number): Enemy {
  return {id: 1, kind: 'tunnelFiend', x, y, drawX: x, drawY: y, hp: 4, maxHp: 4, alive: true, moveTick: 0, biteTick: 0, flash: 0};
}

const dirt = (hp: number): Tile => ({type: 'dirt', hp, maxHp: hp});

describe('flying through open space', () => {
  it('advances the ship, charges the reduced air cost, and reveals the new footprint', () => {
    const h = harness();
    h.movement.move(1, 0);

    expect(h.state.player).toMatchObject({x: 11, y: 40, facing: 1, bob: 1});
    expect(h.state.player.fuel).toBeCloseTo(STARTING.fuel - FUEL.baseMove * FUEL.flyMult);
    expect(h.revealAtPlayer).toHaveBeenCalled();
    expect(h.enemies.wakeEnemiesNear).toHaveBeenCalledWith(11, 40);
  });

  it('records a new depth record in metres', () => {
    const h = harness();
    h.movement.move(0, 1);

    expect(h.state.player.y).toBe(41);
    expect(h.state.stats.maxDepth).toBe((41 - START_Y) * 10);
  });

  it('charges nothing for an open-space descent, even while sprinting', () => {
    const h = harness();
    h.movement.move(0, 1, true);

    expect(h.state.player.fuel).toBe(STARTING.fuel);
  });
});

describe('blocked moves', () => {
  it('refuses to move at all when the destination is clamped to the ship itself', () => {
    const h = harness();
    Object.assign(h.state.player, {x: 1, y: START_Y});

    h.movement.move(-1, 0);

    expect(h.state.player).toMatchObject({x: 1, y: START_Y, fuel: STARTING.fuel});
    expect(h.grid.writes).toHaveLength(0);
  });

  it('clamps horizontal movement to the world edges', () => {
    const h = harness();
    Object.assign(h.state.player, {x: WORLD_W - 2});

    h.movement.move(1, 0);

    expect(h.state.player.x).toBe(WORLD_W - 2);
  });

  it('never drills upward, and never spends fuel refusing to', () => {
    const h = harness();
    h.grid.put(10, 39, dirt(3));

    h.movement.move(0, -1);

    expect(h.state.player).toMatchObject({y: 40, fuel: STARTING.fuel, drillDy: -1});
    expect(h.grid.writes).toHaveLength(0);
    expect(h.toasts.saw('cannot dig upward')).toBe(true);
  });

  it('requires solid ground under the ship before drilling sideways', () => {
    const h = harness();
    h.grid.put(11, 40, dirt(3));
    // (10, 41) stays air, so the ship is hovering.

    h.movement.move(1, 0);
    expect(h.toasts.saw('Side drilling needs solid ground')).toBe(true);
    expect(h.state.player.x).toBe(10);
    expect(h.grid.writes).toHaveLength(0);

    // With a floor underneath, the same press drills the wall instead.
    h.grid.put(10, 41, dirt(3));
    h.movement.move(1, 0);
    expect(h.grid.get(11, 40)).toMatchObject({type: 'dirt', hp: 2});
  });

  it('ignores every move once the run is over', () => {
    const h = harness();
    h.state.gameOver = true;

    h.movement.move(0, 1);

    expect(h.state.player).toMatchObject({x: 10, y: 40, fuel: STARTING.fuel});
    expect(h.gameOver).not.toHaveBeenCalled();
  });
});

describe('crashing a boosted ship into a wall', () => {
  /** Fly one boosted tile through open air so the ship carries speed into the wall. */
  function boostInto(h: Harness, dx: number, dy: number): void {
    h.movement.move(dx, dy, true);
    expect(h.state.input.sprintMomentum).toEqual([dx, dy]);
    h.movement.move(dx, dy, true);
  }

  it('buckles the hull on a boosted landing, on top of the tile damage', () => {
    const h = harness();
    h.grid.put(10, 42, {type: 'rock', hp: 999});

    boostInto(h, 0, 1);

    expect(h.damage.mock.calls).toEqual([[HULL.rockBump], [HULL.sprintCrash]]);
    expect(h.state.player.y).toBe(41);
    expect(h.toasts.saw('Boost crash')).toBe(true);
  });

  it('buckles the hull on a boosted ceiling hit', () => {
    const h = harness();
    h.grid.put(10, 38, dirt(3));

    boostInto(h, 0, -1);

    expect(h.damage).toHaveBeenCalledWith(HULL.sprintCrash);
    expect(h.state.player.y).toBe(39);
  });

  it('buckles the hull on a boosted side slam into an ungrounded wall', () => {
    const h = harness();
    h.grid.put(12, 40, dirt(3));

    boostInto(h, 1, 0);

    expect(h.damage).toHaveBeenCalledWith(HULL.sprintCrash);
    expect(h.toasts.saw('Boost crash')).toBe(true);
    expect(h.state.player.x).toBe(11);
  });

  it('charges the crash once, however long Shift is held against the wall', () => {
    const h = harness();
    h.grid.put(10, 42, {type: 'rock', hp: 999});

    boostInto(h, 0, 1);
    for (let repeat = 0; repeat < 8; repeat++) h.movement.move(0, 1, true);

    expect(h.damage.mock.calls.filter(([amount]) => amount === HULL.sprintCrash)).toHaveLength(1);
    expect(h.state.input.sprintMomentum).toBeNull();
  });

  it('leaves an unboosted bump exactly as it was', () => {
    const h = harness();
    h.grid.put(10, 42, {type: 'rock', hp: 999});

    h.movement.move(0, 1);
    h.movement.move(0, 1);

    expect(h.damage.mock.calls).toEqual([[HULL.rockBump]]);
    expect(h.toasts.saw('Boost crash')).toBe(false);
  });

  it('does not crash a boost that gets turned into a wall it never charged at', () => {
    const h = harness();
    h.grid.put(11, 41, dirt(3));

    // Boost downward, then turn sideways into the wall at ordinary speed.
    h.movement.move(0, 1, true);
    h.movement.move(1, 0, true);

    expect(h.damage).not.toHaveBeenCalled();
  });

  it('does not treat drilling out a tile as a boost run-up', () => {
    const h = harness();
    h.grid.put(10, 41, dirt(1));
    h.grid.put(10, 42, {type: 'rock', hp: 999});
    h.state.player.drill = 5;

    h.movement.move(0, 1, true);
    expect(h.state.player.y).toBe(41);
    expect(h.state.input.sprintMomentum).toBeNull();

    h.movement.move(0, 1, true);
    expect(h.damage.mock.calls).toEqual([[HULL.rockBump]]);
  });

  it('drops the momentum at a world edge instead of crashing into nothing', () => {
    const h = harness();
    Object.assign(h.state.player, {x: 2, y: 40});

    h.movement.move(-1, 0, true);
    expect(h.state.input.sprintMomentum).toEqual([-1, 0]);

    h.movement.move(-1, 0, true);
    expect(h.state.input.sprintMomentum).toBeNull();
    expect(h.damage).not.toHaveBeenCalled();
  });
});

describe('digging', () => {
  it('takes several passes through tough dirt before the ship advances', () => {
    const h = harness();
    h.state.player.drill = 1;
    h.grid.put(10, 41, dirt(2));

    h.movement.move(0, 1);
    expect(h.state.player.y).toBe(40);
    expect(h.state.player.fuel).toBeCloseTo(STARTING.fuel - DIG_COST(FUEL.dig.dig, 1));
    expect(h.grid.get(10, 41)).toMatchObject({type: 'dirt', hp: 1});

    h.movement.move(0, 1);
    expect(h.grid.get(10, 41)).toEqual({type: 'air'});
    expect(h.state.player.y).toBe(41);
  });

  it('stacks mined ore in the inventory, counts it, and saves', () => {
    const h = harness();
    h.state.player.drill = 5;
    h.grid.put(10, 41, {type: 'ore', ore: ORES[0], hp: 1, maxHp: 1});

    h.movement.move(0, 1);

    expect(h.state.player.inventory[0]).toMatchObject({kind: oreKind('Coal'), count: 1});
    expect(countOres(h.state.player.inventory)).toBe(1);
    expect(h.state.stats.oreMined).toBe(1);
    expect(h.state.player.y).toBe(41);
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.audio.played).toContain('ore');
  });

  it('leaves ore in the ground with one hit left when the cargo bay is full', () => {
    const h = harness();
    h.state.player.drill = 5;
    h.state.player.cargoMax = 1;
    h.state.player.inventory = addOre(createInventory(), ORES[0], 1)!;
    h.grid.put(10, 41, {type: 'ore', ore: ORES[1], hp: 1, maxHp: 1});

    h.movement.move(0, 1);

    expect(countOres(h.state.player.inventory)).toBe(1);
    expect(h.grid.get(10, 41)).toMatchObject({type: 'ore', hp: 1});
    expect(h.state.player.y).toBe(40);
    expect(h.toasts.saw('Cargo bay full')).toBe(true);
  });

  /** Capacity is an item count, so a fresh ore kind loads while there is room. */
  it('takes on a new ore kind as long as the bay is under capacity', () => {
    const h = harness();
    h.state.player.drill = 5;
    h.state.player.cargoMax = 99;
    let inventory = createInventory();
    for (const ore of ORES.slice(0, 6)) inventory = addOre(inventory, ore, 99)!;
    h.state.player.inventory = inventory;
    h.grid.put(10, 41, {type: 'ore', ore: ORES[6], hp: 1, maxHp: 1});

    h.movement.move(0, 1);

    expect(countOres(h.state.player.inventory)).toBe(7);
    expect(h.grid.get(10, 41).type).toBe('air');
    expect(h.state.player.y).toBe(41);
  });

});

describe('hazards and hostile tiles', () => {
  it('damages the hull on a rock bump and never moves the ship', () => {
    const h = harness();
    h.grid.put(10, 41, {type: 'rock', hp: 999});

    h.movement.move(0, 1);

    expect(h.damage).toHaveBeenCalledWith(HULL.rockBump);
    expect(h.state.player.y).toBe(40);
    expect(h.state.player.fuel).toBeCloseTo(STARTING.fuel - DIG_COST(0, 1));
    expect(h.grid.writes).toHaveLength(0);
  });

  it('scorches the hull per magma hit and vents the pocket on the last one', () => {
    const h = harness();
    h.state.player.drill = 1;
    h.grid.put(10, 41, {type: 'hazard', hp: 2, maxHp: 2});

    h.movement.move(0, 1);
    expect(h.damage).toHaveBeenCalledWith(HULL.hazardBase + Math.floor(41/HULL.hazardDepthDivisor));
    expect(h.grid.get(10, 41)).toMatchObject({type: 'hazard', hp: 1});

    h.movement.move(0, 1);
    expect(h.grid.get(10, 41)).toEqual({type: 'air'});
    // Venting clears the tile but does not carry the ship into it.
    expect(h.state.player.y).toBe(40);
    expect(h.damage).toHaveBeenCalledTimes(2);
  });

  it('routes a dormant cocoon to the enemy simulation instead of digging it out', () => {
    const h = harness();
    h.grid.put(10, 41, {type: 'enemy', kind: 'tunnelFiend', hp: 4, maxHp: 4});

    h.movement.move(0, 1);

    expect(h.enemies.damageEnemyTile).toHaveBeenCalledWith(10, 41);
    expect(h.state.player.y).toBe(40);
    expect(h.state.player.fuel).toBeCloseTo(STARTING.fuel - DIG_COST(FUEL.dig.enemy, 1));
  });

  it('attacks a live enemy standing in the way rather than entering its tile', () => {
    const h = harness();
    const enemy = liveEnemy(10, 41);
    h.enemies.standingEnemy = enemy;

    h.movement.move(0, 1);

    expect(h.enemies.damageEnemy).toHaveBeenCalledWith(enemy);
    expect(h.state.player.y).toBe(40);
    expect(h.state.player.fuel).toBeCloseTo(STARTING.fuel - DIG_COST(FUEL.dig.enemy, 1));
  });

});

describe('fuel exhaustion', () => {
  it('ends the run before moving when the tank is already empty', () => {
    const h = harness();
    h.state.player.fuel = 0;

    h.movement.move(0, 1);

    expect(h.gameOver).toHaveBeenCalledWith(expect.stringContaining('Out of fuel'));
    expect(h.state.player.y).toBe(40);
  });

  it('ends the run when the last move empties the tank, and clamps fuel at zero', () => {
    const h = harness();
    h.state.player.fuel = 0.01;

    h.movement.move(1, 0);

    expect(h.state.player.x).toBe(11);
    expect(h.state.player.fuel).toBe(0);
    expect(h.gameOver).toHaveBeenCalledWith(expect.stringContaining('Out of fuel'));
  });
});

describe('open destination probing', () => {
  it('reports open air, but not terrain, an enemy, or a clamped destination', () => {
    const h = harness();
    expect(h.movement.isOpenMovementDestination(0, 1)).toBe(true);

    h.grid.put(10, 41, dirt(2));
    expect(h.movement.isOpenMovementDestination(0, 1)).toBe(false);

    h.enemies.standingEnemy = liveEnemy(11, 40);
    expect(h.movement.isOpenMovementDestination(1, 0)).toBe(false);

    h.enemies.standingEnemy = undefined;
    // A clamped destination (here the world's top row) reports not open.
    Object.assign(h.state.player, {y: 0});
    expect(h.movement.isOpenMovementDestination(0, -1)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { findEnemyPathStep, type EnemyPosition } from './enemy-movement';
import type { Tile } from './types';

function dirt(): Tile {
  return {type: 'dirt', hp: 2, maxHp: 2};
}

describe('enemy movement', () => {
  it('follows a cleared path around a bend until it reaches attack range', () => {
    const world = Array.from({length: 8}, () => Array.from({length: 9}, dirt));
    const player = {x: 3, y: 5};
    const clearedPath = [player, {x: 3, y: 4}, {x: 3, y: 3}, {x: 4, y: 3}, {x: 5, y: 3}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 6, y: 5}, {x: 5, y: 5}];
    for (const {x, y} of clearedPath) world[y][x] = {type: 'air'};
    let enemy: EnemyPosition = {x: 5, y: 5};

    const firstStep = findEnemyPathStep(world, enemy, player, [enemy], 24);
    expect(firstStep).toEqual({x: 6, y: 5});

    while (Math.abs(enemy.x - player.x) + Math.abs(enemy.y - player.y) > 1) {
      const step = findEnemyPathStep(world, enemy, player, [enemy], 24);
      expect(step).not.toBeNull();
      enemy = step!;
    }

    expect(enemy).toEqual({x: 3, y: 4});
  });

  it('paths through a hanging decoration like air, but not through a solid panel', () => {
    const world = Array.from({length: 3}, () => Array.from({length: 7}, dirt));
    for (let x = 1; x <= 5; x++) world[1][x] = {type: 'air'};
    world[1][3] = {type: 'decor', decor: 'leninPortrait', hp: 48, maxHp: 48};
    const enemy = {x: 1, y: 1};
    const player = {x: 5, y: 1};

    expect(findEnemyPathStep(world, enemy, player, [enemy], 24)).toEqual({x: 2, y: 1});

    world[1][3] = {type: 'decor', decor: 'steelPlate', hp: 48, maxHp: 48};
    expect(findEnemyPathStep(world, enemy, player, [enemy], 24)).toBeNull();
  });
});

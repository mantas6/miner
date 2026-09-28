import { describe, expect, it } from 'vitest';
import { findEnemyPathStep, type EnemyPosition } from './enemy-movement';
import type { Tile } from './types';
import { nth } from '../test-narrowing';

function dirt(): Tile {
  return {type: 'dirt', hp: 2, maxHp: 2};
}

describe('enemy movement', () => {
  it('follows a cleared path around a bend until it reaches attack range', () => {
    const world = Array.from({length: 8}, () => Array.from({length: 9}, dirt));
    const player = {x: 3, y: 5};
    const clearedPath = [player, {x: 3, y: 4}, {x: 3, y: 3}, {x: 4, y: 3}, {x: 5, y: 3}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 6, y: 5}, {x: 5, y: 5}];
    for (const {x, y} of clearedPath) nth(world, y)[x] = {type: 'air'};
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

});

import { describe, expect, it } from 'vitest';
import { ECONOMY, HULL } from './balance';
import { WORLD_W } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';
import {
  DYNAMITE,
  createPlacedDynamite,
  dynamiteHullDamage,
  dynamitePlacementRefusal,
  getDynamiteBlastTargets,
  isDynamiteFuseLit,
  tickPlacedDynamite
} from './dynamite';
import type { Tile } from './types';

function dirt(): Tile {
  return {type: 'dirt', hp: 2, maxHp: 2};
}

describe('dynamite blast targets', () => {
  it('selects a radius-two circular area of destructible blocks', () => {
    const world = Array.from({length: 12}, () => Array.from({length: 12}, dirt));
    const targets = getDynamiteBlastTargets(world, 6, 7, ECONOMY.dynamite.radius);

    expect(targets).toHaveLength(13);
    expect(targets).toContainEqual({x: 6, y: 5});
    expect(targets).toContainEqual({x: 8, y: 7});
    expect(targets).not.toContainEqual({x: 8, y: 9});
  });

  it('destroys ore and hazards without returning cargo or rewards', () => {
    const world: Tile[][] = Array.from({length: 10}, () => Array.from({length: 10}, dirt));
    world[6][5] = {type: 'ore', ore: {name: 'Gold', color: '#fc0', value: 70, min: 152, max: 602, chance: .04}, hp: 5, maxHp: 5};
    world[5][6] = {type: 'hazard', hp: 8, maxHp: 8};

    const targets = getDynamiteBlastTargets(world, 5, 5, 2);

    expect(targets).toContainEqual({x: 5, y: 6});
    expect(targets).toContainEqual({x: 6, y: 5});
    expect(targets).toContainEqual({x: 4, y: 5});
    expect(targets.every(target => Object.keys(target).sort().join(',') === 'x,y')).toBe(true);
  });

  it('removes ordinary undrillable rock', () => {
    const world: Tile[][] = Array.from({length: 9}, () => Array.from({length: 9}, dirt));
    world[5][4] = {type: 'rock', hp: 999};

    const targets = getDynamiteBlastTargets(world, 5, 5, 2);
    for (const {x, y} of targets) world[y][x] = {type: 'air'};

    expect(targets).toContainEqual({x: 4, y: 5});
    expect(world[5][4]).toEqual({type: 'air'});
  });

  it('destroys placed decorations, which are never returned by a blast', () => {
    const world: Tile[][] = Array.from({length: 9}, () => Array.from({length: 9}, dirt));
    world[5][6] = {type: 'decor', decor: 'copperTrim'};

    const targets = getDynamiteBlastTargets(world, 5, 5, 2);
    for (const {x, y} of targets) world[y][x] = {type: 'air'};

    expect(targets).toContainEqual({x: 6, y: 5});
    expect(world[5][6]).toEqual({type: 'air'});
  });

  it('includes directly hit dormant enemies among destroyed terrain', () => {
    const world: Tile[][] = Array.from({length: 9}, () => Array.from({length: 9}, dirt));
    world[5][6] = {type: 'enemy', kind:'tunnelFiend', hp: 4, maxHp: 4};

    const targets = getDynamiteBlastTargets(world, 5, 5, 2);
    for (const {x, y} of targets) world[y][x] = {type: 'air'};

    expect(targets).toContainEqual({x: 6, y: 5});
    expect(world[5][6]).toEqual({type: 'air'});
  });

  it('protects the side-wall columns without inventing a bottom boundary', () => {
    const world: Tile[][] = Array.from({length: 9}, () => Array.from({length: 9}, dirt));
    world[8][5] = {type: 'rock', hp: 999};
    const edgeTargets = getDynamiteBlastTargets(world, 1, 4, 2);
    const bottomTargets = getDynamiteBlastTargets(world, 5, 7, 2);

    // The far-left and far-right columns are the walls and stay standing.
    expect(edgeTargets).not.toContainEqual({x: 0, y: 4});
    // There is no bottom boundary: the deepest rock in range is still a target.
    expect(bottomTargets).toContainEqual({x: 5, y: 8});
  });
});

describe('a planted stick', () => {
  it('burns for exactly the fuse and then goes off once', () => {
    const stick = createPlacedDynamite(10, 400);
    expect(stick.fuse).toBe(DYNAMITE.fuseTicks);

    let fired = 0;
    for (let step = 0; step < DYNAMITE.fuseTicks; step++) if (tickPlacedDynamite(stick)) fired++;

    expect(fired).toBe(1);
    expect(stick.fuse).toBe(0);
  });

  it('blinks its fuse faster the closer it gets to going off', () => {
    /** Flashes over a 120-step window ending `fuse` steps before the blast. */
    const flashes = (fuse: number) => {
      let count = 0;
      for (let step = 0; step < 120; step++) {
        if (isDynamiteFuseLit(fuse + step) && !isDynamiteFuseLit(fuse + step + 1)) count++;
      }
      return count;
    };

    expect(flashes(DYNAMITE.fuseTicks - 120)).toBeGreaterThan(0);
    expect(flashes(DYNAMITE.fuseTicks - 120)).toBeLessThan(flashes(0));
  });
});

describe('placing a stick', () => {
  const explored = new Set([explorationIndex(40, 100)]);
  const site = {explored, open: true, sticks: []};

  it('accepts explored, cleared ground inside the mine', () => {
    expect(dynamitePlacementRefusal(40, 100, site)).toBeNull();
  });

  it.each([
    ['off the map', -1, 100, {...site}, 'underground'],
    ['above the mine', 40, -1, {...site}, 'underground'],
    ['past the far wall', WORLD_W, 100, {...site}, 'underground'],
    ['under fog', 41, 100, {...site}, 'already explored'],
    ['inside terrain', 40, 100, {...site, open: false}, 'cleared space'],
    ['on another stick', 40, 100, {...site, sticks: [createPlacedDynamite(40, 100)]}, 'already burning']
  ])('refuses %s', (_name, x, y, context, reason) => {
    expect(dynamitePlacementRefusal(x, y, context)).toContain(reason);
  });

  it('refuses one more than the mine will hold', () => {
    const sticks = Array.from({length: DYNAMITE.maxPlaced}, (_, index) => createPlacedDynamite(index, 500));

    expect(dynamitePlacementRefusal(40, 100, {...site, sticks})).toContain(`${DYNAMITE.maxPlaced} sticks`);
  });
});

describe('blast damage to a ship', () => {
  it('hits hardest at the centre, halves toward the rim, and stops at the radius', () => {
    const radius = ECONOMY.dynamite.radius;

    expect(dynamiteHullDamage(0, 0)).toBe(HULL.dynamiteBlast);
    expect(dynamiteHullDamage(1, 0)).toBeLessThan(HULL.dynamiteBlast);
    expect(dynamiteHullDamage(radius, 0)).toBe(Math.round(HULL.dynamiteBlast / 2));
    expect(dynamiteHullDamage(radius + 1, 0)).toBe(0);
    // Diagonals are measured as distance, not as a square.
    expect(dynamiteHullDamage(2, 2)).toBe(0);
    expect(dynamiteHullDamage(1, 1)).toBeGreaterThan(0);
  });

  it('leaves a full-strength ship alive even at the centre', () => {
    expect(HULL.dynamiteBlast).toBeLessThan(100);
  });
});

import { describe, expect, it } from 'vitest';
import { expandReachableAir } from './enemy-exposure';
import type { Tile } from './types';
import { nth } from '../test-narrowing';

function dirt(): Tile {
  return {type: 'dirt', hp: 2, maxHp: 2};
}

function world(): Tile[][] {
  return Array.from({length: 7}, () => Array.from({length: 8}, dirt));
}

describe('buried enemy exposure', () => {
  it('keeps a fully sealed enemy dormant', () => {
    const tiles = world();
    nth(tiles, 3)[5] = {type: 'enemy', kind:'tunnelFiend', hp: 4, maxHp: 4};

    expect(expandReachableAir(tiles, new Set(), [{x: 1, y: 3}], true)).toEqual([]);
  });

  it('does not expose an enemy beside a disconnected partial tunnel', () => {
    const tiles = world();
    nth(tiles, 3)[1] = {type: 'air'};
    nth(tiles, 3)[4] = {type: 'air'};
    nth(tiles, 3)[5] = {type: 'enemy', kind:'tunnelFiend', hp: 4, maxHp: 4};
    const reachable = new Set<string>();

    expect(expandReachableAir(tiles, reachable, [{x: 1, y: 3}], true)).toEqual([]);
    expect(expandReachableAir(tiles, reachable, [{x: 4, y: 3}])).toEqual([]);
  });

  it('exposes an enemy when air connects a traversable path to its edge', () => {
    const tiles = world();
    nth(tiles, 3)[1] = {type: 'air'};
    nth(tiles, 3)[5] = {type: 'enemy', kind:'tunnelFiend', hp: 4, maxHp: 4};
    const reachable = new Set<string>();
    expandReachableAir(tiles, reachable, [{x: 1, y: 3}], true);

    nth(tiles, 3)[2] = {type: 'air'};
    nth(tiles, 3)[3] = {type: 'air'};
    nth(tiles, 3)[4] = {type: 'air'};

    expect(expandReachableAir(tiles, reachable, [{x: 2, y: 3}])).toEqual([{x: 5, y: 3}]);
  });
});

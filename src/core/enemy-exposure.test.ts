import { describe, expect, it } from 'vitest';
import { COCOON_WAKE_RADIUS, cocoonsInWakeRadius, expandReachableAir } from './enemy-exposure';
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

describe('the cocoon wake radius', () => {
  const cocoon = (): Tile => ({type: 'enemy', kind: 'tunnelFiend', hp: 4, maxHp: 4});

  /** A 1-wide shaft down column 3 from row 0 to `bottom`, all of it known reachable. */
  function shaft(tiles: Tile[][], bottom: number): Set<string> {
    const reachable = new Set<string>();
    for (let y = 0; y <= bottom; y++) nth(tiles, y)[3] = {type: 'air'};
    expandReachableAir(tiles, reachable, [{x: 3, y: 0}], true);
    return reachable;
  }

  it('is two tiles, measured the way enemies bite', () => {
    expect(COCOON_WAKE_RADIUS).toBe(2);
  });

  it('wakes a cocoon within two tiles that opens onto the ship\'s air', () => {
    const tiles = world();
    const reachable = shaft(tiles, 4);
    // Beside the shaft, one row below the ship: its side opens onto the shaft's air.
    nth(tiles, 4)[4] = cocoon();
    expect(cocoonsInWakeRadius(tiles, reachable, {x: 3, y: 3})).toEqual([{x: 4, y: 4}]);
  });

  it('leaves a cocoon sealed in dirt asleep, however close', () => {
    const tiles = world();
    const reachable = shaft(tiles, 3);
    // Directly under the shaft's bottom row there is dirt, then the cocoon: no way out.
    nth(tiles, 5)[3] = cocoon();
    expect(cocoonsInWakeRadius(tiles, reachable, {x: 3, y: 3})).toEqual([]);
    // Diagonal to the ship, touching no air.
    nth(tiles, 4)[4] = cocoon();
    expect(cocoonsInWakeRadius(tiles, reachable, {x: 3, y: 3})).toEqual([]);
  });

  it('leaves a cocoon beside air the ship cannot reach asleep', () => {
    const tiles = world();
    const reachable = shaft(tiles, 3);
    // Two tiles off, a cocoon in the wall of a sealed pocket.
    nth(tiles, 3)[6] = {type: 'air'};
    nth(tiles, 3)[5] = cocoon();
    expect(cocoonsInWakeRadius(tiles, reachable, {x: 3, y: 3})).toEqual([]);
  });

  it('ignores a cocoon past the radius, and rows not generated yet', () => {
    const tiles = world();
    const reachable = shaft(tiles, 6);
    nth(tiles, 6)[4] = cocoon();
    // Four, then three tiles off: out of reach until the ship comes within two.
    expect(cocoonsInWakeRadius(tiles, reachable, {x: 3, y: 3})).toEqual([]);
    expect(cocoonsInWakeRadius(tiles, reachable, {x: 3, y: 4})).toEqual([]);
    expect(cocoonsInWakeRadius(tiles, reachable, {x: 3, y: 5})).toEqual([{x: 4, y: 6}]);
    expect(cocoonsInWakeRadius([], reachable, {x: 3, y: 5})).toEqual([]);
  });
});

// The harness's up-front judgement of a tile press: refused, with the reason,
// only when the game would do nothing with it.

import { describe, expect, it } from 'vitest';
import { createInitialState } from '../core/state';
import { TILE_PRESS_REACH, tilePressRefusal } from './tile-press';

describe('tilePressRefusal', () => {
  it('lets a press within reach of the ship through, the ship\'s own tile included', () => {
    const state = createInitialState();
    const {x, y} = state.player;
    expect(TILE_PRESS_REACH).toBe(1);
    expect(tilePressRefusal(state, x, y)).toBeNull();
    expect(tilePressRefusal(state, x + 1, y + 1)).toBeNull();
    expect(tilePressRefusal(state, x - 1, y)).toBeNull();
  });

  it('refuses an unarmed press further off, saying a press never moves the ship', () => {
    const state = createInitialState();
    const {x, y} = state.player;
    const refusal = tilePressRefusal(state, x + 5, y + 3);
    expect(refusal).toContain(`Tile (${x + 5}, ${y + 3}) is 5 tiles from the ship at (${x}, ${y})`);
    expect(refusal).toContain('too far for a tile press');
    expect(refusal).toContain('never moves the ship');
    expect(tilePressRefusal(state, x, y + 2)).not.toBeNull();
  });

  it('leaves an armed device, and the restart after a lost ship, to the game', () => {
    const state = createInitialState();
    const {x, y} = state.player;
    state.armedPlacement = 'dynamite';
    expect(tilePressRefusal(state, x + 5, y)).toBeNull();
    state.armedPlacement = null;
    state.gameOver = true;
    expect(tilePressRefusal(state, x + 20, y + 20)).toBeNull();
  });
});

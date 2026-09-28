import { describe, expect, it } from 'vitest';
import { ENEMY_TYPES } from '../core/enemy-types';
import type { EnemyKind } from '../core/types';
import { rustColor, rustPalette } from './rust-palette';

describe('rustColor', () => {
  it('pulls a palette color toward a dull rust', () => {
    // Pinned so the memo below can never drift from what the rigs used to paint.
    expect(rustColor('#ffffff')).toBe('rgb(192,185,182)');
    expect(rustColor('#000000')).toBe('rgb(16,10,7)');
  });
});

describe('rustPalette', () => {
  const kinds = Object.keys(ENEMY_TYPES) as EnemyKind[];

  it('rusts each of a kind\'s three hull colors', () => {
    for (const kind of kinds) {
      expect(rustPalette(kind)).toEqual(ENEMY_TYPES[kind].colors.map(rustColor));
    }
  });

  it('works a kind out once and hands the same palette back every frame', () => {
    for (const kind of kinds) expect(rustPalette(kind)).toBe(rustPalette(kind));
    const [first, second] = kinds;
    if (first && second) expect(rustPalette(first)).not.toBe(rustPalette(second));
  });
});

// The golden worldgen hash.
//
// The mine is never saved tile by tile: it regenerates from its coordinates on
// every boot, and a save only records the diff on top (see `tile-diff.ts`). So
// any change to what `makeTile` produces silently moves every player's ore, rock
// and tunnels under a diff that was recorded against the old terrain. This pins
// the generated world to one fingerprint, so such a change is always deliberate:
// if it fails, the terrain changed — bump `SAVE_VERSION` if that strands old
// diffs, then paste the new hash below.
//
// Last moved by raising the Gold band to 1100 m and Ruby to 2300 m (`ORES` in
// `shared/constants.ts`): only which ore an unmined tile rolls from 1100 m down
// changed, so saved diffs (dug-out air, placed things) still line up and the save
// version stands.

import { describe, expect, it } from 'vitest';
import { WORLD_W } from '../../shared/constants';
import type { Tile } from '../../shared/world-schema';
import { makeTile } from './world';

/** The rows fingerprinted: the whole shallow mine, plus two deep bands. */
const SAMPLED_ROWS = [
  ...Array.from({length: 600}, (_, y) => y),
  ...Array.from({length: 20}, (_, i) => 1200 + i),
  ...Array.from({length: 20}, (_, i) => 5000 + i)
];

/** One tile as a short token: its type, what it is, and how tough it is. */
function token(tile: Tile): string {
  switch (tile.type) {
    case 'ore': return `o${tile.ore.name}${tile.hp}`;
    case 'enemy': return `e${tile.kind}${tile.hp}`;
    case 'decor': return `d${tile.decor}${tile.hp}`;
    case 'air': return 'a';
    default: return `${tile.type[0]}${tile.hp}`;
  }
}

/** 32-bit FNV-1a over the sampled tiles' tokens, as eight hex digits. */
function worldHash(): string {
  let hash = 0x811c9dc5;
  for (const y of SAMPLED_ROWS) {
    for (let x = 0; x < WORLD_W; x++) {
      const text = token(makeTile(x, y)) + ';';
      for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

describe('world generation', () => {
  it('produces the pinned terrain', () => {
    expect(worldHash()).toBe('b65082f1');
  });
});

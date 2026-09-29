import { describe, expect, it } from 'vitest';
import { START_Y, WORLD_W } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';
import { nth } from '../test-narrowing';
import { tradingPostsInRange } from '../world/world';
import { TRADING_POST_HINT_RADIUS, discoveredTradingPosts, formatPostHint, tradingPostHint } from './post-beacon';
import { createDefaultStats } from './state';

const POSTS = tradingPostsInRange(0, 0, WORLD_W - 1, START_Y + 400);
const POST = nth(POSTS, 0);

describe('formatPostHint', () => {
  it('words the Chebyshev distance and an 8-way arrow (y grows downward)', () => {
    expect(formatPostHint(-6, 9)).toBe('Trading post ≈9 tiles ↙');
    expect(formatPostHint(0, 5)).toBe('Trading post ≈5 tiles ↓');
    expect(formatPostHint(0, -5)).toBe('Trading post ≈5 tiles ↑');
    expect(formatPostHint(7, 0)).toBe('Trading post ≈7 tiles →');
    expect(formatPostHint(-7, 1)).toBe('Trading post ≈7 tiles ←');
    expect(formatPostHint(4, 4)).toBe('Trading post ≈4 tiles ↘');
    expect(formatPostHint(4, -3)).toBe('Trading post ≈4 tiles ↗');
    expect(formatPostHint(-3, -4)).toBe('Trading post ≈4 tiles ↖');
    // A mostly vertical offset reads as straight down, not a diagonal.
    expect(formatPostHint(2, 10)).toBe('Trading post ≈10 tiles ↓');
  });

  it('is silent within trading reach and beyond the beacon radius', () => {
    expect(formatPostHint(0, 0)).toBe('');
    expect(formatPostHint(1, -1)).toBe('');
    expect(formatPostHint(2, 0)).toBe('Trading post ≈2 tiles →');
    expect(formatPostHint(TRADING_POST_HINT_RADIUS, -TRADING_POST_HINT_RADIUS)).toBe(`Trading post ≈${TRADING_POST_HINT_RADIUS} tiles ↗`);
    expect(formatPostHint(TRADING_POST_HINT_RADIUS + 1, 0)).toBe('');
  });
});

describe('tradingPostHint', () => {
  it('points at the nearest post in range, whatever the fog', () => {
    expect(tradingPostHint(POST.x, POST.y - 9)).toBe('Trading post ≈9 tiles ↓');
    expect(tradingPostHint(POST.x, POST.y - 1)).toBe('');
    expect(tradingPostHint(POST.x, POST.y - 13)).toBe('');
  });

  it('says nothing in the home cavern', () => {
    expect(tradingPostHint(45, START_Y)).toBe('');
  });
});

describe('discoveredTradingPosts', () => {
  function stateWith(maxDepth: number, explored: {x: number; y: number}[], shipRow = START_Y) {
    return {
      player: {y: shipRow},
      stats: {...createDefaultStats(), maxDepth},
      exploredTiles: new Set(explored.map(({x, y}) => explorationIndex(x, y)))
    };
  }
  const deepest = POSTS.reduce((a, b) => (b.y > a.y ? b : a));
  const everyPostDepth = (deepest.y - START_Y + 10) * 10;

  it('lists only posts whose own tile has been explored, shallowest first, with depth in metres', () => {
    expect(discoveredTradingPosts(stateWith(everyPostDepth, []))).toEqual([]);
    const seen = [...POSTS].sort((a, b) => b.y - a.y || b.x - a.x);
    expect(discoveredTradingPosts(stateWith(everyPostDepth, seen))).toEqual(
      [...POSTS].sort((a, b) => a.y - b.y || a.x - b.x).map(post => ({x: post.x, y: post.y, depthMeters: (post.y - START_Y) * 10}))
    );
    // A neighbouring tile explored is not the post itself.
    expect(discoveredTradingPosts(stateWith(everyPostDepth, [{x: POST.x + 1, y: POST.y}]))).toEqual([]);
  });

  it('stops a few rows under the deepest descent, where nothing can have been seen', () => {
    const shallow = stateWith((POST.y - START_Y - 10) * 10, [POST]);
    expect(discoveredTradingPosts(shallow)).toEqual([]);
    const reached = stateWith((POST.y - START_Y) * 10, [POST]);
    expect(discoveredTradingPosts(reached)).toEqual([{x: POST.x, y: POST.y, depthMeters: (POST.y - START_Y) * 10}]);
    // A ship standing deeper than the record (a save seeded there) searches from its own row.
    const parked = stateWith(0, [POST], POST.y);
    expect(discoveredTradingPosts(parked)).toEqual([{x: POST.x, y: POST.y, depthMeters: (POST.y - START_Y) * 10}]);
  });
});

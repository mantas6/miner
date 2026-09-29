// Finding trading posts: the HUD beacon that points at one nearby, and the list of
// the posts the player has already seen.
//
// A post is derived from its coordinate (`world.ts`), so both answers come from the
// same chunk rolls the renderer uses and nothing here is stored.
//
//   * The beacon is the scanner's second line, "Trading post ≈9 tiles ↙". It ignores
//     the fog on purpose: it is a signal the kiosk puts out, so it points at a post
//     the ship has never seen — that is the whole point of it. It goes quiet once
//     the post is within trading reach, where the Space hint takes over.
//   * The discovered list is every post whose own tile has been explored, down to
//     just below the deepest row the career has reached, for the Info screen's
//     Prospecting tab (and the objective's "have you found one yet" rung).
//
// Everything here is pure and DOM-free.

import { METERS_PER_TILE, START_Y, WORLD_W, rowDepthMeters } from '../../shared/constants';
import { isTileExplored } from '../../shared/exploration-codec';
import { nearestTradingPost, tradingPostsInRange } from '../world/world';
import { SCANNER_DEVICE } from './scanner-device';
import { TRADING_POST_REACH } from './trading';
import type { GameState } from './types';

/** How far the beacon reaches, in tiles on either axis (Chebyshev). */
export const TRADING_POST_HINT_RADIUS = 12;

/** Arrows for the eight 45° sectors, clockwise from east, with y growing downward. */
const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'] as const;

/** The 8-way arrow from the ship toward an offset (`dy` positive is down). */
function arrowFor(dx: number, dy: number): string {
  const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return ARROWS[((sector % 8) + 8) % 8] ?? '→';
}

/**
 * The beacon line for a post `dx`, `dy` tiles from the ship: "Trading post ≈9 tiles
 * ↙", the distance being Chebyshev (the larger of the two axes). Empty when the
 * post is already within trading reach — the Space hint names it then — or beyond
 * `TRADING_POST_HINT_RADIUS`.
 */
export function formatPostHint(dx: number, dy: number): string {
  const distance = Math.max(Math.abs(dx), Math.abs(dy));
  if (distance <= TRADING_POST_REACH || distance > TRADING_POST_HINT_RADIUS) return '';
  return `Trading post ≈${distance} tiles ${arrowFor(dx, dy)}`;
}

/** The beacon line for a ship at (x, y): the nearest post in range, or empty. */
export function tradingPostHint(x: number, y: number): string {
  const post = nearestTradingPost(x, y, TRADING_POST_HINT_RADIUS);
  return post ? formatPostHint(post.x - x, post.y - y) : '';
}

/** The Prospecting tab's line while no post has been found: where one will turn up. */
export const NO_POSTS_FOUND = `None yet — the scanner points to any within ${TRADING_POST_HINT_RADIUS} tiles.`;

/** One post the player has seen, as the Prospecting tab lists it. */
export interface DiscoveredTradingPost {
  x: number;
  y: number;
  /** Depth below the home row, in metres, the same figure the HUD reports. */
  depthMeters: number;
}

/**
 * Rows below the deepest one reached that can still have been explored: the ship's
 * own footprint reaches one row down, and a Scanner set down beside it maps half
 * its square further.
 */
const DISCOVERY_MARGIN_ROWS = Math.floor(SCANNER_DEVICE.size / 2) + 1;

/**
 * Every trading post whose tile has been explored, shallowest first (then left to
 * right). The search stops a few rows under the career's deepest descent (or the
 * ship's own row, should it stand deeper), below which nothing can have been seen,
 * so it costs one chunk roll per chunk the career has dug past.
 */
export function discoveredTradingPosts(
  state: Pick<GameState, 'exploredTiles' | 'stats'> & {player: Pick<GameState['player'], 'y'>}
): DiscoveredTradingPost[] {
  const recordRow = START_Y + Math.ceil(Math.max(0, state.stats.maxDepth) / METERS_PER_TILE);
  const deepestRow = Math.max(recordRow, state.player.y) + DISCOVERY_MARGIN_ROWS;
  return tradingPostsInRange(0, START_Y, WORLD_W - 1, deepestRow)
    .filter(post => isTileExplored(state.exploredTiles, post.x, post.y))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(post => ({x: post.x, y: post.y, depthMeters: rowDepthMeters(post.y)}));
}

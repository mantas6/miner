// Dynamite: the stick, where it may be planted, its fuse, and what the blast
// takes with it.
//
// A charge is no longer something the ship carries and sets off under itself.
// It is a device: bought at the depot, carried in the cargo bay, planted on a
// tile of the mine, and left there burning for five seconds. That is the whole
// design — the delay is the cost. Everything the blast destroys is destroyed
// without payout, and a ship still standing in the radius when the fuse runs out
// pays for it in hull.
//
// Everything here is pure and DOM-free: the placed stick is three numbers, and
// the blast is a list of coordinates the caller applies to its own world.

import { ECONOMY, HULL } from './balance';
import { ITEM_CATALOG } from './items';
import { placementRefusal, type PlacementCopy } from './placement';
import type { Tile } from './types';

export const DYNAMITE = Object.freeze({
  /** Fuse length, as the shop and the toasts word it. */
  fuseSeconds: 5,
  /** The same wait in fixed 60 Hz simulation steps. */
  fuseTicks: 5 * 60,
  /**
   * Sticks that may burn at once. A soft cap: it keeps a save bounded, and it
   * keeps a whole stack from being emptied into one tunnel faster than the
   * player can get clear of it.
   */
  maxPlaced: 8
});

/** The stackable item the cargo bay carries; defined once in `items.ts`. */
export const DYNAMITE_ITEM = ITEM_CATALOG.dynamite;

/** One planted stick. `fuse` counts simulation steps left before it goes off. */
export interface PlacedDynamite {
  x: number;
  y: number;
  fuse: number;
}

export function createPlacedDynamite(x: number, y: number): PlacedDynamite {
  return {x, y, fuse: DYNAMITE.fuseTicks};
}

/**
 * One fixed 60 Hz step. Reports whether this is the step the stick goes off.
 *
 * Mutates `fuse`: this runs for every planted stick on every step, and the
 * alternative is a fresh object 60 times a second per stick.
 */
export function tickPlacedDynamite(stick: PlacedDynamite): boolean {
  return --stick.fuse <= 0;
}

/**
 * Whether the fuse lamp is lit on this step. The blink quickens as the fuse
 * burns down, so a stick reads as "about to go" from across the mine without a
 * number painted on the canvas.
 */
export function isDynamiteFuseLit(fuse: number): boolean {
  const elapsed = Math.max(0, DYNAMITE.fuseTicks - fuse);
  const burnt = Math.min(1, elapsed / DYNAMITE.fuseTicks);
  // Counted in whole cycles rather than as a period the modulus is taken against:
  // a period that shortens under a fixed modulus stutters, because the phase
  // jumps every time the divisor changes. One flash per 40 steps at the start,
  // one per 8 at the end.
  const cycles = elapsed * (1 / 40 + burnt * (1 / 8 - 1 / 40));
  return cycles % 1 < .5;
}

export interface DynamitePlacementContext {
  explored: ReadonlySet<number>;
  /** Whether the target tile is open space the stick can be dropped into. */
  open: boolean;
  sticks: readonly PlacedDynamite[];
}

/** How dynamite words each of the shared placement refusals. */
const DYNAMITE_PLACEMENT_COPY: PlacementCopy = {
  full: `Only ${DYNAMITE.maxPlaced} sticks can burn at once.`,
  offMine: 'Dynamite is planted underground, inside the mine.',
  unexplored: 'Plant the dynamite on a tile you have already explored.',
  blocked: 'Plant the dynamite in cleared space, not inside terrain.',
  occupied: 'A stick is already burning on that tile.'
};

/** Why this tile cannot take a stick, or `null` when it can. */
export function dynamitePlacementRefusal(x: number, y: number, context: DynamitePlacementContext): string | null {
  return placementRefusal(x, y, {
    explored: context.explored,
    open: context.open,
    occupied: context.sticks.some(stick => stick.x === x && stick.y === y),
    full: context.sticks.length >= DYNAMITE.maxPlaced
  }, DYNAMITE_PLACEMENT_COPY);
}

/**
 * Hull damage for a ship `dx`/`dy` tiles from the blast, and zero for one out of
 * reach. The charge does not care whose ship it is: planting it and then failing
 * to leave is the risk the delay exists to create.
 *
 * Linear falloff, half damage at the rim, so backing off one tile is worth
 * something and the centre is worth avoiding entirely.
 */
export function dynamiteHullDamage(dx: number, dy: number): number {
  const radius = ECONOMY.dynamite.radius;
  const distance = Math.hypot(dx, dy);
  if (distance > radius) return 0;
  return Math.round(HULL.dynamiteBlast * (1 - .5 * (distance / radius)));
}

export interface BlastCoordinate {
  x: number;
  y: number;
}

export function isDynamiteDestructible(tile: Tile): boolean {
  return tile.type === 'dirt' || tile.type === 'rock' || tile.type === 'ore' || tile.type === 'hazard' || tile.type === 'enemy';
}

/** Select blast tiles without mutating terrain or granting rewards for destroyed valuables. */
export function getDynamiteBlastTargets(
  world: Tile[][],
  centerX: number,
  centerY: number,
  radius: number
): BlastCoordinate[] {
  const targets: BlastCoordinate[] = [];
  for (let y = centerY - radius; y <= centerY + radius; y++) {
    const row = world[y];
    if (!row || y < 0) continue;
    for (let x = centerX - radius; x <= centerX + radius; x++) {
      if (x <= 0 || x >= row.length - 1) continue;
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy > radius * radius) continue;
      if (isDynamiteDestructible(row[x])) targets.push({x, y});
    }
  }
  return targets;
}

import { FUEL, HULL, SPRINT } from './balance';
import type { Direction, Tile } from './types';

export function movementDestination(x: number, y: number, dx: number, dy: number, worldWidth: number): {x: number; y: number} {
  return {
    x: Math.max(1, Math.min(worldWidth - 2, x + dx)),
    // Bedrock caps the world above the home cavern, so the only hard clamp the
    // ship needs is the top of the coordinate space itself.
    y: Math.max(0, y + dy)
  };
}

/**
 * Whether a tile is open space the ship (and an enemy) moves through: air. Such a
 * tile is also never ground and never drilled. A missing tile (off the loaded
 * world) is not.
 */
export function isTraversableTile(tile: Tile | undefined): boolean {
  return tile?.type === 'air';
}

/**
 * Whether a ship has ground under it, given the tile directly below: anything but
 * open space holds it up. The movement rules and the scanner readout both ask
 * this one question, so they never disagree about when the ship is hovering.
 */
export function isGrounded(below: Tile | undefined): boolean {
  return !isTraversableTile(below);
}

/**
 * Whether a step drills sideways from a hover — straight left or right with open
 * space below. Allowed, but the drill has no floor to brace against, so every
 * hit costs `FUEL.hoverDrillMult` times the usual dig fuel.
 */
export function isHoverSideDrill(dx: number, dy: number, below: Tile | undefined): boolean {
  return dx !== 0 && dy === 0 && !isGrounded(below);
}

/** That surcharge as a whole percentage (25 for a 1.25× multiplier), for the copy that names it. */
export const HOVER_DRILL_SURCHARGE_PERCENT = Math.round((FUEL.hoverDrillMult - 1) * 100);

export function isOpenSpaceDestination(destinationChanged: boolean, tile: Tile, activeEnemy: boolean): boolean {
  return destinationChanged && isTraversableTile(tile) && !activeEnemy;
}

export function isSprintActive(sprintRequested: boolean, destinationOpen: boolean): boolean {
  return sprintRequested && destinationOpen;
}

export function activeSprintDirection(sprintRequested: boolean, destinationOpen: boolean, dx: number, dy: number): Direction | null {
  return isSprintActive(sprintRequested, destinationOpen) && (dx !== 0 || dy !== 0) ? [dx, dy] : null;
}

/**
 * Sprint momentum the ship carries out of a move attempt.
 *
 * Only a completed sprint step through open space builds speed; anything that
 * fails to advance — terrain, an enemy, a world edge — brings the ship to a stop.
 * That makes the momentum a one-shot ticket, which is what keeps a held Shift
 * against a wall from crashing once per auto-repeat.
 */
export function sprintMomentumAfterMove(advanced: boolean, sprintRequested: boolean, destinationOpen: boolean, dx: number, dy: number): Direction | null {
  return advanced ? activeSprintDirection(sprintRequested, destinationOpen, dx, dy) : null;
}

/**
 * Hull damage for a boosted move that terrain refused, on top of whatever the
 * destination tile charges by itself. Requires momentum in the very direction
 * being rammed, so turning to face a wall mid-boost is not a crash.
 */
export function sprintCrashDamage(momentum: Direction | null, sprintRequested: boolean, dx: number, dy: number): number {
  if (!sprintRequested || !momentum) return 0;
  return momentum[0] === dx && momentum[1] === dy ? HULL.sprintCrash : 0;
}

export function keyboardMovementRepeatMs(normalRepeatMs: number, sprintRequested: boolean, destinationOpen: boolean): number {
  return isSprintActive(sprintRequested, destinationOpen) ? normalRepeatMs * SPRINT.repeatMultiplier : normalRepeatMs;
}

export function movementFuelCost(normalCost: number, sprintRequested: boolean, destinationOpen: boolean, movingDownward: boolean): number {
  if (destinationOpen && movingDownward) return 0;
  return isSprintActive(sprintRequested, destinationOpen) ? normalCost * SPRINT.fuelMultiplier : normalCost;
}

/** Fuel left after a move; never negative, since an empty tank ends the run. */
export function fuelAfterMovement(currentFuel: number, normalCost: number, sprintRequested: boolean, destinationOpen: boolean, movingDownward: boolean): number {
  return Math.max(0, currentFuel - movementFuelCost(normalCost, sprintRequested, destinationOpen, movingDownward));
}

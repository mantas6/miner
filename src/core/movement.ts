import { HULL, SPRINT } from './balance';
import type { Direction } from './types';

export function movementDestination(x: number, y: number, dx: number, dy: number, worldWidth: number): {x: number; y: number} {
  return {
    x: Math.max(1, Math.min(worldWidth - 2, x + dx)),
    // Bedrock caps the world above the home cavern, so the only hard clamp the
    // ship needs is the top of the coordinate space itself.
    y: Math.max(0, y + dy)
  };
}

export function isTraversableTerrain(tileType: string): boolean {
  return tileType === 'air';
}

export function isOpenSpaceDestination(destinationChanged: boolean, tileType: string, activeEnemy: boolean): boolean {
  return destinationChanged && isTraversableTerrain(tileType) && !activeEnemy;
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

export function fuelAfterMovement(currentFuel: number, normalCost: number, sprintRequested: boolean, destinationOpen: boolean, movingDownward: boolean): number {
  return currentFuel - movementFuelCost(normalCost, sprintRequested, destinationOpen, movingDownward);
}

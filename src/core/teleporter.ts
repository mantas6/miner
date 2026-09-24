// The portable teleporter: a single-use charge that opens the portal list and is
// spent on the jump.
//
// The teleporter is a consumable, not a fitting: it is crafted at the
// Manufacturing Station, it rides in the cargo bay like a stick of dynamite, and
// travelling to a portal spends it. This module owns the pure pieces around that —
// how many are aboard, whether one could actually be used, the visual jump effect,
// and the instant move that lands a ship on a portal tile. The portal list itself
// lives in `portal.ts`; the sim that wires it up is a later phase.

import { countItem } from './inventory';
import { ITEM_CATALOG } from './items';
import { portalDestinations } from './portal';
import type { PlacedStation } from './stations';
import type { Player, TeleportEffect } from './types';

export const TELEPORT_EFFECT_FRAMES = 36;
export const REDUCED_TELEPORT_EFFECT_FRAMES = 12;

/** The stackable item the cargo bay carries; defined once in `items.ts`. */
export const TELEPORTER_ITEM = ITEM_CATALOG.teleporter;

/** Teleporters aboard; the whole "have I got a way across?" question. */
export function teleportersCarried(player: Pick<Player, 'inventory'>): number {
  return countItem(player.inventory, TELEPORTER_ITEM.kind);
}

/**
 * Whether a carried teleporter could actually be spent right now: a charge is
 * aboard, and there is at least one portal to travel to that is not already within
 * arm's reach (a portal at the ship's side needs no teleporter).
 */
export function canUsePortableTeleporter(
  player: Pick<Player, 'inventory' | 'x' | 'y'>,
  stations: readonly PlacedStation[]
): boolean {
  if (teleportersCarried(player) <= 0) return false;
  return portalDestinations(stations, {x: player.x, y: player.y}, {excludeReachable: true}).length > 0;
}

export function createTeleportEffect(
  originScreenX: number,
  originScreenY: number,
  destinationX: number,
  destinationY: number,
  reducedMotion = false
): TeleportEffect {
  return {
    originScreenX,
    originScreenY,
    destinationX,
    destinationY,
    frame: 0,
    duration: reducedMotion ? REDUCED_TELEPORT_EFFECT_FRAMES : TELEPORT_EFFECT_FRAMES,
    reducedMotion
  };
}

export function advanceTeleportEffect(effect: TeleportEffect | null): TeleportEffect | null {
  if (!effect || effect.frame + 1 >= effect.duration) return null;
  return {...effect, frame: effect.frame + 1};
}

/**
 * Drop a ship onto a tile as an instant jump: snap both the logical and the render
 * position, and reset the bob and drill animation so it arrives at rest rather
 * than mid-stride. Used by portal travel and respawn.
 */
export function movePlayerTo(player: Player, x: number, y: number): void {
  Object.assign(player, {
    x,
    y,
    drawX: x,
    drawY: y,
    bob: 0,
    drillAnim: 0
  });
}

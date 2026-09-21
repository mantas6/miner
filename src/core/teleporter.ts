// The emergency round trip: up to the depot on a carried teleporter, and back
// down to the tile it was used on.
//
// The teleporter is a single-use item, not a fitting: it is bought at the depot,
// it rides in the cargo bay like a stick of dynamite, and the trip up spends it.
// The trip *back* is free — the return point is the receipt for the item already
// spent — so only the outbound jump touches the bay.

import { HOME_ROW, HOME_X } from '../../shared/constants';
import { countItem, removeItem } from './inventory';
import { ITEM_CATALOG } from './items';
import { isAtHome, placeAtHome } from './state';
import type { Player, TeleportEffect, TeleportReturnPosition } from './types';

export const TELEPORT_EFFECT_FRAMES = 36;
export const REDUCED_TELEPORT_EFFECT_FRAMES = 12;
/** How far from home, in tiles, the ship must be before a teleporter can fire. */
export const MIN_TELEPORT_HOME_DISTANCE = 10;
/** Legacy label the action bar shows for the outbound jump (100 m ≈ 10 tiles). */
export const MIN_TELEPORT_DEPTH_METERS = 100;

/** Straight-line distance from the home cavern's centre, in tiles. */
export function homeDistance(x: number, y: number): number {
  return Math.hypot(x - HOME_X, y - HOME_ROW);
}

/** The stackable item the cargo bay carries; defined once in `items.ts`. */
export const TELEPORTER_ITEM = ITEM_CATALOG.teleporter;

export function canTeleport(player: Pick<Player, 'x' | 'y'>): boolean {
  return homeDistance(player.x, player.y) >= MIN_TELEPORT_HOME_DISTANCE;
}

/** Teleporters aboard; the whole "have I got a way home?" question. */
export function teleportersCarried(player: Pick<Player, 'inventory'>): number {
  return countItem(player.inventory, TELEPORTER_ITEM.kind);
}

export function canUseTeleporter(player: Player, returnPosition: TeleportReturnPosition | null): boolean {
  if (isAtHome(player)) return returnPosition !== null;
  return teleportersCarried(player) > 0 && canTeleport(player);
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

export function teleportPlayerToHome(player: Player): TeleportReturnPosition | null {
  if (!canTeleport(player) || teleportersCarried(player) <= 0) return null;

  const returnPosition = {x: player.x, y: player.y};
  // The teleporter is spent on the way home; the return trip rides on the point
  // it left behind.
  player.inventory = removeItem(player.inventory, TELEPORTER_ITEM.kind);
  placeAtHome(player);
  Object.assign(player, {
    bob: 0,
    drillAnim: 0
  });
  return returnPosition;
}

export function teleportPlayerToReturn(player: Player, returnPosition: TeleportReturnPosition | null): boolean {
  if (!isAtHome(player) || !returnPosition) return false;

  Object.assign(player, {
    ...returnPosition,
    drawX: returnPosition.x,
    drawY: returnPosition.y,
    bob: 0,
    drillAnim: 0
  });
  return true;
}

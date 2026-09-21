// Player-initiated actions that resolve in a single press: the teleporter and
// the repair kit.
//
// The two deployables — scanners and dynamite — arm and place themselves through
// their own modules (`scanner-devices.ts`, `dynamite-sticks.ts`). The teleporter
// is carried the same way but spent from here, because it resolves in one press
// instead of being left behind in the mine. The repair kit is spent the same way.
//
// Each one is a small transaction — validate, mutate, toast, play a sound — so
// they are grouped here rather than scattered through the loop code.

import { TILE, WORLD_W } from '../../shared/constants';
import { HULL } from '../core/balance';
import { countItem, removeItem } from '../core/inventory';
import { ITEM_CATALOG } from '../core/items';
import {
  MIN_TELEPORT_DEPTH_METERS,
  canTeleport,
  createTeleportEffect,
  teleportPlayerToHome,
  teleportPlayerToReturn,
  teleportersCarried
} from '../core/teleporter';
import type { AudioController, GameState } from '../core/types';
import { viewport } from './viewport';

export interface GameActions {
  useTeleporter(): void;
  /**
   * Spend one repair kit from the bay to restore a fraction of the hull. Refused
   * at full hull or with none aboard.
   */
  useRepairKit(): void;
}

export interface GameActionsDeps {
  state: GameState;
  audio: AudioController;
  toast(message: string): void;
  saveProgress(): void;
  atSurface(): boolean;
}

export function createActions(deps: GameActionsDeps): GameActions {
  const {state, audio, toast, saveProgress, atSurface} = deps;

  function useTeleporter(): void {
    const p = state.player;
    if (state.gameOver) return;
    const surf = atSurface();
    if (surf && !state.teleportReturnPosition) return toast('No underground teleport return point.');
    if (!surf && teleportersCarried(p) <= 0) { audio.alarm(); return toast('No teleporter aboard. Craft one at the Manufacturing Station.'); }
    if (!surf && !canTeleport(p)) { audio.alarm(); return toast(`Teleport requires a depth of at least ${MIN_TELEPORT_DEPTH_METERS} m.`); }
    const camX = Math.max(0, Math.min(WORLD_W - viewport.tilesX, state.camX));
    const camY = Math.max(0, state.camY);
    const originScreenX = (p.drawX - camX + .5) * TILE;
    const originScreenY = (p.drawY - camY + .5) * TILE;
    if (surf) {
      if (!teleportPlayerToReturn(p, state.teleportReturnPosition)) return;
      state.teleportReturnPosition = null;
    } else {
      const returnPosition = teleportPlayerToHome(p);
      if (!returnPosition) return;
      state.teleportReturnPosition = returnPosition;
    }
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    state.teleportEffect = createTeleportEffect(originScreenX, originScreenY, p.x, p.y, reducedMotion);
    state.input.keyImpulse = null;
    state.camX = Math.max(0, p.x - Math.floor(viewport.tilesX / 2));
    state.camY = Math.max(0, p.y - Math.floor(viewport.tilesY / 2));
    saveProgress();
    toast(surf
      ? 'Returned to the underground teleport point.'
      : 'Teleported safely home. Press T to return underground.');
  }

  function useRepairKit(): void {
    const p = state.player;
    if (state.gameOver) return;
    if (countItem(p.inventory, ITEM_CATALOG.repairKit.kind) <= 0) {
      audio.alarm();
      return toast('No repair kit aboard. Craft one at the Manufacturing Station.');
    }
    if (p.hull >= p.hullMax) {
      audio.alarm();
      return toast('Hull already at full strength.');
    }
    const restored = Math.min(p.hullMax - p.hull, Math.round(p.hullMax * HULL.repairKitFraction));
    p.hull += restored;
    p.inventory = removeItem(p.inventory, ITEM_CATALOG.repairKit.kind);
    saveProgress();
    audio.blip(540, .08, 'triangle', .05, 40);
    toast(`Repair kit used — hull +${restored}.`);
  }

  return {
    useTeleporter,
    useRepairKit
  };
}

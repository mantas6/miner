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

import { HULL } from '../core/balance';
import { countItem, removeItem } from '../core/inventory';
import { ITEM_CATALOG } from '../core/items';
import { portalDestinations } from '../core/portal';
import { teleportersCarried } from '../core/teleporter';
import type { AudioController, GameState } from '../core/types';
import type { PortalsSim } from './portals';

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
  /** The portal sim: a teleporter opens its list in `teleporter` mode. */
  portals: PortalsSim;
}

export function createActions(deps: GameActionsDeps): GameActions {
  const {state, audio, toast, saveProgress} = deps;

  function useTeleporter(): void {
    if (state.gameOver) return;
    const p = state.player;
    // A teleporter is a carried charge that opens the portal list and is spent on
    // the jump; without one aboard there is nothing to open.
    if (teleportersCarried(p) <= 0) {
      audio.alarm();
      return toast('No teleporter aboard. Craft one at the Manufacturing Station.');
    }
    // A charge is pointless when every portal is already at arm's reach — there is
    // nowhere it could take the ship that it could not already fly to.
    if (portalDestinations(state.stations, {x: p.x, y: p.y}, {excludeReachable: true}).length === 0) {
      return toast('No portal out of reach to teleport to.');
    }
    deps.portals.openTeleporter();
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

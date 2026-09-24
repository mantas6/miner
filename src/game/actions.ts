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
import type { AudioController, GameState } from '../core/types';

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
  const {state, audio, toast, saveProgress} = deps;

  function useTeleporter(): void {
    if (state.gameOver) return;
    // TODO(portals phase 3): a carried teleporter opens the portal travel list and
    // is spent on the jump. Until the portal sim lands, this is an inert stub.
    toast('Teleporter travel is being rebuilt around portals.');
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

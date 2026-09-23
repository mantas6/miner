// Wrecks: opening a corpse ship and salvaging what it still holds.
//
// `core/wreck.ts` holds the rules (where a wreck stands, how far its hatch opens
// from, what a salvage transfer is allowed to move); this is the part that touches
// the running game — the wreck the UI is looking at, the cargo bay it hauls into,
// and the save each transfer schedules.
//
// A wreck is never placed by hand — the run drops it when a ship is lost or reset
// (see `game/run.ts`) — so unlike the cargo container there is no armed pointer
// here, only the *un*armed press: a click on a wreck the ship is standing on or
// beside opens its take-only salvage menu. A wreck is removed the instant it is
// emptied, and the menu it was showing closes with it.
//
// The open wreck does not survive a reload: it is about what the player is doing
// right now, not about what they own.

import { totalItems, type Inventory, type InventoryItemKind } from '../core/inventory';
import {
  isWreckReachable,
  lootAll,
  reachableWreck,
  takeFromWreck,
  wreckAt,
  type Wreck
} from '../core/wreck';
import type { AudioController, GameState } from '../core/types';

export interface WreckSim {
  /** The wreck whose salvage menu is up, or `null`. */
  readonly open: Wreck | null;
  /**
   * An unarmed press on the mine. Opens the wreck on that tile when the ship is
   * close enough, and reports whether it did — a press on bare rock is not a
   * refusal, it is simply not about a wreck.
   */
  openAt(x: number, y: number): boolean;
  /** The keyboard's version: open whatever wreck is under or beside the ship. */
  openNearest(): boolean;
  /** Put the hatch down. Idempotent; also what the dialog's own close reports. */
  close(): void;
  /** Take a stack out of the open wreck and into the bay; `single` takes just one. */
  take(kind: InventoryItemKind, single?: boolean): void;
  /** Haul everything that fits from the open wreck into the bay in one press. */
  lootAll(): void;
  /** One fixed 60 Hz step: nothing to run, only a lost ship to tidy up after. */
  tick(): void;
}

export interface WreckDeps {
  state: GameState;
  audio: AudioController;
  toast(message: string): void;
  saveProgress(): void;
  /** Show the salvage menu for these contents, or take it away with `null`. */
  setOpenUi(contents: Inventory | null): void;
}

export function createWrecks(deps: WreckDeps): WreckSim {
  const {state, audio, toast, saveProgress} = deps;
  let open: Wreck | null = null;

  function close(): void {
    if (!open) return;
    open = null;
    deps.setOpenUi(null);
  }

  /** Re-publish the open wreck's contents after a transfer changed them. */
  function repaint(): void {
    if (open) deps.setOpenUi(open.inventory);
  }

  /** Show the wreck's contents and hand the menu to the UI. */
  function show(wreck: Wreck): boolean {
    open = wreck;
    deps.setOpenUi(wreck.inventory);
    return true;
  }

  function openAt(x: number, y: number): boolean {
    if (state.gameOver) return false;
    const wreck = wreckAt(state.wrecks, x, y);
    if (!wreck) return false;
    if (!isWreckReachable(wreck, state.player.x, state.player.y)) {
      toast('Too far from the wreck. Fly alongside it first.');
      return false;
    }
    return show(wreck);
  }

  function openNearest(): boolean {
    if (state.gameOver) return false;
    if (open) { close(); return true; }
    const wreck = reachableWreck(state.wrecks, state.player.x, state.player.y);
    if (!wreck) {
      toast('No wreck within reach.');
      return false;
    }
    return show(wreck);
  }

  /** Drop a wreck the moment it is emptied, closing the menu it was showing. */
  function retireIfEmpty(wreck: Wreck): void {
    if (totalItems(wreck.inventory) > 0) return;
    state.wrecks = state.wrecks.filter(entry => entry !== wreck);
    close();
  }

  function take(kind: InventoryItemKind, single = false): void {
    const wreck = open;
    if (!wreck || state.gameOver) return;
    // A reset can take the mine out from under an open wreck; hauling out of one
    // the world no longer contains would quietly delete it.
    if (!state.wrecks.includes(wreck)) return close();
    const result = takeFromWreck(state.player.inventory, wreck.inventory, kind, state.player.cargoMax, single ? 1 : Infinity);
    if (!result.ok) {
      audio.alarm();
      return toast(result.refusal);
    }
    state.player.inventory = result.ship;
    wreck.inventory = result.wreck;
    repaint();
    saveProgress();
    audio.blip(620, .05, 'triangle', .035);
    toast(`Salvaged ${result.moved} × ${result.label}.`);
    retireIfEmpty(wreck);
  }

  function lootEverything(): void {
    const wreck = open;
    if (!wreck || state.gameOver) return;
    if (!state.wrecks.includes(wreck)) return close();
    const result = lootAll(state.player.inventory, wreck.inventory, state.player.cargoMax);
    if (result.moved <= 0) {
      audio.alarm();
      return toast(`Cargo bay is full at ${state.player.cargoMax} items. Stow or unload before salvaging more.`);
    }
    state.player.inventory = result.ship;
    wreck.inventory = result.wreck;
    repaint();
    saveProgress();
    audio.blip(660, .06, 'triangle', .04);
    toast(`Salvaged ${result.moved} item${result.moved === 1 ? '' : 's'} from the wreck.`);
    retireIfEmpty(wreck);
  }

  function tick(): void {
    // A lost ship cannot reach into anything, and the open menu would otherwise
    // still look live behind the game-over screen.
    if (state.gameOver) close();
  }

  return {
    get open() {
      return open;
    },
    openAt,
    openNearest,
    close,
    take,
    lootAll: lootEverything,
    tick
  };
}

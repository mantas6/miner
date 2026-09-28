// Chests: opening one buried in the mine and hauling out what it holds.
//
// `core/chest.ts` holds the rules (where a chest lies, what it was buried with,
// how far its lid opens from); `world.ts` places them. This is the part that
// touches the running game — the chest the UI is looking at, the cargo bay it
// hauls into, the ledger entry each haul rewrites and the save it schedules.
//
// A chest opens like a wreck: an unarmed press on it, or `c` beside it, raises a
// take-only menu. The first open writes its rolled loot into `state.chestLedger`,
// and every haul rewrites that entry; the one that empties it leaves `[]` behind —
// the chest is gone for good — and the menu closes with it.
//
// The open chest does not survive a reload: it is about what the player is doing
// right now, not about what they own.

import { isTileExplored } from '../../shared/exploration-codec';
import {
  chestContents,
  chestKey,
  chestStandsAt,
  isChestReachable,
  ledgerStacks,
  reachableChest
} from '../core/chest';
import { totalItems, type Inventory, type InventoryItemKind } from '../core/inventory';
import { lootAll, takeLoot, type Lootable } from '../core/wreck';
import type { AudioController, ChestLedgerStack, GameState } from '../core/types';
import type { Chest } from '../world/world';

export interface ChestSim {
  /** The chest whose menu is up, with what it holds right now, or `null`. */
  readonly open: Lootable | null;
  /**
   * An unarmed press on the mine. Opens the chest on that tile when the ship is
   * close enough, and reports whether it did — a press on bare rock is not a
   * refusal, it is simply not about a chest.
   */
  openAt(x: number, y: number): boolean;
  /** The keyboard's version: open whatever chest is under or beside the ship. */
  openNearest(): boolean;
  /** The chest the keyboard would open, with its Manhattan distance, or `null`. */
  nearest(): (Chest & {distance: number}) | null;
  /** Shut the lid. Idempotent; also what the dialog's own close reports. */
  close(): void;
  /** Take a stack out of the open chest and into the bay; `single` takes just one. */
  take(kind: InventoryItemKind, single?: boolean): void;
  /** Haul everything that fits from the open chest into the bay in one press. */
  lootAll(): void;
  /** One fixed 60 Hz step: nothing to run, only a lost ship to tidy up after. */
  tick(): void;
}

export interface ChestDeps {
  state: GameState;
  audio: AudioController;
  toast(message: string): void;
  saveProgress(): void;
  /**
   * Show the chest menu for these contents, or take it away with `null`. `quiet`
   * skips the close cue when the haul that emptied the chest plays its own. The
   * open cue is this module's (`chestOpen`), so the UI side adds none.
   */
  setOpenUi(contents: Inventory | null, quiet?: boolean): void;
}

export function createChests(deps: ChestDeps): ChestSim {
  const {state, audio, toast, saveProgress} = deps;
  let open: Lootable | null = null;
  /**
   * The ledger entry the open menu last wrote. A reset replaces the ledger under an
   * open chest, and hauling from contents the save no longer agrees with would
   * quietly duplicate loot; a mismatch closes the menu instead.
   */
  let written: ChestLedgerStack[] | null = null;

  function close(quiet = false): void {
    if (!open) return;
    open = null;
    written = null;
    deps.setOpenUi(null, quiet);
  }

  /** Record the open chest's contents in the ledger, so they persist. */
  function record(chest: Lootable): void {
    written = ledgerStacks(chest.inventory);
    state.chestLedger[chestKey(chest.x, chest.y)] = written;
  }

  /** Lift the lid: materialise the ledger entry on first open and hand the menu over. */
  function show(chest: Chest): boolean {
    if (open && open.x === chest.x && open.y === chest.y) return true;
    const firstOpen = state.chestLedger[chestKey(chest.x, chest.y)] === undefined;
    open = {x: chest.x, y: chest.y, inventory: chestContents(state.chestLedger, chest.x, chest.y)};
    record(open);
    if (firstOpen) saveProgress();
    audio.chestOpen();
    deps.setOpenUi(open.inventory);
    return true;
  }

  function openAt(x: number, y: number): boolean {
    if (state.gameOver) return false;
    const chest = chestStandsAt(x, y, state.chestLedger);
    // A chest under fog is not one the player can see, so a press on it is not about one.
    if (!chest || !isTileExplored(state.exploredTiles, x, y)) return false;
    if (!isChestReachable(chest, state.player.x, state.player.y)) {
      toast('Too far from the chest. Fly alongside it first.');
      return false;
    }
    return show(chest);
  }

  function nearest(): (Chest & {distance: number}) | null {
    const {x, y} = state.player;
    const chest = reachableChest(state.chestLedger, state.exploredTiles, x, y);
    return chest ? {...chest, distance: Math.abs(chest.x - x) + Math.abs(chest.y - y)} : null;
  }

  function openNearest(): boolean {
    if (state.gameOver) return false;
    if (open) { close(); return true; }
    const chest = nearest();
    if (!chest) {
      toast('No chest within reach.');
      return false;
    }
    return show(chest);
  }

  /** Whether the ledger still says what the open menu last wrote into it. */
  function stillOpen(chest: Lootable): boolean {
    return written !== null && state.chestLedger[chestKey(chest.x, chest.y)] === written;
  }

  /** After a haul: bank the new contents, and retire the chest once it is bare. */
  function settle(chest: Lootable): void {
    record(chest);
    saveProgress();
    audio.take();
    if (totalItems(chest.inventory) > 0) deps.setOpenUi(chest.inventory);
    else close(true);
  }

  function take(kind: InventoryItemKind, single = false): void {
    const chest = open;
    if (!chest || state.gameOver) return;
    if (!stillOpen(chest)) return close();
    const result = takeLoot(state.player.inventory, chest.inventory, kind, state.player.cargoMax, single ? 1 : Infinity, 'chest');
    if (!result.ok) {
      audio.alarm();
      return toast(result.refusal);
    }
    state.player.inventory = result.ship;
    chest.inventory = result.loot;
    toast(`Took ${result.moved} × ${result.label} from the chest.`);
    settle(chest);
  }

  function lootEverything(): void {
    const chest = open;
    if (!chest || state.gameOver) return;
    if (!stillOpen(chest)) return close();
    const result = lootAll(state.player.inventory, chest.inventory, state.player.cargoMax);
    if (result.moved <= 0) {
      audio.alarm();
      return toast(`Cargo bay is full at ${state.player.cargoMax} items. Stow or unload before looting more.`);
    }
    state.player.inventory = result.ship;
    chest.inventory = result.loot;
    toast(`Took ${result.moved} item${result.moved === 1 ? '' : 's'} from the chest.`);
    settle(chest);
  }

  function tick(): void {
    // A lost ship cannot reach into anything, and the open menu would otherwise
    // still look live behind the game-over screen.
    if (state.gameOver) { close(); return; }
    // The reach it took to lift the lid is what keeps its menu open.
    if (open && !isChestReachable(open, state.player.x, state.player.y)) close();
  }

  return {
    get open() {
      return open;
    },
    openAt,
    openNearest,
    nearest,
    close,
    take,
    lootAll: lootEverything,
    tick
  };
}

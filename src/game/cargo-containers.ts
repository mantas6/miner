// Cargo containers: setting them down, opening them, and moving cargo across.
//
// `core/cargo-container.ts` holds the rules (where a crate may stand, how far its
// lid opens from, what a transfer is allowed to move); this is the part that
// touches the running game — the cargo bay it comes out of, the crate the UI is
// looking at, and the save each transfer schedules.
//
// Placement is the two-press gesture the scanner and the dynamite already use:
// the inventory slot arms it, the mine takes it. Opening one is the *un*armed
// press: a click on a crate the ship is standing on or beside, which is why this
// module owns both halves — a press on the mine has one answer, and it has to
// know whether something is waiting to be placed before it can decide what that
// answer is.
//
// Neither the armed pointer nor the open crate survives a reload. Both are about
// what the player is doing right now, not about what they own.

import {
  CARGO_CONTAINER,
  CARGO_CONTAINER_ITEM,
  containerAt,
  containerPlacementRefusal,
  createPlacedContainer,
  isWithinContainerReach,
  reachableContainer,
  storeInContainer,
  takeFromContainer,
  type PlacedContainer
} from '../core/cargo-container';
import { countItem, removeItem, type Inventory, type InventoryItemKind } from '../core/inventory';
import { inMineBounds } from '../core/placement';
import type { AudioController, GameState } from '../core/types';
import type { WorldGrid } from './world-grid';

export interface CargoContainerSim {
  /** Whether a carried container is waiting for the player to pick a tile. */
  readonly armed: boolean;
  /** The crate whose transfer menu is up, or `null`. */
  readonly open: PlacedContainer | null;
  /** Inventory-slot press: arm placement, or stand the armed one down. */
  toggleArmed(): void;
  /**
   * Disarm without complaint (Escape, an overlay opening, a lost ship). Reports
   * whether anything was armed, so a key handler knows if it consumed the press.
   */
  disarm(): boolean;
  /** A press on the mine while armed. Reports whether a crate was set down. */
  placeAt(x: number, y: number): boolean;
  /**
   * An unarmed press on the mine. Opens the crate on that tile when the ship is
   * close enough, and reports whether it did — a press on bare rock is not a
   * refusal, it is simply not about a container.
   */
  openAt(x: number, y: number): boolean;
  /** The keyboard's version: open whatever crate is under or beside the ship. */
  openNearest(): boolean;
  /** Put the lid down. Idempotent; also what the dialog's own close reports. */
  close(): void;
  /** Move a stack out of the bay and into the open crate; `single` moves just one. */
  store(kind: InventoryItemKind, single?: boolean): void;
  /** Move a stack back, as far as the cargo-bay upgrade allows; `single` moves just one. */
  take(kind: InventoryItemKind, single?: boolean): void;
  /** One fixed 60 Hz step: nothing to run, only a lost ship to tidy up after. */
  tick(): void;
}

export interface CargoContainerDeps {
  state: GameState;
  grid: WorldGrid;
  audio: AudioController;
  toast(message: string): void;
  saveProgress(): void;
  /** Paint the armed state onto the inventory slot. */
  setArmedUi(armed: boolean): void;
  /** Show the transfer menu for these contents, or take it away with `null`. */
  setOpenUi(contents: Inventory | null): void;
}

export function createCargoContainers(deps: CargoContainerDeps): CargoContainerSim {
  const {state, grid, audio, toast, saveProgress} = deps;
  let armed = false;
  let open: PlacedContainer | null = null;

  function setArmed(next: boolean): void {
    if (armed === next) return;
    armed = next;
    deps.setArmedUi(next);
  }

  function disarm(): boolean {
    if (!armed) return false;
    setArmed(false);
    return true;
  }

  function close(): void {
    if (!open) return;
    open = null;
    deps.setOpenUi(null);
  }

  /** Re-publish the open crate's contents after a transfer changed them. */
  function repaint(): void {
    if (open) deps.setOpenUi(open.inventory);
  }

  function toggleArmed(): void {
    if (armed) {
      setArmed(false);
      return toast('Container placement cancelled.');
    }
    if (state.gameOver) return;
    if (countItem(state.player.inventory, CARGO_CONTAINER_ITEM.kind) <= 0) {
      audio.alarm();
      return toast('No container aboard. Craft one at the Manufacturing Station.');
    }
    if (state.cargoContainers.length >= CARGO_CONTAINER.maxPlaced) {
      audio.alarm();
      return toast(`Only ${CARGO_CONTAINER.maxPlaced} containers can stand in the mine at once.`);
    }
    // A crate on screen and a crate waiting to be dropped would both answer the
    // next press on the mine.
    close();
    setArmed(true);
    toast('Container ready — press a mapped tile in the mine. Escape cancels.');
  }

  function placeAt(x: number, y: number): boolean {
    if (!armed) return false;
    // The bay can empty between arming and pressing — a reset, a lost ship — and
    // a crate set down out of an empty bay would be one the player never bought.
    if (state.gameOver || countItem(state.player.inventory, CARGO_CONTAINER_ITEM.kind) <= 0) {
      setArmed(false);
      return false;
    }
    // Bounds first, so a press far outside the mine never generates a row chunk
    // just to find out the tile was never a candidate.
    const refusal = containerPlacementRefusal(x, y, {
      explored: state.exploredTiles,
      open: inMineBounds(x, y) && grid.get(x, y).type === 'air',
      containers: state.cargoContainers,
      wrecks: state.wrecks
    });
    if (refusal) {
      audio.alarm();
      toast(refusal);
      return false;
    }
    state.player.inventory = removeItem(state.player.inventory, CARGO_CONTAINER_ITEM.kind);
    state.cargoContainers.push(createPlacedContainer(x, y));
    setArmed(false);
    saveProgress();
    audio.blip(320, .1, 'square', .045, -40);
    toast(`Container set down. Stand beside it and press it to move up to ${CARGO_CONTAINER.capacity} items of cargo in or out.`);
    return true;
  }

  /** Show the crate's contents and hand the menu to the UI. */
  function show(container: PlacedContainer): boolean {
    open = container;
    deps.setOpenUi(container.inventory);
    return true;
  }

  function openAt(x: number, y: number): boolean {
    if (state.gameOver || armed) return false;
    const container = containerAt(state.cargoContainers, x, y);
    if (!container) return false;
    if (!isWithinContainerReach(container, state.player.x, state.player.y)) {
      toast('Too far from the container. Fly alongside it first.');
      return false;
    }
    return show(container);
  }

  function openNearest(): boolean {
    if (state.gameOver) return false;
    if (open) { close(); return true; }
    // Whatever was waiting for a press on the mine stands down: the menu is about
    // to cover the mine, so that press can no longer arrive.
    disarm();
    const container = reachableContainer(state.cargoContainers, state.player.x, state.player.y);
    if (!container) {
      toast('No container within reach. Set one down from its inventory slot.');
      return false;
    }
    return show(container);
  }

  /** Both directions differ only in which way the stack goes and what it says. */
  function transfer(kind: InventoryItemKind, direction: 'store' | 'take', single = false): void {
    const container = open;
    if (!container || state.gameOver) return;
    // A reset can take the mine out from under an open crate. Moving cargo into
    // one the world no longer contains would quietly delete it.
    if (!state.cargoContainers.includes(container)) return close();
    // The row's 1 button asks for exactly one unit; the plain button moves the whole stack.
    const maxUnits = single ? 1 : Infinity;
    const result = direction === 'store'
      ? storeInContainer(state.player.inventory, container.inventory, kind, maxUnits)
      : takeFromContainer(state.player.inventory, container.inventory, kind, state.player.cargoMax, maxUnits);
    if (!result.ok) {
      audio.alarm();
      return toast(result.refusal);
    }
    state.player.inventory = result.ship;
    container.inventory = result.container;
    repaint();
    saveProgress();
    audio.blip(direction === 'store' ? 420 : 620, .05, 'triangle', .035);
    toast(direction === 'store'
      ? `Stored ${result.moved} × ${result.label}.`
      : `Took ${result.moved} × ${result.label} aboard.`);
  }

  function tick(): void {
    // A lost ship cannot set anything down or reach into anything, and both the
    // armed slot and the open menu would otherwise still look live behind the
    // game-over screen.
    if (!state.gameOver) return;
    disarm();
    close();
  }

  return {
    get armed() {
      return armed;
    },
    get open() {
      return open;
    },
    toggleArmed,
    disarm,
    placeAt,
    openAt,
    openNearest,
    close,
    store: (kind, single) => transfer(kind, 'store', single),
    take: (kind, single) => transfer(kind, 'take', single),
    tick
  };
}

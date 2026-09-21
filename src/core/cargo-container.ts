// The cargo container: a second cargo bay, left behind in the mine.
//
// Crafted at the Manufacturing Station like the other consumables, carried in the
// bay like them, and dropped onto a tile like the scanner and the stick of
// dynamite — but unlike any of those it is never spent. What it buys is slots:
// more of them, stacking by exactly the rules `inventory.ts` already enforces,
// parked wherever the player chose to put them.
//
// So there is no second inventory implementation here. A placed container *is* an
// `Inventory`, and every question about it — is there room, which stack is open,
// what happens when a stack empties — is answered by the same helpers the ship's
// bay uses. All this module adds is the two things a crate has and a bay does not:
// a position in the world, and a transfer across the gap between the two.
//
// The crate has its own item-count capacity, larger than a fresh bay so it earns
// its price as a stash. Taking anything back aboard is still capped by the ship's
// own `cargoMax`, counting every item the bay already holds — otherwise a crate
// would quietly buy the player unlimited carrying capacity.
//
// Everything here is pure and DOM-free.

import {
  addItem,
  createInventory,
  findStack,
  removeItem,
  roomLeft,
  type Inventory,
  type InventoryItem,
  type InventoryItemKind
} from './inventory';
import { ITEM_CATALOG } from './items';
import { placementRefusal, type PlacementCopy } from './placement';

export const CARGO_CONTAINER = Object.freeze({
  /**
   * Total items one crate holds, across every stack inside it. Generous next to a
   * fresh bay, because a crate is crafted for storage and never spent — one keeps
   * paying out for the rest of the save.
   */
  capacity: 50,
  /**
   * Crates that may stand in the mine at once. A soft cap, like the scanner's: it
   * keeps a save bounded, and a mine wallpapered with storage is a map the player
   * can no longer keep in their head.
   */
  maxPlaced: 6,
  /**
   * How far the lid opens from. One tile in any direction — Chebyshev, so the
   * diagonals count — plus the crate's own tile, which the ship can fly onto.
   */
  reach: 1
});

/** The stackable item the cargo bay carries; defined once in `items.ts`. */
export const CARGO_CONTAINER_ITEM = ITEM_CATALOG.container;

/** One crate standing in the mine, and everything inside it. */
export interface PlacedContainer {
  x: number;
  y: number;
  /** Its own slots. Immutable, like the ship's: a transfer replaces the array. */
  inventory: Inventory;
}

export function createPlacedContainer(x: number, y: number): PlacedContainer {
  return {x, y, inventory: createInventory()};
}

/** The crate standing on this tile, or `null`. */
export function containerAt(containers: readonly PlacedContainer[], x: number, y: number): PlacedContainer | null {
  return containers.find(container => container.x === x && container.y === y) ?? null;
}

/** Whether a ship at `x`/`y` is close enough to open this crate. */
export function isWithinContainerReach(container: PlacedContainer, x: number, y: number): boolean {
  return Math.max(Math.abs(container.x - x), Math.abs(container.y - y)) <= CARGO_CONTAINER.reach;
}

/**
 * The crate a ship at `x`/`y` would open with no tile named — the keyboard's
 * answer. The one it is standing on wins, then the nearest neighbour, so a crate
 * flown onto is never passed over for one beside it.
 */
export function reachableContainer(containers: readonly PlacedContainer[], x: number, y: number): PlacedContainer | null {
  let best: PlacedContainer | null = null;
  let bestDistance = Infinity;
  for (const container of containers) {
    if (!isWithinContainerReach(container, x, y)) continue;
    const distance = Math.abs(container.x - x) + Math.abs(container.y - y);
    if (distance >= bestDistance) continue;
    best = container;
    bestDistance = distance;
  }
  return best;
}

export interface ContainerPlacementContext {
  explored: ReadonlySet<number>;
  /** Whether the target tile is open space the crate can be dropped into. */
  open: boolean;
  containers: readonly PlacedContainer[];
}

/** How a container words each of the shared placement refusals. */
const CONTAINER_PLACEMENT_COPY: PlacementCopy = {
  full: `Only ${CARGO_CONTAINER.maxPlaced} containers can stand in the mine at once.`,
  offMine: 'Containers are set down underground, inside the mine.',
  unexplored: 'Set the container down on a tile you have already explored.',
  blocked: 'Set the container down in cleared space, not inside terrain.',
  occupied: 'A container already stands on that tile.'
};

/** Why this tile cannot take a crate, or `null` when it can. */
export function containerPlacementRefusal(x: number, y: number, context: ContainerPlacementContext): string | null {
  return placementRefusal(x, y, {
    explored: context.explored,
    open: context.open,
    occupied: context.containers.some(container => container.x === x && container.y === y),
    full: context.containers.length >= CARGO_CONTAINER.maxPlaced
  }, CONTAINER_PLACEMENT_COPY);
}

/**
 * The outcome of one press on a stack in the transfer menu: the two inventories
 * as they now stand, or the line to show the player instead.
 */
export type ContainerTransfer =
  | {ok: true; ship: Inventory; container: Inventory; moved: number; label: string}
  | {ok: false; refusal: string};

/**
 * Move a stack of `kind` from `from` into `to`, up to `limit` units. `null` when
 * the stack is not there or `limit` is nothing, so the caller can word why.
 */
function moveStack(
  from: Inventory,
  to: Inventory,
  kind: InventoryItemKind,
  limit: number
): {from: Inventory; to: Inventory; moved: number; item: InventoryItem} | null {
  const stack = findStack(from, kind);
  if (!stack) return null;
  const moved = Math.min(stack.count, limit);
  if (moved <= 0) return null;
  const loaded = addItem(to, stack.item, moved);
  return {from: removeItem(from, kind, moved), to: loaded, moved, item: stack.item};
}

/**
 * Bay → crate, capped by the crate's own item capacity. A partial load is a
 * success — the crate takes what fits and the rest stays aboard — and the whole
 * stack goes in one press when there is room, because a menu that moved one unit
 * per click would ask for forty presses to empty a full load of ore. `maxUnits`
 * caps the move below the whole stack — a Ctrl-click asks for exactly one — and
 * is still held under the crate's remaining room.
 */
export function storeInContainer(
  ship: Inventory,
  container: Inventory,
  kind: InventoryItemKind,
  maxUnits = Infinity
): ContainerTransfer {
  const room = roomLeft(container, CARGO_CONTAINER.capacity);
  if (room <= 0) {
    return findStack(ship, kind)
      ? {ok: false, refusal: 'Container is full. Take something out before storing more.'}
      : {ok: false, refusal: 'Nothing of that kind is aboard.'};
  }
  const moved = moveStack(ship, container, kind, Math.min(room, maxUnits));
  if (!moved) return {ok: false, refusal: 'Nothing of that kind is aboard.'};
  return {ok: true, ship: moved.from, container: moved.to, moved: moved.moved, label: moved.item.label};
}

/**
 * Crate → bay, capped by the cargo-bay upgrade. Room is measured against every
 * item already aboard, so equipment counts the same as ore. A partial load is a
 * success: taking two of the ten ore a crate holds is what a ship two short of
 * `cargoMax` should be able to do, and the rest stays where it was. `maxUnits`
 * caps the move below the whole stack — a Ctrl-click asks for exactly one — and
 * is still held under the bay's remaining room.
 */
export function takeFromContainer(
  ship: Inventory,
  container: Inventory,
  kind: InventoryItemKind,
  cargoMax: number,
  maxUnits = Infinity
): ContainerTransfer {
  const room = roomLeft(ship, cargoMax);
  if (room <= 0) {
    return {ok: false, refusal: `Cargo bay is full at ${cargoMax} items. Stow or unload before taking more aboard.`};
  }
  const moved = moveStack(container, ship, kind, Math.min(room, maxUnits));
  if (!moved) return {ok: false, refusal: 'Nothing of that kind is in the container.'};
  return {ok: true, ship: moved.to, container: moved.from, moved: moved.moved, label: moved.item.label};
}

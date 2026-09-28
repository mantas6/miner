// Decorations: the craftable panels the player sets down as tiles.
//
// Unlike the scanner, the stick of dynamite, and the cargo container — which are
// tracked as devices standing in the mine — a decoration *is* a tile. Placing one
// writes a `{type:'decor', decor}` tile; drilling it back out returns the item to
// the bay; a blast destroys it outright. So there is no placed-decor list and no
// per-frame tick: the tile diff is the whole record.
//
// This module holds the pure rules that surround that tile: how a `decor:` stack
// kind maps to the tile's `decor` id and back, and why a given tile can or cannot
// take a decoration. Everything here is DOM-free.

import type { DecorId, DecorKind } from './inventory';
import { isBlockedFor, placementRefusal, type Occupant, type PlacementCopy } from './placement';

/** The stack kind one decoration id lives under, e.g. `steelPlate` → `decor:steelPlate`. */
export function decorKindForId(id: DecorId): DecorKind {
  return `decor:${id}`;
}

/** The decoration id a stack kind names, e.g. `decor:lampPanel` → `lampPanel`. */
export function decorIdForKind(kind: DecorKind): DecorId {
  return kind.slice('decor:'.length) as DecorId;
}

/** How a decoration words each of the shared placement refusals. */
const DECOR_PLACEMENT_COPY: PlacementCopy = {
  // Decorations have no soft cap, so "full" can never fire; the others do.
  full: 'No more decorations can be placed here.',
  offMine: 'Decorations are set down underground, inside the mine.',
  unexplored: 'Set the decoration down on a tile you have already explored.',
  blocked: 'Set the decoration down in cleared space, not inside terrain.',
  occupied: 'Something already occupies that tile — a station, device or the ship itself.'
};

/** The slice of the mine a decoration placement has to weigh a tile against. */
export interface DecorPlacementContext {
  explored: ReadonlySet<number>;
  /** Whether the target tile is cleared air. */
  open: boolean;
  /**
   * What already stands on the tile (`occupantsAt`). A decoration is a solid tile,
   * so it refuses every occupant — the ship included, which it would wall in.
   */
  occupants: ReadonlySet<Occupant>;
}

/** Why this tile cannot take a decoration, or `null` when it can. */
export function decorPlacementRefusal(x: number, y: number, context: DecorPlacementContext): string | null {
  return placementRefusal(x, y, {
    explored: context.explored,
    open: context.open,
    occupied: isBlockedFor('decor', context.occupants),
    full: false
  }, DECOR_PLACEMENT_COPY);
}

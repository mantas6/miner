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
import { placementRefusal, type PlacementCopy } from './placement';

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
  blocked: 'Set the decoration down in cleared space, not inside terrain or on a station.',
  occupied: 'Something already occupies that tile.'
};

/**
 * Why this tile cannot take a decoration, or `null` when it can. `open` is the
 * caller's judgement that the tile is cleared air the ship does not need — and,
 * crucially, not a station tile, which the caller excludes before asking.
 */
export function decorPlacementRefusal(
  x: number,
  y: number,
  context: {explored: ReadonlySet<number>; open: boolean}
): string | null {
  return placementRefusal(x, y, {
    explored: context.explored,
    open: context.open,
    occupied: false,
    full: false
  }, DECOR_PLACEMENT_COPY);
}

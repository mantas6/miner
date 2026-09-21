// The underground home base's mutable state.
//
// The two stations that sit on the home-cavern floor are fixed world objects, not
// tiles: their positions are constants (`STATIONS` in `shared/constants.ts`) and
// only their contents change. Those contents live here, in `state.home`, and are
// persisted — the manufacturing station's own stock, and the oil extractor's
// queued coal and stored fuel.
//
// This is the Phase 2 stub: the type and its default only. Phase 4 grows the pure
// helpers (`nearestStation`, `stowAll`, crafting, the extractor tick) around them.

import { createInventory, type Inventory } from './inventory';

/** The oil extractor's timed coal → fuel conversion buffer. */
export interface HomeExtractor {
  /** Coal queued for conversion. */
  coal: number;
  /** Fuel already produced and waiting to top up the ship. */
  fuel: number;
}

/** Everything the home base stores between visits. */
export interface HomeState {
  /** The manufacturing station's own stock, apart from the ship's cargo bay. */
  station: {inventory: Inventory};
  extractor: HomeExtractor;
}

/** A fresh, empty home base. */
export function createHomeState(): HomeState {
  return {
    station: {inventory: createInventory()},
    extractor: {coal: 0, fuel: 0}
  };
}

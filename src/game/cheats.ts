// The Settings tab's developer cheats: free ore, and a stocked extractor.
//
// The rules (what is granted, and how much fits) are `core/developer.ts`; this is
// the part that touches the running game — banking the change, repainting a
// station screen that happens to be open so the result shows at once, and saying
// what happened.

import { fillDeveloperExtractor, grantDeveloperOres } from '../core/developer';
import type { ExtractorStation, ManufacturerStation, PlacedStation } from '../core/stations';
import type { GameState } from '../core/types';

export interface CheatDeps {
  state: GameState;
  /** The station whose screen is up, or `null`. */
  openStation(): PlacedStation | null;
  scheduleSave(): void;
  /** Repaint the manufacturer's screen with this stock. */
  repaintStation(station: ManufacturerStation): void;
  /** Repaint the extractor's screen with these buffers. */
  repaintExtractor(station: ExtractorStation): void;
  toast(message: string): void;
}

export interface Cheats {
  grantOres(): void;
  fillExtractor(): void;
}

export function createCheats(deps: CheatDeps): Cheats {
  const {state, toast} = deps;
  return {
    grantOres() {
      const granted = grantDeveloperOres(state);
      deps.scheduleSave();
      // Repaint the station screen if it happens to be open, so the overflow shows.
      const open = deps.openStation();
      if (open?.kind === 'manufacturer') deps.repaintStation(open);
      toast(granted > 0 ? `Developer action: granted ${granted} ore for $0.` : 'Developer action: no room for more ore.');
    },
    fillExtractor() {
      fillDeveloperExtractor(state);
      deps.scheduleSave();
      // Repaint the extractor screen if it is open, so the new buffers show at once.
      const open = deps.openStation();
      if (open?.kind === 'extractor') deps.repaintExtractor(open);
      toast('Developer action: extractor stocked for $0.');
    }
  };
}

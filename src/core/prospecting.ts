import { MAX_WORLD_ROW, ORES, START_Y, rowDepthMeters } from '../../shared/constants';
import { SHIP_ORDER, SHIPS } from './ships';
import type { Ore } from './types';

export interface ProspectingGuideRow {
  name: string;
  color: string;
  valueLabel: string;
  depthLabel: string;
}

/**
 * One player-facing depth band for a valuable's spawn rows. `MAX_WORLD_ROW` is a
 * sentinel for "the world does not end here", not a place anyone can dig to, so
 * it is spelled as an open-ended band rather than its raw (astronomical) metre
 * count.
 */
export function formatDepthBandLabel(minRow: number, maxRow: number, startY = START_Y): string {
  const minMeters = rowDepthMeters(minRow, startY);
  if (maxRow >= MAX_WORLD_ROW) return `≈${minMeters} m and deeper`;
  const maxMeters = rowDepthMeters(maxRow, startY);
  return minMeters === 0 ? `starter–≈${maxMeters} m` : `≈${minMeters}–${maxMeters} m`;
}

export function buildProspectingGuideRows(ores: Ore[] = ORES, startY = START_Y): ProspectingGuideRow[] {
  return ores.map(ore => ({
    name: ore.name,
    color: ore.color,
    valueLabel: `$${ore.value}`,
    depthLabel: formatDepthBandLabel(ore.min, ore.max, startY)
  }));
}

export const PROSPECTING_TIP = 'Early goal: dig below home into the first Coal/Iron seam, stow it at the Manufacturing Station, and craft a Fuel Tank Mk I.';

/**
 * How to comb a band: ore is rolled tile by tile, so a straight shaft sees only the
 * 3-wide strip the ship reveals and leaves a band after a few rows, while a
 * sideways gallery stays inside it (a Scout that sank one shaft to 740 m met no Silver).
 */
export const GALLERY_TIP = 'Once you reach an ore band, branch sideways off your shaft: a gallery stays in the band, a shaft passes straight through it.';

/** The ship ladder in one line: where the ore goes once the upgrades are made. */
export const SHIP_LADDER_TIP = `Ship ladder: ${SHIP_ORDER.map(id => SHIPS[id].label).join(' → ')}. Build the next hull at the Manufacturing Station's Shipyard from ore in its stock; each adds a fitting slot and a bigger tank, hull, bay and drill.`;

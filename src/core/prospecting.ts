import { MAX_WORLD_ROW, ORES, START_Y } from '../../shared/constants';
import { ECONOMY } from './balance';
import type { Ore } from './types';

export interface ProspectingGuideRow {
  name: string;
  color: string;
  valueLabel: string;
  depthLabel: string;
}

export function oreMinimumDepthMeters(oreMinRow: number, startY = START_Y): number {
  return Math.max(0, (oreMinRow - startY) * 10);
}

/**
 * One player-facing depth band for a valuable's spawn rows. `MAX_WORLD_ROW` is a
 * sentinel for "the world does not end here", not a place anyone can dig to, so
 * it is spelled as an open-ended band rather than its raw (astronomical) metre
 * count.
 */
export function formatDepthBandLabel(minRow: number, maxRow: number, startY = START_Y): string {
  const minMeters = oreMinimumDepthMeters(minRow, startY);
  if (maxRow >= MAX_WORLD_ROW) return `≈${minMeters} m and deeper`;
  const maxMeters = oreMinimumDepthMeters(maxRow, startY);
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

export const PROSPECTING_TIP = `Early goal: dig below home into the first Coal/Iron seam, then stow it and save toward Cargo +${ECONOMY.cargo.step}.`;

import { ORES, START_Y } from '../../shared/constants';
import { oreMinimumDepthMeters } from './prospecting';
import type { Ore } from './types';

export type DepthMilestoneKind = 'starter' | 'ore' | 'deep';

/** Spacing of the rolling depth targets used once the named landmarks are behind us. */
export const DEEP_RECORD_STEP_METERS = 1000;

export interface DepthMilestone {
  kind: DepthMilestoneKind;
  target: string;
  depthMeters: number;
  remainingMeters: number;
}

/**
 * Finds the next depth landmark from shared ore/world data. The first two ore
 * bands form the deliberately generated Coal/Iron starter seam; after that, each
 * locked ore band becomes the next target.
 *
 * Past the last ore band the mine generates indefinitely, so the ladder rolls on
 * in fixed depth-record steps rather than freezing on an already-cleared target.
 */
export function getDepthMilestone(
  playerY: number,
  ores: Ore[] = ORES,
  startY = START_Y
): DepthMilestone {
  const depthMeters = Math.max(0, playerY - startY) * 10;
  const starterOres = ores.slice(0, 2);
  const starterDepth = Math.max(0, ...starterOres.map(ore => oreMinimumDepthMeters(ore.min, startY)));

  if (starterOres.length > 0 && depthMeters < starterDepth) {
    return {
      kind: 'starter',
      target: `starter ${starterOres.map(ore => ore.name).join('/') } seam`,
      depthMeters: starterDepth,
      remainingMeters: Math.max(0, starterDepth - depthMeters)
    };
  }

  const nextOre = ores.slice(starterOres.length).find(ore => oreMinimumDepthMeters(ore.min, startY) > depthMeters);
  if (nextOre) {
    const targetDepth = oreMinimumDepthMeters(nextOre.min, startY);
    return {
      kind: 'ore',
      target: nextOre.name,
      depthMeters: targetDepth,
      remainingMeters: Math.max(0, targetDepth - depthMeters)
    };
  }

  const recordDepth = (Math.floor(depthMeters / DEEP_RECORD_STEP_METERS) + 1) * DEEP_RECORD_STEP_METERS;
  return {
    kind: 'deep',
    target: `${recordDepth} m depth record`,
    depthMeters: recordDepth,
    remainingMeters: recordDepth - depthMeters
  };
}

/**
 * Announcement copy for a landmark the expedition has just cleared. The caller
 * decides *when* a landmark is cleared (this module only reports the next one);
 * this is the wording used when it is.
 */
export function formatDepthMilestoneReached(milestone: DepthMilestone): string {
  const depth = `Depth ${milestone.depthMeters} m`;
  switch (milestone.kind) {
    case 'starter':
      return `${depth} — ${milestone.target} reached. Fill the cargo bay.`;
    case 'ore':
      return `${depth} — ${milestone.target} band reached. Richer ore, harder rock.`;
    case 'deep':
      return `${depth} — new depth record. The mine keeps going; keep fuel for the climb home.`;
  }
}

/** Formats the compact, always-visible progress readout used by the HUD. */
export function formatDepthMilestone(playerY: number, ores: Ore[] = ORES, startY = START_Y): string {
  const milestone = getDepthMilestone(playerY, ores, startY);
  return `Depth target: ${milestone.target} — ${milestone.remainingMeters} m deeper.`;
}

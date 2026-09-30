import { ORES, START_Y, rowDepthMeters } from '../../shared/constants';
import type { Ore } from './types';

export type DepthMilestoneKind = 'starter' | 'ore' | 'deep';

/** Spacing of the rolling depth targets used once the named landmarks are behind us. */
export const DEEP_RECORD_STEP_METERS = 1000;

export interface DepthMilestone {
  kind: DepthMilestoneKind;
  target: string;
  depthMeters: number;
  remainingMeters: number;
  /**
   * Past the last ore band, with the ship climbed back above a depth record the
   * career has already set: that record step, which the HUD shows in place of a
   * countdown ("record: 9000 m reached"). `null` otherwise.
   */
  recordMeters: number | null;
}

/**
 * Finds the next depth landmark from shared ore/world data. The first two ore
 * bands form the deliberately generated Coal/Iron starter seam; after that, each
 * locked ore band becomes the next target.
 *
 * The landmark is the next one below the career's deepest descent
 * (`maxDepthMeters`, `stats.maxDepth`) or the ship, whichever is deeper — a band
 * the career has already reached is not a target again, so a ship back at home
 * reads the band it has yet to reach, not the starter seam; the distance is still
 * counted from the ship.
 *
 * Past the last ore band the mine generates indefinitely, so the ladder rolls on
 * in fixed depth-record steps rather than freezing on an already-cleared target.
 */
export function getDepthMilestone(
  playerY: number,
  maxDepthMeters = 0,
  ores: Ore[] = ORES,
  startY = START_Y
): DepthMilestone {
  const depthMeters = rowDepthMeters(playerY, startY);
  const reached = Math.max(depthMeters, Number.isFinite(maxDepthMeters) ? maxDepthMeters : 0);
  const starterOres = ores.slice(0, 2);
  const starterDepth = Math.max(0, ...starterOres.map(ore => rowDepthMeters(ore.min, startY)));

  if (starterOres.length > 0 && reached < starterDepth) {
    return {
      kind: 'starter',
      target: `starter ${starterOres.map(ore => ore.name).join('/') } seam`,
      depthMeters: starterDepth,
      remainingMeters: Math.max(0, starterDepth - depthMeters),
      recordMeters: null
    };
  }

  const bands = ores.slice(starterOres.length);
  const nextOre = bands.find(ore => rowDepthMeters(ore.min, startY) > reached);
  if (nextOre) {
    const targetDepth = rowDepthMeters(nextOre.min, startY);
    return {
      kind: 'ore',
      target: nextOre.name,
      depthMeters: targetDepth,
      remainingMeters: Math.max(0, targetDepth - depthMeters),
      recordMeters: null
    };
  }

  const recordDepth = (Math.floor(reached / DEEP_RECORD_STEP_METERS) + 1) * DEEP_RECORD_STEP_METERS;
  // The deepest record step the career has passed, if it lies below the last
  // band (where the rolling records begin) and the ship is back above it.
  const lastBand = Math.max(starterDepth, ...bands.map(ore => rowDepthMeters(ore.min, startY)));
  const passed = recordDepth - DEEP_RECORD_STEP_METERS;
  return {
    kind: 'deep',
    target: `${recordDepth} m depth record`,
    depthMeters: recordDepth,
    remainingMeters: recordDepth - depthMeters,
    recordMeters: passed > lastBand && depthMeters < passed ? passed : null
  };
}

/**
 * The HUD caption under the depth number: the countdown to the next landmark,
 * or — past the last band, above a record already set — that record.
 */
export function formatDepthMilestone(milestone: Pick<DepthMilestone, 'target' | 'remainingMeters' | 'recordMeters'>): string {
  return milestone.recordMeters !== null
    ? `record: ${milestone.recordMeters} m reached`
    : `↓ ${milestone.remainingMeters} m to ${milestone.target}`;
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

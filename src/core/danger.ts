import { ENEMY, FUEL, HULL, RESPAWN } from './balance';
import { DANGER, START_Y, rowDepthMeters } from '../../shared/constants';
import { COCOON_WAKE_RADIUS } from './enemy-exposure';
import { ENEMY_TYPES } from './enemy-types';
import { EXTRACTOR_FUEL_ORDER, POST_REPAIR_KIT, buyPrice, extractorFuelOrderPrice, supplyPrice } from './trading';
import { WRECK } from './wreck';

export interface DangerGuideRow {
  title: string;
  detail: string;
}

function depthLabel(row: number, startY = START_Y): string {
  return `≈${rowDepthMeters(row, startY)} m`;
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/**
 * Hull damage one drill hit on a magma pocket at `row` deals. The hit that
 * `breaches` an untouched pocket takes the burst (`HULL.hazardBase` plus a step
 * every `HULL.hazardDepthDivisor` rows); every later hit to vent it only the small
 * tail. The curve and its numbers are documented at `HULL.hazardBase`.
 */
export function magmaHitDamage(row: number, breaches: boolean): number {
  if (breaches) return HULL.hazardBase + Math.floor(Math.max(0, row) / HULL.hazardDepthDivisor);
  return HULL.hazardTail.base + Math.floor(Math.max(0, row) / HULL.hazardTail.depthDivisor);
}

/** A whole pocket's damage when it takes `hits` hits to vent: the burst, then the tail on each later hit. */
export function magmaPocketDamage(row: number, hits: number): number {
  if (hits <= 0) return 0;
  return magmaHitDamage(row, true) + (hits - 1) * magmaHitDamage(row, false);
}

/** The one-line lead-in the Hazards guide opens with. */
export const DANGER_TIP = 'Plan a return route before the mine gets hostile: deep rewards bring rock, magma, and tunnel fiends.';

/**
 * Player-facing survival guidance derived exclusively from the world and
 * balance configuration, so the overlay remains accurate as tuning changes.
 */
export function buildDangerGuideRows(): DangerGuideRow[] {
  return [
    {
      title: 'Solid rock',
      detail: `Starts around ${depthLabel(DANGER.rockMinRow)}. It cannot be drilled; detour through dirt or air instead of taking its ${HULL.rockBump}-hull impact.`
    },
    {
      title: 'Magma pockets',
      detail: `Start around ${depthLabel(DANGER.hazardMinRow)}. Vent them with repeated drilling, each hit burning extra fuel. Breaking into a pocket scorches the hull once — ${magmaHitDamage(DANGER.hazardMinRow, true)} hull there, more the deeper it lies — and every further hit to vent it only a little (${magmaHitDamage(DANGER.hazardMinRow, false)} hull there), so a stronger drill takes less but is never immune.`
    },
    {
      title: 'Dormant tunnel fiends',
      detail: `Appear from about ${depthLabel(DANGER.enemyMinRow)}. One wakes when a tunnel opens onto it, or when the ship comes within ${COCOON_WAKE_RADIUS} tiles of one with open air to crawl out through — so leave room to retreat.`
    },
    {
      title: 'Active fiends',
      detail: `Drill them back before they chew the hull. Bites start at ${HULL.enemyBite.base} hull damage; faster ${ENEMY_TYPES.skitterling.name}s appear near ${depthLabel(ENEMY_TYPES.skitterling.minRow)}, armored ${ENEMY_TYPES.ironback.name}s near ${depthLabel(ENEMY_TYPES.ironback.minRow)}, and ${ENEMY_TYPES.abyssStalker.name}s beyond ${depthLabel(ENEMY_TYPES.abyssStalker.minRow)}.`
    },
    {
      title: 'Fighting fiends',
      detail: 'Fight from above in a one-tile shaft. An awake biter above you can still be drilled: hold Up into it. Only a dormant cocoon overhead is out of reach, because the drill never digs upward.'
    },
    {
      title: 'Fiend bounties',
      detail: `A destroyed fiend pays $${ENEMY.bounty.base}, plus $${ENEMY.bounty.step} for every ${ENEMY.bounty.depthDivisor} rows of depth.`
    },
    {
      title: 'Patching the hull',
      detail: `A Repair Kit restores ${percent(HULL.repairKitFraction)} of the hull. Craft one at the Manufacturing Station, buy one from the home Supply ($${supplyPrice(POST_REPAIR_KIT)}) or at any trading post ($${buyPrice(POST_REPAIR_KIT)}) — every post keeps a few on the shelf. Any portal, Home included, also patches the hull for cash at the posts' kit rate.`
    },
    {
      title: 'Fuel discipline',
      detail: `At ${Math.round(FUEL.lowFuelFraction * 100)}% fuel, turn back toward home. Climbing an open shaft is cheap and falling is free — it is drilling that burns the tank. Refuel at the Fuel Extractor before the next deep push.`
    },
    {
      title: 'Buying fuel',
      detail: `Fuel can be bought: order it into the home Fuel Extractor ($${extractorFuelOrderPrice()} per ${EXTRACTOR_FUEL_ORDER}), or fill the tank at a trading post, dearer the deeper it stands. Past the Coal band, buying is how the base stays stocked.`
    },
    {
      title: 'Losing a ship',
      detail: `A lost or scuttled ship leaves a wreck holding its ore and fitted upgrades; it crumbles after ${WRECK.lifetimeDeaths} more deaths. The replacement comes back on ${percent(RESPAWN.hullFraction)} hull — at home its tank is drawn from the Fuel Extractor's store, at a field portal it gets ${percent(RESPAWN.portalFuelFraction)} of a tank.`
    }
  ];
}

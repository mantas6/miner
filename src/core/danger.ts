import { ENEMY, FUEL, HULL, RESPAWN } from './balance';
import { DANGER, START_Y, rowDepthMeters } from '../../shared/constants';
import { ENEMY_TYPES } from './enemy-types';
import { EXTRACTOR_FUEL_ORDER, extractorFuelOrderPrice } from './trading';
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
      detail: `Start around ${depthLabel(DANGER.hazardMinRow)}. Vent them with repeated drilling, but each hit burns extra fuel and scorches the hull — the damage is per hit and rises with depth, so a stronger drill that vents it in fewer hits takes less.`
    },
    {
      title: 'Dormant tunnel fiends',
      detail: `Appear from about ${depthLabel(DANGER.enemyMinRow)}. Drilling nearby blocks can wake one, so leave room to retreat.`
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

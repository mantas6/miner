import { ENEMY, FUEL, HULL } from './balance';
import { DANGER, START_Y } from '../../shared/constants';
import { ENEMY_TYPES } from './enemy-types';

export interface DangerGuideRow {
  title: string;
  detail: string;
}

function depthLabel(row: number, startY = START_Y): string {
  return `≈${Math.max(0, row - startY) * 10} m`;
}

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
      detail: `Start around ${depthLabel(DANGER.hazardMinRow)}. Vent them with repeated drilling, but each hit burns extra fuel and scorches hull; damage rises with depth.`
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
      title: 'Fiend bounties',
      detail: `A destroyed fiend pays $${ENEMY.bounty.base}, plus $${ENEMY.bounty.step} for every ${ENEMY.bounty.depthDivisor} rows of depth.`
    },
    {
      title: 'Fuel discipline',
      detail: `At ${Math.round(FUEL.lowFuelFraction * 100)}% fuel, turn back toward home. Refuel at the Fuel Extractor before the next deep push.`
    }
  ];
}

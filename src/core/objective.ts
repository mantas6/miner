import { FUEL } from './balance';
import { ORES, START_Y } from '../../shared/constants';
import { canCraft, RECIPES } from './crafting';
import { isUpgradeKind, type Inventory } from './inventory';
import { oreMinimumDepthMeters } from './prospecting';
import type { Ore, Player } from './types';

type ObjectivePlayer = Pick<Player, 'y' | 'fuel' | 'fuelMax' | 'cargoMax' | 'equipment'>;

export interface ObjectiveInput {
  player: ObjectivePlayer;
  cargoCount: number;
  atSurface: boolean;
  /** The ship's cargo bay, to see whether an upgrade is aboard waiting to be fitted. */
  bay: Inventory;
  /** The manufacturing station's stock, to see stored upgrades and craft materials. */
  station: Inventory;
  ores?: Ore[];
  startY?: number;
}

/** The first ship upgrade the guidance nudges a fresh save toward crafting. */
const FIRST_UPGRADE = 'upgrade:tank:1';
const FIRST_UPGRADE_LABEL = 'Fuel Tank Mk I';

export function currentDepthMeters(playerY: number, startY = START_Y): number {
  return Math.max(0, playerY - startY) * 10;
}

export function nextOreMilestone(depthMeters: number, ores: Ore[] = ORES, startY = START_Y): { name: string; depthMeters: number } | null {
  const nextOre = ores.find(ore => oreMinimumDepthMeters(ore.min, startY) > depthMeters);
  if (!nextOre) return null;
  return { name: nextOre.name, depthMeters: oreMinimumDepthMeters(nextOre.min, startY) };
}

/** Whether any ship upgrade is fitted, in the bay, or stored at the station. */
function hasAnyUpgrade(player: ObjectivePlayer, bay: Inventory, station: Inventory): boolean {
  if (player.equipment.some(slot => slot !== null)) return true;
  return [...bay, ...station].some(stack => isUpgradeKind(stack.kind));
}

export function formatExpeditionObjective({
  player,
  cargoCount,
  atSurface,
  bay,
  station,
  ores = ORES,
  startY = START_Y
}: ObjectiveInput): string {
  const lowFuel = player.fuel <= player.fuelMax * FUEL.lowFuelFraction;

  if (!atSurface && lowFuel) {
    return 'Objective: return home and refuel at the Oil Extractor.';
  }

  if (cargoCount >= player.cargoMax) {
    return 'Objective: return home and stow cargo at the Manufacturing Station.';
  }

  if (!hasAnyUpgrade(player, bay, station)) {
    const recipe = RECIPES.find(entry => entry.output === FIRST_UPGRADE);
    if (recipe && canCraft(station, recipe)) {
      return `Objective: craft ${FIRST_UPGRADE_LABEL} at the Manufacturing Station.`;
    }
    return `Objective: mine Iron and Copper for ${FIRST_UPGRADE_LABEL}.`;
  }

  const depth = currentDepthMeters(player.y, startY);
  const nextOre = nextOreMilestone(depth, ores, startY);
  if (nextOre) {
    return `Objective: dig toward ${nextOre.name} around ${nextOre.depthMeters} m while keeping fuel for the trip home.`;
  }

  // Past the last ore band the mine keeps going, so there is no final target to
  // name: the run's goal stays "haul richer loads up alive and keep upgrading".
  const richestOre = ores[ores.length - 1];
  if (richestOre) {
    return `Objective: work the ${richestOre.name} depths, fill the bay, and get home alive.`;
  }

  return 'Objective: dig deeper, fill the bay, and get home alive.';
}

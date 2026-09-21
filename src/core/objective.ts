import { FUEL } from './balance';
import { ORES, START_Y } from '../../shared/constants';
import { cheapestUpgrade } from './economy';
import { oreMinimumDepthMeters } from './prospecting';
import type { Ore, Player } from './types';

type ObjectivePlayer = Pick<Player, 'y' | 'fuel' | 'fuelMax' | 'hull' | 'hullMax' | 'cargoMax' | 'drill'>;

export interface ObjectiveInput {
  player: ObjectivePlayer;
  cash: number;
  cargoCount: number;
  currentCargoValue: number;
  atSurface: boolean;
  ores?: Ore[];
  startY?: number;
}

export function currentDepthMeters(playerY: number, startY = START_Y): number {
  return Math.max(0, playerY - startY) * 10;
}

export function nextOreMilestone(depthMeters: number, ores: Ore[] = ORES, startY = START_Y): { name: string; depthMeters: number } | null {
  const nextOre = ores.find(ore => oreMinimumDepthMeters(ore.min, startY) > depthMeters);
  if (!nextOre) return null;
  return { name: nextOre.name, depthMeters: oreMinimumDepthMeters(nextOre.min, startY) };
}

export function formatExpeditionObjective({
  player,
  cash,
  cargoCount,
  currentCargoValue,
  atSurface,
  ores = ORES,
  startY = START_Y
}: ObjectiveInput): string {
  const depth = currentDepthMeters(player.y, startY);
  const lowFuel = player.fuel <= player.fuelMax * FUEL.lowFuelFraction;
  const nextUpgrade = cheapestUpgrade(player);
  const projectedCash = cash + currentCargoValue;

  if (!atSurface && lowFuel) {
    return `Objective: return to the surface now — fuel is ${Math.ceil(Math.max(0, player.fuel))}/${player.fuelMax}.`;
  }

  if (atSurface && currentCargoValue > 0) {
    return `Objective: sell cargo for $${currentCargoValue}, then ${projectedCash >= nextUpgrade.cost ? `buy ${nextUpgrade.label}` : `save for ${nextUpgrade.label}`}.`;
  }

  if (atSurface && cash >= nextUpgrade.cost) {
    return `Objective: buy ${nextUpgrade.label} for $${nextUpgrade.cost}, then dig deeper.`;
  }

  if (cargoCount >= player.cargoMax && !atSurface) {
    return `Objective: cargo full — return to sell $${currentCargoValue} and upgrade.`;
  }

  if (!atSurface && currentCargoValue > 0 && projectedCash >= nextUpgrade.cost) {
    return `Objective: return and sell $${currentCargoValue}; ${nextUpgrade.label} is ready after sale.`;
  }

  if (!atSurface && currentCargoValue > 0 && (depth >= 60 || currentCargoValue >= Math.max(24, nextUpgrade.cost - cash))) {
    return `Objective: bank this $${currentCargoValue} cargo at the depot before pushing deeper.`;
  }

  const nextOre = nextOreMilestone(depth, ores, startY);
  if (cargoCount === 0 && depth < 60) {
    return 'Objective: mine the starter Coal/Copper seam below the depot, then return to sell.';
  }

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

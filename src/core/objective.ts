import { FUEL } from './balance';
import { ORES, START_Y, rowDepthMeters } from '../../shared/constants';
import { canCraft, RECIPES } from './crafting';
import { isUpgradeKind, type Inventory } from './inventory';
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

/** The first ore band starting deeper than `depthMeters`, if any is left. */
function nextOreBelow(depthMeters: number, ores: readonly Ore[], startY: number): Ore | undefined {
  for (const ore of ores) if (rowDepthMeters(ore.min, startY) > depthMeters) return ore;
  return undefined;
}

export function nextOreMilestone(depthMeters: number, ores: Ore[] = ORES, startY = START_Y): { name: string; depthMeters: number } | null {
  const nextOre = nextOreBelow(depthMeters, ores, startY);
  if (!nextOre) return null;
  return { name: nextOre.name, depthMeters: rowDepthMeters(nextOre.min, startY) };
}

/** Whether any ship upgrade is fitted, in the bay, or stored at the station. */
function hasAnyUpgrade(player: ObjectivePlayer, bay: Inventory, station: Inventory): boolean {
  if (player.equipment.some(slot => slot !== null)) return true;
  return bay.some(stack => isUpgradeKind(stack.kind)) || station.some(stack => isUpgradeKind(stack.kind));
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
    return 'Objective: return home and refuel at the Fuel Extractor.';
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

  const depth = rowDepthMeters(player.y, startY);
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

/** The same stock for the objective's purposes: one inventory, or two empty ones. */
function sameStock(a: Inventory, b: Inventory | null): boolean {
  return a === b || (b !== null && a.length === 0 && b.length === 0);
}

/**
 * `formatExpeditionObjective` for a caller that asks every frame. The objective
 * is a function of a few coarse facts — the fuel-return and full-bay gates, the
 * upgrade state (the fitted slots, the bay and the station stock, all replaced
 * rather than mutated on change), and which ore band lies ahead — so the text is
 * rebuilt only when one of those moves, and a steady frame hands back the same
 * string without allocating.
 */
export function createExpeditionObjectiveFormatter(): (input: ObjectiveInput) => string {
  let primed = false;
  let returnGate = false;
  let fullGate = false;
  let equipment: ObjectivePlayer['equipment'] | null = null;
  let bay: Inventory | null = null;
  let station: Inventory | null = null;
  let oreTable: readonly Ore[] | null = null;
  let firstRow = 0;
  let aheadOre: Ore | undefined;
  let text = '';
  return input => {
    const {player, ores = ORES, startY = START_Y} = input;
    const returnForFuel = !input.atSurface && player.fuel <= player.fuelMax * FUEL.lowFuelFraction;
    const full = input.cargoCount >= player.cargoMax;
    const nextOre = nextOreBelow(rowDepthMeters(player.y, startY), ores, startY);
    if (
      primed && returnForFuel === returnGate && full === fullGate && player.equipment === equipment
      && input.bay === bay && sameStock(input.station, station)
      && ores === oreTable && startY === firstRow && nextOre === aheadOre
    ) return text;
    primed = true;
    returnGate = returnForFuel;
    fullGate = full;
    equipment = player.equipment;
    bay = input.bay;
    station = input.station;
    oreTable = ores;
    firstRow = startY;
    aheadOre = nextOre;
    text = formatExpeditionObjective(input);
    return text;
  };
}

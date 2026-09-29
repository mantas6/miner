// The HUD's one-line objective: a ladder of rungs, the first that applies wins.
//
//   1. underground on low fuel      → fly to the cheapest exit (home, or a portal home)
//   2. the bay is full              → stow it at home (or sell it, once a post is known)
//   3. at home, the base running dry → feed the Fuel Extractor coal
//   4. no ship upgrade yet          → the Fuel Tank Mk I nudge
//   5. a Mk II is craftable, none made yet → craft it
//   6. a Portal is craftable (or held) and none stands in the field → set one down deep
//   7. 600 m reached, never a Scanner → craft one: ore hides in the fog
//   8. 400 m reached, no trading post found → go find one
//   9. (reserved: the late-game rung)
//  10. the next ore band below the career's deepest descent
//
// The ladder is evaluated into a small `ObjectiveStep` (which rung, plus the few
// values its text needs); the text is a pure function of the step. That split is
// what lets the per-frame formatter skip rebuilding a string on a steady frame.

import { FUEL } from './balance';
import { ORES, START_Y, rowDepthMeters } from '../../shared/constants';
import { canCraft, RECIPES, type Recipe } from './crafting';
import { fuelExitLabel, type FuelExit } from './fuel-reserve';
import { isBaseLow } from './hud-alerts';
import { countItem, isUpgradeKind, oreKind, type Inventory, type InventoryItemKind } from './inventory';
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
  /**
   * The home extractor's buffers, `null` when none stands in the home cavern. Left
   * out, the base rung is skipped.
   */
  baseExtractor?: {fuel: number; coal: number} | null;
  /** Portals standing outside the home cavern. */
  fieldPortals?: number;
  /** The career's deepest descent, in metres (`stats.maxDepth`). */
  maxDepthMeters?: number;
  /** `stats.scannersObtained`. */
  scannersObtained?: number;
  /** `stats.bestMarkCrafted`. */
  bestMarkCrafted?: number;
  /** Trading posts the player has found (explored). */
  postsFound?: number;
  /** The exit the fuel reserve is priced to; home when left out. */
  nearestExit?: Pick<FuelExit, 'kind' | 'name'> | null;
}

/** The first ship upgrade the guidance nudges a fresh save toward crafting. */
const FIRST_UPGRADE = 'upgrade:tank:1';
const FIRST_UPGRADE_LABEL = 'Fuel Tank Mk I';

/** Career depth from which a ship that never had a Scanner is told to craft one. */
export const SCANNER_OBJECTIVE_DEPTH = 600;
/** Career depth from which a player who has found no trading post is sent to find one. */
export const POST_OBJECTIVE_DEPTH = 400;

const firstUpgradeRecipe = RECIPES.find(entry => entry.output === FIRST_UPGRADE);
const markTwoRecipes = RECIPES.filter(entry => isUpgradeKind(entry.output) && entry.output.endsWith(':2'));
const portalRecipe = RECIPES.find(entry => entry.output === 'device:portal');
const COAL = oreKind('Coal');

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

/** What the station stock can make, for the craft rungs: a function of the stock alone. */
interface CraftFacts {
  firstUpgrade: boolean;
  markTwo: boolean;
  portal: boolean;
}

/** What is fitted, aboard or stored: a function of the fitted slots, bay and stock. */
interface HoldFacts {
  /** Any ship upgrade fitted, in the bay, or stored at the station. */
  upgrade: boolean;
  /** A crafted Portal waiting to be set down, aboard or stored. */
  portal: boolean;
  /** A Scanner aboard or stored — however it was come by (a chest counts). */
  scanner: boolean;
  /** Coal in the bay. */
  coal: number;
}

function craftable(recipe: Recipe | undefined, station: Inventory): boolean {
  return recipe !== undefined && canCraft(station, recipe);
}

function craftFacts(station: Inventory): CraftFacts {
  return {
    firstUpgrade: craftable(firstUpgradeRecipe, station),
    markTwo: markTwoRecipes.some(recipe => canCraft(station, recipe)),
    portal: craftable(portalRecipe, station)
  };
}

function holds(bay: Inventory, station: Inventory, kind: InventoryItemKind): boolean {
  return countItem(bay, kind) > 0 || countItem(station, kind) > 0;
}

function holdFacts(player: ObjectivePlayer, bay: Inventory, station: Inventory): HoldFacts {
  return {
    upgrade: player.equipment.some(slot => slot !== null)
      || bay.some(stack => isUpgradeKind(stack.kind)) || station.some(stack => isUpgradeKind(stack.kind)),
    portal: holds(bay, station, 'device:portal'),
    scanner: holds(bay, station, 'scanner'),
    coal: countItem(bay, COAL)
  };
}

type Rung =
  | 'refuel' | 'stow' | 'base' | 'firstUpgrade' | 'markTwo' | 'portal' | 'scanner' | 'post'
  | 'depth' | 'richest' | 'deeper';

/** One evaluated rung: which, plus every value its text reads. */
interface ObjectiveStep {
  rung: Rung;
  /**
   * The rung's wording: refuel 0 home / 1 portal; stow 0 home / 1 or a post;
   * base 0 no extractor / 1 load coal / 2 mine coal; firstUpgrade 0 mine / 1 craft;
   * portal 0 craft / 1 set down; depth 0 mind the trip home / 1 a portal stands.
   */
  variant: number;
  /** Coal aboard (base 1) or the extractor's stored fuel (base 2). */
  amount: number;
  /** The exit label (refuel) or the ore name (depth, richest). */
  name: string;
  /** The ore band's depth in metres (depth). */
  depth: number;
}

function blankStep(): ObjectiveStep {
  return {rung: 'deeper', variant: 0, amount: 0, name: '', depth: 0};
}

function setStep(out: ObjectiveStep, rung: Rung, variant = 0, amount = 0, name = '', depth = 0): ObjectiveStep {
  out.rung = rung;
  out.variant = variant;
  out.amount = amount;
  out.name = name;
  out.depth = depth;
  return out;
}

/** Walk the ladder into `out`; the first rung that applies wins. */
function evaluate(input: ObjectiveInput, crafts: CraftFacts, held: HoldFacts, out: ObjectiveStep): ObjectiveStep {
  const {player, ores = ORES, startY = START_Y} = input;
  const postsFound = input.postsFound ?? 0;
  const fieldPortals = input.fieldPortals ?? 0;

  // 1. Out of fuel underground: the cheapest way back, whatever else is going on.
  if (!input.atSurface && player.fuel <= player.fuelMax * FUEL.lowFuelFraction) {
    const exit = input.nearestExit;
    return exit?.kind === 'portal'
      ? setStep(out, 'refuel', 1, 0, fuelExitLabel(exit))
      : setStep(out, 'refuel', 0);
  }

  // 2. A full bay goes home — or to a post, once one is known.
  if (input.cargoCount >= player.cargoMax) return setStep(out, 'stow', postsFound > 0 ? 1 : 0);

  // 3. At home with the base's fuel running out: feed it before the next dive.
  const base = input.baseExtractor;
  if (input.atSurface && base !== undefined && isBaseLow(base, player.fuelMax)) {
    if (!base) return setStep(out, 'base', 0);
    if (held.coal > 0) return setStep(out, 'base', 1, held.coal);
    return setStep(out, 'base', 2, Math.floor(base.fuel));
  }

  // 4. The first upgrade.
  if (!held.upgrade) return setStep(out, 'firstUpgrade', crafts.firstUpgrade ? 1 : 0);

  // 5. The first Mk II, once its materials are in the stock.
  if (crafts.markTwo && (input.bestMarkCrafted ?? 0) < 2) return setStep(out, 'markTwo');

  // 6. A field portal: a free ride home from the deep.
  if (fieldPortals === 0 && (held.portal || crafts.portal)) return setStep(out, 'portal', held.portal ? 1 : 0);

  const depth = rowDepthMeters(player.y, startY);
  const careerDepth = Math.max(depth, input.maxDepthMeters ?? 0);

  // 7. Past the Silver line with no Scanner ever: the richer ore is behind the fog.
  if (careerDepth >= SCANNER_OBJECTIVE_DEPTH && (input.scannersObtained ?? 0) === 0 && !held.scanner) {
    return setStep(out, 'scanner');
  }

  // 8. Deep enough for posts, and none found yet.
  if (careerDepth >= POST_OBJECTIVE_DEPTH && postsFound === 0) return setStep(out, 'post');

  // 9. Reserved: the late-game rung (Fuel Cells, the Core Drill) slots in here.

  // 10. The next ore band below the deepest the career has been — not below the
  // ship, which at home would name the first band all run long.
  const nextOre = nextOreBelow(careerDepth, ores, startY);
  if (nextOre) {
    return setStep(out, 'depth', fieldPortals === 0 ? 0 : 1, 0, nextOre.name, rowDepthMeters(nextOre.min, startY));
  }

  // Past the last ore band the mine keeps going, so there is no final target to
  // name: the run's goal stays "haul richer loads up alive and keep upgrading".
  const richestOre = ores[ores.length - 1];
  if (richestOre) return setStep(out, 'richest', 0, 0, richestOre.name);
  return setStep(out, 'deeper');
}

/** The objective line for an evaluated rung. */
function formatStep(step: ObjectiveStep): string {
  switch (step.rung) {
    case 'refuel':
      return step.variant === 1
        ? `Objective: fly to ${step.name} and jump home to refuel.`
        : 'Objective: fly home and refuel at the Fuel Extractor.';
    case 'stow':
      return step.variant === 1
        ? 'Objective: stow cargo at home, or sell it at a trading post.'
        : 'Objective: return home and stow cargo at the Manufacturing Station.';
    case 'base':
      if (step.variant === 0) return 'Objective: set a Fuel Extractor down in the home cavern.';
      if (step.variant === 1) return `Objective: load the ${step.amount} coal aboard into the Fuel Extractor.`;
      return `Objective: mine Coal — the Fuel Extractor is down to ${step.amount} fuel.`;
    case 'firstUpgrade':
      return step.variant === 1
        ? `Objective: craft ${FIRST_UPGRADE_LABEL} at the Manufacturing Station.`
        : `Objective: mine Iron and Copper for ${FIRST_UPGRADE_LABEL}.`;
    case 'markTwo':
      return 'Objective: craft a Mk II upgrade at the Manufacturing Station.';
    case 'portal':
      return step.variant === 1
        ? 'Objective: set the Portal down deep — a free ride home.'
        : 'Objective: craft a Portal and set it down deep — a free ride home.';
    case 'scanner':
      return 'Objective: craft a Scanner (2 Copper + 1 Silver) — ore hides in the fog.';
    case 'post':
      return `Objective: find a trading post below ${POST_OBJECTIVE_DEPTH} m to turn ore into cash.`;
    case 'depth':
      return step.variant === 1
        ? `Objective: dig toward ${step.name} around ${step.depth} m.`
        : `Objective: dig toward ${step.name} around ${step.depth} m while keeping fuel for the trip home.`;
    case 'richest':
      return `Objective: work the ${step.name} depths, fill the bay, and get home alive.`;
    case 'deeper':
      return 'Objective: dig deeper, fill the bay, and get home alive.';
  }
}

export function formatExpeditionObjective(input: ObjectiveInput): string {
  const step = evaluate(input, craftFacts(input.station), holdFacts(input.player, input.bay, input.station), blankStep());
  return formatStep(step);
}

/** The same stock for the objective's purposes: one inventory, or two empty ones. */
function sameStock(a: Inventory, b: Inventory | null): boolean {
  return a === b || (b !== null && a.length === 0 && b.length === 0);
}

function sameStep(a: ObjectiveStep, b: ObjectiveStep): boolean {
  return a.rung === b.rung && a.variant === b.variant && a.amount === b.amount && a.name === b.name && a.depth === b.depth;
}

/**
 * `formatExpeditionObjective` for a caller that asks every frame. The ladder is
 * cheap scalar tests over a few facts; the costly parts are cached on what they
 * depend on — the craft checks on the station stock, the held-item checks on the
 * fitted slots, bay and stock (all replaced rather than mutated on change) — and
 * the text is rebuilt only when the evaluated step moves, so a steady frame hands
 * back the same string without allocating.
 */
export function createExpeditionObjectiveFormatter(): (input: ObjectiveInput) => string {
  let craftStation: Inventory | null = null;
  let crafts: CraftFacts = craftFacts([]);
  let holdEquipment: ObjectivePlayer['equipment'] | null = null;
  let holdBay: Inventory | null = null;
  let holdStation: Inventory | null = null;
  let held: HoldFacts | null = null;
  const scratch = blankStep();
  const shown = blankStep();
  let text = '';
  return input => {
    const {player, bay, station} = input;
    if (!sameStock(station, craftStation)) {
      craftStation = station;
      crafts = craftFacts(station);
    }
    if (!held || player.equipment !== holdEquipment || bay !== holdBay || !sameStock(station, holdStation)) {
      holdEquipment = player.equipment;
      holdBay = bay;
      holdStation = station;
      held = holdFacts(player, bay, station);
    }
    evaluate(input, crafts, held, scratch);
    if (text !== '' && sameStep(scratch, shown)) return text;
    Object.assign(shown, scratch);
    text = formatStep(shown);
    return text;
  };
}

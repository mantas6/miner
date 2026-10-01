// The HUD's one-line objective: a ladder of rungs, the first that applies wins.
//
//   0. the ship is lost             → deploy a new one
//   1. underground on low fuel      → fly to the cheapest exit (home, or a portal home)
//   2. the hull is low              → spend a Repair Kit, or go get one
//   3. the bay is full              → stow it at home (or sell it, once a post is known)
//   4. at home, the base running dry → feed the Fuel Extractor coal — or, once the
//      career is past the Coal band, order fuel into it
//      a crafted upgrade in the bay or stock, a slot empty → fit it;
//      nothing fitted and a wreck holds an upgrade → salvage it
//   5. no ship upgrade yet          → the Fuel Tank Mk I nudge (mine, stow, craft)
//   6. a Mk II (or, after one, a Mk III) is craftable → craft it
//   7. the next hull on the ladder is buildable, or half its bill is stocked or
//      aboard → build it (stow first, when the rest of the bill is in the bay)
//   8. a Portal is craftable (or held; the Deep Portal once unlocked) and none
//      stands in the field → set one down deep
//   9. 600 m reached, never a Scanner → craft one (the Silver is home), buy one (the
//      cash is), or else dig galleries at the Silver band / sell ore at a post
//  10. 400 m reached, no trading post found → go find one
//  11. the late game: craft (then fit) the Core Drill; turn spare Uranium into Fuel
//      Cells; with the drill fitted, build the next hull, then — in the Core Breaker —
//      push the depth record past the next 1000 m
//  12. a Scout with a Mk I fitted   → the Drill Mk I first, while no drill is fitted
//      or held and a slot is free (mine, stow, craft); then name the Hauler and its bill
//  13. the deepest ore band reached, until a few of its ore are mined
//  14. the next ore band below the career's deepest descent
//
// The ladder is evaluated into a small `ObjectiveStep` (which rung, plus the few
// values its text needs); the text is a pure function of the step. That split is
// what lets the per-frame formatter skip rebuilding a string on a steady frame.

import { FUEL, HULL } from './balance';
import { ORES, START_Y, rowDepthMeters } from '../../shared/constants';
import { canCraft, formatInputs, isRecipeUnlocked, pooledShortfall, RECIPES, standardRecipe, type HasInputs, type Recipe } from './crafting';
import { fuelExitLabel, type FuelExit } from './fuel-reserve';
import { isBaseLow } from './hud-alerts';
import {
  CORE_DRILL_KIND,
  countItem,
  isUpgradeKind,
  oreKind,
  parseUpgradeKind,
  type Inventory,
  type InventoryItemKind,
  type UpgradeKind,
  type UpgradeTier
} from './inventory';
import { FUEL_CELL_FUEL, itemForKind } from './items';
import { hasEmptyOpenSlot, upgradeBonus } from './ship-upgrades';
import { SHIPS, nextShip, type ShipId } from './ships';
import { EXTRACTOR_FUEL_ORDER, POST_REPAIR_KIT, buyPrice, extractorFuelOrderPrice, supplyPrice } from './trading';
import type { Ore, Player } from './types';

type ObjectivePlayer = Pick<Player, 'y' | 'fuel' | 'fuelMax' | 'hull' | 'hullMax' | 'cargoMax' | 'equipment' | 'ship'>;

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
  /**
   * `stats.oresMined`, per ore name. Left out, every band counts as worked and the
   * band rung is skipped.
   */
  oresMined?: Readonly<Record<string, number>>;
  /** Trading posts the player has found (explored). */
  postsFound?: number;
  /** The wallet (`state.cash`), to tell a Scanner the player can buy from one it cannot. */
  cash?: number;
  /** The exit the fuel reserve is priced to; home when left out. */
  nearestExit?: Pick<FuelExit, 'kind' | 'name'> | null;
  /** The ship is lost (`state.gameOver`): every other rung waits for a new one. */
  gameOver?: boolean;
  /** A standing wreck that still holds a ship upgrade, or `null`. */
  wreckWithUpgrade?: {x: number; y: number} | null;
}

/** The first ship upgrade the guidance nudges a fresh save toward crafting. */
const FIRST_UPGRADE = 'upgrade:tank:1';
/**
 * The Scout's next upgrade after its first, ahead of the Hauler: at drill 1 an ore
 * takes a hit per hit point, so a trip brings home only a handful and the Hauler's
 * bill would take many trips.
 */
const SCOUT_DRILL = 'upgrade:drill:1';

/** Career depth from which a ship that never had a Scanner is told to craft one. */
export const SCANNER_OBJECTIVE_DEPTH = 600;
/** Career depth from which a player who has found no trading post is sent to find one. */
export const POST_OBJECTIVE_DEPTH = 400;
/** The depth-record rung rounds its target up to the next multiple of this. */
export const DEPTH_RECORD_STEP = 1000;
/**
 * How many of a band's ore must come out of the rock before the objective moves on
 * to the next band: the smallest count a Mk II or Mk III recipe takes of one ore.
 */
export const BAND_ORE_TARGET = 3;
/** The share of the next hull's bill the station and the bay must hold before the ship rung names it. */
export const SHIP_OBJECTIVE_SHARE = 0.5;

const firstUpgradeRecipe = RECIPES.find(entry => entry.output === FIRST_UPGRADE);
const scoutDrillRecipe = RECIPES.find(entry => entry.output === SCOUT_DRILL);
const markTwoRecipes = RECIPES.filter(entry => isUpgradeKind(entry.output) && entry.output.endsWith(':2'));
const markThreeRecipes = RECIPES.filter(entry => isUpgradeKind(entry.output) && entry.output.endsWith(':3'));
const portalRecipe = standardRecipe('device:portal');
/** The Deep Portal: the same Portal from deep ore, once the first Mk II is crafted. */
const deepPortalRecipe = RECIPES.find(entry => entry.output === 'device:portal' && entry.alt);
const coreDrillRecipe = RECIPES.find(entry => entry.output === CORE_DRILL_KIND);
const repairKitRecipe = RECIPES.find(entry => entry.output === 'repairKit');
const scannerRecipe = RECIPES.find(entry => entry.output === 'scanner');
const COAL = oreKind('Coal');
const SILVER = oreKind('Silver');
const URANIUM = oreKind('Uranium');
const REPAIR_KIT = 'repairKit';

/** A recipe's bill in words, e.g. "2 Copper + 1 Silver". */
function billText(recipe: HasInputs | undefined): string {
  return recipe ? recipe.inputs.map(input => `${input.count} ${itemForKind(input.kind).label}`).join(' + ') : '';
}

/** How many of `kind` a recipe (or hull) consumes; 0 for none. */
function inputCount(recipe: HasInputs | undefined, kind: InventoryItemKind): number {
  return recipe?.inputs.find(input => input.kind === kind)?.count ?? 0;
}

/** A recipe's inputs by name alone, e.g. "Iron and Copper". */
function inputNames(recipe: HasInputs | undefined): string {
  const names = recipe ? recipe.inputs.map(input => itemForKind(input.kind).label) : [];
  const last = names.pop() ?? '';
  return names.length > 0 ? `${names.join(', ')} and ${last}` : last;
}

/** How a Mk I the ladder steers toward reads on its mine / craft / stow lines. */
interface MarkOneGoal {
  label: string;
  /** What to mine for it, e.g. "Iron and Copper". */
  ores: string;
  /** Added to the mine line after the label: the bill, for a goal that gives its reason. */
  mineNote: string;
  /** Added to every line: why this upgrade, or ''. */
  note: string;
}

type MarkOneKind = typeof FIRST_UPGRADE | typeof SCOUT_DRILL;

/** What the Drill Mk I adds over the Scout's own drill, in percent: fewer hits per ore, so less fuel. */
const SCOUT_DRILL_GAIN = Math.round(upgradeBonus(SCOUT_DRILL) / SHIPS.scout.base.drill * 100);

const MARK_ONE_GOALS: Record<MarkOneKind, MarkOneGoal> = {
  [FIRST_UPGRADE]: {label: itemForKind(FIRST_UPGRADE).label, ores: inputNames(firstUpgradeRecipe), mineNote: '', note: ''},
  [SCOUT_DRILL]: {
    label: itemForKind(SCOUT_DRILL).label,
    ores: inputNames(scoutDrillRecipe),
    mineNote: ` (${billText(scoutDrillRecipe)})`,
    // Every hit burns the same fuel, so a stronger drill saves it on every ore.
    note: ` — +${SCOUT_DRILL_GAIN} % drill power, less fuel per ore`
  }
};

const REPAIR_KIT_BILL = billText(repairKitRecipe);
const REPAIR_KIT_PRICE = supplyPrice(REPAIR_KIT);
/** Every post keeps Repair Kits on the shelf (`POST_REPAIR_KIT`), at the post markup. */
const POST_REPAIR_KIT_PRICE = buyPrice(POST_REPAIR_KIT);
const SCANNER_BILL = billText(scannerRecipe);
const DEEP_PORTAL_BILL = billText(deepPortalRecipe);
const SCANNER_PRICE = supplyPrice('scanner');
/** The Silver a Scanner takes: what a career short of it has to dig for (or buy around). */
const SCANNER_SILVER = inputCount(scannerRecipe, SILVER);
/** What one extractor fuel order costs at the home price, in whole dollars (posts charge more the deeper they stand). */
const FUEL_ORDER_PRICE = extractorFuelOrderPrice();

const MARKS: Record<UpgradeTier, string> = {1: 'Mk I', 2: 'Mk II', 3: 'Mk III'};

/** What an upgrade is called as a goal: "a Mk II upgrade", "a Booster", "the Core Drill". */
function upgradeGoal(kind: UpgradeKind): string {
  const {id, tier} = parseUpgradeKind(kind);
  if (tier === 4) return 'the Core Drill';
  if (id === 'booster') return 'a Booster';
  return `a ${MARKS[tier]} upgrade`;
}

/** What an ore is first wanted for — the first upgrade recipe that takes it — or ''. */
function oreGoal(name: string): string {
  const kind = oreKind(name);
  for (const recipe of RECIPES) {
    if (isUpgradeKind(recipe.output) && recipe.inputs.some(input => input.kind === kind)) return upgradeGoal(recipe.output);
  }
  return '';
}

/** The first ore band starting deeper than `depthMeters`, if any is left. */
function nextOreBelow(depthMeters: number, ores: readonly Ore[], startY: number): Ore | undefined {
  for (const ore of ores) if (rowDepthMeters(ore.min, startY) > depthMeters) return ore;
  return undefined;
}

/** The deepest ore band starting at or above `depthMeters` — the band the career has reached. */
function reachedOreBand(depthMeters: number, ores: readonly Ore[], startY: number): Ore | undefined {
  let reached: Ore | undefined;
  for (const ore of ores) if (rowDepthMeters(ore.min, startY) <= depthMeters) reached = ore;
  return reached;
}

/** Whether Coal still spawns as deep as the career has been: the base can be fed from the rock. */
function coalInReach(depthMeters: number, ores: readonly Ore[], startY: number): boolean {
  const coal = ores.find(ore => ore.name === 'Coal');
  return coal === undefined || depthMeters < rowDepthMeters(coal.max, startY);
}

export function nextOreMilestone(depthMeters: number, ores: Ore[] = ORES, startY = START_Y): { name: string; depthMeters: number } | null {
  const nextOre = nextOreBelow(depthMeters, ores, startY);
  if (!nextOre) return null;
  return { name: nextOre.name, depthMeters: rowDepthMeters(nextOre.min, startY) };
}

/** What the station stock can make, for the craft rungs: a function of the stock alone. */
interface CraftFacts {
  firstUpgrade: boolean;
  /** The Scout's Drill Mk I. */
  scoutDrill: boolean;
  markTwo: boolean;
  markThree: boolean;
  portal: boolean;
  /** The Deep Portal's bill is stocked (whether it is unlocked is the ladder's call). */
  deepPortal: boolean;
  coreDrill: boolean;
}

/** The next hull up and how near the stock is to it: a function of the hull and the stock. */
interface ShipFacts {
  /** The hull the Shipyard would build next, or `null` on the top rung. */
  next: ShipId | null;
  label: string;
  /** The stock covers the whole bill. */
  buildable: boolean;
  /** The stock and the bay together cover it: stow, then build. */
  covered: boolean;
  /** The stock and the bay cover at least `SHIP_OBJECTIVE_SHARE` of the bill, counted in ore. */
  halfway: boolean;
  /** What neither the stock nor the bay holds, e.g. "10 Iron, 6 Silver"; empty once covered. */
  missing: string;
}

/** What is fitted, aboard or stored: a function of the fitted slots, bay and stock. */
interface HoldFacts {
  /** Any ship upgrade fitted, in the bay, or stored at the station. */
  upgrade: boolean;
  /** A Mk I upgrade (the Booster included) in a fitting slot. */
  markOneFitted: boolean;
  /** A drill upgrade of any mark fitted, aboard, or stored. */
  drill: boolean;
  /** The Scanner's Silver aboard or stored. */
  scannerSilver: boolean;
  /** A crafted Portal waiting to be set down, aboard or stored. */
  portal: boolean;
  /** A Scanner aboard or stored — however it was come by (a chest counts). */
  scanner: boolean;
  /** Coal in the bay. */
  coal: number;
  /** Uranium aboard and stored together — Fuel Cell material, and Core Drill / Core Breaker ore. */
  uranium: number;
  /** A Fuel Cell aboard or stored. */
  fuelCell: boolean;
  /** A Repair Kit in the bay, ready to spend from its slot. */
  repairKitAboard: boolean;
  /** A Repair Kit in the station stock. */
  repairKitStored: boolean;
  /** The Core Drill in a fitting slot. */
  coreDrillFitted: boolean;
  /** The Core Drill aboard or stored, waiting to be fitted. */
  coreDrillHeld: boolean;
  /**
   * A crafted upgrade waiting to be fitted — the bay's first, else the stock's —
   * or `null`. The Core Drill is left to its own late-game rung.
   */
  unfitted: {label: string; stored: boolean} | null;
  /** The bay and the stock together cover the Fuel Tank Mk I: stow, then craft. */
  firstUpgradeWithBay: boolean;
  /** The same for the Scout's Drill Mk I. */
  scoutDrillWithBay: boolean;
}

function craftable(recipe: Recipe | undefined, station: Inventory): boolean {
  return recipe !== undefined && canCraft(station, recipe);
}

/** Whether the bay and the stock together hold every input a recipe needs. */
function craftableTogether(recipe: Recipe | undefined, bay: Inventory, station: Inventory): boolean {
  return recipe !== undefined
    && recipe.inputs.every(input => countItem(bay, input.kind) + countItem(station, input.kind) >= input.count);
}

/** The first upgrade in `stock` bar the Core Drill, as its label, or `null`. */
function fittableLabel(stock: Inventory): string | null {
  for (const stack of stock) {
    if (isUpgradeKind(stack.kind) && stack.kind !== CORE_DRILL_KIND) return itemForKind(stack.kind).label;
  }
  return null;
}

function unfittedUpgrade(bay: Inventory, station: Inventory): HoldFacts['unfitted'] {
  const aboard = fittableLabel(bay);
  if (aboard) return {label: aboard, stored: false};
  const stored = fittableLabel(station);
  return stored ? {label: stored, stored: true} : null;
}

function craftFacts(station: Inventory): CraftFacts {
  return {
    firstUpgrade: craftable(firstUpgradeRecipe, station),
    scoutDrill: craftable(scoutDrillRecipe, station),
    markTwo: markTwoRecipes.some(recipe => canCraft(station, recipe)),
    markThree: markThreeRecipes.some(recipe => canCraft(station, recipe)),
    portal: craftable(portalRecipe, station),
    deepPortal: craftable(deepPortalRecipe, station),
    coreDrill: craftable(coreDrillRecipe, station)
  };
}

/**
 * The next hull's bill against the stock it is built from, with the ore aboard
 * counted toward it — the Shipyard's own reading (`pooledShortfall`) — so a ship
 * home with the last Silver in its bay is told to stow and build, not to mine.
 */
function shipFacts(ship: ShipId, bay: Inventory, station: Inventory): ShipFacts {
  const next = nextShip(ship);
  if (!next) return {next: null, label: '', buildable: false, covered: false, halfway: false, missing: ''};
  const hull = SHIPS[next];
  const {missing, stow} = pooledShortfall(bay, station, hull);
  const bill = hull.inputs.reduce((sum, input) => sum + input.count, 0);
  const lacking = missing.reduce((sum, input) => sum + input.count, 0);
  return {
    next,
    label: hull.label,
    buildable: missing.length === 0 && stow.length === 0,
    covered: missing.length === 0,
    halfway: bill > 0 && bill - lacking >= bill * SHIP_OBJECTIVE_SHARE,
    missing: formatInputs(missing)
  };
}

function holds(bay: Inventory, station: Inventory, kind: InventoryItemKind): boolean {
  return countItem(bay, kind) > 0 || countItem(station, kind) > 0;
}

function isDrillKind(kind: InventoryItemKind | null): boolean {
  return kind !== null && isUpgradeKind(kind) && parseUpgradeKind(kind).id === 'drill';
}

function holdFacts(player: ObjectivePlayer, bay: Inventory, station: Inventory): HoldFacts {
  return {
    upgrade: player.equipment.some(slot => slot !== null)
      || bay.some(stack => isUpgradeKind(stack.kind)) || station.some(stack => isUpgradeKind(stack.kind)),
    markOneFitted: player.equipment.some(slot => slot !== null && parseUpgradeKind(slot).tier === 1),
    drill: player.equipment.some(isDrillKind) || bay.some(stack => isDrillKind(stack.kind))
      || station.some(stack => isDrillKind(stack.kind)),
    scannerSilver: countItem(bay, SILVER) + countItem(station, SILVER) >= SCANNER_SILVER,
    portal: holds(bay, station, 'device:portal'),
    scanner: holds(bay, station, 'scanner'),
    coal: countItem(bay, COAL),
    uranium: countItem(bay, URANIUM) + countItem(station, URANIUM),
    fuelCell: holds(bay, station, 'fuelCell'),
    repairKitAboard: countItem(bay, REPAIR_KIT) > 0,
    repairKitStored: countItem(station, REPAIR_KIT) > 0,
    coreDrillFitted: player.equipment.includes(CORE_DRILL_KIND),
    coreDrillHeld: holds(bay, station, CORE_DRILL_KIND),
    unfitted: unfittedUpgrade(bay, station),
    firstUpgradeWithBay: craftableTogether(firstUpgradeRecipe, bay, station),
    scoutDrillWithBay: craftableTogether(scoutDrillRecipe, bay, station)
  };
}

type Rung =
  | 'lost' | 'refuel' | 'hull' | 'stow' | 'base' | 'fit' | 'salvage'
  | 'firstUpgrade' | 'markTwo' | 'markThree' | 'ship' | 'portal' | 'scanner' | 'post'
  | 'coreDrill' | 'fuelCell' | 'record' | 'band' | 'depth' | 'richest' | 'deeper';

/** One evaluated rung: which, plus every value its text reads. */
interface ObjectiveStep {
  rung: Rung;
  /**
   * The rung's wording: refuel 0 home / 1 portal; hull 0 kit aboard / 1 kit in
   * stock / 2 craft or buy at home / 3 go home for one / 4 or a post; stow 0 home /
   * 1 or a post; base 0 no extractor / 1 load coal / 2 mine coal / 3 order fuel;
   * fit 0 aboard / 1 in stock; firstUpgrade 0 mine / 1 craft / 2 stow and craft;
   * ship 0 build (or still needs) / 1 stow the ore aboard and build;
   * portal 0 craft / 1 set down / 2 craft the Deep Portal; scanner 0 craft / 1 buy /
   * 2 dig for Silver / 3 dig for it or sell ore at a post; coreDrill 0 craft /
   * 1 fit; band 0 none mined yet, here / 1 work it; depth 0 mind the trip home /
   * 1 a portal stands.
   */
  variant: number;
  /**
   * Coal aboard (base 1), the extractor's stored fuel (base 2), the wreck's x
   * (salvage), or the band's ore mined so far (band).
   */
  amount: number;
  /**
   * The exit label (refuel), the upgrade's label (fit), the Mk I's kind
   * (firstUpgrade), the hull's label (ship) or the ore name (band, depth, richest).
   */
  name: string;
  /**
   * The ore band's depth (band, depth; the Silver band's for scanner), the record
   * to beat (record) in metres, or the wreck's y (salvage).
   */
  depth: number;
  /** What the next hull still needs (ship), e.g. "10 Iron, 6 Silver"; empty otherwise. */
  detail: string;
}

function blankStep(): ObjectiveStep {
  return {rung: 'deeper', variant: 0, amount: 0, name: '', depth: 0, detail: ''};
}

function setStep(out: ObjectiveStep, rung: Rung, variant = 0, amount = 0, name = '', depth = 0, detail = ''): ObjectiveStep {
  out.rung = rung;
  out.variant = variant;
  out.amount = amount;
  out.name = name;
  out.depth = depth;
  out.detail = detail;
  return out;
}

function shipStep(out: ObjectiveStep, ships: ShipFacts): ObjectiveStep {
  return setStep(out, 'ship', !ships.buildable && ships.covered ? 1 : 0, 0, ships.label, 0, ships.missing);
}

/** A Mk I to make: craft it once stocked, stow and craft once the bay covers the rest, else mine for it. */
function markOneStep(out: ObjectiveStep, kind: MarkOneKind, craftableNow: boolean, withBay: boolean): ObjectiveStep {
  return setStep(out, 'firstUpgrade', craftableNow ? 1 : withBay ? 2 : 0, 0, kind);
}

/** Walk the ladder into `out`; the first rung that applies wins. */
function evaluate(input: ObjectiveInput, crafts: CraftFacts, ships: ShipFacts, held: HoldFacts, out: ObjectiveStep): ObjectiveStep {
  const {player, ores = ORES, startY = START_Y} = input;
  const postsFound = input.postsFound ?? 0;
  const fieldPortals = input.fieldPortals ?? 0;
  const bestMark = input.bestMarkCrafted ?? 0;
  const depth = rowDepthMeters(player.y, startY);
  const careerDepth = Math.max(depth, input.maxDepthMeters ?? 0);

  // 0. A lost ship has one thing left to do.
  if (input.gameOver) return setStep(out, 'lost');

  // 1. Out of fuel underground: the cheapest way back, whatever else is going on.
  if (!input.atSurface && player.fuel <= player.fuelMax * FUEL.lowFuelFraction) {
    const exit = input.nearestExit;
    return exit?.kind === 'portal'
      ? setStep(out, 'refuel', 1, 0, fuelExitLabel(exit))
      : setStep(out, 'refuel', 0);
  }

  // 2. A hull about to give: patch it before anything else can bite.
  if (player.hullMax > 0 && player.hull <= player.hullMax * HULL.lowHullFraction) {
    if (held.repairKitAboard) return setStep(out, 'hull', 0);
    if (input.atSurface) return setStep(out, 'hull', held.repairKitStored ? 1 : 2);
    return setStep(out, 'hull', postsFound > 0 ? 4 : 3);
  }

  // 3. A full bay goes home — or to a post, once one is known.
  if (input.cargoCount >= player.cargoMax) return setStep(out, 'stow', postsFound > 0 ? 1 : 0);

  // 4. At home with the base's fuel running out: feed it before the next dive —
  // with coal while the career still digs where Coal grows, with cash below it.
  const base = input.baseExtractor;
  if (input.atSurface && base !== undefined && isBaseLow(base, player.fuelMax)) {
    if (!base) return setStep(out, 'base', 0);
    if (held.coal > 0) return setStep(out, 'base', 1, held.coal);
    if (!coalInReach(careerDepth, ores, startY)) return setStep(out, 'base', 3);
    return setStep(out, 'base', 2, Math.floor(base.fuel));
  }

  // A crafted upgrade does nothing until it is fitted, so fit it while a slot is free.
  if (held.unfitted && hasEmptyOpenSlot(player.equipment, bestMark)) {
    return setStep(out, 'fit', held.unfitted.stored ? 1 : 0, 0, held.unfitted.label);
  }

  // A bare ship whose upgrades went down with the last one: get them back first.
  const wreck = input.wreckWithUpgrade;
  if (wreck && player.equipment.every(slot => slot === null)) return setStep(out, 'salvage', 0, wreck.x, '', wreck.y);

  // 5. The first upgrade: mine for it, stow what is aboard, then craft.
  if (!held.upgrade) return markOneStep(out, FIRST_UPGRADE, crafts.firstUpgrade, held.firstUpgradeWithBay);

  // 6. The first Mk II, then the first Mk III, once their materials are in the stock.
  if (crafts.markTwo && bestMark < 2) return setStep(out, 'markTwo');
  if (crafts.markThree && bestMark < 3) return setStep(out, 'markThree');

  // 7. The next hull, once it is buildable or half its bill is stocked.
  if (ships.next && (ships.buildable || ships.halfway)) return shipStep(out, ships);

  // 8. A field portal: a free ride home from the deep — from Silver and Gold, or,
  // once the deep recipes are unlocked, from the Ruby and Emerald of the deep game.
  if (fieldPortals === 0) {
    if (held.portal) return setStep(out, 'portal', 1);
    if (crafts.portal) return setStep(out, 'portal', 0);
    if (crafts.deepPortal && deepPortalRecipe && isRecipeUnlocked(deepPortalRecipe, bestMark)) return setStep(out, 'portal', 2);
  }

  // 9. Past the Silver line with no Scanner ever: the richer ore is behind the fog.
  // Only the way the player can actually take is named — the Silver to craft one,
  // the cash to buy one — and, short of both, where the Silver is (and, once a post
  // is known, that ore sells there for the cash).
  if (careerDepth >= SCANNER_OBJECTIVE_DEPTH && (input.scannersObtained ?? 0) === 0 && !held.scanner) {
    if (held.scannerSilver) return setStep(out, 'scanner', 0);
    if ((input.cash ?? 0) >= SCANNER_PRICE) return setStep(out, 'scanner', 1);
    const silver = ores.find(ore => ore.name === 'Silver');
    const bandDepth = silver ? rowDepthMeters(silver.min, startY) : SCANNER_OBJECTIVE_DEPTH;
    return setStep(out, 'scanner', postsFound > 0 ? 3 : 2, 0, '', bandDepth);
  }

  // 10. Deep enough for posts, and none found yet.
  if (careerDepth >= POST_OBJECTIVE_DEPTH && postsFound === 0) return setStep(out, 'post');

  // 11. The late game. The Core Drill first; Fuel Cells only from Uranium the
  // recipes still ahead — the Core Drill, the next hull — can spare; with the drill
  // fitted, the next hull, and in the last one, the record.
  const coreDrillPending = !held.coreDrillFitted && !held.coreDrillHeld;
  if (!held.coreDrillFitted && held.coreDrillHeld) return setStep(out, 'coreDrill', 1);
  if (coreDrillPending && crafts.coreDrill) return setStep(out, 'coreDrill', 0);
  const uraniumReserve = (coreDrillPending ? inputCount(coreDrillRecipe, URANIUM) : 0)
    + (ships.next ? inputCount(SHIPS[ships.next], URANIUM) : 0);
  if (held.uranium > uraniumReserve && !held.fuelCell) return setStep(out, 'fuelCell');
  if (held.coreDrillFitted) {
    if (ships.next) return shipStep(out, ships);
    const record = (Math.floor(careerDepth / DEPTH_RECORD_STEP) + 1) * DEPTH_RECORD_STEP;
    return setStep(out, 'record', 0, 0, '', record);
  }

  // 12. A Scout past its first upgrade: the Drill Mk I first — at drill 1 every ore
  // takes a hit per hit point, so a trip brings home a handful — while no drill is
  // fitted or held and a slot is free for it (one made goes to the fit rung above);
  // then name the Hauler, so the grind has a goal.
  if (held.markOneFitted && ships.next === 'hauler') {
    if (!held.drill && hasEmptyOpenSlot(player.equipment, bestMark)) {
      return markOneStep(out, SCOUT_DRILL, crafts.scoutDrill, held.scoutDrillWithBay);
    }
    return shipStep(out, ships);
  }

  // 13. The band the career has reached, until a few of its ore are mined — arriving
  // at a band is not the same as working it.
  const band = input.oresMined ? reachedOreBand(careerDepth, ores, startY) : undefined;
  const mined = band ? (input.oresMined?.[band.name] ?? 0) : 0;
  if (band && mined < BAND_ORE_TARGET) {
    const here = player.y >= band.min && player.y <= band.max;
    return setStep(out, 'band', here && mined === 0 ? 0 : 1, mined, band.name, rowDepthMeters(band.min, startY));
  }

  // 14. The next ore band below the deepest the career has been — not below the
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
    case 'lost':
      return 'Objective: press R (or tap the mine) to deploy a new ship.';
    case 'refuel':
      return step.variant === 1
        ? `Objective: fly to ${step.name} and jump home to refuel.`
        : 'Objective: fly home and refuel at the Fuel Extractor.';
    case 'hull':
      if (step.variant === 0) return 'Objective: hull is low — use a Repair Kit from its bay slot.';
      if (step.variant === 1) return 'Objective: hull is low — take the Repair Kit from the station and use it.';
      if (step.variant === 2) return `Objective: hull is low — craft a Repair Kit (${REPAIR_KIT_BILL}) or buy one from Supply ($${REPAIR_KIT_PRICE}).`;
      if (step.variant === 3) return `Objective: hull is low — return home: craft a Repair Kit (${REPAIR_KIT_BILL}) or buy one ($${REPAIR_KIT_PRICE}).`;
      return `Objective: hull is low — buy a Repair Kit at any trading post ($${POST_REPAIR_KIT_PRICE}), or return home to craft one (${REPAIR_KIT_BILL}).`;
    case 'stow':
      return step.variant === 1
        ? 'Objective: stow cargo at home, or sell it at a trading post.'
        : 'Objective: return home and stow cargo at the Manufacturing Station.';
    case 'base':
      if (step.variant === 0) return 'Objective: set a Fuel Extractor down in the home cavern.';
      if (step.variant === 1) return `Objective: load the ${step.amount} coal aboard into the Fuel Extractor.`;
      if (step.variant === 3) return `Objective: order fuel into the Fuel Extractor ($${FUEL_ORDER_PRICE} per ${EXTRACTOR_FUEL_ORDER}) or fill up at a trading post.`;
      return `Objective: mine Coal — the Fuel Extractor is down to ${step.amount} fuel.`;
    case 'fit':
      return step.variant === 1
        ? `Objective: take the ${step.name} from the station and fit it from the Ship screen.`
        : `Objective: fit the ${step.name} from the Ship screen.`;
    case 'salvage':
      return `Objective: salvage the wreck at (${step.amount}, ${step.depth}) — it holds your upgrades.`;
    case 'firstUpgrade': {
      const goal = MARK_ONE_GOALS[step.name as MarkOneKind];
      if (step.variant === 1) return `Objective: craft ${goal.label} at the Manufacturing Station${goal.note}.`;
      if (step.variant === 2) return `Objective: stow your ore and craft ${goal.label}${goal.note}.`;
      return `Objective: mine ${goal.ores} for ${goal.label}${goal.mineNote}${goal.note}.`;
    }
    case 'markTwo':
      return 'Objective: craft a Mk II upgrade at the Manufacturing Station.';
    case 'markThree':
      return 'Objective: craft a Mk III upgrade at the Manufacturing Station.';
    case 'ship':
      if (step.variant === 1) return `Objective: stow your ore and build the ${step.name} at the Manufacturing Station.`;
      return step.detail
        ? `Objective: build the ${step.name} at the Manufacturing Station (still needs ${step.detail}).`
        : `Objective: build the ${step.name} at the Manufacturing Station.`;
    case 'portal':
      if (step.variant === 1) return 'Objective: set the Portal down deep — a free ride home.';
      if (step.variant === 2) return `Objective: craft a Deep Portal (${DEEP_PORTAL_BILL}) and set it down deep — a free ride home.`;
      return 'Objective: craft a Portal and set it down deep — a free ride home.';
    case 'scanner':
      if (step.variant === 0) return `Objective: craft a Scanner (${SCANNER_BILL}) — set down, it maps the fog around it, ore and all.`;
      if (step.variant === 1) return `Objective: buy a Scanner from Supply ($${SCANNER_PRICE}) — set down, it maps the fog around it, ore and all.`;
      return step.variant === 3
        ? `Objective: for a Scanner (${SCANNER_BILL}, or $${SCANNER_PRICE} at Supply), dig sideways galleries around ${step.depth} m or sell ore at a trading post.`
        : `Objective: for a Scanner (${SCANNER_BILL}, or $${SCANNER_PRICE} at Supply), dig sideways galleries around ${step.depth} m — Silver hides beside shafts.`;
    case 'post':
      return `Objective: find a trading post below ${POST_OBJECTIVE_DEPTH} m to turn ore into cash.`;
    case 'coreDrill':
      return step.variant === 1
        ? 'Objective: fit the Core Drill from the Ship screen.'
        : 'Objective: craft the Core Drill at the Manufacturing Station.';
    case 'fuelCell':
      return `Objective: craft Fuel Cells (1 Uranium → 2 cells, +${FUEL_CELL_FUEL} fuel each) for the deep runs.`;
    case 'record':
      return `Objective: you have the deepest rig there is — set a depth record past ${step.depth} m.`;
    case 'band': {
      if (step.variant === 1) return `Objective: work the ${step.name} depths around ${step.depth} m — ${step.amount} of ${BAND_ORE_TARGET} mined.`;
      const goal = oreGoal(step.name);
      return goal
        ? `Objective: mine ${BAND_ORE_TARGET} ${step.name} here for ${goal}.`
        : `Objective: mine ${BAND_ORE_TARGET} ${step.name} here.`;
    }
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
  const {player, bay, station} = input;
  const step = evaluate(input, craftFacts(station), shipFacts(player.ship, bay, station), holdFacts(player, bay, station), blankStep());
  return formatStep(step);
}

/** The same stock for the objective's purposes: one inventory, or two empty ones. */
function sameStock(a: Inventory, b: Inventory | null): boolean {
  return a === b || (b !== null && a.length === 0 && b.length === 0);
}

function sameStep(a: ObjectiveStep, b: ObjectiveStep): boolean {
  return a.rung === b.rung && a.variant === b.variant && a.amount === b.amount && a.name === b.name
    && a.depth === b.depth && a.detail === b.detail;
}

/**
 * `formatExpeditionObjective` for a caller that asks every frame. The ladder is
 * cheap scalar tests over a few facts; the costly parts are cached on what they
 * depend on — the craft checks on the station stock, the next hull's bill on the
 * hull and the stock, the held-item checks on the fitted slots, bay and stock (all
 * replaced rather than mutated on change) — and the text is rebuilt only when the
 * evaluated step moves, so a steady frame hands back the same string without
 * allocating.
 */
export function createExpeditionObjectiveFormatter(): (input: ObjectiveInput) => string {
  let craftStation: Inventory | null = null;
  let crafts: CraftFacts = craftFacts([]);
  let shipStation: Inventory | null = null;
  let shipBay: Inventory | null = null;
  let shipId: ShipId | null = null;
  let ships: ShipFacts | null = null;
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
    if (!ships || player.ship !== shipId || !sameStock(station, shipStation) || !sameStock(bay, shipBay)) {
      shipStation = station;
      shipBay = bay;
      shipId = player.ship;
      ships = shipFacts(player.ship, bay, station);
    }
    if (!held || player.equipment !== holdEquipment || bay !== holdBay || !sameStock(station, holdStation)) {
      holdEquipment = player.equipment;
      holdBay = bay;
      holdStation = station;
      held = holdFacts(player, bay, station);
    }
    evaluate(input, crafts, ships, held, scratch);
    if (text !== '' && sameStep(scratch, shown)) return text;
    Object.assign(shown, scratch);
    text = formatStep(shown);
    return text;
  };
}

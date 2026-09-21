// Central balance/config module. DOM-free. Pure data, no behavior.
// All values ported verbatim from the previous inline literals.

export const STARTING = Object.freeze({
  cash: 60,
  fuel: 100,
  fuelMax: 100,
  hull: 100,
  hullMax: 100,
  // Cargo capacity is a total item count now, not a slot count: the bay holds up
  // to this many units across every stack, ore and equipment alike.
  cargoMax: 20,
  drill: 1
});

/**
 * The fixed fog-reveal footprint around the ship: movement permanently uncovers
 * this many tiles on a side (a 3x3 square). It is no longer upgradeable.
 */
export const REVEAL_FOOTPRINT = 3;

export const LIMITS = Object.freeze({
  fuelMax: Object.freeze({ min: 100, max: 2000 }),
  hullMax: Object.freeze({ min: 100, max: 2000 }),
  cargoMax: Object.freeze({ min: STARTING.cargoMax, max: 1000 }),
  drill: Object.freeze({ min: 1, max: 100 }),
  /** Carried (not yet planted) sticks of dynamite; they live in the cargo bay. */
  dynamite: Object.freeze({ min: 0, max: 999 }),
  /** Carried (not yet used) teleporters; they live in the cargo bay. */
  teleporters: Object.freeze({ min: 0, max: 999 }),
  /** Carried (not yet deployed) scanner devices; they live in the cargo bay. */
  scanners: Object.freeze({ min: 0, max: 999 }),
  /** Carried (not yet fired) Linebreaker guns; they live in the cargo bay. */
  guns: Object.freeze({ min: 0, max: 999 }),
  /** Carried (not yet placed) cargo containers; they live in the cargo bay. */
  containers: Object.freeze({ min: 0, max: 999 })
});

export const FUEL = Object.freeze({
  baseMove: 0.25,
  vertical: 0.08,
  flyMult: 0.5,
  digMult: 1.5,
  dig: Object.freeze({
    enemy: 0.65,
    hazard: 1.15,
    artifact: 1.4,
    dig: 0.9
  }),
  // Return forecast: a clear-shaft ascent with a deliberately generous detour allowance.
  returnReserveMultiplier: 2,
  returnReserveCautionMultiplier: 1.5,
  lowFuelFraction: 0.25,
  lowFuelWarnMs: 1400
});

export const SPRINT = Object.freeze({
  repeatMultiplier: 0.55,
  fuelMultiplier: 1.75
});

export const HULL = Object.freeze({
  lowHullFraction: 0.30,
  rockBump: 4,
  /**
   * Slamming a boosted ship into terrain. Charged on top of any tile damage, and
   * only once per run-up: the crash spends the sprint momentum that earned it.
   */
  sprintCrash: 6,
  /**
   * Standing at the centre of one's own blast. Roughly a third of a starting
   * hull, halving toward the rim: survivable at full strength from any distance,
   * and lethal to a ship that was already limping home.
   */
  dynamiteBlast: 35,
  hazardBase: 3.5,
  hazardDepthDivisor: 90,
  enemyBite: Object.freeze({
    base: 6,
    perDepth: 70,
    step: 2
  })
});

export const ENEMY = Object.freeze({
  bounty: Object.freeze({ base: 12, depthDivisor: 35, step: 4 })
});

export const ECONOMY = Object.freeze({
  refuel: Object.freeze({ base: 20, perTank: 0.35 }),
  repair: Object.freeze({ base: 30, perHull: 0.45 }),
  cargo: Object.freeze({ base: 120, growth: 1.32, step: 10 }),
  tank: Object.freeze({ base: 150, growth: 1.34, step: 20 }),
  hull: Object.freeze({ base: 180, growth: 1.38, step: 20 }),
  drill: Object.freeze({ base: 200, growth: 1.55, step: 1 }),
  dynamite: Object.freeze({ price: 50, radius: 2 }),
  /**
   * One disposable teleporter: a round trip to the depot and back to the tile it
   * was used on. The dearest consumable on the shelf, and the price it always
   * carried, because it saves the whole fuel-and-hull cost of the climb home and
   * hands back the deep position afterwards.
   */
  teleporter: Object.freeze({ price: 250 }),
  scanner: Object.freeze({ price: 50 }),
  /**
   * One disposable Linebreaker: a barrel, a single round, and nothing to reload.
   * Priced above the dynamite it competes with underground, because one shot
   * buys a guaranteed kill at range where a stick of dynamite buys a wider hole
   * the player still has to run away from.
   */
  gun: Object.freeze({ price: 150, range: 8, damage: 100 }),
  /**
   * One cargo container, dropped in the mine and left there for good.
   *
   * The shelf is a ladder of what a purchase buys: $50 buys one hole in the rock
   * (dynamite) or one small map (scanner), $150 buys one guaranteed kill at range
   * (Linebreaker), $250 buys one whole climb home and back (teleporter). A
   * container buys none of those — it does nothing on the turn it is used — but it
   * is the only thing on the shelf that is never spent, so a single purchase keeps
   * paying for the rest of the save. It sits one rung under the teleporter for
   * that reason: dearer than everything that resolves in a single press, cheaper
   * than the one consumable that rescues a run outright.
   */
  container: Object.freeze({ price: 200 }),
  artifactReward: 5000
});

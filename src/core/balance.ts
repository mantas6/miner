// Central balance/config module. DOM-free. Pure data, no behavior.

/**
 * A new career's wallet and vitals, and the starter Scout's base stats: the four
 * maxima here are what `SHIPS.scout.base` (`core/ships.ts`) reads, and every
 * bigger hull on the ladder brings its own.
 */
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

export const FUEL = Object.freeze({
  baseMove: 0.25,
  vertical: 0.08,
  flyMult: 0.5,
  digMult: 1.5,
  /**
   * Drilling sideways from a hover (nothing under the ship) multiplies the dig
   * cost again: reachable, so ore beside a shaft is not lost, but dearer than
   * digging with a floor to brace against. Kept mild: about one visible ore in
   * three sits in the row above a tunnel, and a hover is the only way to reach it.
   */
  hoverDrillMult: 1.25,
  dig: Object.freeze({
    enemy: 0.65,
    hazard: 1.15,
    dig: 0.9
  }),
  // Return forecast: a clear-flight trip to the nearest exit (home or a portal),
  // padded by a modest detour/hover allowance. Measured climbs cost about the
  // clear-flight price itself (26 against a 1.35× forecast of 37 at 1550 m), so
  // the pad stays small; the caution band below still warns well before empty.
  returnReserveMultiplier: 1.2,
  returnReserveCautionMultiplier: 1.5,
  lowFuelFraction: 0.25,
  lowFuelWarnMs: 1400
});

/**
 * What a replacement ship deploys with, as shares of its hull's bare base tank
 * and hull, so a death (or a scuttle) is never a free refill or a free repair.
 * At home the tank is filled from the home extractor's store, up to a full base
 * tank; a store too dry to cover `homeFuelFraction` of one tops it up to that
 * share, so a lost ship is never stranded. A field portal hands out only
 * `portalFuelFraction` of a tank and draws nothing. The hull always comes back at
 * `hullFraction` of its base maximum.
 */
export const RESPAWN = Object.freeze({
  homeFuelFraction: 0.5,
  portalFuelFraction: 0.5,
  hullFraction: 0.5
});

export const SPRINT = Object.freeze({
  repeatMultiplier: 0.55,
  fuelMultiplier: 1.75
});

export const HULL = Object.freeze({
  lowHullFraction: 0.30,
  /** Fraction of the hull maximum one repair kit restores. */
  repairKitFraction: 0.25,
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

/**
 * The fuel extractor's timed coal → fuel conversion: every `ticksPerCoal` steps
 * it burns one queued coal into `fuelPerCoal` stored fuel. `fuelCap` bounds the
 * buffer.
 *
 * `fuelPerCoal` must clearly out-earn what a coal run burns, or coal is
 * break-even and the seeded store is the whole early-game fuel budget. A run is a
 * sweep: the ship digs the band's dirt and keeps whatever coal lies in its path,
 * so the coal a stretch of mid-band dirt turns up must repay digging it 1.2 times
 * over at drill 1.75 (Scout + Drill Mk I). `balance.test.ts` pins that margin.
 */
export const EXTRACTOR = Object.freeze({
  ticksPerCoal: 180,
  fuelPerCoal: 115,
  fuelCap: 500
});

/**
 * Terrain tuning for `makeTile` in `world/world.ts`. Rows are absolute tile rows,
 * not `START_Y` offsets — these curves were balanced against raw `y` — and the
 * golden worldgen hash pins every value, so a change here moves the whole mine.
 */
export const TERRAIN = Object.freeze({
  /** Ore-spawn roll: `base × min(maxMultiplier, 1 + row / rowDivisor)`. */
  oreChance: Object.freeze({ base: .10, rowDivisor: 90, maxMultiplier: 2.2 }),
  /** Ore durability: `max(min, ceil(row / rowDivisor + base))`. */
  oreHp: Object.freeze({ min: 3, rowDivisor: 28, base: 4 }),
  /** Dirt durability: `max(min, ceil(row / rowDivisor) + base)`, plus `deepBonus` below `deepRow`. */
  dirtHp: Object.freeze({ min: 2, rowDivisor: 42, base: 1, deepRow: 210, deepBonus: 2 }),
  /** Undrillable rock: its roll doubles below `deepRow`. */
  rock: Object.freeze({ chance: .018, deepChance: .036, deepRow: 190, hp: 999 }),
  /** Magma: roll `min(chanceMax, chanceBase + row / chanceRowDivisor)`; hp `max(hpMin, ceil(hpBase + row / hpRowDivisor))`. */
  hazard: Object.freeze({ chanceBase: .007, chanceRowDivisor: 13000, chanceMax: .026, hpMin: 4, hpBase: 3, hpRowDivisor: 55 }),
  /** Dormant enemy: same shape as `hazard`; hp is the tunnel-fiend base the kind then scales. */
  enemy: Object.freeze({ chanceBase: .008, chanceRowDivisor: 6500, chanceMax: .046, hpMin: 4, hpBase: 3, hpRowDivisor: 35 })
});

// The world's data shapes are defined once, as zod schemas, in
// `shared/world-schema.ts`.
import type { EnemyKind, Tile } from '../../shared/world-schema';
// Type-only: neither the track registry nor the tile diff becomes a runtime
// dependency of this module.
import type { TrackId } from '../audio/tracks';
import type { PlacedContainer } from './cargo-container';
import type { PlacedDynamite } from './dynamite';
import type { Inventory, InventoryItemKind, UpgradeKind } from './inventory';
import type { ScannerDevice } from './scanner-device';
import type { PlacedStation } from './stations';
import type { Wreck } from './wreck';
import type { TileDiff } from '../world/tile-diff';

export type {
  AirTile,
  DecorId,
  DecorTile,
  DirtTile,
  DormantEnemyTile,
  EnemyKind,
  HazardTile,
  Ore,
  OreTile,
  RockTile,
  Tile
} from '../../shared/world-schema';

export type Direction = [number, number];

/**
 * What one attempted step did: the ship `advanced` onto the destination, the
 * drill `drilled` it (or hit an enemy) without getting through yet, the ship
 * `bumped` solid rock, the move was `refused` outright (no upward or ungrounded
 * side drilling), or `none` — nothing happened (the run is over, the tank was
 * already dry, or the world edge left nowhere to go).
 */
export type MoveResult = 'advanced' | 'drilled' | 'bumped' | 'refused' | 'none';

/**
 * A held direction that just bumped rock, and the tile the ship bumped it from.
 * Auto-repeat skips that direction while the ship stays on this tile, so a held
 * key costs one bump rather than one every repeat.
 */
export interface BumpLock {
  direction: Direction;
  x: number;
  y: number;
}

/**
 * A list with at least one entry. Indexing past the end still reads as possibly
 * `undefined`, but element 0 does not, so a constant table typed this way always
 * has an entry to fall back on.
 */
export type NonEmpty<T> = readonly [T, ...T[]];

/** One stack left in an opened chest: just the kind and how many, resolved through the catalog. */
export interface ChestLedgerStack {
  kind: InventoryItemKind;
  count: number;
}

/** The opened chests, keyed `"x,y"`; `[]` is a chest looted bare. */
export type ChestLedger = Record<string, ChestLedgerStack[]>;

export interface Player {
  x: number;
  y: number;
  drawX: number;
  drawY: number;
  facing: number;
  bob: number;
  drillAnim: number;
  drillDx: number;
  drillDy: number;
  fuel: number;
  fuelMax: number;
  hull: number;
  hullMax: number;
  cargoMax: number;
  drill: number;
  /**
   * The cargo bay. Mined ore stacks here awaiting stowage at the Manufacturing
   * Station, capped by `cargoMax`. Crafted equipment — dynamite, scanners,
   * teleporters, cargo containers, upgrades, station devices, decorations, the
   * toolkit — rides here too.
   */
  inventory: Inventory;
  /**
   * Ship-upgrade fitting slots, one entry per `SHIP_UPGRADE_SLOTS`. A slot holds
   * an equipped upgrade kind or `null` when empty. `applyEquipment` derives `fuelMax`/`hullMax`/`cargoMax`/`drill` and `boost` from these.
   */
  equipment: (UpgradeKind | null)[];
  /** Whether a Booster is fitted, enabling the Shift sprint. Derived from `equipment`. */
  boost: boolean;
}

/** The transform fields the ship shares with the renderer. */
export type ShipTransform = Pick<
  Player,
  'x' | 'y' | 'drawX' | 'drawY' | 'facing' | 'bob' | 'drillAnim' | 'drillDx' | 'drillDy'
>;

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  drawX: number;
  drawY: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  moveTick: number;
  biteTick: number;
  flash: number;
  /**
   * The cocoon tile it hatched from. Transient (enemies are never saved): the
   * hatch is left out of the tile diff so a reload regrows the cocoon, and a kill
   * records this tile as air so a destroyed enemy stays destroyed.
   */
  origin: {x: number; y: number};
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

export interface TeleportEffect {
  originScreenX: number;
  originScreenY: number;
  destinationX: number;
  destinationY: number;
  frame: number;
  duration: number;
  reducedMotion: boolean;
}

export interface GameStats {
  maxDepth: number;
  /** Every dollar credited to the wallet: trading-post ore sales and fiend bounties. */
  totalCashEarned: number;
  oreMined: number;
  enemiesDestroyed: number;
  deaths: number;
  /** Scanners crafted or bought (home Supply, trading posts) — the objective's Scanner rung. */
  scannersObtained: number;
  /** The highest upgrade mark ever crafted, 0 (none) to 4 — the objective's Mk II rung. */
  bestMarkCrafted: number;
}

export interface InputState {
  keyImpulse: Direction | null;
  /** Current keyboard sprint through open air; null while drilling, blocked, or idle. */
  sprintDirection: Direction | null;
  /** Speed carried out of the last move; a crash into terrain spends it. */
  sprintMomentum: Direction | null;
  lastKeyboardMove: number;
  keyboardRepeatMs: number;
  /**
   * Set when a keyboard move bumps rock; held repeats in that direction are
   * skipped until the key is let go, another direction is held, the ship leaves
   * the tile, or the rock ahead opens up. A fresh press always bumps again.
   */
  bumpLock: BumpLock | null;
  /** Deadline (sim tick) until which a second R press confirms a reset. */
  resetConfirmUntil: number;
}

export interface GameState {
  world: Tile[][];
  /**
   * Tile mutations of the world, against the terrain `world.ts` regenerates.
   * Persisted to `localStorage` and re-applied on every restart.
   */
  tileDiff: TileDiff;
  cash: number;
  tick: number;
  gameOver: boolean;
  camX: number;
  camY: number;
  particles: Particle[];
  enemies: Enemy[];
  /** Next id handed to an awakened enemy. */
  enemyIdCounter: number;
  input: InputState;
  player: Player;
  stats: GameStats;
  teleportEffect: TeleportEffect | null;
  reducedMotion: boolean;
  /** Explored cells as row-major indexes; every other tile is fogged. */
  exploredTiles: Set<number>;
  /** Scanner devices left in the mine, clearing fog around themselves. */
  scannerDevices: ScannerDevice[];
  /** Dynamite planted in the mine and still burning. */
  placedDynamite: PlacedDynamite[];
  /** Cargo containers standing in the mine, each with its own slots. */
  cargoContainers: PlacedContainer[];
  /**
   * Wrecks standing in the mine: the corpse loot a lost or reset ship leaves
   * behind, each holding the ore and (unequipped) upgrades that did not survive
   * the run. Bounded to `WRECK.maxPlaced`, oldest dropped; they survive death and
   * reload and clear only on a full player-data reset.
   */
  wrecks: Wreck[];
  /**
   * Stations standing in the mine — manufacturers with their own stock, extractors
   * with their coal/fuel buffers, named portals. One of each is seeded on the
   * home-cavern floor; the player can craft, place, and lift more with the
   * Construction Toolkit.
   */
  stations: PlacedStation[];
  /**
   * Trading-post buy stock the player has drawn down, keyed by `"x,y"` — one entry
   * per visited post, an array of remaining stock per offer index. Posts themselves
   * are derived from the world (`world.ts`), so only this dwindling stock is stored;
   * an absent key means the post is still at its freshly rolled stock. It survives
   * death and reload, and clears only on a full player-data reset.
   */
  tradeLedger: Record<string, number[]>;
  /**
   * What is left in each chest the player has opened, keyed by `"x,y"`. Chests and
   * their loot are derived from the world (`world.ts`, `core/chest.ts`), so an
   * absent key is a chest still holding its freshly rolled loot; an entry is written
   * the first time one is opened, and an empty array is a chest looted bare — gone
   * from the canvas and the observation. It survives death, reload and a world
   * reset, and clears only on a full player-data reset.
   */
  chestLedger: ChestLedger;
  /**
   * The carried item armed for a press on the mine, or `null` when nothing is:
   * a deployable (scanner, dynamite, container), a station device, a decoration,
   * or the Construction Toolkit. The placeable kinds drive the canvas placement
   * grid, and it mirrors the same state the sims paint onto the inventory slot.
   * Purely transient — never saved, since it is about what the player is doing
   * this instant, not what they own.
   */
  armedPlacement: InventoryItemKind | null;
  /**
   * The tile under the pointer while a device is armed, or `null`. Drives the
   * stronger hover highlight on the placement grid. Transient, like the pointer
   * itself.
   */
  hoverTile: {x: number; y: number} | null;
}

export interface AudioController {
  ctx: AudioContext | null;
  /** The shared context is unlocked and running; a gesture already paid for it. */
  enabled: boolean;
  /** Soundtrack preference, remembered between visits. */
  musicEnabled: boolean;
  /** Sound-effect preference, remembered between visits. */
  sfxEnabled: boolean;
  /** Either switch is on, so a trusted gesture is worth spending on an unlock. */
  readonly wantsSound: boolean;
  master: GainNode | null;
  musicGain: GainNode | null;
  musicEl: HTMLAudioElement | null;
  musicTimer: number | null;
  step: number;
  /** Track the soundtrack element is pointed at. */
  currentTrackId: TrackId;
  lastMove: number;
  lastLowFuel: number;
  init(): void;
  /** Unlock the context and resume whatever the player left switched on. */
  enable(): Promise<boolean>;
  toggleMusic(): Promise<void>;
  toggleSfx(): Promise<void>;
  /** One enveloped tone; `delay` (seconds) schedules it on the context clock. */
  blip(freq?: number, dur?: number, type?: OscillatorType, gain?: number, slide?: number, delay?: number): void;
  /** A lowpassed noise burst; `delay` (seconds) schedules it on the context clock. */
  noise(dur?: number, gain?: number, filterFreq?: number, delay?: number): void;
  /** Layered boom for dynamite and ship destruction; `power` scales loudness and length. */
  explosion(power?: number): void;
  mine(): void;
  ore(value?: number): void;
  cash(value?: number): void;
  bump(): void;
  enemyHit(): void;
  enemyWake(): void;
  alarm(): void;
  lowFuel(): void;
  // Named cues, one per kind of player action; each is silent while effects are off.
  /** Rising three-step gurgle as fuel pours into the tank. */
  refuel(): void;
  /** Metallic double clank of the Manufacturer. */
  craft(): void;
  /** Ore sold at a trading post: the cash register. */
  sell(value?: number): void;
  buy(): void;
  /** Cargo into a station, extractor or container. */
  stow(): void;
  /** Cargo out of a station, container or wreck. */
  take(): void;
  /** A device, station or decoration set down in the mine. */
  place(): void;
  /** The Construction Toolkit packing something back up. */
  lift(): void;
  /** Whoosh of a portal or teleporter jump. */
  portal(): void;
  upgradeFit(): void;
  upgradeRemove(): void;
  repair(): void;
  /** An overlay coming up. */
  open(): void;
  /** An overlay going away. */
  close(): void;
  /** A device armed for a press on the mine. */
  arm(): void;
  /** An armed device stood down. */
  disarm(): void;
  /** A ship deployed: run start and a portal redeploy. */
  respawn(): void;
  /** An enemy bounty paid out. */
  bounty(): void;
  /** A depth landmark cleared. */
  milestone(): void;
  /** A scanner device finished its survey. */
  surveyDone(): void;
  /** The softest tick, for switches and small confirmations. */
  click(): void;
  chestOpen(): void;
  /** Low bell for a grave. */
  grave(): void;
  /** True when the shipped audio played; false when the synth fallback took over. */
  startMusic(): Promise<boolean>;
  startSynthMusic(): void;
  musicNote(freq: number, dur: number, type: OscillatorType, gain: number, start: number): void;
  stopMusic(): void;
  /** Point the soundtrack at another shipped track, keeping playback state. */
  setTrack(trackId: TrackId): void;
  /**
   * Tear down for good: stop the loop, release the soundtrack element and close
   * the context. Every later call on the controller is a no-op.
   */
  dispose(): void;
}

// The world's data shapes are defined once, as zod schemas, in
// `shared/world-schema.ts`.
import type { EnemyKind, Tile } from '../../shared/world-schema';
// Type-only: neither the track registry nor the tile diff becomes a runtime
// dependency of this module.
import type { TrackId } from '../audio/tracks';
import type { PlacedContainer } from './cargo-container';
import type { PlacedDynamite } from './dynamite';
import type { Inventory, InventoryItemKind } from './inventory';
import type { ScannerDevice } from './scanner-device';
import type { TileDiff } from '../world/tile-diff';

export type {
  AirTile,
  Artifact,
  ArtifactTile,
  DirtTile,
  DormantEnemyTile,
  EnemyKind,
  HazardTile,
  MotherlodeTile,
  Ore,
  OreTile,
  RockTile,
  Tile
} from '../../shared/world-schema';

export type Direction = [number, number];

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
   * The slot-based cargo bay. Mined ore stacks here awaiting sale at the depot
   * (artifacts are banked instead), capped by both a free slot and `cargoMax`.
   * Bought equipment — dynamite, scanners, Linebreaker guns, teleporters, cargo
   * containers — rides here too.
   */
  inventory: Inventory;
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

export interface TeleportReturnPosition {
  x: number;
  y: number;
}

export interface GameStats {
  maxDepth: number;
  totalCashEarned: number;
  oreMined: number;
  artifactsFound: number;
  enemiesDestroyed: number;
  deaths: number;
  motherlodeClaims: number;
  motherlodeExtractions: number;
}

export interface InputState {
  keyImpulse: Direction | null;
  /** Current keyboard sprint through open air; null while drilling, blocked, or idle. */
  sprintDirection: Direction | null;
  /** Speed carried out of the last move; a crash into terrain spends it. */
  sprintMomentum: Direction | null;
  lastKeyboardMove: number;
  keyboardRepeatMs: number;
  gunArmed: boolean;
  /** Deadline (performance clock) until which a second R press confirms a reset. */
  resetConfirmUntil: number;
}

export interface GameState {
  world: Tile[][];
  /**
   * Tile mutations of the world, against the terrain `world.ts` regenerates.
   * Persisted to `localStorage` and re-applied on every restart.
   */
  soloTileDiff: TileDiff;
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
  extractionPhase: import('./extraction-phase').ExtractionPhase;
  teleportEffect: TeleportEffect | null;
  teleportReturnPosition: TeleportReturnPosition | null;
  reducedMotion: boolean;
  /** Explored underground cells as row-major indexes; surface rows are implicitly visible. */
  exploredTiles: Set<number>;
  /** Scanner devices left in the mine, clearing fog around themselves. */
  scannerDevices: ScannerDevice[];
  /** Dynamite planted in the mine and still burning. */
  placedDynamite: PlacedDynamite[];
  /** Cargo containers standing in the mine, each with its own slots. */
  cargoContainers: PlacedContainer[];
  /**
   * The carried device armed for placement, or `null` when nothing is. Only the
   * placeable kinds (scanner, dynamite, container) ever appear here; it drives the
   * canvas placement grid, and mirrors the same state the sims paint onto the HUD
   * slot. Purely transient — never saved, since it is about what the player is
   * doing this instant, not what they own.
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
  blip(freq?: number, dur?: number, type?: OscillatorType, gain?: number, slide?: number): void;
  noise(dur?: number, gain?: number, filterFreq?: number): void;
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
  /** True when the shipped audio played; false when the synth fallback took over. */
  startMusic(): Promise<boolean>;
  startSynthMusic(): void;
  musicNote(freq: number, dur: number, type: OscillatorType, gain: number, start: number): void;
  stopMusic(): void;
  /** Point the soundtrack at another shipped track, keeping playback state. */
  setTrack(trackId: TrackId): void;
}

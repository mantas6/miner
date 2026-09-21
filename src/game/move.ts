// One step of the ship.
//
// Every attempted move funnels through `move()`: it clamps the destination,
// charges fuel, and then hands the destination tile to a per-type handler that
// decides whether the ship advances or the drill merely bites. The handler table
// is exhaustive over `Tile['type']`, so a new terrain type fails to compile until
// its movement rule exists.

import { START_Y, WORLD_W } from '../../shared/constants';
import { ECONOMY, FUEL, HULL } from '../core/balance';
import { claimArtifact } from '../core/artifacts';
import { beginExtraction, completeExtractionAtDepot } from '../core/extraction-phase';
import { addOre } from '../core/inventory';
import { fuelAfterMovement, isOpenSpaceDestination, movementDestination, sprintCrashDamage, sprintMomentumAfterMove } from '../core/movement';
import type {
  AirTile,
  ArtifactTile,
  AudioController,
  Direction,
  DirtTile,
  DormantEnemyTile,
  GameState,
  HazardTile,
  MotherlodeTile,
  OreTile,
  Player,
  RockTile,
  Tile
} from '../core/types';
import type { EnemySim } from './enemies';
import type { WorldGrid } from './world-grid';

/** Whether the destination cleared out enough for the ship to occupy it. */
type MoveOutcome = 'blocked' | 'advance';

interface MoveContext {
  dx: number;
  dy: number;
  /** Destination coordinate, already clamped to the world. */
  nx: number;
  ny: number;
  player: Player;
  /** Charge the move's fuel, applying the sprint and free-fall modifiers. */
  useFuel(amount: number): void;
  /** Fuel needed to drill through the destination, plus a per-tile surcharge. */
  dig(extra: number): number;
  /** Fuel needed to fly through open air. */
  flyCost: number;
}

type TileMoveHandler<T extends Tile = Tile> = (tile: T, context: MoveContext) => MoveOutcome;

export interface GameMovement {
  /** Attempt one step. `sprinting` only matters through open space. */
  move(dx: number, dy: number, sprinting?: boolean): void;
  /** Whether the ship would fly (not drill) into this direction's destination. */
  isOpenMovementDestination(dx: number, dy: number): boolean;
}

export interface GameMovementDeps {
  state: GameState;
  grid: WorldGrid;
  enemies: EnemySim;
  audio: AudioController;
  toast(message: string): void;
  saveProgress(): void;
  /** Queue a debounced save; every step moves the ship's persisted position. */
  scheduleSave(): void;
  addCash(amount: number): void;
  /** Reveal the fog footprint around the ship's new position. */
  revealAtPlayer(): void;
  atSurface(): boolean;
  /** Apply hull damage, which may end the run. */
  damage(amount: number): void;
  /** End the run with a message. */
  gameOver(message: string): void;
  spawnDust(x: number, y: number, color?: string, amount?: number): void;
  spawnExplosion(x: number, y: number): void;
}

export function createMovement(deps: GameMovementDeps): GameMovement {
  const {state, grid, enemies, audio, toast, saveProgress, addCash, atSurface, damage, gameOver, spawnDust, spawnExplosion} = deps;

  function grounded(): boolean {
    const p = state.player;
    return grid.get(p.x, p.y + 1).type !== 'air';
  }

  function isOpenMovementDestination(dx: number, dy: number): boolean {
    const p = state.player;
    const {x: nx, y: ny} = movementDestination(p.x, p.y, dx, dy, WORLD_W, START_Y);
    return isOpenSpaceDestination(nx !== p.x || ny !== p.y, grid.get(nx, ny).type, Boolean(enemies.enemyAt(nx, ny)));
  }

  function flyThroughAir(_tile: AirTile, {dy, useFuel, flyCost}: MoveContext): MoveOutcome {
    useFuel(flyCost);
    if (performance.now() - audio.lastMove > 120) {
      audio.blip(150 + Math.abs(dy)*35, 0.035, 'triangle', 0.02);
      audio.lastMove = performance.now();
    }
    return 'advance';
  }

  function bumpIntoRock(_tile: RockTile, {dx, dy, nx, ny, player, useFuel, dig}: MoveContext): MoveOutcome {
    player.drillDx = dx; player.drillDy = dy; player.drillAnim = 1.2;
    damage(HULL.rockBump);
    useFuel(dig(0));
    spawnDust(nx, ny, '#444857', 8);
    audio.bump();
    toast('Solid rock blocks the drill.');
    return 'blocked';
  }

  function drillEnemyCocoon(_tile: DormantEnemyTile, {dx, dy, nx, ny, player, useFuel, dig}: MoveContext): MoveOutcome {
    player.drillDx = dx; player.drillDy = dy; player.drillAnim = 1.65;
    useFuel(dig(FUEL.dig.enemy));
    enemies.damageEnemyTile(nx, ny);
    return 'blocked';
  }

  function drillHazard(tile: HazardTile, {dx, dy, nx, ny, player, useFuel, dig}: MoveContext): MoveOutcome {
    player.drillDx = dx; player.drillDy = dy; player.drillAnim = 1.65;
    tile.hp -= player.drill;
    useFuel(dig(FUEL.dig.hazard));
    damage(HULL.hazardBase + Math.floor(ny/HULL.hazardDepthDivisor));
    spawnDust(nx, ny, '#ff5f24', 18);
    audio.alarm();
    if (tile.hp <= 0) {
      grid.set(nx, ny, {type:'air'});
      spawnExplosion(nx, ny);
      enemies.wakeEnemiesNear(nx, ny);
      toast('Magma pocket vented — hull scorched!');
    } else {
      grid.set(nx, ny, tile);
      toast(`Venting magma... ${Math.ceil(tile.hp)} hits left`);
    }
    return 'blocked';
  }

  function drillMotherlode(tile: MotherlodeTile, {dx, dy, nx, ny, player, useFuel, dig}: MoveContext): MoveOutcome {
    player.drillDx = dx; player.drillDy = dy; player.drillAnim = 1.9;
    tile.hp -= player.drill;
    useFuel(dig(FUEL.dig.artifact));
    spawnDust(nx, ny, '#ffb347', 24);
    audio.mine();
    if (tile.hp <= 0) {
      grid.set(nx, ny, {type:'air'});
      enemies.wakeEnemiesNear(nx, ny);
      const extraction = beginExtraction(state.extractionPhase);
      state.extractionPhase = extraction.phase;
      if (extraction.changed) {
        addCash(ECONOMY.artifactReward);
        state.stats.motherlodeClaims++;
        saveProgress();
      }
      spawnExplosion(nx, ny);
      toast('Motherlode core secured +$5000! Return it to the depot alive.');
    } else {
      grid.set(nx, ny, tile);
      toast(`Cracking Motherlode core... ${Math.ceil(tile.hp)} hits left`);
    }
    return 'blocked';
  }

  /** Dirt, ore, and artifacts share one drill pass; only the payout differs. */
  function drillValuableTile(tile: DirtTile | OreTile | ArtifactTile, {dx, dy, nx, ny, player, useFuel, dig}: MoveContext): MoveOutcome {
    player.drillDx = dx; player.drillDy = dy; player.drillAnim = 1.65;
    tile.hp -= player.drill;
    useFuel(dig(FUEL.dig.dig));
    spawnDust(nx, ny, tile.type === 'ore' ? tile.ore.color : tile.type === 'artifact' ? tile.artifact.color : '#9d6a42', tile.type === 'ore' || tile.type === 'artifact' ? 14 : 9);
    audio.mine();
    if (tile.hp > 0) {
      grid.set(nx, ny, tile);
      toast(`Drilling... ${Math.max(1, tile.hp)} hits left`);
      return 'blocked';
    }
    if (tile.type === 'ore') {
      // Ore needs room under the cargo-bay upgrade, measured in total items
      // aboard; a full bay leaves the seam standing with one hit left.
      const loaded = addOre(player.inventory, tile.ore, player.cargoMax);
      if (!loaded) {
        tile.hp = 1;
        grid.set(nx, ny, tile);
        toast('Cargo bay full. Go sell at the surface.');
        audio.alarm();
        return 'blocked';
      }
      player.inventory = loaded;
      state.stats.oreMined++;
      saveProgress();
      toast(`Mined ${tile.ore.name} +$${tile.ore.value}`);
      audio.ore(tile.ore.value);
    }
    if (tile.type === 'artifact') {
      const payout = claimArtifact(state, tile.artifact);
      saveProgress();
      toast(`ARTIFACT RECOVERED: ${tile.artifact.name} +$${payout} CASH NOW · Cargo unchanged.`);
      audio.cash(payout);
    }
    grid.set(nx, ny, {type:'air'});
    enemies.wakeEnemiesNear(nx, ny);
    return 'advance';
  }

  /** Destination tile type → the drill/fly behaviour that resolves the move. */
  const tileMoveHandlers: {[K in Tile['type']]: TileMoveHandler<Extract<Tile, {type: K}>>} = {
    air: flyThroughAir,
    rock: bumpIntoRock,
    enemy: drillEnemyCocoon,
    hazard: drillHazard,
    motherlode: drillMotherlode,
    dirt: drillValuableTile,
    ore: drillValuableTile,
    artifact: drillValuableTile
  };

  function resolveDestinationTile(tile: Tile, context: MoveContext): MoveOutcome {
    const handler = tileMoveHandlers[tile.type] as TileMoveHandler;
    return handler(tile, context);
  }

  /** Commit a move into a now-clear destination: reposition, reveal, and settle. */
  function advanceShip(nx: number, ny: number): void {
    const p = state.player;
    p.x = nx; p.y = ny; p.bob = 1;
    // The save remembers where the ship parked, so every step is progress worth
    // writing — debounced, because a sprint down a tunnel is one step per frame.
    deps.scheduleSave();
    deps.revealAtPlayer();
    state.stats.maxDepth = Math.max(state.stats.maxDepth, Math.max(0, p.y - START_Y) * 10);
    enemies.wakeEnemiesNear(p.x, p.y);
    if (atSurface()) {
      const extraction = completeExtractionAtDepot(state.extractionPhase, true);
      state.extractionPhase = extraction.phase;
      if (extraction.changed) {
        state.stats.motherlodeExtractions++;
        saveProgress();
        toast('Motherlode extraction complete at the depot!');
      }
    }
    if (p.fuel < 0) p.fuel = 0;
    if (p.fuel <= 0) gameOver('Out of fuel — ship exploded. Tap anywhere to restart.');
  }

  /**
   * Terrain refused a boosted move: the ship pancakes against the wall it was
   * charging at. Charged on top of whatever the destination tile costs anyway,
   * and only for the direction the momentum was actually built in.
   */
  function crashIntoWall(momentum: Direction | null, sprinting: boolean, dx: number, dy: number, nx: number, ny: number): void {
    const crash = sprintCrashDamage(momentum, sprinting, dx, dy);
    if (crash <= 0) return;
    damage(crash);
    spawnDust(nx, ny, '#c9d4e4', 12);
    audio.explosion(0.3);
    toast('Boost crash — hull buckled!');
  }

  function move(dx: number, dy: number, sprinting = false): void {
    if (state.gameOver) return;
    const p = state.player;
    if (p.fuel <= 0) { gameOver('Out of fuel — ship exploded. Tap anywhere to restart.'); return; }
    const {x: nx, y: ny} = movementDestination(p.x, p.y, dx, dy, WORLD_W, START_Y);
    if (nx === p.x && ny === p.y) {
      state.input.sprintMomentum = null;
      if (dy < 0 && p.y === START_Y) toast('Stay low — the surface airspace is for the depot, not flying.');
      return;
    }
    const tile = grid.get(nx, ny);
    const activeEnemy = enemies.enemyAt(nx, ny);
    const destinationOpen = isOpenSpaceDestination(true, tile.type, Boolean(activeEnemy));
    const baseCost = FUEL.baseMove + Math.abs(dy)*FUEL.vertical;
    const context: MoveContext = {
      dx, dy, nx, ny, player: p,
      useFuel: amount => { p.fuel = fuelAfterMovement(p.fuel, amount, sprinting, destinationOpen, dy > 0); },
      dig: extra => (baseCost + extra) * FUEL.digMult, // digging uses 50% more fuel
      flyCost: baseCost * FUEL.flyMult                 // flying uses 50% less fuel
    };
    p.facing = dx ? Math.sign(dx) : p.facing;
    p.drillDx = dx;
    p.drillDy = dy;
    const resolve = (): MoveOutcome => {
      if (activeEnemy) { p.drillAnim = 1.65; context.useFuel(context.dig(FUEL.dig.enemy)); enemies.damageEnemy(activeEnemy); return 'blocked'; }
      if (tile.type !== 'air' && dy < 0) { p.drillDx = 0; p.drillDy = -1; p.drillAnim = 0.75; audio.bump(); toast('The drill cannot dig upward. Use tunnels to fly up.'); return 'blocked'; }
      if (tile.type !== 'air' && dx !== 0 && dy === 0 && !grounded()) { p.drillDx = dx; p.drillDy = 0; p.drillAnim = 0.55; audio.bump(); toast('Side drilling needs solid ground underneath.'); return 'blocked'; }
      return resolveDestinationTile(tile, context);
    };
    // Read the momentum before the move consumes it: the crash is paid by the
    // speed the *previous* step built up, not by this one.
    const momentum = state.input.sprintMomentum;
    const advanced = resolve() === 'advance';
    state.input.sprintMomentum = sprintMomentumAfterMove(advanced, sprinting, destinationOpen, dx, dy);
    if (!advanced) { crashIntoWall(momentum, sprinting, dx, dy, nx, ny); return; }
    advanceShip(nx, ny);
  }

  return {move, isOpenMovementDestination};
}

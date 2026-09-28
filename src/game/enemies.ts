// Enemy simulation glue.
//
// The pure pieces live in core/ (`enemy-types`, `enemy-movement`,
// `enemy-exposure`); this module owns the stateful side: which air is reachable,
// waking cocoons into entities, the drill's kill path, and the per-tick
// movement/bite pass.

import { ENEMY } from '../core/balance';
import { expandReachableAir } from '../core/enemy-exposure';
import { findEnemyPathStep } from '../core/enemy-movement';
import { enemyBiteCooldown, enemyBiteDamage, enemyMoveDelay, getEnemyType } from '../core/enemy-types';
import type { AudioController, Enemy, GameState } from '../core/types';
import type { WorldGrid } from './world-grid';

/** Enemies stop pathing toward a target further away than this (Manhattan). */
const ENEMY_AGGRO_RANGE = 24;

/** Drop dead enemies in place, keeping the living in order, without a new array per tick. */
function compactLiving(enemies: Enemy[]): void {
  let kept = 0;
  for (const enemy of enemies) if (enemy.alive) enemies[kept++] = enemy;
  enemies.length = kept;
}

/** What a kill removes: a live entity, or a dormant cocoon tile. */
type KillTarget =
  | {kind: 'active'; enemy: Enemy}
  | {kind: 'dormant'; x: number; y: number};

export interface EnemySim {
  /** The live enemy standing on a tile, if any. */
  enemyAt(x: number, y: number): Enemy | undefined;
  /** Wake every cocoon newly reachable through air from this coordinate. */
  wakeEnemiesNear(x: number, y: number): void;
  /** Recompute reachable air from the player and wake everything exposed. */
  resetExposure(): void;
  /** Forget reachable air without re-seeding it (world reset). */
  clearExposure(): void;
  /** Hurt a live enemy; kills it at zero HP. */
  damageEnemy(enemy: Enemy | undefined, amount?: number): void;
  /** Drill a dormant cocoon tile. Returns whether the tile was a cocoon. */
  damageEnemyTile(x: number, y: number): boolean;
  /** Easing, biting, and pathing. */
  update(): void;
}

export interface EnemySimDeps {
  state: GameState;
  grid: WorldGrid;
  audio: AudioController;
  toast(message: string): void;
  addCash(amount: number): void;
  saveProgress(): void;
  /** Apply hull damage to the local ship. */
  damagePlayer(amount: number): void;
  spawnDust(x: number, y: number, color?: string, amount?: number): void;
  spawnExplosion(x: number, y: number): void;
}

export function createEnemySim(deps: EnemySimDeps): EnemySim {
  const {state, grid, audio, toast, addCash, saveProgress, damagePlayer, spawnDust, spawnExplosion} = deps;
  /** Air cells already known to be connected to the surface/player. */
  const reachableAir = new Set<string>();

  function enemyAt(x: number, y: number): Enemy | undefined {
    return state.enemies.find(e => e.alive && Math.round(e.x) === x && Math.round(e.y) === y);
  }

  function wakeEnemy(x: number, y: number): boolean {
    const tile = grid.get(x, y);
    if (tile.type !== 'enemy') return false;
    // The hatch is not a dig: left out of the tile diff, a reload regenerates the
    // cocoon from the seed (and the exposure pass wakes it again) instead of
    // leaving the tile permanently empty with its enemy gone for good. Only a kill
    // makes it permanent (see `killEnemy`).
    grid.set(x, y, {type: 'air'}, {record: false});
    const enemy: Enemy = {
      id: state.enemyIdCounter++,
      kind: tile.kind,
      x,
      y,
      drawX: x,
      drawY: y,
      hp: tile.hp || 4,
      maxHp: tile.maxHp || tile.hp || 4,
      alive: true,
      moveTick: 0,
      biteTick: 0,
      flash: 0,
      origin: {x, y}
    };
    state.enemies.push(enemy);
    spawnDust(x, y, getEnemyType(enemy.kind).glow, 18);
    audio.enemyWake();
    toast(`${getEnemyType(enemy.kind).name} awakened! Drill it before it chews the hull.`);
    return true;
  }

  function wakeEnemiesNear(x: number, y: number): void {
    let seeds = [{x, y}];
    while (seeds.length) {
      const exposed = expandReachableAir(state.world, reachableAir, seeds);
      for (const enemy of exposed) wakeEnemy(enemy.x, enemy.y);
      seeds = exposed;
    }
  }

  function resetExposure(): void {
    reachableAir.clear();
    let seeds = [{x: state.player.x, y: state.player.y}];
    let forceSeeds = true;
    while (seeds.length) {
      const exposed = expandReachableAir(state.world, reachableAir, seeds, forceSeeds);
      for (const enemy of exposed) wakeEnemy(enemy.x, enemy.y);
      seeds = exposed;
      forceSeeds = false;
    }
  }

  function enemyBounty(y: number): number {
    return ENEMY.bounty.base + Math.floor(y / ENEMY.bounty.depthDivisor) * ENEMY.bounty.step;
  }

  function creditBounty(amount: number, message = `Enemy destroyed +$${amount} bounty.`): void {
    addCash(amount);
    state.stats.enemiesDestroyed++;
    saveProgress();
    audio.bounty();
    toast(message);
  }

  /** Green sparks plus the hit sting: identical for entities and cocoons. */
  function playHitFeedback(x: number, y: number, dust: number): void {
    spawnDust(x, y, '#92ff55', dust);
    audio.enemyHit();
  }

  /**
   * The one kill path. Active enemies are entities — flagged dead — while dormant
   * cocoons are tiles, so clearing them can expose (and therefore wake) their
   * neighbours. Either way the bounty is paid exactly once.
   */
  function killEnemy(target: KillTarget, bountyMessage?: (bounty: number) => string): void {
    const x = target.kind === 'active' ? target.enemy.x : target.x;
    const y = target.kind === 'active' ? target.enemy.y : target.y;
    const bounty = enemyBounty(y);
    if (target.kind === 'active') {
      target.enemy.alive = false;
      // Commit the hatch now that the enemy is gone for good: recording its cocoon
      // tile as air keeps a reload from regrowing it and paying the bounty twice.
      // Anything else standing there since (a placed panel) was recorded already.
      const {origin} = target.enemy;
      if (grid.get(origin.x, origin.y).type === 'air') grid.set(origin.x, origin.y, {type: 'air'});
      spawnExplosion(x, y);
    } else {
      grid.set(x, y, {type: 'air'});
      spawnExplosion(x, y);
    }
    creditBounty(bounty, bountyMessage?.(bounty));
    if (target.kind === 'dormant') wakeEnemiesNear(x, y);
  }

  function damageEnemy(enemy: Enemy | undefined, amount = state.player.drill): void {
    if (!enemy || !enemy.alive) return;
    enemy.hp -= amount;
    enemy.flash = 1;
    playHitFeedback(enemy.x, enemy.y, 13);
    if (enemy.hp <= 0) killEnemy({kind: 'active', enemy});
    else toast(`Enemy hit — ${Math.ceil(enemy.hp)} HP left.`);
  }

  function damageEnemyTile(x: number, y: number): boolean {
    const tile = grid.get(x, y);
    if (tile.type !== 'enemy') return false;
    tile.hp -= state.player.drill;
    playHitFeedback(x, y, 12);
    if (tile.hp <= 0) {
      killEnemy({kind: 'dormant', x, y}, bounty => `Dormant enemy drilled out +$${bounty} bounty.`);
    } else {
      grid.set(x, y, tile);
      toast(`Drilling enemy cocoon... ${Math.ceil(tile.hp)} HP left`);
    }
    return true;
  }

  /** Ease an enemy's rendered position toward its logical tile and fade its flash. */
  function easeEnemy(e: Enemy): void {
    e.drawX += (e.x - e.drawX) * 0.28;
    e.drawY += (e.y - e.drawY) * 0.28;
    e.flash *= 0.82;
  }

  /** Chew the local hull if this enemy's bite cooldown has elapsed. */
  function biteLocalPlayer(e: Enemy): void {
    if (state.tick - e.biteTick <= enemyBiteCooldown(e.kind)) return;
    e.biteTick = state.tick;
    const bite = enemyBiteDamage(e.kind, e.y);
    damagePlayer(bite);
    spawnDust(state.player.x, state.player.y, '#ff5d45', 10);
    toast(`${getEnemyType(e.kind).name} chewing the hull! -${bite}`);
  }

  // The per-tick pass is only called while the run is live; the caller owns that
  // gate (the UI phase), so it only rules out a finished run here.
  function update(): void {
    if (state.gameOver) return;
    compactLiving(state.enemies);
    const p = state.player;
    for (const e of state.enemies) {
      easeEnemy(e);
      const dist = Math.abs(e.x - p.x) + Math.abs(e.y - p.y);
      if (dist <= 1) {
        biteLocalPlayer(e);
        continue; // Bite from an adjacent tile; never step onto the ship's tile.
      }
      const moveDelay = enemyMoveDelay(e.kind, e.y);
      if (state.tick - e.moveTick < moveDelay || dist > ENEMY_AGGRO_RANGE) continue;
      e.moveTick = state.tick;
      // Nothing in this pass kills an enemy, so the list compacted above is still
      // exactly the living ones and doubles as the occupied set.
      const step = findEnemyPathStep(state.world, e, p, state.enemies, ENEMY_AGGRO_RANGE);
      if (step && (step.x !== p.x || step.y !== p.y)) { e.x = step.x; e.y = step.y; }
    }
  }

  return {
    enemyAt,
    wakeEnemiesNear,
    resetExposure,
    clearExposure: () => reachableAir.clear(),
    damageEnemy,
    damageEnemyTile,
    update
  };
}

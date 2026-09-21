// Run lifecycle: fresh worlds, fresh ships, hull damage, and death.
//
// These transitions all answer one question — what survives an event and what is
// thrown away — so they are grouped here rather than spread across the loop code.
// The rules worth remembering:
//   * hull damage that empties the hull ends the run exactly once;
//   * death keeps cash, upgrades and stats, and loses cargo and position;
//   * a boot keeps the position the save recorded, because only dying costs it.

import { START_Y } from '../../shared/constants';
import { STARTING } from '../core/balance';
import { cancelExtraction } from '../core/extraction-phase';
import { createInventory, removeOres } from '../core/inventory';
import { createDefaultStats, placeAtSurfaceSpawn, respawnPlayer } from '../core/state';
import { applyTileEntries, tileDiffEntries } from '../world/tile-diff';
import { ensureWorldRow } from '../world/world';
import { resetWorldTerrain } from '../world/world-state';
import type { AudioController, GameState } from '../core/types';
import type { EnemySim } from './enemies';
import type { GameInput } from './input';
import { viewport } from './viewport';

export interface GameRun {
  /** Discard the generated world and deploy a fresh miner (offline reset). */
  generate(): void;
  /** Boot into the loaded save: its mine, and its ship where it was parked. */
  resume(): void;
  /** Regenerate terrain in place, keeping all player progress. */
  clearWorldRuntime(): void;
  /** Redeploy the ship; `full` also wipes cash, upgrades, stats, and fog. */
  resetPlayer(full?: boolean): void;
  /** R or a tap after death: a whole new world. */
  restartGame(): void;
  /** End the run once, banking the death. */
  gameOver(message?: string): void;
  /** Apply hull damage; an emptied hull ends the run. */
  damage(amount: number): void;
}

export interface GameRunDeps {
  state: GameState;
  audio: AudioController;
  /**
   * Resolved lazily: both the enemy simulation and the keyboard are constructed
   * after the run module, because they depend on it.
   */
  enemies(): EnemySim;
  input(): GameInput;
  toast(message: string): void;
  saveProgress(): void;
  /** Reveal the fog footprint around the ship. */
  revealAtPlayer(): void;
  spawnExplosion(x: number, y: number): void;
  /** Drop the whole terrain cache (world replaced wholesale). */
  invalidateTerrain(): void;
  /** Drop the whole fog cache (exploration replaced wholesale). */
  invalidateFog(): void;
}

export function createRun(deps: GameRunDeps): GameRun {
  const {state, audio, toast, saveProgress, spawnExplosion} = deps;

  /** Snap the camera onto the ship, so a run never opens mid-pan. */
  function centreCameraOnShip(): void {
    state.camX = Math.max(0, state.player.x - Math.floor(viewport.tilesX/2));
    state.camY = Math.max(0, state.player.y - Math.floor(viewport.tilesY/2));
  }

  function resetPlayer(full = true): void {
    state.extractionPhase = cancelExtraction();
    state.teleportEffect = null;
    state.teleportReturnPosition = null;
    state.input.gunArmed = false;
    if (full) {
      state.cash = STARTING.cash;
      Object.assign(state.player, {
        fuelMax: STARTING.fuelMax,
        hullMax: STARTING.hullMax,
        cargoMax: STARTING.cargoMax,
        drill: STARTING.drill,
        // Bought equipment lives in the bay, so emptying it is part of the wipe.
        inventory: createInventory()
      });
      state.scannerDevices = [];
      state.placedDynamite = [];
      state.cargoContainers = [];
      state.exploredTiles.clear();
      state.stats = createDefaultStats();
      saveProgress();
      deps.invalidateFog();
    }
    respawnPlayer(state.player);
    deps.revealAtPlayer();
    centreCameraOnShip();
    state.particles.length = 0;
    state.gameOver = false;
    toast('Fresh drill deployed.');
  }

  /** The mine rebuilt from its seed, with the saved diff dug back out. */
  function buildSoloWorld(): void {
    state.enemies = [];
    state.world = [];
    // Terrain comes back from the seed, so the dug-out blocks have to be layered
    // on again: a death or a refresh must not refill the tunnels behind you.
    applyTileEntries(state.world, tileDiffEntries(state.soloTileDiff));
  }

  function generate(): void {
    buildSoloWorld();
    resetPlayer(false);
    deps.enemies().resetExposure();
  }

  function resume(): void {
    buildSoloWorld();
    const p = state.player;
    // The save carries a tile, not a guarantee: a capped or quota-dropped diff
    // can leave that coordinate solid again. Anything but open air returns to the
    // depot, because a ship buried in dirt cannot drill its way back up.
    if (ensureWorldRow(state.world, p.y)?.[p.x]?.type !== 'air') placeAtSurfaceSpawn(p);
    // Fuel, hull and cargo are never saved, so a resumed run is a fresh ship
    // parked where the last one left off — carrying the equipment the save
    // restored into its bay, and none of the ore.
    Object.assign(p, {fuel: p.fuelMax, hull: p.hullMax, inventory: removeOres(p.inventory)});
    deps.revealAtPlayer();
    centreCameraOnShip();
    state.gameOver = false;
    deps.enemies().resetExposure();
    toast(p.y > START_Y ? `Ship recovered at ${(p.y - START_Y) * 10} m.` : 'Fresh drill deployed.');
  }

  function clearWorldRuntime(): void {
    resetWorldTerrain(state);
    deps.enemies().clearExposure();
    state.enemyIdCounter = 1;
    deps.input().clearKeys();
    deps.invalidateTerrain();
    deps.invalidateFog();
  }

  function restartGame(): void {
    const died = state.gameOver;
    deps.input().reset();
    generate();
    if (died) toast('Replacement ship deployed. Cash and upgrades kept; cargo lost.');
  }

  function gameOver(message = 'Game over. Tap anywhere or press R to restart.'): void {
    if (state.gameOver) return;
    state.gameOver = true;
    state.input.gunArmed = false;
    state.teleportEffect = null;
    state.extractionPhase = cancelExtraction();
    state.stats.deaths++;
    saveProgress();
    toast(message);
    spawnExplosion(state.player.x, state.player.y);
    audio.explosion(1.2);
    audio.alarm();
  }

  function damage(amount: number): void {
    const p = state.player;
    p.hull = Math.max(0, p.hull - amount);
    if (amount > 1) audio.bump();
    if (p.hull <= 0) gameOver('Ship destroyed. Tap anywhere to restart.');
  }

  return {generate, resume, clearWorldRuntime, resetPlayer, restartGame, gameOver, damage};
}

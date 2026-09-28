// Run lifecycle: fresh worlds, fresh ships, hull damage, and death.
//
// These transitions all answer one question — what survives an event and what is
// thrown away — so they are grouped here rather than spread across the loop code.
// The rules worth remembering:
//   * hull damage that empties the hull ends the run exactly once;
//   * death keeps cash and stats, and loses cargo, fitted upgrades and position;
//   * a boot keeps the position the save recorded, because only dying costs it;
//   * a player-data wipe keeps the mine and its live enemies, and never rewinds
//     the tick their cooldowns are measured against.

import { START_Y } from '../../shared/constants';
import { removeOres } from '../core/inventory';
import { respawnPortals } from '../core/portal';
import { createInitialState, placeAtHome, respawnPlayer } from '../core/state';
import { dropWreck } from '../core/wreck';
import { applyTileEntries, tileDiffEntries } from '../world/tile-diff';
import { resetWorldTerrain } from '../world/world-state';
import type { AudioController, GameState } from '../core/types';
import type { EnemySim } from './enemies';
import type { GameInput } from './input';
import type { PortalsSim } from './portals';
import { viewport } from './viewport';
import { canLandOn } from './world-grid';

export const PLAYER_DATA_RESET_CONFIRMATION = 'Reset all player data? This permanently clears cash, upgrades, equipment, cargo, stats, objectives, explored fog, and current ship progress. The mine terrain will be preserved.';

export function confirmPlayerDataReset(confirmReset: (message: string) => boolean): boolean {
  return confirmReset(PLAYER_DATA_RESET_CONFIRMATION);
}

/** Where a fresh ship redeploys after a restart: a portal tile, or the home base. */
type SpawnAt = {x: number; y: number} | undefined;

export interface GameRun {
  /** Discard the generated world and deploy a fresh miner (offline reset). */
  generate(at?: SpawnAt): void;
  /** Boot into the loaded save: its mine, and its ship where it was parked. */
  resume(): void;
  /** Regenerate terrain in place, keeping all player progress. */
  clearWorldRuntime(): void;
  /**
   * Redeploy the ship at `at` (a portal) or the home base; `full` (the default)
   * also wipes all player data, keeping the mine. Never saves — the caller does.
   */
  resetPlayer(full?: boolean, at?: SpawnAt): void;
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
  /** Resolved lazily, like the enemies: the portal sim is wired after the run. */
  portals(): PortalsSim;
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
  const canLand = canLandOn(state);

  /** Snap the camera onto the ship, so a run never opens mid-pan. */
  function centreCameraOnShip(): void {
    state.camX = Math.max(0, state.player.x - Math.floor(viewport.tilesX/2));
    state.camY = Math.max(0, state.player.y - Math.floor(viewport.tilesY/2));
  }

  /**
   * The one ship redeploy, and — with `full` — the one player-data wipe. A plain
   * redeploy (`full` false, the death/restart path) keeps every piece of
   * progress; a full wipe returns everything the player owns to a new game's
   * values while the mine itself — terrain, tile diff, live enemies — is left
   * standing. Neither writes the save: the caller does, once the state is final.
   *
   * `state.tick` is never rewound. Enemy move and bite cooldowns are stamped
   * with absolute ticks, so rewinding the clock would freeze every live enemy
   * until it caught back up.
   */
  function resetPlayer(full = true, at?: SpawnAt): void {
    state.teleportEffect = null;
    if (full) {
      const fresh = createInitialState();
      state.cash = fresh.cash;
      state.stats = fresh.stats;
      // Bought equipment lives in the bay and the fitted upgrades in the slots, so
      // a fresh ship is the wipe; `respawnPlayer` below re-derives the maxima.
      Object.assign(state.player, fresh.player);
      state.scannerDevices = fresh.scannerDevices;
      state.placedDynamite = fresh.placedDynamite;
      state.cargoContainers = fresh.cargoContainers;
      state.wrecks = fresh.wrecks;
      // Back to the two home stations and the Home portal: everything crafted and
      // placed since was player property.
      state.stations = fresh.stations;
      // A full player wipe drops the drawn-down trading stock too; a plain death
      // (`full` false) leaves it, so a post the player emptied stays emptied.
      state.tradeLedger = fresh.tradeLedger;
      // Likewise every chest the player opened comes back full.
      state.chestLedger = fresh.chestLedger;
      state.input = fresh.input;
      state.exploredTiles.clear();
      deps.invalidateFog();
    }
    respawnPlayer(state.player, at);
    deps.revealAtPlayer();
    centreCameraOnShip();
    state.particles.length = 0;
    state.gameOver = false;
    toast('Fresh drill deployed.');
  }

  /** The mine rebuilt from its seed, with the saved diff dug back out. */
  function buildSoloWorld(): void {
    // Live enemies go with the old grid: a hatch is never written to the diff,
    // so every cocoon comes back from the seed and the exposure pass that
    // follows re-wakes the reachable ones. Keeping the entities would double them.
    state.enemies = [];
    state.world = [];
    // Terrain comes back from the seed, so the dug-out blocks have to be layered
    // on again: a death or a refresh must not refill the tunnels behind you.
    applyTileEntries(state.world, tileDiffEntries(state.soloTileDiff));
  }

  function generate(at?: SpawnAt): void {
    buildSoloWorld();
    // A portal placed underground sits on a dug-out (air) tile, and the solo tile
    // diff carries that hole back out of the reseeded terrain. A diff that lost it
    // (a capped or quota-trimmed save) leaves the tile solid, and a ship set down
    // there would be buried, so that redeploy falls back to the home base.
    resetPlayer(false, at && canLand(at.x, at.y) ? at : undefined);
    deps.enemies().resetExposure();
  }

  function resume(): void {
    buildSoloWorld();
    const p = state.player;
    // The save carries a tile, not a guarantee: a capped or quota-dropped diff
    // can leave that coordinate solid again. Anything but open space (air, or a
    // decoration hanging in it) returns to the home base, because a ship buried in
    // dirt cannot drill its way back up.
    if (!canLand(p.x, p.y)) placeAtHome(p);
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
    state.enemyIdCounter = 1;
    deps.input().clearKeys();
    deps.invalidateTerrain();
    deps.invalidateFog();
    // The ship is back at the home base in a fresh mine: re-seed reachable air
    // from there (waking anything the fresh cavern already exposes) and uncover
    // the fog around it, exactly as a new run's first frame would.
    deps.enemies().resetExposure();
    deps.revealAtPlayer();
    centreCameraOnShip();
  }

  function restartGame(): void {
    const spawns = respawnPortals(state.stations, canLand);
    // Two or more portals and the player has not chosen yet: raise the no-close
    // redeploy prompt and let the pick drive the rebuild. One portal redeploys
    // there without asking; none falls back to the home cavern.
    if (spawns.length >= 2 && deps.portals().mode !== 'respawn') {
      deps.portals().openRespawn(at => completeRestart(at));
      return;
    }
    completeRestart(spawns.length === 1 ? {x: spawns[0].x, y: spawns[0].y} : undefined);
  }

  /** Drop the wreck at the death tile, rebuild the world, and redeploy at `at`. */
  function completeRestart(at?: SpawnAt): void {
    const died = state.gameOver;
    deps.input().reset();
    // Drop what the run was carrying — its ore and its fitted upgrades — as a
    // wreck on the tile the old ship sat on, before `generate()` strips them off
    // the replacement. Both a death and a hand `R`-reset come through here, so a
    // scrapped ship leaves a salvageable corpse either way.
    const wreck = dropWreck(state.wrecks, state.player);
    if (wreck) saveProgress();
    generate(at);
    if (wreck) {
      const where = `(${wreck.x}, ${wreck.y})`;
      toast(died
        ? `Replacement ship deployed. Cargo and fitted upgrades left in the wreck at ${where}.`
        : `Ship reset. Cargo and fitted upgrades left in the wreck at ${where}.`);
    } else if (died) {
      toast('Replacement ship deployed. Cargo and fitted upgrades lost.');
    }
  }

  function gameOver(message = 'Game over. Tap anywhere or press R to restart.'): void {
    if (state.gameOver) return;
    state.gameOver = true;
    state.teleportEffect = null;
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

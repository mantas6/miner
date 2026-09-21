// Planted dynamite: arming, placing, burning, and going off.
//
// `core/dynamite.ts` holds the rules (where a stick may go, how long it burns,
// what the blast takes and what it costs a ship caught in it); this is the part
// that touches the running game — the cargo bay it comes out of, the terrain it
// clears, the enemies it wakes, and the hull it dents.
//
// Placement is the same two-press gesture the scanner uses: the inventory slot
// arms it, the mine takes it. That state lives here rather than in `state.input`
// because it belongs to the item rather than to the keyboard, and because it must
// not survive a reload — an armed pointer restored from a save would swallow the
// first click of the next run.

import {
  DYNAMITE,
  DYNAMITE_ITEM,
  createPlacedDynamite,
  dynamiteHullDamage,
  dynamitePlacementRefusal,
  getDynamiteBlastTargets,
  tickPlacedDynamite,
  type PlacedDynamite
} from '../core/dynamite';
import { countItem, removeItem } from '../core/inventory';
import { inMineBounds } from '../core/placement';
import type { AudioController, GameState } from '../core/types';
import type { WorldGrid } from './world-grid';

export interface DynamiteSim {
  /** Whether a carried stick is waiting for the player to pick a tile. */
  readonly armed: boolean;
  /** Inventory-slot press: arm placement, or stand the armed one down. */
  toggleArmed(): void;
  /**
   * Disarm without complaint (Escape, an overlay opening, a lost ship). Reports
   * whether anything was armed, so a key handler knows if it consumed the press.
   */
  disarm(): boolean;
  /** A press on the mine while armed. Reports whether a stick was planted. */
  placeAt(x: number, y: number): boolean;
  /** One fixed 60 Hz step of every burning fuse. */
  tick(): void;
}

export interface DynamiteDeps {
  state: GameState;
  grid: WorldGrid;
  audio: AudioController;
  toast(message: string): void;
  saveProgress(): void;
  /** Rouse whatever was sleeping around the blast. */
  wakeEnemiesNear(x: number, y: number): void;
  spawnExplosion(x: number, y: number): void;
  /** Hull damage for a ship caught in its own blast; an emptied hull ends the run. */
  damagePlayer(amount: number): void;
  /** Paint the armed state onto the inventory slot. */
  setArmedUi(armed: boolean): void;
}

export function createDynamiteSticks(deps: DynamiteDeps): DynamiteSim {
  const {state, grid, audio, toast, saveProgress} = deps;
  let armed = false;

  function setArmed(next: boolean): void {
    if (armed === next) return;
    armed = next;
    deps.setArmedUi(next);
  }

  function disarm(): boolean {
    if (!armed) return false;
    setArmed(false);
    return true;
  }

  function toggleArmed(): void {
    if (armed) {
      setArmed(false);
      return toast('Dynamite placement cancelled.');
    }
    if (state.gameOver) return;
    if (countItem(state.player.inventory, DYNAMITE_ITEM.kind) <= 0) {
      audio.alarm();
      return toast('No dynamite aboard. Craft a stick at the Manufacturing Station.');
    }
    if (state.placedDynamite.length >= DYNAMITE.maxPlaced) {
      audio.alarm();
      return toast(`Only ${DYNAMITE.maxPlaced} sticks can burn at once.`);
    }
    setArmed(true);
    toast('Dynamite ready — press a mapped tile in the mine. Escape cancels.');
  }

  function placeAt(x: number, y: number): boolean {
    if (!armed) return false;
    // The bay can empty between arming and pressing — a reset, a lost ship — and
    // a stick planted out of an empty bay would be one the player never bought.
    if (state.gameOver || countItem(state.player.inventory, DYNAMITE_ITEM.kind) <= 0) {
      setArmed(false);
      return false;
    }
    // Bounds first, so a press far outside the mine never generates a row chunk
    // just to find out the tile was never a candidate.
    const refusal = dynamitePlacementRefusal(x, y, {
      explored: state.exploredTiles,
      open: inMineBounds(x, y) && grid.get(x, y).type === 'air',
      sticks: state.placedDynamite
    });
    if (refusal) {
      audio.alarm();
      toast(refusal);
      return false;
    }
    state.player.inventory = removeItem(state.player.inventory, DYNAMITE_ITEM.kind);
    state.placedDynamite.push(createPlacedDynamite(x, y));
    setArmed(false);
    saveProgress();
    audio.blip(220, .12, 'sawtooth', .045, 60);
    toast(`Fuse lit — ${DYNAMITE.fuseSeconds} s. Get clear of the blast.`);
    return true;
  }

  /** The moment the fuse runs out: terrain, noise, and whatever was standing too close. */
  function detonate(stick: PlacedDynamite): void {
    const radius = DYNAMITE.radius;
    grid.ensureRow(stick.y + radius);
    const targets = getDynamiteBlastTargets(grid.world, stick.x, stick.y, radius);
    for (const {x, y} of targets) grid.set(x, y, {type: 'air'});
    deps.wakeEnemiesNear(stick.x, stick.y);
    deps.spawnExplosion(stick.x, stick.y);
    audio.explosion();
    // Only the local ship: a partner runs their own simulation and lights their
    // own fuses, and the cleared tiles reach them as ordinary tile updates.
    const player = state.player;
    const hullDamage = state.gameOver ? 0 : dynamiteHullDamage(player.x - stick.x, player.y - stick.y);
    if (hullDamage > 0) {
      deps.damagePlayer(hullDamage);
      return toast(`Caught in your own blast — hull down ${hullDamage}.`);
    }
    toast(targets.length
      ? `Dynamite cleared ${targets.length} blocks. Ore and artifacts were destroyed; no rewards granted.`
      : 'Dynamite detonated, but no destructible blocks were in range.');
  }

  function tick(): void {
    // A lost ship cannot plant anything, and the armed slot would otherwise still
    // look live behind the game-over screen.
    if (state.gameOver) disarm();
    const sticks = state.placedDynamite;
    if (sticks.length === 0) return;
    // Burnt-out sticks leave the mine before any of them go off, so a blast that
    // ends the run cannot leave a spent charge behind for the next ship to find.
    const spent = sticks.filter(tickPlacedDynamite);
    if (spent.length === 0) return;
    state.placedDynamite = sticks.filter(stick => !spent.includes(stick));
    for (const stick of spent) detonate(stick);
    saveProgress();
  }

  return {
    get armed() {
      return armed;
    },
    toggleArmed,
    disarm,
    placeAt,
    tick
  };
}

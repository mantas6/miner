// Placing decorations: arming a carried panel and setting it down as a tile.
//
// `core/decor.ts` holds the rules (which tiles take a decoration, how a stack kind
// maps to the tile it writes); this is the part that touches the running game —
// the bay the panel comes out of and the tile diff the placement records. Drilling
// one back out and blasting one apart live with the terrain, in `move.ts` and
// `dynamite.ts`, because a placed decoration is a tile, not a tracked device.
//
// The gesture is the two-press one the deployables use: the inventory slot arms a
// specific decoration kind, the next press on the mine writes it. Only one kind is
// ever armed, and it shares the single `armedPlacement` slot with the deployables,
// so arming a panel stands any armed device down and vice versa.

import { decorIdForKind, decorPlacementRefusal } from '../core/decor';
import { isStationTile } from '../core/home';
import { countItem, removeItem, type DecorKind } from '../core/inventory';
import { inMineBounds } from '../core/placement';
import type { AudioController, GameState } from '../core/types';
import type { WorldGrid } from './world-grid';

export interface DecorSim {
  /** The decoration kind waiting for a tile, or `null` when nothing is armed. */
  readonly armed: DecorKind | null;
  /** Inventory-slot press: arm this decoration, or stand the armed one down. */
  toggleArmed(kind: DecorKind): void;
  /** Disarm without complaint (Escape, an overlay opening, a lost ship). */
  disarm(): boolean;
  /** A press on the mine while armed. Reports whether a decoration was set down. */
  placeAt(x: number, y: number): boolean;
  /** One fixed 60 Hz step: only a lost ship to tidy up after. */
  tick(): void;
}

export interface DecorDeps {
  state: GameState;
  grid: WorldGrid;
  audio: AudioController;
  toast(message: string): void;
  saveProgress(): void;
  /** Paint the armed decoration onto the inventory slot, or clear it with `null`. */
  setArmedUi(kind: DecorKind | null): void;
}

export function createDecor(deps: DecorDeps): DecorSim {
  const {state, grid, audio, toast, saveProgress} = deps;
  let armed: DecorKind | null = null;

  function setArmed(next: DecorKind | null): void {
    if (armed === next) return;
    armed = next;
    deps.setArmedUi(next);
  }

  function disarm(): boolean {
    if (!armed) return false;
    setArmed(null);
    return true;
  }

  function toggleArmed(kind: DecorKind): void {
    if (armed === kind) {
      setArmed(null);
      return toast('Decoration placement cancelled.');
    }
    if (state.gameOver) return;
    if (countItem(state.player.inventory, kind) <= 0) {
      audio.alarm();
      return toast('None of that decoration aboard. Craft one at the station.');
    }
    setArmed(kind);
    toast('Decoration ready — press a mapped tile in the mine. Escape cancels.');
  }

  function placeAt(x: number, y: number): boolean {
    const kind = armed;
    if (!kind) return false;
    // The bay can empty between arming and pressing — a reset, a lost ship.
    if (state.gameOver || countItem(state.player.inventory, kind) <= 0) {
      setArmed(null);
      return false;
    }
    const refusal = decorPlacementRefusal(x, y, {
      explored: state.exploredTiles,
      open: inMineBounds(x, y) && grid.get(x, y).type === 'air' && !isStationTile(x, y)
    });
    if (refusal) {
      audio.alarm();
      toast(refusal);
      return false;
    }
    grid.set(x, y, {type: 'decor', decor: decorIdForKind(kind)});
    state.player.inventory = removeItem(state.player.inventory, kind);
    setArmed(null);
    saveProgress();
    audio.blip(360, .08, 'triangle', .04, 30);
    toast('Decoration placed. Drill it out to recover it.');
    return true;
  }

  function tick(): void {
    if (state.gameOver) disarm();
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

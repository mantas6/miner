// Deployed scanner devices: arming, placing, and running them.
//
// `core/scanner-device.ts` holds the rules (what a device covers, when it fires,
// where it may be dropped); this is the part of the feature that touches the
// running game — the cargo bay it is taken out of, the fog it clears, the toasts
// it writes, and the save it schedules.
//
// Placement is a two-press gesture: the inventory slot arms it, the mine takes
// it. That state lives here rather than in `state.input` because it belongs to
// the device rather than to the keyboard, and because it must not survive a
// reload — an armed pointer restored from a save would swallow the first click
// of the next run.

import { MAX_WORLD_ROW, WORLD_W } from '../../shared/constants';
import { countItem, removeItem } from '../core/inventory';
import {
  SCANNER_DEVICE,
  SCANNER_ITEM,
  createScannerDevice,
  isScannerDone,
  scannerPlacementRefusal,
  tickScannerDevice,
  type ScannerDevice
} from '../core/scanner-device';
import type { AudioController, GameState } from '../core/types';
import type { WorldGrid } from './world-grid';

export interface ScannerDeviceSim {
  /** Whether a carried scanner is waiting for the player to pick a tile. */
  readonly armed: boolean;
  /** Inventory-slot press: arm placement, or stand the armed one down. */
  toggleArmed(): void;
  /**
   * Disarm without complaint (Escape, an overlay opening, a lost ship). Reports
   * whether anything was armed, so a key handler knows if it consumed the press.
   */
  disarm(): boolean;
  /** A press on the mine while armed. Reports whether a device was deployed. */
  placeAt(x: number, y: number): boolean;
  /** One fixed 60 Hz step of every deployed device. */
  tick(): void;
}

export interface ScannerDeviceDeps {
  state: GameState;
  grid: WorldGrid;
  audio: AudioController;
  toast(message: string): void;
  saveProgress(): void;
  /** Explore these tiles: the fog cache, the peer and the save all follow. */
  revealTiles(indexes: number[]): void;
  /** Paint the armed state onto the inventory slot. */
  setArmedUi(armed: boolean): void;
  /** Injected so a test can decide which fogged tile a device picks. */
  random?(): number;
}

export function createScannerDevices(deps: ScannerDeviceDeps): ScannerDeviceSim {
  const {state, grid, audio, toast, saveProgress} = deps;
  const random = deps.random ?? Math.random;
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
      return toast('Scanner deployment cancelled.');
    }
    if (state.gameOver) return;
    if (countItem(state.player.inventory, SCANNER_ITEM.kind) <= 0) {
      audio.alarm();
      return toast('No scanner aboard. Buy one at the surface depot.');
    }
    if (state.scannerDevices.length >= SCANNER_DEVICE.maxPlaced) {
      audio.alarm();
      return toast(`Only ${SCANNER_DEVICE.maxPlaced} scanners can be deployed at once.`);
    }
    setArmed(true);
    toast('Scanner ready — press a mapped tile in the mine. Escape cancels.');
  }

  function placeAt(x: number, y: number): boolean {
    if (!armed) return false;
    // The bay can empty between arming and pressing — a reset, a lost ship — and
    // a device deployed out of an empty bay would be one the player never bought.
    if (state.gameOver || countItem(state.player.inventory, SCANNER_ITEM.kind) <= 0) {
      setArmed(false);
      return false;
    }
    // Bounds first, so a press far outside the mine never generates a row chunk
    // just to find out the tile was never a candidate.
    const inBounds = x >= 0 && x < WORLD_W && y >= 0 && y <= MAX_WORLD_ROW;
    const refusal = scannerPlacementRefusal(x, y, {
      explored: state.exploredTiles,
      open: inBounds && grid.get(x, y).type === 'air',
      devices: state.scannerDevices
    });
    if (refusal) {
      audio.alarm();
      toast(refusal);
      return false;
    }
    state.player.inventory = removeItem(state.player.inventory, SCANNER_ITEM.kind);
    state.scannerDevices.push(createScannerDevice(x, y));
    setArmed(false);
    saveProgress();
    audio.blip(880, .09, 'triangle', .05, 140);
    toast(`Scanner deployed. It maps ${SCANNER_DEVICE.size}×${SCANNER_DEVICE.size} tiles, one every ${SCANNER_DEVICE.intervalSeconds} s.`);
    return true;
  }

  function tick(): void {
    // A lost ship cannot deploy anything, and the armed slot would otherwise
    // still look live behind the game-over screen.
    if (state.gameOver) disarm();
    const devices = state.scannerDevices;
    if (devices.length === 0) return;
    // Collected rather than revealed one at a time: two devices that fire on the
    // same step should cost one fog invalidation and one message to the peer.
    let revealed: number[] | null = null;
    let fired: ScannerDevice[] | null = null;
    for (const device of devices) {
      const index = tickScannerDevice(device, state.exploredTiles, random);
      if (index === null) continue;
      (revealed ??= []).push(index);
      (fired ??= []).push(device);
    }
    if (!revealed || !fired) return;
    deps.revealTiles(revealed);
    // A device that had nothing left never fires, so "fired and is now finished"
    // is the one step on which it announces itself — exactly once.
    const finished = fired.filter(device => isScannerDone(device, state.exploredTiles)).length;
    for (let announced = 0; announced < finished; announced++) {
      toast('Scanner finished its survey and went inert.');
    }
    if (finished > 0) saveProgress();
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

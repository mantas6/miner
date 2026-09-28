// Opening a chest, looting it, and losing it once it is bare.
//
// The rules themselves are core/chest.test.ts; what is checked here is the wiring:
// the first open writes the rolled loot into the ledger, the menu the UI paints
// follows every haul, a chest emptied bare is recorded as `[]` and its menu closes
// quietly, and a full bay is refused through the same alarm-and-toast path the
// wreck uses.

import { describe, expect, it, vi } from 'vitest';
import { WORLD_W } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';
import { chestKey, chestLoot } from '../core/chest';
import { addItem, createInventory, totalItems, type Inventory } from '../core/inventory';
import { createInitialState } from '../core/state';
import type { GameState } from '../core/types';
import { chestsInRange } from '../world/world';
import { createChests, type ChestSim } from './chests';
import { createAudioStub, createToastLog, type AudioStub } from './test-support';
import { nth } from '../test-narrowing';

const CHEST = nth(chestsInRange(0, 0, WORLD_W - 1, 400), 0);
const KEY = chestKey(CHEST.x, CHEST.y);
const LOOT = chestLoot(CHEST.x, CHEST.y);

/** Units across a ledger entry's stacks. */
function itemsTotal(stacks: readonly {count: number}[] | undefined): number {
  return (stacks ?? []).reduce((sum, stack) => sum + stack.count, 0);
}

interface Harness {
  state: GameState;
  chests: ChestSim;
  audio: AudioStub;
  toasts: ReturnType<typeof createToastLog>;
  /** Every contents push the UI received; `null` means the menu was taken away. */
  openUi: (Inventory | null)[];
  /** The `quiet` flag of each push, in step with `openUi`. */
  quiet: (boolean | undefined)[];
  saveProgress: ReturnType<typeof vi.fn>;
}

/** A ship parked on the first generated chest, its tile explored. */
function harness(): Harness {
  const state = createInitialState();
  Object.assign(state.player, {x: CHEST.x, y: CHEST.y});
  state.exploredTiles.add(explorationIndex(CHEST.x, CHEST.y));
  const audio = createAudioStub();
  const toasts = createToastLog();
  const openUi: (Inventory | null)[] = [];
  const quiet: (boolean | undefined)[] = [];
  const saveProgress = vi.fn();
  const chests = createChests({
    state,
    audio,
    toast: toasts.toast,
    saveProgress,
    setOpenUi: (contents, silent) => { openUi.push(contents); quiet.push(silent); }
  });
  return {state, chests, audio, toasts, openUi, quiet, saveProgress};
}

describe('opening a chest', () => {
  it('opens the chest under a press, writes its loot into the ledger, and creaks', () => {
    const h = harness();

    expect(h.chests.openAt(CHEST.x, CHEST.y)).toBe(true);
    expect(h.chests.open?.inventory).toEqual(LOOT);
    expect(h.openUi.at(-1)).toEqual(LOOT);
    expect(h.state.chestLedger[KEY]).toEqual(LOOT.map(stack => ({kind: stack.kind, count: stack.count})));
    expect(h.saveProgress).toHaveBeenCalledOnce();
    expect(h.audio.played).toEqual(['chestOpen']);
  });

  it('opens from a neighbouring tile, but not from two away', () => {
    const h = harness();
    h.state.player.x = CHEST.x + 1;
    expect(h.chests.openAt(CHEST.x, CHEST.y)).toBe(true);
    h.chests.close();

    h.state.player.x = CHEST.x + 2;
    expect(h.chests.openAt(CHEST.x, CHEST.y)).toBe(false);
    expect(h.toasts.saw('Too far from the chest')).toBe(true);
  });

  it('says nothing about a press on a tile with no chest, or one under fog', () => {
    const h = harness();
    const before = h.toasts.messages.length;
    expect(h.chests.openAt(CHEST.x + 1, CHEST.y)).toBe(false);
    h.state.exploredTiles.clear();
    expect(h.chests.openAt(CHEST.x, CHEST.y)).toBe(false);
    expect(h.toasts.messages).toHaveLength(before);
    expect(h.state.chestLedger).toEqual({});
  });

  it('opens the nearest chest from the keyboard, and closes it again', () => {
    const h = harness();

    expect(h.chests.nearest()).toEqual({...CHEST, distance: 0});
    expect(h.chests.openNearest()).toBe(true);
    expect(h.chests.open).not.toBeNull();
    expect(h.chests.openNearest()).toBe(true);
    expect(h.chests.open).toBeNull();
    expect(h.openUi.at(-1)).toBeNull();
    expect(h.quiet.at(-1)).toBe(false);
  });

  it('says nothing is in reach when the keyboard finds no chest', () => {
    const h = harness();
    h.state.player.x = CHEST.x + 3;

    expect(h.chests.openNearest()).toBe(false);
    expect(h.toasts.saw('No chest within reach')).toBe(true);
  });

  it('reopens with what the ledger kept, not a fresh roll', () => {
    const h = harness();
    h.state.chestLedger[KEY] = [{kind: 'scanner', count: 1}];

    h.chests.openAt(CHEST.x, CHEST.y);

    expect(totalItems(h.chests.open!.inventory)).toBe(1);
    expect(h.saveProgress).not.toHaveBeenCalled();
  });

  it('shuts the menu when the ship is lost', () => {
    const h = harness();
    h.chests.openAt(CHEST.x, CHEST.y);
    h.state.gameOver = true;

    h.chests.tick();

    expect(h.chests.open).toBeNull();
    expect(h.openUi.at(-1)).toBeNull();
  });
});

describe('looting a chest', () => {
  /** A chest open under the ship, with the open-time bookkeeping cleared. */
  function opened(): Harness {
    const h = harness();
    h.chests.openAt(CHEST.x, CHEST.y);
    h.saveProgress.mockClear();
    h.audio.played.length = 0;
    return h;
  }

  it('takes a single unit, rewriting the ledger and keeping the menu up', () => {
    const h = opened();
    const first = nth(LOOT, 0);

    h.chests.take(first.kind, true);

    expect(totalItems(h.state.player.inventory)).toBe(1);
    expect(itemsTotal(h.state.chestLedger[KEY])).toBe(totalItems(LOOT) - 1);
    expect(h.chests.open).not.toBeNull();
    expect(h.openUi.at(-1)).toBe(h.chests.open!.inventory);
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.audio.played).toEqual(['take']);
    expect(h.toasts.saw(`Took 1 × ${first.item.label}`)).toBe(true);
  });

  it('loots everything in one press, leaving a bare chest that is gone for good', () => {
    const h = opened();

    h.chests.lootAll();

    expect(totalItems(h.state.player.inventory)).toBe(totalItems(LOOT));
    expect(h.state.chestLedger[KEY]).toEqual([]);
    expect(h.chests.open).toBeNull();
    expect(h.openUi.at(-1)).toBeNull();
    // The haul's own cue covers the menu closing behind it.
    expect(h.quiet.at(-1)).toBe(true);
    expect(h.audio.played).toEqual(['take']);
    // A bare chest cannot be opened again.
    expect(h.chests.openAt(CHEST.x, CHEST.y)).toBe(false);
    expect(h.chests.openNearest()).toBe(false);
  });

  it('leaves the overflow behind when the bay fills mid-loot', () => {
    const h = opened();
    h.state.player.cargoMax = 1;

    h.chests.lootAll();

    expect(totalItems(h.state.player.inventory)).toBe(1);
    expect(itemsTotal(h.state.chestLedger[KEY])).toBe(totalItems(LOOT) - 1);
    expect(h.chests.open).not.toBeNull();
  });

  it('refuses a haul the cargo bay cannot hold', () => {
    const h = opened();
    h.state.player.cargoMax = 1;
    h.state.player.inventory = addItem(createInventory(), {kind: 'dynamite', label: 'Dynamite', color: '#e04a2f', value: 0}, 1);

    h.chests.lootAll();
    h.chests.take(nth(LOOT, 0).kind);

    expect(h.toasts.saw('Cargo bay is full')).toBe(true);
    expect(h.audio.played).toEqual(['alarm', 'alarm']);
    expect(itemsTotal(h.state.chestLedger[KEY])).toBe(totalItems(LOOT));
  });

  it('shuts the menu instead of hauling from a chest a reset refilled', () => {
    const h = opened();
    h.state.chestLedger = {};

    h.chests.lootAll();

    expect(h.chests.open).toBeNull();
    expect(h.openUi.at(-1)).toBeNull();
    expect(totalItems(h.state.player.inventory)).toBe(0);
  });

  it('does nothing at all with no chest open', () => {
    const h = harness();

    h.chests.take(nth(LOOT, 0).kind);
    h.chests.lootAll();

    expect(totalItems(h.state.player.inventory)).toBe(0);
    expect(h.saveProgress).not.toHaveBeenCalled();
  });
});

// Opening a wreck, salvaging it, and losing it once it is empty.
//
// The rules themselves are core/wreck.test.ts; what is checked here is the wiring:
// the salvage menu the UI paints follows every haul, a wreck is removed the instant
// it is emptied, and a full bay is refused through the same alarm-and-toast path the
// crate uses.

import { describe, expect, it, vi } from 'vitest';
import { addItem, addOre, countOres, createInventory, oreItem, type Inventory } from '../core/inventory';
import { createInitialState } from '../core/state';
import { createWreck } from '../core/wreck';
import type { GameState, Ore } from '../core/types';
import { createWrecks, type WreckSim } from './wrecks';
import { createAudioStub, createToastLog, type AudioStub } from './test-support';

const COPPER: Ore = {name: 'Copper', color: '#c87a3a', value: 8, min: 0, max: 900, chance: 1};

interface Harness {
  state: GameState;
  wrecks: WreckSim;
  audio: AudioStub;
  toasts: ReturnType<typeof createToastLog>;
  /** Every contents push the UI received; `null` means the menu was taken away. */
  openUi: (Inventory | null)[];
  saveProgress: ReturnType<typeof vi.fn>;
}

/** A ship parked at (40,100) with a wreck holding `ore` copper on its own tile. */
function harness(ore = 6): Harness {
  const state = createInitialState();
  Object.assign(state.player, {x: 40, y: 100});
  const wreck = createWreck(40, 100, addItem(createInventory(), oreItem(COPPER), ore));
  state.wrecks = [wreck];
  const audio = createAudioStub();
  const toasts = createToastLog();
  const openUi: (Inventory | null)[] = [];
  const saveProgress = vi.fn();
  const wrecks = createWrecks({
    state,
    audio,
    toast: toasts.toast,
    saveProgress,
    setOpenUi: contents => openUi.push(contents)
  });
  return {state, wrecks, audio, toasts, openUi, saveProgress};
}

describe('opening a wreck', () => {
  it('opens the wreck under a press and hands its contents to the UI', () => {
    const h = harness();

    expect(h.wrecks.openAt(40, 100)).toBe(true);
    expect(h.wrecks.open).toBe(h.state.wrecks[0]);
    expect(h.openUi.at(-1)).toBe(h.state.wrecks[0].inventory);
  });

  it('says nothing at all about a press on bare rock', () => {
    const h = harness();
    const toasts = h.toasts.messages.length;

    expect(h.wrecks.openAt(12, 300)).toBe(false);
    expect(h.wrecks.open).toBeNull();
    expect(h.toasts.messages).toHaveLength(toasts);
  });

  it('refuses a wreck the ship has flown away from', () => {
    const h = harness();
    h.state.player.y = 120;

    expect(h.wrecks.openAt(40, 100)).toBe(false);
    expect(h.wrecks.open).toBeNull();
    expect(h.toasts.saw('Too far')).toBe(true);
  });

  it('opens the nearest wreck from the keyboard, and closes it again', () => {
    const h = harness();

    expect(h.wrecks.openNearest()).toBe(true);
    expect(h.wrecks.open).not.toBeNull();

    // The same key is the way back out.
    expect(h.wrecks.openNearest()).toBe(true);
    expect(h.wrecks.open).toBeNull();
    expect(h.openUi.at(-1)).toBeNull();
  });

  it('says nothing is in reach when the keyboard finds no wreck', () => {
    const h = harness();
    h.state.wrecks = [];

    expect(h.wrecks.openNearest()).toBe(false);
    expect(h.toasts.saw('No wreck within reach')).toBe(true);
  });

  it('shuts the menu when the ship is lost', () => {
    const h = harness();
    h.wrecks.openAt(40, 100);
    h.state.gameOver = true;

    h.wrecks.tick();

    expect(h.wrecks.open).toBeNull();
    expect(h.openUi.at(-1)).toBeNull();
  });
});

describe('salvaging a wreck', () => {
  /** A wreck open beside the ship. */
  function opened(ore = 6): Harness {
    const h = harness(ore);
    h.wrecks.openAt(40, 100);
    h.saveProgress.mockClear();
    return h;
  }

  it('takes a whole stack, repaints the menu, and banks the change', () => {
    const h = opened();

    h.wrecks.take(oreItem(COPPER).kind);

    expect(countOres(h.state.player.inventory)).toBe(6);
    // The wreck emptied, so it is gone and the menu closed with it.
    expect(h.state.wrecks).toEqual([]);
    expect(h.wrecks.open).toBeNull();
    expect(h.openUi.at(-1)).toBeNull();
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.toasts.saw('Salvaged 6 × Copper')).toBe(true);
  });

  it('takes a single unit, leaving the rest in the wreck', () => {
    const h = opened();

    h.wrecks.take(oreItem(COPPER).kind, true);

    expect(countOres(h.state.player.inventory)).toBe(1);
    expect(countOres(h.state.wrecks[0].inventory)).toBe(5);
    // Still holding something, so the wreck stays and the menu with it.
    expect(h.wrecks.open).toBe(h.state.wrecks[0]);
    expect(h.openUi.at(-1)).toBe(h.state.wrecks[0].inventory);
  });

  it('loots everything that fits in one press and removes the emptied wreck', () => {
    const h = opened();

    h.wrecks.lootAll();

    expect(countOres(h.state.player.inventory)).toBe(6);
    expect(h.state.wrecks).toEqual([]);
    expect(h.wrecks.open).toBeNull();
    expect(h.toasts.saw('Salvaged 6 items from the wreck')).toBe(true);
  });

  it('leaves the overflow behind when the bay fills mid-loot, keeping the wreck', () => {
    const h = opened(0);
    h.state.player.cargoMax = 2;
    h.state.wrecks[0].inventory = addItem(createInventory(), oreItem(COPPER), 5);

    h.wrecks.lootAll();

    expect(countOres(h.state.player.inventory)).toBe(2);
    expect(countOres(h.state.wrecks[0].inventory)).toBe(3);
    expect(h.wrecks.open).toBe(h.state.wrecks[0]);
  });

  it('refuses a take the cargo bay cannot hold, and keeps the wreck', () => {
    const h = opened(0);
    h.state.player.inventory = addOre(createInventory(), COPPER, 2)!; // bay at cargoMax? force full
    h.state.player.cargoMax = 1;
    h.state.wrecks[0].inventory = addItem(createInventory(), oreItem(COPPER), 3);

    h.wrecks.take(oreItem(COPPER).kind);

    expect(h.toasts.saw('Cargo bay is full')).toBe(true);
    expect(h.audio.played).toContain('alarm');
    expect(h.state.wrecks).toHaveLength(1);
  });

  it('shuts the menu instead of hauling from a wreck a reset already removed', () => {
    const h = opened();
    h.state.wrecks = [];

    h.wrecks.take(oreItem(COPPER).kind);

    expect(h.wrecks.open).toBeNull();
    expect(h.openUi.at(-1)).toBeNull();
    expect(countOres(h.state.player.inventory)).toBe(0);
  });

  it('does nothing at all with no wreck open', () => {
    const h = harness();

    h.wrecks.take(oreItem(COPPER).kind);
    h.wrecks.lootAll();

    expect(countOres(h.state.player.inventory)).toBe(0);
    expect(h.saveProgress).not.toHaveBeenCalled();
  });
});

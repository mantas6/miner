import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOME_X, START_Y } from '../../shared/constants';
import { HULL } from '../core/balance';
import { addItem, countItem, createInventory } from '../core/inventory';
import { ITEM_CATALOG } from '../core/items';
import { createInitialState } from '../core/state';
import { TELEPORTER_ITEM } from '../core/teleporter';
import type { GameState } from '../core/types';
import { createActions, type GameActions } from './actions';
import {
  createAudioStub,
  createToastLog,
  type AudioStub
} from './test-support';

interface Harness {
  state: GameState;
  actions: GameActions;
  audio: AudioStub;
  toasts: ReturnType<typeof createToastLog>;
  saveProgress: ReturnType<typeof vi.fn>;
  flags: {atSurface: boolean};
}

function harness(): Harness {
  const state = createInitialState();
  const context = {
    state,
    audio: createAudioStub(),
    toasts: createToastLog(),
    saveProgress: vi.fn(),
    flags: {atSurface: true}
  };
  const actions = createActions({
    state,
    audio: context.audio,
    toast: context.toasts.toast,
    saveProgress: context.saveProgress,
    atSurface: () => context.flags.atSurface
  });
  return {...context, actions};
}

describe('using a repair kit', () => {
  it('restores a fraction of the hull and spends one kit', () => {
    const h = harness();
    h.state.player.hull = 20;
    h.state.player.inventory = addItem(createInventory(), ITEM_CATALOG.repairKit, 2);

    h.actions.useRepairKit();

    expect(h.state.player.hull).toBe(20 + Math.round(h.state.player.hullMax * HULL.repairKitFraction));
    expect(countItem(h.state.player.inventory, ITEM_CATALOG.repairKit.kind)).toBe(1);
    expect(h.saveProgress).toHaveBeenCalled();
  });

  it('never overfills the hull', () => {
    const h = harness();
    h.state.player.hull = h.state.player.hullMax - 2;
    h.state.player.inventory = addItem(createInventory(), ITEM_CATALOG.repairKit, 1);

    h.actions.useRepairKit();

    expect(h.state.player.hull).toBe(h.state.player.hullMax);
    expect(countItem(h.state.player.inventory, ITEM_CATALOG.repairKit.kind)).toBe(0);
  });

  it('refuses at full hull and with none aboard, warning audibly', () => {
    const h = harness();
    h.actions.useRepairKit();
    expect(h.toasts.saw('No repair kit aboard')).toBe(true);

    h.state.player.hull = h.state.player.hullMax;
    h.state.player.inventory = addItem(createInventory(), ITEM_CATALOG.repairKit, 1);
    h.actions.useRepairKit();
    expect(h.toasts.saw('already at full strength')).toBe(true);
    expect(countItem(h.state.player.inventory, ITEM_CATALOG.repairKit.kind)).toBe(1);
    expect(h.audio.played).toContain('alarm');
  });
});

describe('using the teleporter', () => {
  // The jump asks the browser about reduced motion, and this suite has no DOM.
  afterEach(() => vi.unstubAllGlobals());

  /** A ship well past the 100 m threshold, with `count` teleporters in the bay. */
  function deepWithTeleporters(h: Harness, count: number): void {
    vi.stubGlobal('window', {});
    const y = START_Y + 40;
    Object.assign(h.state.player, {x: 20, y, drawX: 20, drawY: y});
    h.state.player.inventory = addItem(createInventory(), TELEPORTER_ITEM, count)!;
    h.flags.atSurface = false;
  }

  it('spends one teleporter on the trip up and nothing on the trip back', () => {
    const h = harness();
    deepWithTeleporters(h, 2);

    h.actions.useTeleporter();

    expect(countItem(h.state.player.inventory, TELEPORTER_ITEM.kind)).toBe(1);
    expect(h.state.player.y).toBe(START_Y);
    expect(h.state.teleportReturnPosition).toEqual({x: 20, y: START_Y + 40});
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.toasts.saw('Teleported safely home')).toBe(true);

    h.flags.atSurface = true;
    h.actions.useTeleporter();

    // The return point is the receipt for the charge already spent.
    expect(countItem(h.state.player.inventory, TELEPORTER_ITEM.kind)).toBe(1);
    expect(h.state.player.y).toBe(START_Y + 40);
    expect(h.state.teleportReturnPosition).toBeNull();
  });

  it('frees the slot once the last teleporter is spent', () => {
    const h = harness();
    deepWithTeleporters(h, 1);

    h.actions.useTeleporter();

    expect(countItem(h.state.player.inventory, TELEPORTER_ITEM.kind)).toBe(0);
    expect(h.state.player.inventory.every(slot => slot === null)).toBe(true);
  });

  it('refuses the jump with nothing in the bay', () => {
    const h = harness();
    deepWithTeleporters(h, 0);

    h.actions.useTeleporter();

    expect(h.state.player.y).toBe(START_Y + 40);
    expect(h.state.teleportReturnPosition).toBeNull();
    expect(h.toasts.saw('No teleporter aboard')).toBe(true);
    expect(h.audio.played).toContain('alarm');
  });

  it('keeps the teleporter when the ship is too close to home to use it', () => {
    const h = harness();
    deepWithTeleporters(h, 1);
    Object.assign(h.state.player, {x: HOME_X, y: START_Y + 1, drawX: HOME_X, drawY: START_Y + 1});

    h.actions.useTeleporter();

    expect(countItem(h.state.player.inventory, TELEPORTER_ITEM.kind)).toBe(1);
    expect(h.toasts.saw('depth of at least')).toBe(true);
    expect(h.audio.played).toContain('alarm');
  });
});

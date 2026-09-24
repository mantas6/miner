import { describe, expect, it, vi } from 'vitest';
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

describe('using the teleporter (portals phase 1 stub)', () => {
  // TODO(portals phase 3): replace with the portal-travel behaviour — a carried
  // teleporter opens the portal list and is spent on the jump.
  it('is an inert no-op that keeps the charge and toasts while travel is rebuilt', () => {
    const h = harness();
    h.state.player.inventory = addItem(createInventory(), TELEPORTER_ITEM, 1);

    h.actions.useTeleporter();

    expect(countItem(h.state.player.inventory, TELEPORTER_ITEM.kind)).toBe(1);
    expect(h.toasts.saw('being rebuilt')).toBe(true);
  });

  it('does nothing once the ship is lost', () => {
    const h = harness();
    h.state.gameOver = true;

    h.actions.useTeleporter();

    expect(h.toasts.messages).toHaveLength(0);
  });
});

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
  createPortalsSimStub,
  createToastLog,
  type AudioStub,
  type PortalsSimStub
} from './test-support';

interface Harness {
  state: GameState;
  actions: GameActions;
  audio: AudioStub;
  toasts: ReturnType<typeof createToastLog>;
  saveProgress: ReturnType<typeof vi.fn>;
  portals: PortalsSimStub;
  flags: {atSurface: boolean};
}

function harness(): Harness {
  const state = createInitialState();
  const context = {
    state,
    audio: createAudioStub(),
    toasts: createToastLog(),
    saveProgress: vi.fn(),
    portals: createPortalsSimStub(),
    flags: {atSurface: true}
  };
  const actions = createActions({
    state,
    audio: context.audio,
    toast: context.toasts.toast,
    saveProgress: context.saveProgress,
    atSurface: () => context.flags.atSurface,
    portals: context.portals
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
  it('opens the portal list in teleporter mode when a charge and an out-of-reach portal exist', () => {
    const h = harness();
    // The seeded Home portal sits three tiles off the home base, out of reach.
    h.state.player.inventory = addItem(createInventory(), TELEPORTER_ITEM, 1);

    h.actions.useTeleporter();

    expect(h.portals.openTeleporter).toHaveBeenCalledOnce();
    // The charge is spent on the jump, not on opening the list.
    expect(countItem(h.state.player.inventory, TELEPORTER_ITEM.kind)).toBe(1);
  });

  it('refuses with no teleporter aboard, warning audibly', () => {
    const h = harness();

    h.actions.useTeleporter();

    expect(h.portals.openTeleporter).not.toHaveBeenCalled();
    expect(h.toasts.saw('No teleporter aboard')).toBe(true);
    expect(h.audio.played).toContain('alarm');
  });

  it('refuses when no portal is out of reach', () => {
    const h = harness();
    h.state.player.inventory = addItem(createInventory(), TELEPORTER_ITEM, 1);
    // Strip every portal, so there is nowhere a teleporter could take the ship.
    h.state.stations = h.state.stations.filter(s => s.kind !== 'portal');

    h.actions.useTeleporter();

    expect(h.portals.openTeleporter).not.toHaveBeenCalled();
    expect(h.toasts.saw('No portal out of reach')).toBe(true);
  });

  it('does nothing once the ship is lost', () => {
    const h = harness();
    h.state.gameOver = true;

    h.actions.useTeleporter();

    expect(h.portals.openTeleporter).not.toHaveBeenCalled();
    expect(h.toasts.messages).toHaveLength(0);
  });
});

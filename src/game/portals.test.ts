// The portal sim: opening the travel/teleporter/respawn lists, jumping between
// built portals, spending a carried teleporter, renaming, and the lost-ship
// redeploy.
//
// The pure rules (which portals a tile reaches, how a name is sanitized) live in
// core/portal.ts; what is checked here is the wiring — a jump moves the ship and
// saves, a teleporter jump spends exactly one charge, an unlisted target is
// refused, a rename persists, a lifted source closes the list, and the respawn
// prompt never closes itself but hands its pick to the callback.

import { describe, expect, it, vi } from 'vitest';
import { addItem, countItem, createInventory } from '../core/inventory';
import { createInitialState } from '../core/state';
import { createPortal, type PortalStation } from '../core/stations';
import { TELEPORTER_ITEM } from '../core/teleporter';
import type { GameState } from '../core/types';
import type { PortalView } from '../ui/store';
import { createPortalsSim, type PortalsSim } from './portals';
import { createAudioStub, createToastLog, type AudioStub } from './test-support';

interface Harness {
  state: GameState;
  sim: PortalsSim;
  audio: AudioStub;
  toasts: ReturnType<typeof createToastLog>;
  saveProgress: ReturnType<typeof vi.fn>;
  revealAtPlayer: ReturnType<typeof vi.fn>;
  views: (PortalView | null)[];
  lastView(): PortalView | null;
}

function harness(): Harness {
  const state = createInitialState();
  const views: (PortalView | null)[] = [];
  const context = {
    state,
    audio: createAudioStub(),
    toasts: createToastLog(),
    saveProgress: vi.fn(),
    revealAtPlayer: vi.fn(),
    views
  };
  const sim = createPortalsSim({
    state,
    audio: context.audio,
    toast: context.toasts.toast,
    saveProgress: context.saveProgress,
    setPortalUi: view => views.push(view),
    revealAtPlayer: context.revealAtPlayer
  });
  return {...context, sim, lastView: () => views.at(-1) ?? null};
}

/** The seeded `Home` portal every fresh state carries. */
function homePortal(state: GameState): PortalStation {
  return state.stations.find((s): s is PortalStation => s.kind === 'portal')!;
}

describe('travelling between portals', () => {
  it('moves the ship to the picked portal, reveals, saves, and toasts', () => {
    const h = harness();
    const home = homePortal(h.state);
    h.state.stations.push(createPortal(50, 100, 'Deep'));

    expect(h.sim.openTravel(home)).toBe(true);
    expect(h.sim.mode).toBe('travel');
    const view = h.lastView()!;
    expect(view.mode).toBe('travel');
    expect(view.source).toEqual({x: home.x, y: home.y, name: home.name});
    expect(view.destinations.map(d => d.name)).toContain('Deep');

    expect(h.sim.travelTo(50, 100)).toBe(true);
    expect(h.state.player).toMatchObject({x: 50, y: 100, drawX: 50, drawY: 100});
    expect(h.state.teleportEffect).not.toBeNull();
    expect(h.revealAtPlayer).toHaveBeenCalled();
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.toasts.saw('Travelled to "Deep"')).toBe(true);
    // The overlay closes itself once the jump lands.
    expect(h.sim.mode).toBeNull();
    expect(h.lastView()).toBeNull();
  });

  it('refuses a target that is not on the current list, leaving the ship put', () => {
    const h = harness();
    const home = homePortal(h.state);
    const {x, y} = h.state.player;

    h.sim.openTravel(home);
    expect(h.sim.travelTo(999, 999)).toBe(false);
    expect(h.state.player).toMatchObject({x, y});
    // Still open: an unlisted press is a miss, not a close.
    expect(h.sim.mode).toBe('travel');
  });

  it('lists every other portal but never the source itself', () => {
    const h = harness();
    const home = homePortal(h.state);
    h.state.stations.push(createPortal(50, 100, 'Deep'));

    h.sim.openTravel(home);

    const names = h.lastView()!.destinations.map(d => d.name);
    expect(names).toContain('Deep');
    expect(names).not.toContain(home.name);
  });
});

describe('spending a carried teleporter', () => {
  it('opens the list in teleporter mode and spends exactly one charge on the jump', () => {
    const h = harness();
    h.state.player.inventory = addItem(createInventory(), TELEPORTER_ITEM, 2);
    Object.assign(h.state.player, {x: 5, y: 5});
    h.state.stations = [createPortal(50, 100, 'Deep')];

    expect(h.sim.openTeleporter()).toBe(true);
    expect(h.sim.mode).toBe('teleporter');

    h.sim.travelTo(50, 100);

    expect(h.state.player).toMatchObject({x: 50, y: 100});
    expect(countItem(h.state.player.inventory, TELEPORTER_ITEM.kind)).toBe(1);
    expect(h.sim.mode).toBeNull();
  });

  it('excludes portals already within arm’s reach of the ship', () => {
    const h = harness();
    Object.assign(h.state.player, {x: 5, y: 5});
    // One portal at the ship's side (reachable), one far away.
    h.state.stations = [createPortal(6, 5, 'Near'), createPortal(50, 100, 'Far')];

    h.sim.openTeleporter();

    const names = h.lastView()!.destinations.map(d => d.name);
    expect(names).toContain('Far');
    expect(names).not.toContain('Near');
  });
});

describe('renaming the source portal', () => {
  it('collapses whitespace, persists, and republishes the new name', () => {
    const h = harness();
    const home = homePortal(h.state);
    h.sim.openTravel(home);

    h.sim.rename('  My   Base  ');

    expect(home.name).toBe('My Base');
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.lastView()!.source?.name).toBe('My Base');
  });

  it('keeps the current name for an all-whitespace entry', () => {
    const h = harness();
    const home = homePortal(h.state);
    h.sim.openTravel(home);
    const before = home.name;

    h.sim.rename('   ');

    expect(home.name).toBe(before);
  });

  it('does nothing outside travel mode', () => {
    const h = harness();
    Object.assign(h.state.player, {x: 5, y: 5});
    h.state.stations = [createPortal(50, 100, 'Deep')];
    h.sim.openTeleporter();

    h.sim.rename('Nope');

    expect(h.state.stations.some(s => s.kind === 'portal' && s.name === 'Nope')).toBe(false);
  });
});

describe('the portal tick', () => {
  it('closes the travel list when the source portal is lifted out from under it', () => {
    const h = harness();
    const home = homePortal(h.state);
    h.sim.openTravel(home);

    // The Construction Toolkit packs the source portal away.
    h.state.stations = h.state.stations.filter(s => s !== home);
    h.sim.tick();

    expect(h.sim.mode).toBeNull();
    expect(h.lastView()).toBeNull();
  });

  it('leaves the respawn prompt open even after a death set gameOver', () => {
    const h = harness();
    h.state.stations = [createPortal(48, 20, 'Home'), createPortal(50, 100, 'Deep')];
    h.state.gameOver = true;
    h.sim.openRespawn(vi.fn());

    h.sim.tick();

    expect(h.sim.mode).toBe('respawn');
  });
});

describe('the lost-ship respawn prompt', () => {
  it('cannot be closed and hands its pick to the callback', () => {
    const h = harness();
    const onPick = vi.fn();
    h.state.stations = [createPortal(48, 20, 'Home'), createPortal(50, 100, 'Deep')];
    h.state.gameOver = true;
    Object.assign(h.state.player, {x: 12, y: 60});

    h.sim.openRespawn(onPick);
    expect(h.sim.mode).toBe('respawn');
    expect(h.lastView()!.mode).toBe('respawn');

    // The prompt has no close button: `close()` is ignored.
    h.sim.close();
    expect(h.sim.mode).toBe('respawn');

    // Distances are measured from the death tile, so the picked coords are listed.
    expect(h.sim.travelTo(50, 100)).toBe(true);
    expect(onPick).toHaveBeenCalledWith({x: 50, y: 100});
    // The callback rebuilds the world and redeploys the ship, so the sim does not
    // move it itself.
    expect(h.state.player).toMatchObject({x: 12, y: 60});
    expect(h.sim.mode).toBeNull();
  });
});

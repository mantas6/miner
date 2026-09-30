// The portal sim: opening the travel/teleporter/respawn lists, jumping between
// built portals, spending a carried teleporter, renaming, and the lost-ship
// redeploy.
//
// The pure rules (which portals a tile reaches, how a name is sanitized) live in
// core/portal.ts; what is checked here is the wiring — a jump moves the ship and
// saves, a teleporter jump spends exactly one charge, an unlisted target is
// refused, a rename persists, a paid repair patches the hull for cash, a lifted
// source closes the list, and the respawn prompt never closes itself but hands
// its pick to the callback.

import { describe, expect, it, vi } from 'vitest';
import { addItem, countItem, createInventory } from '../core/inventory';
import { createInitialState } from '../core/state';
import { STATIONS } from '../../shared/constants';
import { createExtractor, createPortal, type PortalStation } from '../core/stations';
import { TELEPORTER_ITEM } from '../core/teleporter';
import { hullRepair } from '../core/trading';
import type { GameState } from '../core/types';
import type { PortalView } from '../ui/store';
import { createPortalsSim, type PortalsSim } from './portals';
import { createAudioStub, createToastLog, dugPortal, type AudioStub } from './test-support';
import { nth } from '../test-narrowing';

interface Harness {
  state: GameState;
  sim: PortalsSim;
  audio: AudioStub;
  toasts: ReturnType<typeof createToastLog>;
  saveProgress: ReturnType<typeof vi.fn>;
  revealAtPlayer: ReturnType<typeof vi.fn>;
  wakeNearShip: ReturnType<typeof vi.fn>;
  views: (PortalView | null)[];
  /** The `quiet` flag of each `setPortalUi` call, in step with `views`. */
  quiet: (boolean | undefined)[];
  lastView(): PortalView | null;
}

function harness(): Harness {
  const state = createInitialState();
  const views: (PortalView | null)[] = [];
  const quiet: (boolean | undefined)[] = [];
  const context = {
    state,
    audio: createAudioStub(),
    toasts: createToastLog(),
    saveProgress: vi.fn(),
    revealAtPlayer: vi.fn(),
    wakeNearShip: vi.fn(),
    views,
    quiet
  };
  const sim = createPortalsSim({
    state,
    audio: context.audio,
    toast: context.toasts.toast,
    saveProgress: context.saveProgress,
    setPortalUi: (view, silent) => { views.push(view); quiet.push(silent); },
    revealAtPlayer: context.revealAtPlayer,
    wakeNearShip: context.wakeNearShip,
    addCash: amount => { state.cash += amount; }
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
    h.state.stations.push(dugPortal(h.state, 50, 100, 'Deep'));

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
    // The landing is a place the ship has arrived: cocoons in reach of it wake.
    expect(h.wakeNearShip).toHaveBeenCalledOnce();
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.toasts.saw('Travelled to "Deep"')).toBe(true);
    // The overlay closes itself once the jump lands — quietly, under the whoosh.
    expect(h.sim.mode).toBeNull();
    expect(h.lastView()).toBeNull();
    expect(h.quiet.at(-1)).toBe(true);
    expect(h.audio.played).toEqual(['portal']);
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
    h.state.stations.push(dugPortal(h.state, 50, 100, 'Deep'));

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
    h.state.stations = [dugPortal(h.state, 50, 100, 'Deep')];

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
    h.state.stations = [dugPortal(h.state, 6, 5, 'Near'), dugPortal(h.state, 50, 100, 'Far')];

    h.sim.openTeleporter();

    const names = h.lastView()!.destinations.map(d => d.name);
    expect(names).toContain('Far');
    expect(names).not.toContain('Near');
  });
});

describe('a portal whose tile has gone solid', () => {
  it('is never offered as a destination, by a portal or a teleporter', () => {
    const h = harness();
    const home = homePortal(h.state);
    h.state.player.inventory = addItem(createInventory(), TELEPORTER_ITEM, 1);
    // A portal whose dug-out tile the save lost: it stands in rock again.
    h.state.stations.push(createPortal(50, 100, 'Buried'), dugPortal(h.state, 60, 120, 'Open'));

    h.sim.openTravel(home);
    expect(h.lastView()!.destinations.map(d => d.name)).toEqual(['Open']);

    h.sim.close();
    Object.assign(h.state.player, {x: 5, y: 5});
    h.sim.openTeleporter();
    const names = h.lastView()!.destinations.map(d => d.name);
    expect(names).toContain('Open');
    expect(names).not.toContain('Buried');
  });

  it('refuses a listed jump whose tile filled in after the list opened, spending nothing', () => {
    const h = harness();
    h.state.player.inventory = addItem(createInventory(), TELEPORTER_ITEM, 1);
    Object.assign(h.state.player, {x: 5, y: 5});
    h.state.stations = [dugPortal(h.state, 50, 100, 'Deep')];
    h.sim.openTeleporter();

    nth(h.state.world, 100)[50] = {type: 'dirt', hp: 2, maxHp: 2};

    expect(h.sim.travelTo(50, 100)).toBe(false);
    expect(h.state.player).toMatchObject({x: 5, y: 5});
    expect(countItem(h.state.player.inventory, TELEPORTER_ITEM.kind)).toBe(1);
    expect(h.toasts.saw('buried in rock')).toBe(true);
    expect(h.lastView()!.destinations).toEqual([]);
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
    expect(h.audio.played).toEqual(['click']);
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
    h.state.stations = [dugPortal(h.state, 50, 100, 'Deep')];
    h.sim.openTeleporter();

    h.sim.rename('Nope');

    expect(h.state.stations.some(s => s.kind === 'portal' && s.name === 'Nope')).toBe(false);
  });
});

describe('repairing the hull at a portal', () => {
  it('patches the whole gap for cash at the posts\' kit rate, and saves', () => {
    const h = harness();
    h.sim.openTravel(homePortal(h.state));
    Object.assign(h.state.player, {hull: 40, hullMax: 100});
    h.state.cash = 1000;
    const quote = hullRepair(40, 100, 1000);
    // 60 points is 2.4 kits' worth (a kit restores 25): 2.4 × $60 = $144.
    expect(quote).toEqual({amount: 60, cost: 144});

    h.sim.repairHull();

    expect(h.state.player.hull).toBe(100);
    expect(h.state.cash).toBe(1000 - 144);
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.audio.played).toEqual(['repair']);
    expect(h.toasts.saw('Hull repaired +60 for $144')).toBe(true);
    // The list stays up: a repair is not a jump.
    expect(h.sim.mode).toBe('travel');
  });

  it('repairs only as far as a thin wallet reaches', () => {
    const h = harness();
    h.sim.openTravel(homePortal(h.state));
    Object.assign(h.state.player, {hull: 40, hullMax: 100});
    h.state.cash = 30;

    h.sim.repairHull();

    // $30 at $2.40 a point buys 12 whole points, for $28.
    expect(h.state.player.hull).toBe(52);
    expect(h.state.cash).toBe(2);
  });

  it('refuses a whole hull or an empty wallet, spending nothing', () => {
    const h = harness();
    h.sim.openTravel(homePortal(h.state));
    h.state.cash = 500;
    h.sim.repairHull();
    expect(h.state.cash).toBe(500);
    expect(h.toasts.saw('already whole')).toBe(true);

    Object.assign(h.state.player, {hull: 40});
    h.state.cash = 0;
    h.sim.repairHull();
    expect(h.state.player.hull).toBe(40);
    expect(h.toasts.saw('Not enough cash for a repair')).toBe(true);
    expect(h.audio.played).toEqual(['alarm', 'alarm']);
  });

  it('does nothing outside the travel list', () => {
    const h = harness();
    Object.assign(h.state.player, {x: 5, y: 5, hull: 40});
    h.state.stations = [dugPortal(h.state, 50, 100, 'Deep')];
    h.state.cash = 500;
    h.sim.openTeleporter();

    h.sim.repairHull();

    expect(h.state.player.hull).toBe(40);
    expect(h.state.cash).toBe(500);
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
    // A plain close keeps its cue; only a jump silences it.
    expect(h.quiet.at(-1)).toBe(false);
  });

  it('leaves the respawn prompt open even after a death set gameOver', () => {
    const h = harness();
    h.state.stations = [dugPortal(h.state, 48, 20, 'Home'), dugPortal(h.state, 50, 100, 'Deep')];
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
    const store = {...createExtractor(STATIONS.extractor.x, STATIONS.extractor.y), fuel: 80};
    h.state.stations = [store, dugPortal(h.state, 48, 20, 'Home'), dugPortal(h.state, 50, 100, 'Deep')];
    h.state.gameOver = true;
    Object.assign(h.state.player, {x: 12, y: 60});

    h.sim.openRespawn(onPick);
    expect(h.sim.mode).toBe('respawn');
    expect(h.lastView()!.mode).toBe('respawn');
    // Each row prices the redeploy: home (48,20 is in the cavern) what the
    // extractor's store covers, the field portal half a tank.
    expect(h.lastView()!.destinations.map(d => [d.name, d.respawnFuel])).toEqual([
      ['Home', 80],
      ['Deep', 50]
    ]);
    // Listing prices the redeploy; it draws nothing.
    expect(store.fuel).toBe(80);
    // A dry store still lists the reserve half tank at home.
    store.fuel = 0;
    h.sim.openRespawn(onPick);
    expect(h.lastView()!.destinations.map(d => d.respawnFuel)).toEqual([50, 50]);

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
    expect(h.quiet.at(-1)).toBe(true);
    expect(h.audio.played).toEqual(['respawn']);
  });
});

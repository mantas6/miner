// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEVELOPER_CASH_GRANT, developerRefuel, developerRepairHull, formatDeveloperServiceControl, grantDeveloperCash } from './developer';
import { load, save } from '../persistence';
import { createInitialState, respawnPlayer } from './state';

afterEach(() => vi.unstubAllGlobals());

describe('developer money cheat', () => {
  it('grants the full cheat amount to local cash without changing earned-cash stats', () => {
    const state = createInitialState();
    const startingCash = state.cash;

    grantDeveloperCash(state);

    expect(state.cash).toBe(startingCash + DEVELOPER_CASH_GRANT);
    expect(state.stats.totalCashEarned).toBe(0);
  });

  it('allows repeated grants', () => {
    const state = createInitialState();
    const startingCash = state.cash;

    grantDeveloperCash(state);
    grantDeveloperCash(state);
    grantDeveloperCash(state);

    expect(state.cash).toBe(startingCash + DEVELOPER_CASH_GRANT * 3);
  });

  it('persists granted cash through the regular save path', () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value)
    });
    const state = createInitialState();
    const startingCash = state.cash;
    grantDeveloperCash(state);
    save(state);

    const restored = createInitialState();
    load(restored);

    expect(restored.cash).toBe(startingCash + DEVELOPER_CASH_GRANT);
  });
});

describe('developer ship services', () => {
  it('restores base and upgraded resources exactly to their current maxima', () => {
    const state = createInitialState();
    state.player.fuel = 1;
    state.player.hull = 2;

    expect(developerRefuel(state.player)).toBe(true);
    expect(developerRepairHull(state.player)).toBe(true);
    expect(state.player).toMatchObject({ fuel: 100, fuelMax: 100, hull: 100, hullMax: 100 });

    state.player.fuelMax = 240;
    state.player.hullMax = 360;
    state.player.fuel = 12;
    state.player.hull = 34;
    developerRefuel(state.player);
    developerRepairHull(state.player);

    expect(state.player).toMatchObject({ fuel: 240, fuelMax: 240, hull: 360, hullMax: 360 });
  });

  it('charges no cash and changes no statistics', () => {
    const state = createInitialState();
    state.cash = 0;
    state.player.fuel = 10;
    state.player.hull = 20;
    state.stats.maxDepth = 80;
    const stats = { ...state.stats };

    developerRefuel(state.player);
    developerRepairHull(state.player);

    expect(state.cash).toBe(0);
    expect(state.stats).toEqual(stats);
  });

  it('is a no-op at full and disables controls with clear full-state copy', () => {
    const state = createInitialState();

    expect(developerRefuel(state.player)).toBe(false);
    expect(developerRepairHull(state.player)).toBe(false);
    expect(formatDeveloperServiceControl(state.player, 'fuel')).toMatchObject({buttonDisabled: true});
    expect(formatDeveloperServiceControl(state.player, 'fuel').buttonLabel).toContain('already full');
    expect(formatDeveloperServiceControl(state.player, 'hull')).toMatchObject({buttonDisabled: true});
  });

  it('updates controls immediately, but the derived maxima reset to base on restart', () => {
    // The developer services fill to whatever maxima the ship currently has, and
    // the controls reflect it at once. Those maxima are no longer persisted,
    // though — they are derived from fitted equipment (Phase 3) — so a fresh boot
    // comes back at the starting base.
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value)
    });
    const state = createInitialState();
    state.player.fuelMax = 220;
    state.player.hullMax = 180;
    state.player.fuel = 20;
    state.player.hull = 30;

    developerRefuel(state.player);
    developerRepairHull(state.player);
    save(state);

    expect(formatDeveloperServiceControl(state.player, 'fuel').level).toBe('Fuel 220/220');
    expect(formatDeveloperServiceControl(state.player, 'hull').buttonDisabled).toBe(true);
    const restored = createInitialState();
    load(restored);
    respawnPlayer(restored.player);
    expect(restored.player).toMatchObject({ fuel: 100, fuelMax: 100, hull: 100, hullMax: 100 });
  });
});

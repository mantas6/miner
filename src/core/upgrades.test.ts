// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ECONOMY, LIMITS } from './balance';
import { load, save } from '../persistence';
import { createInitialState } from './state';
import { applyPlayerUpgrade, formatDeveloperUpgradeControl, getPlayerUpgradeProgress } from './upgrades';

afterEach(() => vi.unstubAllGlobals());

describe('developer player upgrades', () => {
  it('grants every normal upgrade without changing cash and derives current stats normally', () => {
    const state = createInitialState();
    const cash = state.cash;

    expect(applyPlayerUpgrade(state.player, 'cargo')).toBe(true);
    expect(applyPlayerUpgrade(state.player, 'tank')).toBe(true);
    expect(applyPlayerUpgrade(state.player, 'hull')).toBe(true);
    expect(applyPlayerUpgrade(state.player, 'drill')).toBe(true);

    expect(state.cash).toBe(cash);
    expect(state.player).toMatchObject({ cargoMax: 30, fuel: 120, fuelMax: 120, hull: 120, hullMax: 120, drill: 2 });
  });

  it('stops safely at each category cap and reports max levels', () => {
    const state = createInitialState();
    state.player.cargoMax = LIMITS.cargoMax.max;
    state.player.fuelMax = LIMITS.fuelMax.max;
    state.player.hullMax = LIMITS.hullMax.max;
    state.player.drill = LIMITS.drill.max;

    for (const id of ['cargo', 'tank', 'hull', 'drill'] as const) {
      expect(getPlayerUpgradeProgress(state.player, id).atMax).toBe(true);
      expect(applyPlayerUpgrade(state.player, id)).toBe(false);
    }
    expect(getPlayerUpgradeProgress(state.player, 'cargo')).toMatchObject({ level: 98, maxLevel: 98 });
  });

  it('reaches the new fuel and hull caps without exceeding them', () => {
    const state = createInitialState();
    state.player.fuelMax = LIMITS.fuelMax.max - ECONOMY.tank.step;
    state.player.hullMax = LIMITS.hullMax.max - ECONOMY.hull.step;

    expect(applyPlayerUpgrade(state.player, 'tank')).toBe(true);
    expect(applyPlayerUpgrade(state.player, 'hull')).toBe(true);
    expect(getPlayerUpgradeProgress(state.player, 'tank')).toMatchObject({ value: 2000, level: 95, maxLevel: 95, atMax: true });
    expect(getPlayerUpgradeProgress(state.player, 'hull')).toMatchObject({ value: 2000, level: 95, maxLevel: 95, atMax: true });
    expect(applyPlayerUpgrade(state.player, 'tank')).toBe(false);
    expect(applyPlayerUpgrade(state.player, 'hull')).toBe(false);
  });

  it('disables a developer control at max and displays current/max level', () => {
    const state = createInitialState();
    state.player.drill = LIMITS.drill.max;

    const control = formatDeveloperUpgradeControl(state.player, 'drill');

    expect(control.level).toBe('Level 99/99 · 100/100');
    expect(control.buttonDisabled).toBe(true);
    expect(control.buttonLabel).toContain('at max');
  });

  it('no longer persists a runtime stat bump — the maxima are derived from equipment', () => {
    // `applyPlayerUpgrade` still mutates the stat at runtime (it survives until the
    // shop is removed in Phase 6), but the four ship stats are no longer saved:
    // they are recomputed from the fitted `equipment` on load. So a reload drops
    // the free bump back to the starting base.
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value)
    });
    const state = createInitialState();
    applyPlayerUpgrade(state.player, 'tank');
    expect(state.player.fuelMax).toBe(120);
    save(state);

    const restored = createInitialState();
    load(restored);

    expect(restored.cash).toBe(state.cash);
    expect(restored.player.fuelMax).toBe(100);
  });
});

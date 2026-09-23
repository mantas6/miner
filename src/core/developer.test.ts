// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEVELOPER_EXTRACTOR_COAL,
  DEVELOPER_ORE_BUNDLE,
  fillDeveloperExtractor,
  grantDeveloperOres
} from './developer';
import { EXTRACTOR } from './balance';
import { ORES } from '../../shared/constants';
import { totalItems } from './inventory';
import { load, save } from '../persistence';
import { createInitialState } from './state';
import { firstManufacturer } from './stations';
import type { GameState } from './types';

/** The seeded manufacturer's stock, which the ore overflow lands in. */
function stationStock(state: GameState) {
  return firstManufacturer(state.stations)!.inventory;
}

/** The seeded extractor's buffers. */
function extractor(state: GameState) {
  return state.stations.find(s => s.kind === 'extractor')!;
}

afterEach(() => vi.unstubAllGlobals());

describe('developer grant ores', () => {
  it('fills the cargo bay first, then overflows into the station stock', () => {
    const state = createInitialState();

    const granted = grantDeveloperOres(state);

    expect(granted).toBe(DEVELOPER_ORE_BUNDLE * ORES.length);
    // The bay fills to its capacity; the rest lands in the station warehouse.
    expect(totalItems(state.player.inventory)).toBe(state.player.cargoMax);
    expect(totalItems(stationStock(state))).toBe(DEVELOPER_ORE_BUNDLE * ORES.length - state.player.cargoMax);
    // A grant is free — no cash and no earned-cash statistics move.
    expect(state.stats.totalCashEarned).toBe(0);
  });

  it('persists the ore banked in the station stock through the save path', () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value)
    });
    const state = createInitialState();
    grantDeveloperOres(state);
    const stationTotal = totalItems(stationStock(state));
    save(state);

    const restored = createInitialState();
    load(restored);

    // Ore in the bay is lost with the run and never saved; the station warehouse
    // keeps what was banked there.
    expect(totalItems(restored.player.inventory)).toBe(0);
    expect(totalItems(stationStock(restored))).toBe(stationTotal);
  });
});

describe('developer fill extractor', () => {
  it('queues coal and fills stored fuel to the cap', () => {
    const state = createInitialState();

    fillDeveloperExtractor(state);

    expect(extractor(state).coal).toBe(DEVELOPER_EXTRACTOR_COAL);
    expect(extractor(state).fuel).toBe(EXTRACTOR.fuelCap);
    expect(state.cash).toBe(createInitialState().cash);
  });
});

// @vitest-environment happy-dom
//
// The oil extractor screen as a component: does it paint the queued coal, the
// stored fuel against its cap, and the countdown from the store, and does the Load
// coal button name its amount, disable at zero, and reach the right command? What a
// load or a conversion actually does — and the auto-refuel on parking — lives in
// core/home.test.ts and game/home-stations.test.ts.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXTRACTOR } from '../core/balance';
import { addItem, createInventory, oreItem } from '../core/inventory';
import { ExtractorScreen } from './ExtractorScreen';
import { setUiCommands, uiCommands } from './commands';
import { buildInventorySlots, uiStore, type ExtractorView, type PlayerSnapshot } from './store';

const pristine = {...uiStore.getState()};
const pristineCommands = {...uiCommands};

const COAL = {name: 'Coal', color: '#343434', value: 8, min: 0, max: 900, chance: 1};

function playerSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    fuel: 100, fuelMax: 100, hull: 100, hullMax: 100, cargoMax: 20, drill: 1,
    scanners: 0, dynamite: 0, teleporters: 0, containers: 0, ...overrides
  };
}

function open(options: {extractor?: Partial<ExtractorView>; player?: Partial<PlayerSnapshot>; bayCoal?: number} = {}): HTMLDialogElement {
  const rendered = render(<ExtractorScreen />);
  act(() => {
    const store = uiStore.getState();
    store.setExtractor({coal: 0, fuel: 0, progress: 0, ...options.extractor});
    store.syncPlayer(playerSnapshot(options.player));
    store.setInventorySlots(
      options.bayCoal ? buildInventorySlots(addItem(createInventory(), oreItem(COAL), options.bayCoal)) : []
    );
    store.setActiveOverlay('extractor');
  });
  return rendered.container.querySelector('dialog')!;
}

beforeEach(() => {
  uiStore.setState(pristine);
  uiStore.getState().clearToasts();
});

afterEach(() => {
  cleanup();
  setUiCommands(pristineCommands);
});

describe('oil extractor dialog', () => {
  it('opens as a modal, painting the queued coal and the stored fuel against its cap', () => {
    const dialog = open({extractor: {coal: 4, fuel: 40}});

    expect(dialog.open).toBe(true);
    expect(document.activeElement?.id).toBe('extractorCloseBtn');
    expect(document.getElementById('extractorCoal')!.textContent).toBe('4');
    expect(document.getElementById('extractorFuel')!.textContent).toContain('40');
    expect(document.getElementById('extractorFuel')!.textContent).toContain(`/ ${EXTRACTOR.fuelCap}`);
  });

  it('counts down the seconds to the next fuel while a coal is burning', () => {
    open({extractor: {coal: 2, fuel: 0, progress: EXTRACTOR.ticksPerCoal - 120}});
    expect(document.getElementById('extractorStatus')!.textContent).toContain('next fuel in 2s');
  });

  it('reads idle with no coal queued', () => {
    open({extractor: {coal: 0, fuel: 0, progress: 0}});
    expect(document.getElementById('extractorStatus')!.textContent).toContain('Idle');
  });

  it('labels Load coal with the bay count and disables it when the bay has none', () => {
    open({bayCoal: 5});
    const load = document.getElementById('loadCoalBtn') as HTMLButtonElement;
    expect(load.textContent).toContain('Load coal (5)');
    expect(load.disabled).toBe(false);

    cleanup();
    const emptyLoad = (open({bayCoal: 0}), document.getElementById('loadCoalBtn') as HTMLButtonElement);
    expect(emptyLoad.textContent).toContain('Load coal (0)');
    expect(emptyLoad.disabled).toBe(true);
  });

  it('reads that the fuel store is full and to park to refuel', () => {
    open({extractor: {coal: 4, fuel: EXTRACTOR.fuelCap, progress: 0}});
    expect(document.getElementById('extractorStatus')!.textContent).toContain('park on the extractor to refuel');
  });

  it('routes the Load coal button to its command', () => {
    const loadCoal = vi.fn();
    setUiCommands({loadCoal});
    open({extractor: {coal: 0, fuel: 50}, player: {fuel: 70, fuelMax: 100}, bayCoal: 3});

    fireEvent.click(document.getElementById('loadCoalBtn')!);
    expect(loadCoal).toHaveBeenCalledOnce();
  });

  it('is not built until opened, and dispatches close from the button and the backdrop', () => {
    const closeExtractor = vi.fn();
    setUiCommands({closeExtractor});
    render(<ExtractorScreen />);
    expect(document.getElementById('extractor-card')).toBeNull();

    act(() => { uiStore.getState().setActiveOverlay('extractor'); });
    expect(document.getElementById('extractor-card')).not.toBeNull();

    fireEvent.click(document.getElementById('extractorCloseBtn')!);
    expect(closeExtractor).toHaveBeenCalledOnce();

    fireEvent.pointerDown(document.querySelector('dialog')!);
    expect(closeExtractor).toHaveBeenCalledTimes(2);
  });
});

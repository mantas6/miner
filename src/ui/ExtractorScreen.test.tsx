// @vitest-environment happy-dom
//
// The fuel extractor screen as a component: does it paint the queued coal, the
// stored fuel against its cap, and the countdown from the store, and do the two
// transfer buttons name their amounts, disable at zero, and reach the right
// command? What a load/refuel or a conversion actually does — and the auto-refuel
// on parking — lives in core/stations.test.ts and game/home-stations.test.ts.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXTRACTOR } from '../core/balance';
import { EXTRACTOR_FUEL_ORDER, extractorFuelOrder, extractorFuelOrderPrice } from '../core/trading';
import { addItem, createInventory, oreItem } from '../core/inventory';
import { ExtractorScreen } from './ExtractorScreen';
import { setUiCommands, uiCommands } from './commands';
import { buildInventorySlots, uiStore, type ExtractorView } from './store';
import { emptyOverlay } from '../test-overlays';

const pristine = {...uiStore.getState()};
const pristineCommands = {...uiCommands};

const COAL = {name: 'Coal', color: '#343434', value: 8, min: 0, max: 900, chance: 1};

/** The ship's tank, as the HUD snapshot the screen reads it from carries it. */
type ShipFuel = {fuel: number; fuelMax: number};

function open(options: {extractor?: Partial<ExtractorView>; player?: Partial<ShipFuel>; bayCoal?: number; cash?: number} = {}): HTMLDialogElement {
  const rendered = render(<ExtractorScreen />);
  act(() => {
    const store = uiStore.getState();
    uiStore.setState({hud: {...store.hud, fuel: 100, fuelMax: 100, cash: options.cash ?? 0, ...options.player}});
    store.setInventorySlots(
      options.bayCoal ? buildInventorySlots(addItem(createInventory(), oreItem(COAL), options.bayCoal)) : []
    );
    store.showOverlay({kind: 'extractor', extractor: {coal: 0, fuel: 0, progress: 0, supply: false, ...options.extractor}});
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

describe('fuel extractor dialog', () => {
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

  it('reads that the fuel store is full and to refuel to resume converting', () => {
    open({extractor: {coal: 4, fuel: EXTRACTOR.fuelCap, progress: 0}});
    expect(document.getElementById('extractorStatus')!.textContent).toContain('refuel to resume converting');
  });

  it('labels Refuel with the amount it would pour in, capped by tank room and stored fuel', () => {
    open({extractor: {coal: 0, fuel: 50}, player: {fuel: 70, fuelMax: 100}});
    const refuel = document.getElementById('refuelBtn') as HTMLButtonElement;
    // 30 of room, 50 stored: only 30 moves.
    expect(refuel.textContent).toContain('Refuel ship (+30)');
    expect(refuel.disabled).toBe(false);
  });

  it('disables Refuel with a full tank or no stored fuel', () => {
    open({extractor: {coal: 0, fuel: 0}, player: {fuel: 70, fuelMax: 100}});
    expect((document.getElementById('refuelBtn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('routes the two buttons to their commands', () => {
    const loadCoal = vi.fn();
    const refuelFromExtractor = vi.fn();
    setUiCommands({loadCoal, refuelFromExtractor});
    open({extractor: {coal: 0, fuel: 50}, player: {fuel: 70, fuelMax: 100}, bayCoal: 3});

    fireEvent.click(document.getElementById('loadCoalBtn')!);
    expect(loadCoal).toHaveBeenCalledOnce();

    fireEvent.click(document.getElementById('refuelBtn')!);
    expect(refuelFromExtractor).toHaveBeenCalledOnce();
  });

  it('offers no fuel order at an extractor away from the base', () => {
    open({extractor: {supply: false}, cash: 10_000});
    expect(document.getElementById('extractorBuyFuelBtn')).toBeNull();
  });

  it('orders fuel into the base extractor for cash, naming the amount and cost', () => {
    const buyExtractorFuel = vi.fn();
    setUiCommands({buyExtractorFuel});
    open({extractor: {fuel: 0, supply: true}, cash: 1000});
    const button = document.getElementById('extractorBuyFuelBtn') as HTMLButtonElement;
    const {cost} = extractorFuelOrder(0, 1000);

    expect(button.textContent).toBe(`Buy fuel (+${EXTRACTOR_FUEL_ORDER}) $${cost}`);
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(buyExtractorFuel).toHaveBeenCalledOnce();
  });

  it('disables the fuel order with a full store or an empty wallet, still quoting the rate', () => {
    const rate = `Buy fuel ($${extractorFuelOrderPrice()} per ${EXTRACTOR_FUEL_ORDER})`;
    open({extractor: {fuel: EXTRACTOR.fuelCap, supply: true}, cash: 1000});
    expect((document.getElementById('extractorBuyFuelBtn') as HTMLButtonElement).disabled).toBe(true);
    expect(document.getElementById('extractorBuyFuelBtn')!.textContent).toBe(rate);

    cleanup();
    open({extractor: {fuel: 0, supply: true}, cash: 0});
    const broke = document.getElementById('extractorBuyFuelBtn') as HTMLButtonElement;
    expect(broke.disabled).toBe(true);
    // An empty wallet learns what an order would cost before it needs one.
    expect(broke.textContent).toBe(rate);
  });

  it('is not built until opened, and dispatches close from the button and the backdrop', () => {
    const closeStation = vi.fn();
    setUiCommands({closeStation});
    render(<ExtractorScreen />);
    expect(document.getElementById('extractor-card')).toBeNull();

    act(() => { uiStore.getState().showOverlay(emptyOverlay('extractor')); });
    expect(document.getElementById('extractor-card')).not.toBeNull();

    fireEvent.click(document.getElementById('extractorCloseBtn')!);
    expect(closeStation).toHaveBeenCalledOnce();

    fireEvent.pointerDown(document.querySelector('dialog')!);
    expect(closeStation).toHaveBeenCalledTimes(2);
  });
});

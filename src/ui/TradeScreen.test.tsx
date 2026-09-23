// @vitest-environment happy-dom
//
// The trading-post screen as a component: does it paint the wallet, the bay's ore
// to sell, and the post's offers to buy from the store, and does a press reach the
// right command? What a trade actually does lives in core/trading.test.ts and
// game/trading.test.ts.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addItem, createInventory, oreItem } from '../core/inventory';
import { TradeScreen } from './TradeScreen';
import { setUiCommands, uiCommands } from './commands';
import { buildInventorySlots, uiStore, type TradeOfferView } from './store';

const pristine = {...uiStore.getState()};
const pristineCommands = {...uiCommands};

const IRON = {name: 'Iron', color: '#8a7f75', value: 12, min: 0, max: 900, chance: 1};

const OFFERS: TradeOfferView[] = [
  {index: 0, kind: 'repairKit', label: 'Repair Kit', color: '#7be08a', price: 54, stock: 2},
  {index: 1, kind: 'teleporter', label: 'Teleporter', color: '#72d9ff', price: 372, stock: 1},
  {index: 2, kind: 'scanner', label: 'Scanner', color: '#6fe3ff', price: 102, stock: 0}
];

/** Open the screen with a wallet, a stack of ore aboard, and the offers above. */
function open(cash = 500, cargo = 0, cargoMax = 20): HTMLDialogElement {
  const rendered = render(<TradeScreen />);
  act(() => {
    const store = uiStore.getState();
    uiStore.setState({hud: {...store.hud, cash, cargo, cargoMax}});
    store.setInventorySlots(buildInventorySlots(addItem(createInventory(), oreItem(IRON), 4)));
    store.setTradeBuy(OFFERS);
    store.setActiveOverlay('trade');
  });
  return rendered.container.querySelector('dialog')!;
}

function control(action: string, kind: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`[data-trade="${action}"][data-trade-kind="${kind}"]`)!;
}

beforeEach(() => {
  uiStore.setState(pristine);
  uiStore.getState().clearToasts();
});

afterEach(() => {
  cleanup();
  setUiCommands(pristineCommands);
});

describe('trading-post dialog', () => {
  it('opens as a modal, with the wallet, the ore, and the offers painted', () => {
    const dialog = open();

    expect(dialog.open).toBe(true);
    expect(document.activeElement?.id).toBe('tradeCloseBtn');
    expect(document.getElementById('tradeCash')?.textContent).toContain('$500');

    expect(control('sell', 'ore:Iron').closest('div')!.textContent).toContain('Iron');
    expect(control('sell', 'ore:Iron').closest('div')!.textContent).toContain('×4');

    expect(control('buy', 'repairKit').textContent).toContain('$54');
    expect(control('buy', 'teleporter').textContent).toContain('$372');
  });

  it('routes sell, sell-one and buy to their commands with the kind pressed', () => {
    const sellToPost = vi.fn();
    const buyFromPost = vi.fn();
    setUiCommands({sellToPost, buyFromPost});
    open();

    fireEvent.click(control('sell', 'ore:Iron'));
    expect(sellToPost).toHaveBeenCalledWith('ore:Iron', false);

    fireEvent.click(control('sell-one', 'ore:Iron'));
    expect(sellToPost).toHaveBeenCalledWith('ore:Iron', true);

    fireEvent.click(control('buy', 'repairKit'));
    expect(buyFromPost).toHaveBeenCalledWith('repairKit');
  });

  it('disables a buy the player cannot afford, one that is sold out, and everything when the bay is full', () => {
    // A small wallet: the repair kit at $54 is affordable, the teleporter at $372 is not.
    open(100);
    expect(control('buy', 'repairKit').disabled).toBe(false);
    expect(control('buy', 'teleporter').disabled).toBe(true);
    // The scanner is sold out at any wallet.
    expect(control('buy', 'scanner').disabled).toBe(true);

    cleanup();
    // A full bay disables even an affordable, in-stock offer.
    open(500, 20, 20);
    expect(control('buy', 'repairKit').disabled).toBe(true);
  });

  it('is not built until opened, and dispatches close from the button and the backdrop', () => {
    const closeTrade = vi.fn();
    setUiCommands({closeTrade});
    render(<TradeScreen />);
    expect(document.getElementById('trade-card')).toBeNull();

    act(() => {
      uiStore.getState().setTradeBuy(OFFERS);
      uiStore.getState().setActiveOverlay('trade');
    });
    expect(document.getElementById('trade-card')).not.toBeNull();

    fireEvent.click(document.getElementById('tradeCloseBtn')!);
    expect(closeTrade).toHaveBeenCalledOnce();

    fireEvent.pointerDown(document.querySelector('dialog')!);
    expect(closeTrade).toHaveBeenCalledTimes(2);
  });
});

// @vitest-environment happy-dom
//
// The shop as a component: does it show the catalog's verdict, and does a click
// reach the right command? The pricing and copy itself is covered by
// core/shop-catalog.test.ts.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShopScreen } from './ShopScreen';
import { setUiCommands, uiCommands } from './commands';
import { uiStore, type PlayerSnapshot } from './store';

const pristine = {...uiStore.getState()};
const pristineCommands = {...uiCommands};

function open(patch: {cash?: number; atSurface?: boolean; player?: Partial<PlayerSnapshot>} = {}): HTMLDialogElement {
  const rendered = render(<ShopScreen />);
  act(() => {
    const store = uiStore.getState();
    store.syncHud({...store.hud, cash: patch.cash ?? 60, atSurface: patch.atSurface ?? true});
    store.syncPlayer({...store.player, ...patch.player});
    store.setActiveOverlay('shop');
  });
  return rendered.container.querySelector('dialog')!;
}

function row(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-shop-upgrade="${id}"], [data-shop-item="${id}"], [data-shop-service="${id}"]`)!;
}

function status(id: string): string | null {
  return row(id).querySelector('[data-shop-status]')!.textContent;
}

function button(id: string): HTMLButtonElement {
  return row(id).querySelector('button')!;
}

beforeEach(() => {
  uiStore.setState(pristine);
  uiStore.getState().clearToasts();
});

afterEach(() => {
  cleanup();
  setUiCommands(pristineCommands);
});

describe('shop dialog', () => {
  it('opens as a modal, focuses the close button and reports the wallet', () => {
    const dialog = open({cash: 250});

    expect(dialog.open).toBe(true);
    expect(document.activeElement?.id).toBe('shopCloseBtn');
    expect(document.querySelector('[data-shop-cash]')?.textContent).toBe('$250 available');
    expect(document.querySelector('[data-shop-location]')?.textContent).toBe('Surface depot');
  });

  it('closes and drops its catalog when the overlay state clears', () => {
    const dialog = open();

    act(() => { uiStore.getState().setActiveOverlay(null); });

    expect(dialog.open).toBe(false);
    // Nothing is left to reprice itself off the wallet while the shop is shut.
    expect(document.getElementById('shop-card')).toBeNull();
    expect(document.querySelector('[data-shop-cash]')).toBeNull();
  });

  it('is not built at all until it is opened', () => {
    render(<ShopScreen />);

    expect(document.getElementById('shop-screen')).not.toBeNull();
    expect(document.getElementById('shop-card')).toBeNull();
  });

  it('dispatches close from the close button and from a backdrop press', () => {
    const closeShop = vi.fn();
    setUiCommands({closeShop});
    const dialog = open();

    fireEvent.click(document.getElementById('shopCloseBtn')!);
    expect(closeShop).toHaveBeenCalledOnce();

    fireEvent.pointerDown(dialog);
    expect(closeShop).toHaveBeenCalledTimes(2);

    // A press inside the card is not a dismissal.
    fireEvent.pointerDown(document.getElementById('shop-card')!);
    expect(closeShop).toHaveBeenCalledTimes(2);
  });

  it('enables only affordable purchases and says what is missing', () => {
    open({cash: 130});

    expect(button('cargo').disabled).toBe(false);
    expect(status('cargo')).toBe('Ready');
    expect(button('tank').disabled).toBe(true);
    expect(status('tank')).toBe('Need $20');
    expect(button('dynamite').disabled).toBe(false);
    expect(button('teleporter').disabled).toBe(true);
  });

  it('disables every purchase away from the surface depot', () => {
    open({cash: 1_000_000, atSurface: false});

    const buttons = [...document.querySelectorAll<HTMLButtonElement>('article button')];
    expect(buttons.length).toBeGreaterThan(8);
    expect(buttons.every(item => item.disabled)).toBe(true);
    expect([...document.querySelectorAll('[data-shop-status]')].every(item => item.textContent === 'Surface depot only')).toBe(true);
    expect(document.querySelector('[data-shop-location]')?.textContent).toBe('Return to surface');
  });

  it('routes each purchase to its command', () => {
    const commands = {
      buyUpgrade: vi.fn(),
      refuel: vi.fn(),
      repair: vi.fn(),
      buyDynamite: vi.fn(),
      buyTeleporter: vi.fn(),
      buyScanner: vi.fn(),
      buyContainer: vi.fn()
    };
    setUiCommands(commands);
    open({cash: 1_000_000, player: {fuel: 10, hull: 10}});

    fireEvent.click(button('hull'));
    expect(commands.buyUpgrade).toHaveBeenCalledWith('hull');
    fireEvent.click(document.getElementById('drillBtn')!);
    expect(commands.buyUpgrade).toHaveBeenCalledWith('drill');
    fireEvent.click(document.getElementById('fuelBtn')!);
    expect(commands.refuel).toHaveBeenCalledOnce();
    fireEvent.click(document.getElementById('repairBtn')!);
    expect(commands.repair).toHaveBeenCalledOnce();
    fireEvent.click(document.getElementById('shopDynamiteBtn')!);
    expect(commands.buyDynamite).toHaveBeenCalledOnce();
    fireEvent.click(document.getElementById('shopTeleporterBtn')!);
    expect(commands.buyTeleporter).toHaveBeenCalledOnce();
    fireEvent.click(document.getElementById('shopScannerBtn')!);
    expect(commands.buyScanner).toHaveBeenCalledOnce();
    fireEvent.click(document.getElementById('shopContainerBtn')!);
    expect(commands.buyContainer).toHaveBeenCalledOnce();
  });

  it('repaints rows when the ship snapshot changes', () => {
    open({cash: 1_000_000});
    expect(button('dynamite').disabled).toBe(false);

    act(() => {
      const store = uiStore.getState();
      store.syncPlayer({...store.player, dynamite: 4, scanners: 2, teleporters: 1, containers: 5});
    });

    // Every consumable tally comes out of the cargo bay, not off the ship.
    expect(row('dynamite').querySelector('[data-shop-current]')?.textContent).toBe('Carried: 4');
    expect(row('scanner').querySelector('[data-shop-current]')?.textContent).toBe('Carried: 2');
    expect(row('teleporter').querySelector('[data-shop-current]')?.textContent).toBe('Carried: 1');
    expect(row('container').querySelector('[data-shop-current]')?.textContent).toBe('Carried: 5');
    // The Linebreaker is gone: no gun shelf and no ammunition shelf.
    expect(document.querySelector('[data-shop-item="gun"]')).toBeNull();
    expect(document.querySelector('[data-shop-item="bullets"]')).toBeNull();
  });
});

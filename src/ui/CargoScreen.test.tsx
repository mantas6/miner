// @vitest-environment happy-dom
//
// The transfer menu as a component: does it paint both sides from the store, and
// does a press on a stack reach the right command with the right kind? What a
// transfer is allowed to do is core/cargo-container.test.ts, and who owns the open
// crate is game/cargo-containers.test.ts.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARGO_CONTAINER } from '../core/cargo-container';
import { addItem, createInventory, oreItem } from '../core/inventory';
import { DYNAMITE_ITEM } from '../core/dynamite';
import { CargoScreen } from './CargoScreen';
import { setUiCommands, uiCommands } from './commands';
import { buildInventorySlots, uiStore } from './store';

const pristine = {...uiStore.getState()};
const pristineCommands = {...uiCommands};

const COPPER = {name: 'Copper', color: '#c87a3a', value: 8, min: 0, max: 900, chance: 1};

function open(): HTMLDialogElement {
  const rendered = render(<CargoScreen />);
  act(() => {
    const store = uiStore.getState();
    store.setContainerSlots(buildInventorySlots(addItem(createInventory(), oreItem(COPPER), 4)));
    store.setInventorySlots(buildInventorySlots(addItem(createInventory(), DYNAMITE_ITEM, 2)));
    store.setActiveOverlay('container');
  });
  return rendered.container.querySelector('dialog')!;
}

function stack(action: 'store' | 'take', kind: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`[data-cargo-action="${action}"][data-cargo-kind="${kind}"]`)!;
}

function oneButton(action: 'store' | 'take', kind: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`[data-cargo-action="${action}-one"][data-cargo-kind="${kind}"]`)!;
}

beforeEach(() => {
  uiStore.setState(pristine);
  uiStore.getState().clearToasts();
});

afterEach(() => {
  cleanup();
  setUiCommands(pristineCommands);
});

describe('cargo transfer dialog', () => {
  it('opens as a modal on the close button, with both sides painted', () => {
    const dialog = open();

    expect(dialog.open).toBe(true);
    expect(document.activeElement?.id).toBe('cargoCloseBtn');
    expect(stack('take', 'ore:Copper').textContent).toContain('Copper');
    expect(stack('take', 'ore:Copper').textContent).toContain('×4');
    expect(stack('store', 'dynamite').textContent).toContain('×2');
  });

  it('lists only the stacks aboard and heads each side with how full it is', () => {
    open();

    // One copper stack in the crate, one dynamite stack in the bay.
    expect(document.querySelectorAll('#containerSlots > li')).toHaveLength(1);
    expect(document.querySelectorAll('#shipSlots > li')).toHaveLength(1);
    expect(document.getElementById('containerSlots-title')?.textContent).toContain(`4/${CARGO_CONTAINER.capacity}`);
  });

  it('is not built at all until it is opened, and drops its contents when it shuts', () => {
    render(<CargoScreen />);
    expect(document.getElementById('cargo-screen')).not.toBeNull();
    expect(document.getElementById('cargo-card')).toBeNull();

    act(() => { uiStore.getState().setActiveOverlay('container'); });
    expect(document.getElementById('cargo-card')).not.toBeNull();

    act(() => { uiStore.getState().setActiveOverlay(null); });
    expect(document.getElementById('cargo-card')).toBeNull();
  });

  it('routes each press to its command, with the kind pressed', () => {
    const storeInContainer = vi.fn();
    const takeFromContainer = vi.fn();
    setUiCommands({storeInContainer, takeFromContainer});
    open();

    fireEvent.click(stack('store', 'dynamite'));
    expect(storeInContainer).toHaveBeenCalledWith('dynamite', false);

    fireEvent.click(stack('take', 'ore:Copper'));
    expect(takeFromContainer).toHaveBeenCalledWith('ore:Copper', false);
  });

  it('moves a single unit from the per-row "1" button', () => {
    const storeInContainer = vi.fn();
    const takeFromContainer = vi.fn();
    setUiCommands({storeInContainer, takeFromContainer});
    open();

    fireEvent.click(oneButton('store', 'dynamite'));
    expect(storeInContainer).toHaveBeenCalledWith('dynamite', true);

    fireEvent.click(oneButton('take', 'ore:Copper'));
    expect(takeFromContainer).toHaveBeenCalledWith('ore:Copper', true);
  });

  it('dispatches close from the close button, the backdrop, and the browser', () => {
    const closeContainer = vi.fn();
    setUiCommands({closeContainer});
    const dialog = open();

    fireEvent.click(document.getElementById('cargoCloseBtn')!);
    expect(closeContainer).toHaveBeenCalledOnce();

    fireEvent.pointerDown(dialog);
    expect(closeContainer).toHaveBeenCalledTimes(2);

    // A press inside the card is not a dismissal.
    fireEvent.pointerDown(document.getElementById('cargo-card')!);
    expect(closeContainer).toHaveBeenCalledTimes(2);

    // What Escape reaching the UA does.
    act(() => { dialog.close(); });
    expect(closeContainer).toHaveBeenCalledTimes(3);
  });

  it('repaints the crate when the game pushes new contents', () => {
    open();

    act(() => {
      uiStore.getState().setContainerSlots(buildInventorySlots(createInventory()));
    });

    expect(document.querySelector('[data-cargo-action="take"]')).toBeNull();
    // Empty now: no stacks, just the one "Empty" placeholder row.
    const rows = [...document.querySelectorAll('#containerSlots > li')];
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe('Empty');
  });
});

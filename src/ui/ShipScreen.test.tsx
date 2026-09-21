// @vitest-environment happy-dom
//
// The ship equipment screen as a component: does it paint the fitting slots and
// the bay upgrades from the store, and does a press reach the right command with
// the right slot or kind? What an equip/unequip is allowed to do lives in
// core/ship-upgrades.test.ts.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addItem, createInventory, oreItem } from '../core/inventory';
import { itemForKind } from '../core/items';
import { ShipScreen } from './ShipScreen';
import { setUiCommands, uiCommands } from './commands';
import { buildInventorySlots, buildShipSlots, uiStore } from './store';

const pristine = {...uiStore.getState()};
const pristineCommands = {...uiCommands};

const COPPER = {name: 'Copper', color: '#c87a3a', value: 8, min: 0, max: 900, chance: 1};

function open(): HTMLDialogElement {
  const rendered = render(<ShipScreen />);
  act(() => {
    const store = uiStore.getState();
    // One tank fitted in slot 0, slot 1 empty.
    store.setShipEquipment(buildShipSlots(['upgrade:tank:1', null]));
    // The bay holds an upgrade stack and an ore stack; only the upgrade shows here.
    store.setInventorySlots(buildInventorySlots(
      addItem(addItem(createInventory(), itemForKind('upgrade:cargo:2'), 3), oreItem(COPPER), 4)
    ));
    store.setActiveOverlay('ship');
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

describe('ship equipment dialog', () => {
  it('opens as a modal on the close button, painting the fitted slot and the empty one', () => {
    const dialog = open();

    expect(dialog.open).toBe(true);
    expect(document.activeElement?.id).toBe('shipCloseBtn');

    const slots = [...document.querySelectorAll('#shipSlots > li')];
    expect(slots).toHaveLength(2);
    expect(slots[0].textContent).toContain('Fuel Tank Mk I');
    expect(slots[1].textContent).toContain('Empty');
  });

  it('lists only the upgrade stacks aboard, never the ore', () => {
    open();

    const bay = [...document.querySelectorAll('#shipBay > li')];
    expect(bay).toHaveLength(1);
    expect(bay[0].textContent).toContain('Cargo Hold Mk II');
    expect(bay[0].textContent).toContain('×3');
  });

  it('disables Unfit on an empty slot and enables it on a fitted one', () => {
    open();

    const fitted = document.querySelector<HTMLButtonElement>('[data-ship-unequip="0"]')!;
    const empty = document.querySelector<HTMLButtonElement>('[data-ship-unequip="1"]')!;
    expect(fitted.disabled).toBe(false);
    expect(empty.disabled).toBe(true);
  });

  it('routes Fit to equipUpgrade with the kind and Unfit to unequipUpgrade with the slot', () => {
    const equipUpgrade = vi.fn();
    const unequipUpgrade = vi.fn();
    setUiCommands({equipUpgrade, unequipUpgrade});
    open();

    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-ship-equip="upgrade:cargo:2"]')!);
    expect(equipUpgrade).toHaveBeenCalledWith('upgrade:cargo:2');

    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-ship-unequip="0"]')!);
    expect(unequipUpgrade).toHaveBeenCalledWith(0);
  });

  it('is not built at all until it is opened, and drops its contents when it shuts', () => {
    render(<ShipScreen />);
    expect(document.getElementById('ship-screen')).not.toBeNull();
    expect(document.getElementById('ship-card')).toBeNull();

    act(() => { uiStore.getState().setActiveOverlay('ship'); });
    expect(document.getElementById('ship-card')).not.toBeNull();

    act(() => { uiStore.getState().setActiveOverlay(null); });
    expect(document.getElementById('ship-card')).toBeNull();
  });

  it('dispatches close from the close button, the backdrop, and the browser', () => {
    const closeShip = vi.fn();
    setUiCommands({closeShip});
    const dialog = open();

    fireEvent.click(document.getElementById('shipCloseBtn')!);
    expect(closeShip).toHaveBeenCalledOnce();

    fireEvent.pointerDown(dialog);
    expect(closeShip).toHaveBeenCalledTimes(2);

    // A press inside the card is not a dismissal.
    fireEvent.pointerDown(document.getElementById('ship-card')!);
    expect(closeShip).toHaveBeenCalledTimes(2);

    // What Escape reaching the UA does.
    act(() => { dialog.close(); });
    expect(closeShip).toHaveBeenCalledTimes(3);
  });
});

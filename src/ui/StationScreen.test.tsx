// @vitest-environment happy-dom
//
// The manufacturing station screen as a component: does it paint the station
// stock, the bay, and the recipe list from the store, and does a press reach the
// right command? What a stow/take/craft actually does lives in
// core/stations.test.ts, core/crafting.test.ts, and game/home-stations.test.ts.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addItem, createInventory, oreItem } from '../core/inventory';
import { StationScreen } from './StationScreen';
import { setUiCommands, uiCommands } from './commands';
import { buildInventorySlots, uiStore } from './store';

const pristine = {...uiStore.getState()};
const pristineCommands = {...uiCommands};

const IRON = {name: 'Iron', color: '#8a7f75', value: 12, min: 0, max: 900, chance: 1};
const COAL = {name: 'Coal', color: '#343434', value: 8, min: 0, max: 900, chance: 1};

function open(): HTMLDialogElement {
  const rendered = render(<StationScreen />);
  act(() => {
    const store = uiStore.getState();
    // The station holds three iron; the bay holds two coal.
    store.setStationSlots(buildInventorySlots(addItem(createInventory(), oreItem(IRON), 3)));
    store.setInventorySlots(buildInventorySlots(addItem(createInventory(), oreItem(COAL), 2)));
    store.setActiveOverlay('station');
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

describe('manufacturing station dialog', () => {
  it('opens as a modal, painting the station stock and the bay', () => {
    const dialog = open();

    expect(dialog.open).toBe(true);
    expect(document.activeElement?.id).toBe('stationCloseBtn');

    const stock = [...document.querySelectorAll('#stationStock > li')];
    expect(stock[0].textContent).toContain('Iron');
    expect(stock[0].textContent).toContain('×3');

    const bay = [...document.querySelectorAll('#stationBay > li')];
    expect(bay[0].textContent).toContain('Coal');
    expect(bay[0].textContent).toContain('×2');
  });

  it('routes Take/Stow, their single-unit "1" buttons, Stow all, and Craft to their commands', () => {
    const takeFromStation = vi.fn();
    const stowStack = vi.fn();
    const stowAll = vi.fn();
    const craft = vi.fn();
    setUiCommands({takeFromStation, stowStack, stowAll, craft});
    open();

    // The station's Iron stack takes a whole stack, or one, aboard.
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-station="take"][data-station-kind="ore:Iron"]')!);
    expect(takeFromStation).toHaveBeenCalledWith('ore:Iron', false);
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-station="take-one"][data-station-kind="ore:Iron"]')!);
    expect(takeFromStation).toHaveBeenCalledWith('ore:Iron', true);

    // The bay's Coal stack stows a whole stack, or one, into the station.
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-station="stow"][data-station-kind="ore:Coal"]')!);
    expect(stowStack).toHaveBeenCalledWith('ore:Coal', false);
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-station="stow-one"][data-station-kind="ore:Coal"]')!);
    expect(stowStack).toHaveBeenCalledWith('ore:Coal', true);

    fireEvent.click(document.getElementById('stowAllBtn')!);
    expect(stowAll).toHaveBeenCalledOnce();

    // The repair kit recipe is the first row, and the station's three iron affords it.
    const repairKitCraft = document.querySelector<HTMLButtonElement>('[data-craft="repairKit"]')!;
    expect(repairKitCraft.disabled).toBe(false);
    fireEvent.click(repairKitCraft);
    expect(craft).toHaveBeenCalledWith(0);
  });

  it('disables a recipe the station cannot afford and names the shortfall', () => {
    open();

    // The teleporter needs silver and gold the iron-only stock does not have.
    const teleporter = document.querySelector<HTMLButtonElement>('[data-craft="teleporter"]')!;
    expect(teleporter.disabled).toBe(true);
    expect(teleporter.closest('li')!.textContent).toContain('Need');
  });

  it('is not built until opened, and dispatches close from the button and the backdrop', () => {
    const closeStation = vi.fn();
    setUiCommands({closeStation});
    render(<StationScreen />);
    expect(document.getElementById('station-card')).toBeNull();

    act(() => {
      uiStore.getState().setStationSlots([]);
      uiStore.getState().setActiveOverlay('station');
    });
    expect(document.getElementById('station-card')).not.toBeNull();

    fireEvent.click(document.getElementById('stationCloseBtn')!);
    expect(closeStation).toHaveBeenCalledOnce();

    fireEvent.pointerDown(document.querySelector('dialog')!);
    expect(closeStation).toHaveBeenCalledTimes(2);
  });
});

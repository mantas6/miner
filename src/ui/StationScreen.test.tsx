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
import { nth } from '../test-narrowing';
import { SUPPLY_POOL, supplyPrice } from '../core/trading';

const pristine = {...uiStore.getState()};
const pristineCommands = {...uiCommands};

const IRON = {name: 'Iron', color: '#8a7f75', value: 12, min: 0, max: 900, chance: 1};
const COAL = {name: 'Coal', color: '#343434', value: 8, min: 0, max: 900, chance: 1};
const COPPER = {name: 'Copper', color: '#c47b45', value: 16, min: 0, max: 900, chance: 1};

function open(supply = false, cash = 0, bestMarkCrafted = 0): HTMLDialogElement {
  const rendered = render(<StationScreen />);
  act(() => {
    const store = uiStore.getState();
    uiStore.setState({hud: {...store.hud, cash}});
    // The station holds three iron and a copper; the bay holds two coal.
    store.setInventorySlots(buildInventorySlots(addItem(createInventory(), oreItem(COAL), 2)));
    const stock = addItem(addItem(createInventory(), oreItem(IRON), 3), oreItem(COPPER), 1);
    store.showOverlay({kind: 'station', slots: buildInventorySlots(stock), supply, bestMarkCrafted});
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
    expect(nth(stock, 0).textContent).toContain('Iron');
    expect(nth(stock, 0).textContent).toContain('×3');

    const bay = [...document.querySelectorAll('#stationBay > li')];
    expect(nth(bay, 0).textContent).toContain('Coal');
    expect(nth(bay, 0).textContent).toContain('×2');
  });

  it('routes Take/Stow, their single-unit "1" buttons, Stow ore, and Craft to their commands', () => {
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

    // The bulk stow says what it moves: the ore, not the kit aboard.
    expect(document.getElementById('stowAllBtn')!.textContent).toBe('Stow ore');
    fireEvent.click(document.getElementById('stowAllBtn')!);
    expect(stowAll).toHaveBeenCalledOnce();

    // The repair kit recipe is the first row, and the station's iron and copper afford it.
    const repairKitCraft = document.querySelector<HTMLButtonElement>('[data-craft="repairKit"]')!;
    expect(repairKitCraft.getAttribute('aria-disabled')).toBe('false');
    expect(repairKitCraft.getAttribute('aria-label')).toBe('Craft Repair Kit');
    fireEvent.click(repairKitCraft);
    expect(craft).toHaveBeenCalledWith('repairKit');
  });

  it('lists the deep alternates only once a Mk II is crafted, each pressed by its own :alt id', () => {
    open();
    expect(document.querySelector('[data-craft="device:portal:alt"]')).toBeNull();
    expect(document.querySelector('[data-craft="teleporter:alt"]')).toBeNull();
    expect(document.querySelector('[data-craft="device:portal"]')).not.toBeNull();
    cleanup();

    const craft = vi.fn();
    setUiCommands({craft});
    open(false, 0, 2);
    const standard = document.querySelector<HTMLButtonElement>('[data-craft="device:portal"]')!;
    const deep = document.querySelector<HTMLButtonElement>('[data-craft="device:portal:alt"]')!;
    expect(standard.getAttribute('aria-label')).toBe('Craft Portal');
    expect(deep.getAttribute('aria-label')).toBe('Craft Deep Portal');
    expect(deep.closest('li')!.textContent).toContain('Deep Portal');
    // Its own shortfall, read off its own bill: the stock's Iron covers the Iron.
    expect(document.getElementById(deep.getAttribute('aria-describedby')!)?.textContent).toBe('Need 2 Ruby, 2 Emerald');
    expect(document.querySelector('[data-craft="teleporter:alt"]')?.getAttribute('aria-label')).toBe('Craft Deep Teleporter');
    fireEvent.click(deep);
    expect(craft).toHaveBeenCalledWith('device:portal:alt');
  });

  it('disables a recipe the station cannot afford and names the shortfall', () => {
    open();

    // The teleporter needs silver and gold the iron-only stock does not have.
    const teleporter = document.querySelector<HTMLButtonElement>('[data-craft="teleporter"]')!;
    // aria-disabled rather than disabled: it stays focusable, described by the
    // shortfall, and a press still reaches the sim, whose refusal toast explains.
    expect(teleporter.disabled).toBe(false);
    expect(teleporter.getAttribute('aria-disabled')).toBe('true');
    const description = document.getElementById(teleporter.getAttribute('aria-describedby')!);
    expect(description?.textContent).toMatch(/^Need /);
    expect(teleporter.closest('li')!.textContent).toContain('Need');
    const craft = vi.fn();
    setUiCommands({craft});
    fireEvent.click(teleporter);
    expect(craft).toHaveBeenCalledOnce();
  });

  it('names every transfer button by its verb and the stack it moves', () => {
    open();
    const label = (selector: string) => document.querySelector(selector)?.getAttribute('aria-label');
    expect(label('[data-station="take"][data-station-kind="ore:Iron"]')).toBe('Take all Iron');
    expect(label('[data-station="take-one"][data-station-kind="ore:Iron"]')).toBe('Take one Iron');
    expect(label('[data-station="stow"][data-station-kind="ore:Coal"]')).toBe('Stow all Coal');
    expect(label('[data-station="stow-one"][data-station-kind="ore:Coal"]')).toBe('Stow one Coal');
  });

  it('shows no Supply counter at a manufacturer away from the base', () => {
    open(false, 10_000);
    expect(document.getElementById('supplyList')).toBeNull();
    expect(document.querySelector('[data-supply]')).toBeNull();
  });

  it('lists the home Supply with prices, live only while the wallet covers them', () => {
    const buySupply = vi.fn();
    setUiCommands({buySupply});
    const cash = supplyPrice('dynamite');
    open(true, cash);

    const rows = [...document.querySelectorAll<HTMLButtonElement>('#supplyList [data-supply]')];
    expect(rows.map(row => row.dataset.supply)).toEqual([...SUPPLY_POOL]);
    for (const row of rows) {
      const price = supplyPrice(row.dataset.supply as (typeof SUPPLY_POOL)[number]);
      expect(row.textContent).toBe(`$${price}`);
      expect(row.disabled).toBe(cash < price);
    }
    const dynamite = document.querySelector<HTMLButtonElement>('[data-supply="dynamite"]')!;
    expect(dynamite.getAttribute('aria-label')).toBe(`Buy Dynamite for $${cash}`);
    expect(dynamite.disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('[data-supply="container"]')!.disabled).toBe(true);

    fireEvent.click(dynamite);
    expect(buySupply).toHaveBeenCalledWith('dynamite');
  });

  it('shows the Shipyard: the hull flown, the next one with its gains, and a Build button live only when stocked', () => {
    const craftShip = vi.fn();
    setUiCommands({craftShip});
    open();

    expect(document.getElementById('shipyardCurrent')?.textContent).toBe('Flying the Scout · 3 slots');
    const build = document.querySelector<HTMLButtonElement>('[data-craft-ship="hauler"]')!;
    expect(build.getAttribute('aria-label')).toBe('Build the Hauler');
    expect(build.getAttribute('aria-disabled')).toBe('true');
    const row = build.closest('li')!;
    expect(row.textContent).toContain('Hauler · +1 slot · +50 fuel · +25 hull · +10 cargo');
    // Three iron and a copper in the stock: the whole bill but a slice of each is short.
    expect(document.getElementById(build.getAttribute('aria-describedby')!)?.textContent)
      .toBe('Need 13 Iron, 9 Copper, 6 Silver');
    fireEvent.click(build);
    expect(craftShip).toHaveBeenCalledWith('hauler');

    // Silver aboard counts toward the bill: named as stowing to do, not as missing.
    act(() => {
      uiStore.getState().setInventorySlots(buildInventorySlots(addItem(createInventory(), oreItem({...IRON, name: 'Silver'}), 4)));
    });
    expect(document.getElementById(build.getAttribute('aria-describedby')!)?.textContent)
      .toBe('Need 13 Iron, 9 Copper, 2 Silver · 4 Silver aboard to stow');
    expect(build.getAttribute('aria-disabled')).toBe('true');

    act(() => {
      const stock = [['Iron', 16], ['Copper', 10], ['Silver', 6]].reduce(
        (inventory, [name, count]) => addItem(inventory, oreItem({...IRON, name: name as string}), count as number), createInventory()
      );
      uiStore.getState().showOverlay({kind: 'station', slots: buildInventorySlots(stock), supply: false, bestMarkCrafted: 0});
    });
    expect(build.getAttribute('aria-disabled')).toBe('false');
    expect(document.getElementById(build.getAttribute('aria-describedby')!)?.textContent).toBe('16 Iron · 10 Copper · 6 Silver');
  });

  it('says so on the top rung, with no Build button', () => {
    open();
    act(() => { uiStore.getState().setShip('corebreaker'); });

    expect(document.getElementById('shipyardCurrent')?.textContent).toBe('Flying the Core Breaker · 7 slots');
    expect(document.querySelector('[data-craft-ship]')).toBeNull();
    expect(document.getElementById('shipyardList')?.textContent).toContain('Top of the ladder');
  });

  it('is not built until opened, and dispatches close from the button and the backdrop', () => {
    const closeStation = vi.fn();
    setUiCommands({closeStation});
    render(<StationScreen />);
    expect(document.getElementById('station-card')).toBeNull();

    act(() => {
      uiStore.getState().showOverlay({kind: 'station', slots: [], supply: false, bestMarkCrafted: 0});
    });
    expect(document.getElementById('station-card')).not.toBeNull();

    fireEvent.click(document.getElementById('stationCloseBtn')!);
    expect(closeStation).toHaveBeenCalledOnce();

    fireEvent.pointerDown(document.querySelector('dialog')!);
    expect(closeStation).toHaveBeenCalledTimes(2);
  });
});

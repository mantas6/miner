// @vitest-environment happy-dom
//
// The portal overlay as a component: does it paint the right header, the rename
// field and the destination rows from the store, and does a press reach the right
// command? What travel, a teleporter jump and a respawn actually do lives in
// game/portals.test.ts and core/portal.test.ts.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalScreen } from './PortalScreen';
import { setUiCommands, uiCommands } from './commands';
import { uiStore, type PortalDestinationView, type PortalView } from './store';

const pristine = {...uiStore.getState()};
const pristineCommands = {...uiCommands};

const DESTINATIONS: PortalDestinationView[] = [
  {x: 12, y: 40, name: 'Depot', depthMeters: 120, distance: 8},
  {x: 48, y: 20, name: 'Home', depthMeters: 0, distance: 30}
];

/** Open the overlay in a given mode with the destinations above (unless overridden). */
function open(view: Partial<PortalView> = {}): HTMLDialogElement {
  const rendered = render(<PortalScreen />);
  const portal: PortalView = {
    mode: 'travel',
    source: {x: 48, y: 20, name: 'Home'},
    destinations: DESTINATIONS,
    ...view
  };
  act(() => {
    uiStore.getState().setPortalUi(portal);
    uiStore.getState().setActiveOverlay('portal');
  });
  return rendered.container.querySelector('dialog')!;
}

function row(x: number, y: number): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`[data-portal="${x},${y}"]`)!;
}

beforeEach(() => {
  uiStore.setState(pristine);
  uiStore.getState().clearToasts();
});

afterEach(() => {
  cleanup();
  setUiCommands(pristineCommands);
});

describe('portal overlay', () => {
  it('paints the travel header, the rename field and a row per destination', () => {
    const dialog = open();

    expect(dialog.open).toBe(true);
    expect(document.getElementById('portal-title')?.textContent).toBe('Portal · Home');

    const input = document.getElementById('portalNameInput') as HTMLInputElement;
    expect(input.value).toBe('Home');
    expect(input.maxLength).toBe(16);
    expect(document.getElementById('portalNameSaveBtn')).not.toBeNull();

    const depot = row(12, 40);
    expect(depot.textContent).toContain('Depot');
    expect(depot.textContent).toContain('120 m');
    expect(depot.textContent).toContain('8 tiles');
  });

  it('saves the renamed portal from the button and from Enter in the field', () => {
    const renamePortal = vi.fn();
    setUiCommands({renamePortal});
    open();

    const input = document.getElementById('portalNameInput') as HTMLInputElement;
    fireEvent.change(input, {target: {value: 'Base Camp'}});
    fireEvent.click(document.getElementById('portalNameSaveBtn')!);
    expect(renamePortal).toHaveBeenCalledWith('Base Camp');

    fireEvent.change(input, {target: {value: 'Depths'}});
    fireEvent.keyDown(input, {key: 'Enter'});
    expect(renamePortal).toHaveBeenCalledWith('Depths');
  });

  it('travels to the pressed row with its own coordinates', () => {
    const travelToPortal = vi.fn();
    setUiCommands({travelToPortal});
    open();

    fireEvent.click(row(12, 40));
    expect(travelToPortal).toHaveBeenCalledWith(12, 40);

    fireEvent.click(row(48, 20));
    expect(travelToPortal).toHaveBeenCalledWith(48, 20);
  });

  it('has no rename field in teleporter mode, and its own header', () => {
    open({mode: 'teleporter', source: undefined});

    expect(document.getElementById('portal-title')?.textContent).toBe('Teleporter');
    expect(document.getElementById('portalNameInput')).toBeNull();
    expect(document.getElementById('portalNameSaveBtn')).toBeNull();
    // The rows are still there to pick from.
    expect(row(12, 40)).not.toBeNull();
  });

  it('renders no close button in respawn mode, and ignores a backdrop press', () => {
    const closePortal = vi.fn();
    setUiCommands({closePortal});
    const dialog = open({mode: 'respawn', source: undefined});

    expect(document.getElementById('portal-title')?.textContent).toBe('Ship lost — choose where to redeploy');
    expect(document.getElementById('portalCloseBtn')).toBeNull();
    expect(document.getElementById('portalNameInput')).toBeNull();

    // A press on the backdrop is the dialog itself; respawn mode swallows it.
    fireEvent.pointerDown(dialog);
    expect(closePortal).not.toHaveBeenCalled();
  });

  it('closes from the button and the backdrop in travel and teleporter modes', () => {
    const closePortal = vi.fn();
    setUiCommands({closePortal});
    const dialog = open();

    fireEvent.click(document.getElementById('portalCloseBtn')!);
    expect(closePortal).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(dialog);
    expect(closePortal).toHaveBeenCalledTimes(2);
  });

  it('shows a mode-specific empty line when there are no destinations', () => {
    open({destinations: []});
    expect(document.getElementById('portalList')?.textContent).toContain('No other portals built yet.');

    cleanup();
    open({mode: 'teleporter', source: undefined, destinations: []});
    expect(document.getElementById('portalList')?.textContent).toContain('Every portal is within reach.');
  });

  it('is not built until opened', () => {
    render(<PortalScreen />);
    expect(document.getElementById('portal-card')).toBeNull();

    act(() => {
      uiStore.getState().setPortalUi({mode: 'travel', source: {x: 48, y: 20, name: 'Home'}, destinations: []});
      uiStore.getState().setActiveOverlay('portal');
    });
    expect(document.getElementById('portal-card')).not.toBeNull();
  });
});

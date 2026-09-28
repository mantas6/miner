// @vitest-environment happy-dom
//
// The gravestone as a component: does it paint the epitaph from the store with
// its OK focused, and does every way of dismissing it reach `closeGrave`? Who lies
// where is core/grave.test.ts; the keys that dismiss it are game/input.test.ts.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Epitaph } from '../core/grave';
import { GraveScreen } from './GraveScreen';
import { setUiCommands, uiCommands } from './commands';
import { uiStore } from './store';

const pristine = {...uiStore.getState()};
const pristineCommands = {...uiCommands};

const EPITAPH: Epitaph = {name: 'Praskovya Ivanova', born: 1939, died: 1983, cause: 'Ran dry at 130 m'};

function open(epitaph: Epitaph = EPITAPH): HTMLDialogElement {
  const rendered = render(<GraveScreen />);
  act(() => {
    uiStore.getState().showOverlay({kind: 'grave', epitaph});
  });
  return rendered.container.querySelector('dialog')!;
}

beforeEach(() => {
  uiStore.setState(pristine);
});

afterEach(() => {
  cleanup();
  setUiCommands(pristineCommands);
});

describe('grave dialog', () => {
  it('opens as a modal with the name, the years and the cause, OK focused', () => {
    const dialog = open();

    expect(dialog.id).toBe('grave-screen');
    expect(dialog.open).toBe(true);
    expect(document.activeElement?.id).toBe('graveOkBtn');
    expect(document.getElementById('grave-name')?.textContent).toBe('Praskovya Ivanova');
    expect(document.getElementById('grave-years')?.textContent).toBe('1939 – 1983');
    expect(document.getElementById('grave-cause')?.textContent).toBe('Ran dry at 130 m');
  });

  it('is not built until opened, and dispatches close from OK and the backdrop', () => {
    const closeGrave = vi.fn();
    setUiCommands({closeGrave});
    render(<GraveScreen />);
    expect(document.getElementById('grave-card')).toBeNull();

    act(() => {
      uiStore.getState().showOverlay({kind: 'grave', epitaph: EPITAPH});
    });
    expect(document.getElementById('grave-card')).not.toBeNull();

    fireEvent.click(document.getElementById('graveOkBtn')!);
    expect(closeGrave).toHaveBeenCalledOnce();

    fireEvent.pointerDown(document.querySelector('dialog')!);
    expect(closeGrave).toHaveBeenCalledTimes(2);
  });

  it('closes the dialog once the overlay drops', () => {
    const dialog = open();

    act(() => {
      uiStore.getState().closeOverlay('grave');
    });

    expect(dialog.open).toBe(false);
    expect(document.getElementById('grave-card')).toBeNull();
  });
});

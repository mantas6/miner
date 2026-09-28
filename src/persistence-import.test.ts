// @vitest-environment happy-dom
//
// Save export and import, inside a live runtime, through the Settings tab.
//
// Import is a full reset that writes one key back instead of none, so it has the
// same hazard: the runtime saves on a debounce, on an interval, on
// `visibilitychange` and on `beforeunload` — and `location.reload()` fires that
// last one — so an import that only wrote the key would watch the run it meant to
// replace written straight back over it on the way out.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { SAVE_KEY, SAVE_VERSION } from './persistence';
import { uiCommands } from './ui/commands';
import { uiStore } from './ui/store';
import { MinerApp } from './ui/ui';
import type { GameRuntime } from './game/game';

function click(id: string): void {
  act(() => { fireEvent.click(document.getElementById(id)!); });
}

function paste(text: string): void {
  act(() => { fireEvent.change(document.getElementById('importSaveText')!, {target: {value: text}}); });
}

function lastToast(): string | undefined {
  return uiStore.getState().toasts.at(-1)?.message;
}

describe('Save export and import, from the Settings tab', () => {
  let runtime: GameRuntime;
  let reload: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const context: unknown = new Proxy({}, {
      get: (_target, key) => (key === 'canvas' ? document.getElementById('game') : () => context),
      set: () => true
    });
    HTMLCanvasElement.prototype.getContext = (() => context) as HTMLCanvasElement['getContext'];
    localStorage.clear();
    localStorage.setItem(SAVE_KEY, JSON.stringify({version: SAVE_VERSION, cash: 250}));

    render(React.createElement(MinerApp));
    vi.stubGlobal('requestAnimationFrame', () => 0);
    reload = vi.fn();
    vi.stubGlobal('location', {...window.location, reload});

    const { createGameRuntime } = await import('./game/game');
    await act(async () => {
      runtime = createGameRuntime({
        canvas: document.getElementById('game') as HTMLCanvasElement,
        panel: document.getElementById('game-panel') as HTMLElement
      });
    });
    act(() => { uiCommands.beginRun(); });
    act(() => { uiCommands.openInfo(); });
    click('info-tab-settings');
  });

  afterAll(() => {
    runtime.dispose();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('exports the running save into the store and the read-only box', () => {
    click('exportSaveBtn');

    const exported = uiStore.getState().saveExport;
    expect(exported).not.toBeNull();
    expect(JSON.parse(exported!)).toMatchObject({version: SAVE_VERSION, cash: 250});
    expect((document.getElementById('exportSaveText') as HTMLTextAreaElement).value).toBe(exported);
  });

  it.each([
    ['an older save', JSON.stringify({version: SAVE_VERSION - 1, cash: 1}), `version ${SAVE_VERSION - 1}`],
    ['a newer save', JSON.stringify({version: SAVE_VERSION + 1, cash: 1}), `version ${SAVE_VERSION + 1}`],
    ['text that is not JSON', 'not a save', 'not valid JSON']
  ])('refuses %s with a toast and leaves storage untouched', (_name, text, reason) => {
    const before = localStorage.getItem(SAVE_KEY);
    paste(text);
    click('importSaveBtn');
    click('importSaveConfirmBtn');

    expect(lastToast()).toContain(reason);
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
    expect(reload).not.toHaveBeenCalled();
  });

  it('asks first, then writes the imported save and reloads, and it survives the way out', () => {
    const imported = JSON.stringify({version: SAVE_VERSION, cash: 4321});
    paste(imported);
    click('importSaveBtn');

    // The confirm is a step of its own: nothing has been touched yet.
    expect(JSON.parse(localStorage.getItem(SAVE_KEY)!).cash).toBe(250);
    expect(reload).not.toHaveBeenCalled();

    click('importSaveConfirmBtn');

    expect(localStorage.getItem(SAVE_KEY)).toBe(imported);
    expect(reload).toHaveBeenCalledOnce();

    // The reload raises `beforeunload`, and the tab may be hidden before it lands.
    // Neither may write the replaced run back over the import.
    act(() => { window.dispatchEvent(new Event('beforeunload')); });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(localStorage.getItem(SAVE_KEY)).toBe(imported);
  });
});

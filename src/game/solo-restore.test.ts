// @vitest-environment happy-dom
//
// Booting into a mine somebody already dug. `game.test.ts` covers a fresh world;
// this covers the other half of a refresh — terrain regenerates from its seed,
// so the saved tile diff has to be layered back on before the first keypress,
// or every tunnel would be filled in again. The ship comes back with it: a save
// records the tile it parked on, so a refresh resumes down the shaft rather than
// at the home base.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, render } from '@testing-library/react';
import { START_Y, WORLD_W } from '../../shared/constants';
import { SAVE_KEY, SAVE_VERSION } from '../persistence';
import { uiCommands } from '../ui/commands';
import { uiStore } from '../ui/store';
import { MinerApp } from '../ui/ui';
import type { GameRuntime } from './game';

const SHAFT_X = Math.floor(WORLD_W / 2);
/** The shaft the previous run left behind, directly below the home base. */
const DUG_ROWS = [START_Y + 1, START_Y + 2, START_Y + 3];

let frame: ((now: number) => void) | null = null;
let clock = 1000;
const toasts: string[] = [];

function renderFrame(): void {
  act(() => {
    clock += 100;
    frame?.(clock);
  });
  const toast = uiStore.getState().toasts.at(-1)?.message;
  if (toast && toasts.at(-1) !== toast) toasts.push(toast);
}

function press(key: string): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
    window.dispatchEvent(new KeyboardEvent('keyup', {key, bubbles: true, cancelable: true}));
  });
}

function depthMeters(): number {
  return uiStore.getState().hud.depthMeters;
}

describe('booting into a saved solo mine', () => {
  let runtime: GameRuntime;

  beforeAll(async () => {
    const context: unknown = new Proxy({}, {
      get: (_target, key) => (key === 'canvas' ? document.getElementById('game') : () => context),
      set: () => true
    });
    HTMLCanvasElement.prototype.getContext = (() => context) as HTMLCanvasElement['getContext'];
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      version: SAVE_VERSION,
      cash: 500,
      x: SHAFT_X,
      y: DUG_ROWS[0],
      tiles: DUG_ROWS.map(y => ({x: SHAFT_X, y, tile: {type: 'air'}}))
    }));

    render(React.createElement(MinerApp));
    vi.stubGlobal('requestAnimationFrame', (callback: (now: number) => void) => {
      frame = callback;
      return 0;
    });
    const { createGameRuntime } = await import('./game');
    await act(async () => {
      runtime = createGameRuntime({
        canvas: document.getElementById('game') as HTMLCanvasElement,
        panel: document.getElementById('game-panel') as HTMLElement
      });
    });
    act(() => { uiCommands.playSolo(); });
  });

  afterAll(() => {
    runtime.dispose();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('opens the run on the tile the last session parked on', () => {
    renderFrame();

    // A ship that ignored the save, or one buried by terrain it failed to
    // restore, would be sitting at the home base instead.
    expect(depthMeters()).toBe(10);
  });

  it('drops the ship down the saved shaft without drilling it again', () => {
    const descent = DUG_ROWS.length * 10;

    for (let attempt = 0; attempt < 20 && depthMeters() < descent; attempt++) {
      press('s');
      renderFrame();
    }

    expect(depthMeters()).toBe(descent);
    // Restored air costs no drill hits; regenerated dirt would announce each one.
    expect(toasts.filter(message => message.startsWith('Drilling'))).toEqual([]);
  });

  it('keeps saving the shaft it was given, plus whatever it digs next', () => {
    // The floor of the saved shaft is untouched terrain again, so pressing on
    // drills — and the newly cleared tile joins the same diff.
    for (let attempt = 0; attempt < 40 && depthMeters() < (DUG_ROWS.length + 1) * 10; attempt++) {
      press('s');
      renderFrame();
    }
    expect(toasts.some(message => message.startsWith('Drilling'))).toBe(true);

    act(() => { window.dispatchEvent(new Event('beforeunload')); });

    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    const air = saved.tiles.filter((entry: {tile: {type: string}}) => entry.tile.type === 'air');
    expect(saved).toMatchObject({version: SAVE_VERSION, x: SHAFT_X, y: DUG_ROWS.at(-1)! + 1});
    expect(air.map((entry: {y: number}) => entry.y)).toEqual(
      [...DUG_ROWS, DUG_ROWS.at(-1)! + 1]
    );
    expect(air.every((entry: {x: number}) => entry.x === SHAFT_X)).toBe(true);
  });
});

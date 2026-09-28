// @vitest-environment happy-dom
//
// When the runtime writes the save. `localStorage` is synchronous and a dug mine
// is megabytes of JSON, so gameplay changes only ever *schedule* a save — one
// trailing write per burst — and the minute interval only writes a run that
// actually changed. The moments a debounce could lose the run (a hidden tab, an
// unload, a teardown) still write on the spot.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, render } from '@testing-library/react';
import { SAVE_KEY } from '../persistence';
import { uiCommands } from '../ui/commands';
import { MinerApp } from '../ui/ui';
import type { GameRuntime } from './game';

describe('the save cadence', () => {
  let runtime: GameRuntime;
  let setItem: ReturnType<typeof vi.spyOn>;
  /** Writes of the save key so far. */
  const writes = () => setItem.mock.calls.filter(([key]: unknown[]) => key === SAVE_KEY).length;

  beforeAll(async () => {
    const context: unknown = new Proxy({}, {
      get: (_target, key) => (key === 'canvas' ? document.getElementById('game') : () => context),
      set: () => true
    });
    HTMLCanvasElement.prototype.getContext = (() => context) as HTMLCanvasElement['getContext'];
    localStorage.clear();
    render(React.createElement(MinerApp));
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']});
    setItem = vi.spyOn(localStorage, 'setItem');
    const { createGameRuntime } = await import('./game');
    act(() => {
      runtime = createGameRuntime({
        canvas: document.getElementById('game') as HTMLCanvasElement,
        panel: document.getElementById('game-panel') as HTMLElement
      });
    });
    act(() => { uiCommands.beginRun(); });
  });

  afterAll(() => {
    runtime.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('banks the boot-time fog reveal once the debounce settles', () => {
    // Resuming reveals the fog around the ship, which schedules — not writes.
    expect(writes()).toBe(0);
    act(() => { vi.advanceTimersByTime(500); });
    expect(writes()).toBe(1);
  });

  it('skips the minute interval while nothing has changed', () => {
    const before = writes();
    act(() => { vi.advanceTimersByTime(3 * 60_000); });
    expect(writes()).toBe(before);
  });

  it('folds a burst of changes into one trailing write', () => {
    const before = writes();
    act(() => {
      uiCommands.grantDeveloperOres();
      uiCommands.fillExtractor();
      uiCommands.grantDeveloperOres();
    });
    act(() => { vi.advanceTimersByTime(499); });
    expect(writes()).toBe(before);
    act(() => { vi.advanceTimersByTime(1); });
    expect(writes()).toBe(before + 1);
    // Written, so clean again: the next interval tick has nothing to do.
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(writes()).toBe(before + 1);
  });

  it('writes on the spot when the tab is hidden, even with nothing pending', () => {
    const before = writes();
    Object.defineProperty(document, 'hidden', {value: true, configurable: true});
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    Object.defineProperty(document, 'hidden', {value: false, configurable: true});
    expect(writes()).toBe(before + 1);
  });
});

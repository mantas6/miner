// @vitest-environment happy-dom
//
// The remembered camera framing: the stored value's own validation, and the two
// ends of the round trip through the runtime — a boot that adopts the saved
// level before the first frame, and a wheel gesture that writes the level it
// settles on back out.
//
// The clamping matters as much as the storage. `localStorage` is player-editable
// and outlives any change to the supported range, so a stale or hand-written key
// must not be able to boot the game into a view the wheel could never reach.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, render } from '@testing-library/react';
import { uiCommands } from '../ui/commands';
import { MinerApp } from '../ui/ui';
import { viewport } from './viewport';
import { MAX_ZOOM, MIN_ZOOM } from './zoom';
import { loadZoomLevel, saveZoomLevel, ZOOM_SETTINGS_KEY } from './zoom-settings';
import type { GameRuntime } from './game';

/** The level the seeded key asks the runtime to boot into. */
const SAVED_ZOOM = 1.5;

function storedZoom(): number | undefined {
  return JSON.parse(localStorage.getItem(ZOOM_SETTINGS_KEY) || 'null')?.zoom;
}

describe('zoom preference storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('falls back to the unzoomed baseline for a first visit and for unreadable storage', () => {
    expect(loadZoomLevel()).toBe(1);

    localStorage.setItem(ZOOM_SETTINGS_KEY, '{bad json');
    expect(loadZoomLevel()).toBe(1);
  });

  it('round-trips a level inside the supported range', () => {
    saveZoomLevel(1.4);

    expect(loadZoomLevel()).toBe(1.4);
    expect(storedZoom()).toBe(1.4);
  });

  it('clamps a level that is out of range on the way in and on the way out', () => {
    saveZoomLevel(50);
    expect(storedZoom()).toBe(MAX_ZOOM);

    // A key written by an older range, or by hand, still has to read as playable.
    localStorage.setItem(ZOOM_SETTINGS_KEY, JSON.stringify({zoom: 0.01}));
    expect(loadZoomLevel()).toBe(MIN_ZOOM);
    localStorage.setItem(ZOOM_SETTINGS_KEY, JSON.stringify({zoom: 9}));
    expect(loadZoomLevel()).toBe(MAX_ZOOM);
  });

  it('ignores a stored value that is not a usable number', () => {
    for (const zoom of ['1.5', null, Number.NaN]) {
      localStorage.setItem(ZOOM_SETTINGS_KEY, JSON.stringify({zoom}));
      expect(loadZoomLevel()).toBe(1);
    }

    localStorage.setItem(ZOOM_SETTINGS_KEY, JSON.stringify({}));
    expect(loadZoomLevel()).toBe(1);
  });

  it('does not fail when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => { throw new Error('Storage disabled'); }),
      setItem: vi.fn(() => { throw new Error('Storage disabled'); })
    });

    expect(() => saveZoomLevel(1.5)).not.toThrow();
    expect(loadZoomLevel()).toBe(1);

    vi.unstubAllGlobals();
  });
});

describe('zoom across a reload', () => {
  let runtime: GameRuntime;
  let frame: ((now: number) => void) | null = null;
  let clock = 1000;

  /** One animation frame, wide enough to run several fixed steps of easing. */
  function renderFrame(): void {
    act(() => {
      clock += 100;
      frame?.(clock);
    });
  }

  function wheel(deltaY: number): void {
    act(() => {
      document.getElementById('game')!
        .dispatchEvent(new WheelEvent('wheel', {deltaY, bubbles: true, cancelable: true}));
    });
  }

  /** Ease until the glide has arrived, so `zoom` and `targetZoom` agree. */
  function settleZoom(): void {
    for (let frames = 0; frames < 40 && viewport.zoom !== viewport.targetZoom; frames++) renderFrame();
  }

  beforeAll(async () => {
    const context: unknown = new Proxy({}, {
      get: (_target, key) => (key === 'canvas' ? document.getElementById('game') : () => context),
      set: () => true
    });
    HTMLCanvasElement.prototype.getContext = (() => context) as HTMLCanvasElement['getContext'];
    localStorage.clear();
    localStorage.setItem(ZOOM_SETTINGS_KEY, JSON.stringify({zoom: SAVED_ZOOM}));

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
    act(() => { uiCommands.beginRun(); });
  });

  afterAll(() => {
    runtime.dispose();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('opens at the remembered level, with no glide in from the baseline', () => {
    expect(viewport.zoom).toBe(SAVED_ZOOM);
    expect(viewport.targetZoom).toBe(SAVED_ZOOM);
    // The framing is live before the first frame, not merely recorded.
    expect(viewport.worldWidthPx).toBe(viewport.widthPx / SAVED_ZOOM);
  });

  it('writes the level the wheel settles on, once the glide has stopped', () => {
    // Only the debounce is put on a fake clock; the loop is driven by hand above,
    // and faking the frame or the performance clock would stop the simulation.
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
    try {
      wheel(240);
      expect(viewport.targetZoom).toBeLessThan(SAVED_ZOOM);
      settleZoom();

      // Debounced against the glide: dozens of eased frames write nothing.
      expect(storedZoom()).toBe(SAVED_ZOOM);

      vi.advanceTimersByTime(1000);
    } finally {
      vi.useRealTimers();
    }

    expect(storedZoom()).toBe(viewport.targetZoom);
    expect(storedZoom()).toBeLessThan(SAVED_ZOOM);
  });

  it('banks the current level when the page goes away', () => {
    wheel(-240);
    settleZoom();

    act(() => { window.dispatchEvent(new Event('beforeunload')); });

    expect(storedZoom()).toBe(viewport.targetZoom);
    expect(loadZoomLevel()).toBe(viewport.zoom);
  });

  it('never banks a level outside the supported range, however hard the wheel spins', () => {
    for (let spins = 0; spins < 60; spins++) wheel(240);
    settleZoom();
    act(() => { window.dispatchEvent(new Event('beforeunload')); });

    expect(storedZoom()).toBe(MIN_ZOOM);
    expect(loadZoomLevel()).toBe(MIN_ZOOM);
  });
});

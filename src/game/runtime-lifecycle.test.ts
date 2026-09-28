// @vitest-environment happy-dom
//
// The runtime's lifetime, which is now React's to own. `game.test.ts` proves the
// wiring works once; this proves it can be taken apart and put back together —
// the property dev StrictMode (and Fast Refresh, and a crash remount) depends on.
//
// Everything asserted here was silently broken before the runtime had a
// `dispose()`: a second boot added a second set of capture listeners, a second
// 60 Hz loop, a second save interval, and left the first one writing to the store
// forever.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, render } from '@testing-library/react';
import { SAVE_KEY } from '../persistence';
import { uiCommands } from '../ui/commands';
import { activeOverlayId, uiStore } from '../ui/store';
import { MinerApp } from '../ui/ui';
import { createGameRuntime, type GameRuntime } from './game';
import { ZOOM_SETTINGS_KEY } from './zoom-settings';

/** The window/document events the runtime and the keyboard layer install. */
const RUNTIME_EVENTS = new Set([
  'resize', 'focus', 'beforeunload', 'pointerdown', 'touchstart',
  'keydown', 'keyup', 'wheel', 'visibilitychange'
]);

interface Listener {
  type: string;
  handler: unknown;
}

/**
 * Ledger of the listeners still attached to a target, by identity. React's own
 * overlays register some of the same events, so every assertion is a delta
 * against a baseline taken just before the runtime is built.
 */
function trackListeners(target: EventTarget) {
  const live: Listener[] = [];
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);

  target.addEventListener = (type: string, handler: never, options?: never) => {
    if (RUNTIME_EVENTS.has(type)) live.push({type, handler});
    add(type, handler, options);
  };
  target.removeEventListener = (type: string, handler: never, options?: never) => {
    const index = live.findIndex(entry => entry.type === type && entry.handler === handler);
    if (index >= 0) live.splice(index, 1);
    remove(type, handler, options);
  };

  return {
    live,
    baseline: () => [...live],
    /** Listeners added since `baseline`, optionally for one event type. */
    added(baseline: Listener[], type?: string) {
      const fresh = live.filter(entry => !baseline.includes(entry));
      return type ? fresh.filter(entry => entry.type === type) : fresh;
    },
    restore() {
      target.addEventListener = add;
      target.removeEventListener = remove;
    }
  };
}

const frames = new Map<number, (now: number) => void>();
let nextFrameHandle = 1;

function surface() {
  return {
    canvas: document.getElementById('game') as HTMLCanvasElement,
    panel: document.getElementById('game-panel') as HTMLElement
  };
}

function boot(): GameRuntime {
  let runtime: GameRuntime | undefined;
  act(() => { runtime = createGameRuntime(surface()); });
  return runtime!;
}

let windowListeners: ReturnType<typeof trackListeners>;
let documentListeners: ReturnType<typeof trackListeners>;
let windowBase: Listener[] = [];
let documentBase: Listener[] = [];

describe('game runtime lifecycle', () => {
  beforeAll(() => {
    const context: unknown = new Proxy({}, {
      get: (_target, key) => (key === 'canvas' ? document.getElementById('game') : () => context),
      set: () => true
    });
    HTMLCanvasElement.prototype.getContext = (() => context) as HTMLCanvasElement['getContext'];
    // Chrome only, no runtime factory: this file mounts the runtimes itself.
    render(React.createElement(MinerApp));
    vi.stubGlobal('requestAnimationFrame', (callback: (now: number) => void) => {
      const handle = nextFrameHandle++;
      frames.set(handle, callback);
      return handle;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => { frames.delete(handle); });
    windowListeners = trackListeners(window);
    documentListeners = trackListeners(document);
  });

  beforeEach(() => {
    windowBase = windowListeners.baseline();
    documentBase = documentListeners.baseline();
  });

  afterEach(() => {
    act(() => {
      uiStore.getState().setPhase('intro');
      uiStore.getState().clearToasts();
    });
  });

  afterAll(() => {
    windowListeners.restore();
    documentListeners.restore();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('installs one listener per event, one loop and one save interval', () => {
    const setInterval = vi.spyOn(window, 'setInterval');
    const runtime = boot();

    expect(windowListeners.added(windowBase, 'keydown')).toHaveLength(1);
    // Two each: the audio unlock, and the keyboard layer's restart tap.
    expect(windowListeners.added(windowBase, 'pointerdown')).toHaveLength(2);
    expect(windowListeners.added(windowBase, 'touchstart')).toHaveLength(2);
    expect(windowListeners.added(windowBase, 'resize')).toHaveLength(1);
    expect(documentListeners.added(documentBase, 'visibilitychange')).toHaveLength(1);
    expect(frames.size).toBe(1);
    expect(setInterval).toHaveBeenCalledTimes(1);

    runtime.dispose();
    setInterval.mockRestore();
  });

  it('leaves nothing attached after dispose', () => {
    const clearInterval = vi.spyOn(window, 'clearInterval');
    const runtime = boot();
    const queuedFrame = [...frames.values()].at(-1)!;

    runtime.dispose();

    expect(windowListeners.added(windowBase)).toEqual([]);
    expect(documentListeners.added(documentBase)).toEqual([]);
    expect(frames.size).toBe(0);
    expect(clearInterval).toHaveBeenCalled();

    // A frame the browser had already queued must not resurrect the loop.
    act(() => { queuedFrame(performance.now()); });
    expect(frames.size).toBe(0);
    clearInterval.mockRestore();
  });

  it('stops answering the keyboard and the command table once disposed', () => {
    const runtime = boot();
    act(() => { uiStore.getState().setPhase('playing'); });
    runtime.dispose();

    const before = uiStore.getState().hud.fuel;
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {key: 's', bubbles: true, cancelable: true}));
      window.dispatchEvent(new KeyboardEvent('keyup', {key: 's', bubbles: true, cancelable: true}));
    });
    // No loop, no listeners: the ship cannot have spent fuel.
    expect(uiStore.getState().hud.fuel).toBe(before);

    // And a button press cannot reach the discarded runtime either.
    act(() => { uiCommands.openInfo(); });
    expect(activeOverlayId(uiStore.getState())).toBeNull();
  });

  it('boots again cleanly after a dispose, exactly like a StrictMode remount', () => {
    const first = boot();
    first.dispose();
    const second = boot();

    // One of everything, from the second boot only.
    expect(windowListeners.added(windowBase, 'keydown')).toHaveLength(1);
    expect(windowListeners.added(windowBase, 'touchstart')).toHaveLength(2);
    expect(documentListeners.added(documentBase, 'visibilitychange')).toHaveLength(1);
    expect(frames.size).toBe(1);
    // The boot toast is announced once: teardown clears the queue the first one
    // left behind, so the player never sees the same line twice.
    expect(uiStore.getState().toasts).toHaveLength(1);

    // The live runtime is the second one, and it is fully wired.
    act(() => { uiCommands.openInfo(); });
    expect(activeOverlayId(uiStore.getState())).toBe('info');
    act(() => { uiCommands.closeInfo(); });

    second.dispose();
  });

  it('follows the reduced-motion preference live and drops the watch on dispose', () => {
    const listeners = new Set<EventListener>();
    const media = {
      matches: false,
      addEventListener: (_type: string, listener: EventListener) => { listeners.add(listener); },
      removeEventListener: (_type: string, listener: EventListener) => { listeners.delete(listener); }
    };
    const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
    const runtime = boot();
    matchMedia.mockRestore();

    expect(listeners.size).toBe(1);
    runtime.dispose();
    expect(listeners.size).toBe(0);
  });

  it('is safe to dispose twice', () => {
    const runtime = boot();

    runtime.dispose();
    expect(() => runtime.dispose()).not.toThrow();
    expect(windowListeners.added(windowBase)).toEqual([]);
  });

  it('refuses a canvas with no 2D context, so the mount can report the failure', () => {
    const broken = document.createElement('canvas');
    broken.getContext = (() => null) as HTMLCanvasElement['getContext'];

    expect(() => createGameRuntime({canvas: broken, panel: surface().panel}))
      .toThrow(/2D canvas rendering context/);
    // A refused boot installs nothing.
    expect(windowListeners.added(windowBase)).toEqual([]);
    expect(frames.size).toBe(0);
  });

  it('tears a boot that fails part-way back down, without writing over the save', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    // The surface, its resize listener and the audio graph are up by the time this throws.
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(() => { throw new Error('media queries exploded'); });

    expect(() => createGameRuntime(surface())).toThrow(/media queries exploded/);
    matchMedia.mockRestore();

    expect(windowListeners.added(windowBase)).toEqual([]);
    expect(documentListeners.added(documentBase)).toEqual([]);
    expect(frames.size).toBe(0);
    // A half-built run is never banked over the one on disk.
    expect(setItem.mock.calls.filter(([key]) => key === SAVE_KEY || key === ZOOM_SETTINGS_KEY)).toEqual([]);
    // And nothing is left for a button to reach.
    act(() => { uiCommands.openInfo(); });
    expect(activeOverlayId(uiStore.getState())).toBeNull();
    setItem.mockRestore();

    // The mount is reusable: the next boot comes up whole.
    const runtime = boot();
    act(() => { uiCommands.openInfo(); });
    expect(activeOverlayId(uiStore.getState())).toBe('info');
    act(() => { uiCommands.closeInfo(); });
    runtime.dispose();
  });
});

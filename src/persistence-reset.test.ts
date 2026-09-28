// @vitest-environment happy-dom
//
// The full reset, from both ends: the key list itself, and the Settings button
// that uses it inside a live runtime.
//
// The second half is the part that used to be impossible to get right by
// inspection. The runtime saves on a debounce, on an interval, on
// `visibilitychange` and on `beforeunload` — and `location.reload()` fires that
// last one — so a reset that only removed the keys would watch the run reappear
// on the way out.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { AUDIO_SETTINGS_KEY } from './audio/audio-settings';
import { ZOOM_SETTINGS_KEY } from './game/zoom-settings';
import { SAVE_KEY } from './persistence';
import { GAME_RESET_CONFIRMATION, LEGACY_STORAGE_KEYS, PERSISTED_STORAGE_KEYS, clearPersistedGameData } from './persistence-reset';
import { uiCommands } from './ui/commands';
import { MinerApp } from './ui/ui';
import type { GameRuntime } from './game/game';

function click(id: string): void {
  act(() => { fireEvent.click(document.getElementById(id)!); });
}

describe('the stored keys a full reset owns', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  /**
   * The save file is only one of them, and each preference deliberately lives
   * outside it. A key added to the game but not to this list is a reset that
   * silently leaves something behind, so the set is pinned rather than counted.
   */
  it('names the save file and every preference key, once each', () => {
    expect([...PERSISTED_STORAGE_KEYS]).toEqual([
      SAVE_KEY, AUDIO_SETTINGS_KEY, ZOOM_SETTINGS_KEY,
      // The pre-rename keys a returning player's storage may still hold.
      'moleload-progress-v1', 'moleload:audio-settings:v1', 'moleload:zoom-settings:v1'
    ]);
    expect((LEGACY_STORAGE_KEYS as readonly string[]).includes(SAVE_KEY)).toBe(false);
    expect(new Set(PERSISTED_STORAGE_KEYS).size).toBe(PERSISTED_STORAGE_KEYS.length);
    expect(GAME_RESET_CONFIRMATION).toContain('permanently deletes');
  });

  /** The origin is shared, so this is a list of removals and not a `clear()`. */
  it('removes every key it owns and nothing else', () => {
    for (const key of PERSISTED_STORAGE_KEYS) localStorage.setItem(key, '{}');
    localStorage.setItem('unrelated-app-key', 'keep me');

    clearPersistedGameData();

    for (const key of PERSISTED_STORAGE_KEYS) expect(localStorage.getItem(key), key).toBeNull();
    expect(localStorage.getItem('unrelated-app-key')).toBe('keep me');
  });

  it('keeps clearing after a key that storage refuses to remove', () => {
    const removed: string[] = [];
    vi.stubGlobal('localStorage', {
      removeItem: (key: string) => {
        if (key === SAVE_KEY) throw new Error('Storage disabled');
        removed.push(key);
      }
    });

    expect(() => clearPersistedGameData()).not.toThrow();
    expect(removed).toEqual([AUDIO_SETTINGS_KEY, ZOOM_SETTINGS_KEY, ...LEGACY_STORAGE_KEYS]);
  });
});

describe('Reset game, from the Settings tab', () => {
  let runtime: GameRuntime;
  let reload: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const context: unknown = new Proxy({}, {
      get: (_target, key) => (key === 'canvas' ? document.getElementById('game') : () => context),
      set: () => true
    });
    HTMLCanvasElement.prototype.getContext = (() => context) as HTMLCanvasElement['getContext'];
    localStorage.clear();
    for (const key of PERSISTED_STORAGE_KEYS) localStorage.setItem(key, '{}');

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
    act(() => { uiCommands.playSolo(); });
  });

  afterAll(() => {
    runtime.dispose();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('asks first, then wipes every key and reloads, and stays wiped on the way out', () => {
    act(() => { uiCommands.openInfo(); });
    click('info-tab-settings');
    click('resetGameBtn');

    // The confirm is a step of its own: nothing has been touched yet.
    expect(localStorage.getItem(SAVE_KEY)).toBe('{}');
    expect(reload).not.toHaveBeenCalled();

    click('resetGameConfirmBtn');

    for (const key of PERSISTED_STORAGE_KEYS) expect(localStorage.getItem(key), key).toBeNull();
    expect(reload).toHaveBeenCalledOnce();

    // The reload the button just asked for raises `beforeunload`, and the tab may
    // be hidden before it lands. Neither may write the run back.
    act(() => { window.dispatchEvent(new Event('beforeunload')); });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    for (const key of PERSISTED_STORAGE_KEYS) expect(localStorage.getItem(key), key).toBeNull();
  });
});

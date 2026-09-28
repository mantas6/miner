// @vitest-environment happy-dom
//
// What `main.tsx` promises the runtime, now that the runtime is mounted by a React
// effect instead of at module import time: StrictMode is on, the game is built
// against the *mounted* canvas and panel (never a `getElementById` at import), and
// a crash has a visible surface.

import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyOverlay } from './test-overlays';

interface RuntimeCall {
  canvas: HTMLCanvasElement;
  panel: HTMLElement;
}

/** Stand in for `createGameRuntime`, recording every mount and teardown. */
function stubRuntime() {
  const calls: RuntimeCall[] = [];
  const disposed: number[] = [];
  const createGameRuntime = vi.fn((options: RuntimeCall) => {
    const index = calls.push(options) - 1;
    return {dispose: () => { disposed.push(index); }};
  });
  return {calls, disposed, createGameRuntime};
}

async function bootMain(runtime: ReturnType<typeof stubRuntime>): Promise<void> {
  vi.doMock('./game/game', () => ({createGameRuntime: runtime.createGameRuntime}));
  document.body.innerHTML = '<div id="root"></div>';
  // `root.render` is concurrent, so the commit and the mount effect land inside
  // `act`, not on the import itself.
  await act(async () => { await import('./main'); });
}

/**
 * Bring the cheat menu on screen the only way a player can: it is a disclosure in
 * the Settings tab of the Info overlay, and neither the overlay, nor an unselected
 * tab, nor a collapsed disclosure is mounted.
 */
async function openCheatMenu(): Promise<void> {
  const { uiStore } = await import('./ui/store');
  await act(async () => { uiStore.getState().showOverlay(emptyOverlay('info')); });
  await act(async () => { uiStore.getState().setInfoTab('info-settings'); });
  await act(async () => { document.getElementById('cheatsToggleBtn')!.click(); });
}

describe('browser startup', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock('./game/game');
    document.body.innerHTML = '';
  });

  it('builds the runtime against the mounted canvas and panel', async () => {
    const runtime = stubRuntime();
    await bootMain(runtime);

    const mounted = runtime.calls.at(-1)!;
    expect(mounted.canvas).toBe(document.getElementById('game'));
    expect(mounted.panel).toBe(document.getElementById('game-panel'));
    expect(mounted.canvas.isConnected).toBe(true);
  });

  it('survives the StrictMode double mount with exactly one live runtime', async () => {
    const runtime = stubRuntime();
    await bootMain(runtime);

    // Dev StrictMode mounts, tears down, and mounts again. Every runtime but the
    // last one has to have been disposed, or two loops would be simulating.
    expect(runtime.calls.length).toBeGreaterThanOrEqual(2);
    const live = runtime.calls.length - 1;
    expect(runtime.disposed).toEqual([...Array(live).keys()]);
  });

  it('reports the boot outcome so a failed runtime has a visible surface', async () => {
    const runtime = stubRuntime();
    await bootMain(runtime);
    const { uiStore } = await import('./ui/store');

    expect(uiStore.getState().runtimeStatus).toBe('ready');
    expect(document.getElementById('runtime-failure')).toBeNull();
  });

  it('reaches the cheat menu from Settings with no environment opt-in', async () => {
    const runtime = stubRuntime();
    await bootMain(runtime);

    // No tab of its own: the tablist is the six player sections and nothing else.
    expect(document.getElementById('info-tab-developer')).toBeNull();

    await openCheatMenu();
    expect(document.getElementById('cheat-menu')).toBeInstanceOf(HTMLElement);
    expect(document.getElementById('resetPlayerDataBtn')).toBeInstanceOf(HTMLButtonElement);
  });
});

// @vitest-environment happy-dom
//
// The React side of the runtime lifecycle: the effect that owns the game, and the
// two visible surfaces for things going wrong. Before this seam existed a boot
// failure was a silent black rectangle and a React crash left the canvas
// simulating behind a HUD that had quietly unmounted.

import { StrictMode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './Failure';
import { uiStore, useUiStore } from './store';
import { MinerApp } from './ui';
import type { GameRuntimeSurface } from './useGameRuntime';
import { nth } from '../test-narrowing';

const pristine = {...uiStore.getState()};

afterEach(() => {
  cleanup();
  act(() => { uiStore.setState(pristine); });
  vi.restoreAllMocks();
});

describe('mounting the runtime', () => {
  it('boots against the mounted elements and reports ready', () => {
    const mounted: GameRuntimeSurface[] = [];
    const dispose = vi.fn();

    render(<MinerApp createRuntime={surface => { mounted.push(surface); return {dispose}; }} />);

    expect(mounted).toHaveLength(1);
    expect(nth(mounted, 0).canvas).toBe(document.getElementById('game'));
    expect(nth(mounted, 0).panel).toBe(document.getElementById('game-panel'));
    expect(uiStore.getState().runtimeStatus).toBe('ready');
    expect(document.getElementById('runtime-failure')).toBeNull();
    expect(dispose).not.toHaveBeenCalled();
  });

  it('disposes the runtime when the shell unmounts', () => {
    const dispose = vi.fn();
    render(<MinerApp createRuntime={() => ({dispose})} />);

    cleanup();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(uiStore.getState().runtimeStatus).toBe('booting');
  });

  it('keeps exactly one runtime alive through a StrictMode double mount', () => {
    const disposals: number[] = [];
    let built = 0;
    const createRuntime = vi.fn(() => {
      const id = built++;
      return {dispose: () => { disposals.push(id); }};
    });

    render(
      <StrictMode>
        <MinerApp createRuntime={createRuntime} />
      </StrictMode>
    );

    // Dev StrictMode runs the effect, its cleanup, then the effect again. The
    // first runtime must be gone; the last one must not be.
    expect(built).toBe(2);
    expect(disposals).toEqual([0]);
    expect(uiStore.getState().runtimeStatus).toBe('ready');
  });

  it('surfaces a failed boot instead of leaving a dead canvas', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<MinerApp createRuntime={() => { throw new Error('2D canvas rendering context is unavailable.'); }} />);

    expect(uiStore.getState().runtimeStatus).toBe('failed');
    const notice = document.getElementById('runtime-failure');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain('2D canvas rendering context is unavailable.');
    expect(notice?.querySelector('button')?.textContent).toBe('Reload');
  });

  it('mounts the chrome with no game at all when no factory is given', () => {
    render(<MinerApp />);

    expect(document.getElementById('game')).not.toBeNull();
    expect(uiStore.getState().runtimeStatus).toBe('booting');
    expect(document.getElementById('runtime-failure')).toBeNull();
  });
});

function Boom(): never {
  throw new Error('HUD exploded');
}

describe('app error boundary', () => {
  it('replaces a crashed tree with a recoverable notice', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>
    );

    const notice = document.getElementById('app-failure');
    expect(notice?.textContent).toContain('HUD exploded');
    expect(notice?.querySelector('button')).not.toBeNull();
  });

  it('disposes the runtime when a crash takes the tree down with it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const dispose = vi.fn();

    function Crash() {
      const crashed = useUiStore(state => state.hud.gameOver);
      if (crashed) throw new Error('HUD exploded mid-run');
      return null;
    }

    render(
      <AppErrorBoundary>
        <MinerApp createRuntime={() => ({dispose})} />
        <Crash />
      </AppErrorBoundary>
    );
    expect(dispose).not.toHaveBeenCalled();

    act(() => { uiStore.getState().syncHud({...uiStore.getState().hud, gameOver: true}); });

    // The canvas is gone, so the simulation behind it must be too.
    expect(document.getElementById('game')).toBeNull();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

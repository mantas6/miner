// @vitest-environment happy-dom
//
// The bridge's runtime-facing half, booted against the real game the way
// `src/game/game.test.ts` does: register on boot, freeze the tick while paused,
// resume without replaying the frozen gap, and fall back to safe defaults once the
// runtime is disposed. The pure observation shape is covered next door in
// `observation.test.ts`; this is only the seam into a live simulation.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, render } from '@testing-library/react';
import { MinerApp } from '../ui/ui';
import { agentBridge } from './bridge';
import type { GameRuntime } from '../game/game';

/** happy-dom has no canvas raster, so drawing calls go into a black hole. */
function stubCanvasContext(): void {
  const context: unknown = new Proxy({}, {
    get: (_target, key) => (key === 'canvas' ? document.getElementById('game') : () => context),
    set: () => true
  });
  HTMLCanvasElement.prototype.getContext = (() => context) as HTMLCanvasElement['getContext'];
}

let frame: ((now: number) => void) | null = null;
let clock = 1000;

/** Run one animation frame, advancing the clock past several fixed steps. */
function renderFrame(): void {
  act(() => {
    clock += 100;
    frame?.(clock);
  });
}

function currentTick(): number {
  const observation = agentBridge.observe();
  if (!observation) throw new Error('expected a live observation');
  return observation.tick;
}

describe('agent bridge', () => {
  let runtime: GameRuntime;

  beforeAll(async () => {
    stubCanvasContext();
    render(React.createElement(MinerApp));
    vi.stubGlobal('requestAnimationFrame', (callback: (now: number) => void) => {
      frame = callback;
      return 0;
    });
    const { createGameRuntime } = await import('../game/game');
    await act(async () => {
      runtime = createGameRuntime({
        canvas: document.getElementById('game') as HTMLCanvasElement,
        panel: document.getElementById('game-panel') as HTMLElement
      });
    });
  });

  afterAll(() => {
    runtime.dispose();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('registers on boot and observes the ship at the home base', () => {
    const observation = agentBridge.observe();
    expect(observation).not.toBeNull();
    expect(observation?.ship.x).toBe(45);
    expect(observation?.ship.y).toBe(20);
    expect(observation?.ship.atSurface).toBe(true);
    expect(agentBridge.isPaused()).toBe(false);
  });

  it('freezes the tick while paused and does not burst-replay on resume', () => {
    renderFrame();
    renderFrame();
    const before = currentTick();
    renderFrame();
    // Running: the tick moved on with the frames.
    expect(currentTick()).toBeGreaterThan(before);

    agentBridge.setPaused(true);
    expect(agentBridge.isPaused()).toBe(true);
    const frozen = currentTick();
    renderFrame();
    renderFrame();
    // Paused: the fixed step is held even as frames keep painting.
    expect(currentTick()).toBe(frozen);

    agentBridge.setPaused(false);
    // The first frame after resuming only re-anchors the clock, so the frozen gap
    // is discarded rather than replayed in one burst.
    renderFrame();
    expect(currentTick()).toBe(frozen);
    // The next frame steps normally again.
    renderFrame();
    expect(currentTick()).toBeGreaterThan(frozen);
  });

  it('falls back to safe defaults once the runtime is disposed', () => {
    runtime.dispose();
    expect(agentBridge.observe()).toBeNull();
    expect(agentBridge.isPaused()).toBe(false);
    expect(agentBridge.screenPointForTile(45, 20)).toBeNull();
  });
});

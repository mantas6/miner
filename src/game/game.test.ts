// @vitest-environment happy-dom
//
// One integration test for the orchestrator's wiring. The feature modules are
// unit-tested next door with stubs; what cannot be checked that way is the graph
// itself — several dependencies are late-bound closures precisely because the
// module cycle (grid → session → run → enemies → move → input) cannot be
// resolved in one pass. A mistake there is invisible to every other test and
// fatal in the browser, so this boots the real thing once.
//
// The real React tree is mounted too, so the store sync that replaced the old
// per-frame DOM writes is covered end to end: keypress → simulation → store →
// rendered HUD.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { buildShipSlots, uiStore } from '../ui/store';
import { MinerApp } from '../ui/ui';
import type { GameRuntime } from './game';

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

function press(key: string): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
    window.dispatchEvent(new KeyboardEvent('keyup', {key, bubbles: true, cancelable: true}));
  });
}

function click(id: string): void {
  act(() => {
    document.getElementById(id)?.dispatchEvent(new MouseEvent('click', {bubbles: true}));
  });
}

function text(id: string): string | undefined {
  return document.getElementById(id)?.textContent ?? undefined;
}

function dialogOpen(id: string): boolean {
  return (document.getElementById(id) as HTMLDialogElement | null)?.open === true;
}

describe('booting the game', () => {
  let runtime: GameRuntime;

  beforeAll(async () => {
    stubCanvasContext();
    render(React.createElement(MinerApp));
    vi.stubGlobal('requestAnimationFrame', (callback: (now: number) => void) => {
      frame = callback;
      return 0;
    });
    const { createGameRuntime } = await import('./game');
    // The shell is mounted first, then the runtime is built against its elements —
    // the same order `useGameRuntime` uses, without React owning the lifetime here.
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

  it('deploys a fresh drill at the home base and fills the HUD', () => {
    expect(text('toast')).toBe('Fresh drill deployed.');
    expect(text('depth')).toBe('0 m');
    expect(text('cash')).toBe('$60');
    expect(text('fuelLabel')).toBe('100/100');
    // Boot phase: the splash owns the screen alone, with no lobby behind it.
    expect(document.getElementById('intro')).not.toBeNull();
    expect(document.getElementById('lobby-screen')).toBeNull();
  });

  it('walks the splash straight into the run on one press', () => {
    // Keys belong to the splash, so nothing has moved before the press.
    press('s');
    renderFrame();
    expect(text('depth')).toBe('0 m');

    act(() => { fireEvent.pointerDown(document.getElementById('intro')!); });

    // No mode picker in between: the press is the whole answer.
    expect(document.getElementById('intro')).toBeNull();
    expect(document.getElementById('lobby-screen')).toBeNull();
    expect(text('toast')).toContain('Drill ready');
    // The run takes the keyboard, and the canvas is the surface that holds it.
    expect(document.activeElement?.id).toBe('game');
  });

  it('drops the keyboard focus ring on a pointer press but keeps the keys', () => {
    // The canvas holds a keyboard-seeded focus ring (the run took focus at boot).
    // A press on the mine is the mouse taking over, so the ring must go — but the
    // browser only re-decides :focus-visible when focus moves, and this press
    // lands on the already-focused canvas, so the runtime reseats focus itself.
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    canvas.focus();
    expect(document.activeElement).toBe(canvas);

    const blur = vi.spyOn(canvas, 'blur');
    act(() => { fireEvent.pointerDown(canvas); });

    // Reseated as a pointer focus (blur then refocus), so the ring clears while
    // the canvas keeps the keyboard for the mine.
    expect(blur).toHaveBeenCalled();
    expect(document.activeElement).toBe(canvas);
    blur.mockRestore();
  });

  it('runs the whole input → move → terrain → HUD chain on a keypress', () => {
    // The spoken status starts where the ship does, at home base.
    expect(text('game-status')).toBe('At home base.');

    press('s');
    renderFrame();

    // The home base sits on a stone-paved floor (48 hp against a starting drill of
    // 1), so it takes a full slab of presses to break through before the ship drops
    // into the cleared tile — each press spends fuel drilling either way.
    for (let attempt = 0; attempt < 60 && text('depth') === '0 m'; attempt++) {
      press('s');
      renderFrame();
    }

    expect(text('depth')).toBe('10 m');
    expect(text('fuelLabel')).not.toBe('100/100');
    // Leaving the home base is a state change nothing outside the canvas showed before.
    expect(text('game-status')).toBe('In the mine.');
  });

  it('opens and closes the info dialog through the bound controls', () => {
    click('infoBtn');
    expect(dialogOpen('info-screen')).toBe(true);
    expect(text('cargoList')).toContain('Cargo bay empty');

    press('Escape');
    expect(dialogOpen('info-screen')).toBe(false);
  });

  it('opens and closes the ship equipment screen from anywhere', () => {
    click('shipBtn');
    expect(dialogOpen('ship-screen')).toBe(true);
    // The fitting slots come from the store snapshot the game pushes on open.
    expect(document.querySelectorAll('#shipSlots > li').length).toBeGreaterThan(0);

    press('Escape');
    expect(dialogOpen('ship-screen')).toBe(false);
  });

  it('empties the fitted-slot display when a replacement ship deploys', () => {
    // Stand in for a run that fitted an upgrade: the store still paints it.
    act(() => { uiStore.getState().setShipEquipment(buildShipSlots(['upgrade:tank:1', null])); });
    expect(uiStore.getState().shipEquipment.some(slot => slot.kind !== null)).toBe(true);

    // R twice confirms a redeploy; the wreck takes the fitted upgrades with it, so
    // the store must be re-synced to empty slots rather than the dead ship's.
    press('r');
    press('r');
    expect(uiStore.getState().shipEquipment.every(slot => slot.kind === null)).toBe(true);
  });

  // Kept last: this one digs far enough to change cargo and depth for good.
  it('feeds the scanner, the return-fuel forecast and the milestone toast from one dive', () => {
    // Underground there is a climb to pay for, so the fuel gauge splits for it.
    expect(document.getElementById('fuel')?.getAttribute('aria-label')).toContain('after climbing home');
    expect(text('scanner')).toMatch(/^Scanner/);
    expect(text('depthTarget')).toContain('starter Coal/Iron seam');

    // The first landmark is that starter seam, 30 m down.
    for (let attempt = 0; attempt < 200 && text('depth') !== '30 m'; attempt++) {
      press('s');
      renderFrame();
    }

    expect(text('depth')).toBe('30 m');
    expect(text('toast')).toContain('Depth 30 m');
    expect(text('depthTarget')).toBe('↓ 30 m to Copper');
    // 30 m down, the climb home now owns a visible slice of the fuel gauge.
    expect((document.getElementById('fuelReturn') as HTMLElement).style.width).not.toBe('0%');

    // Crossing announces once: the next frame leaves the toast alone.
    act(() => { uiStore.getState().pushToast('Cleared.'); });
    renderFrame();
    expect(text('toast')).toBe('Cleared.');
  });
});

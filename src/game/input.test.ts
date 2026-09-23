// @vitest-environment happy-dom
//
// The keyboard/pointer layer, driven through the real window listeners it
// installs. What matters here is the gating: nothing may reach the simulation
// before the run is live, and after a death a press has to deploy the next ship.
//
// `attach()` returns its own detach, so each harness's listeners are dropped again
// after the test that installed them — the same counterpart the runtime uses to
// survive being remounted.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../core/state';
import type { GameState } from '../core/types';
import { uiStore } from '../ui/store';
import type { GameActions } from './actions';
import { createInput, type GameInput } from './input';
import { setViewportZoom, viewport } from './viewport';
import { MAX_ZOOM, MIN_ZOOM } from './zoom';

function createActionsSpy() {
  return {
    useTeleporter: vi.fn(),
    useRepairKit: vi.fn()
  } satisfies GameActions;
}

interface Harness {
  state: GameState;
  input: GameInput;
  actions: ReturnType<typeof createActionsSpy>;
  move: ReturnType<typeof vi.fn>;
  restartGame: ReturnType<typeof vi.fn>;
  closeShipScreen: ReturnType<typeof vi.fn>;
  closeInfoScreen: ReturnType<typeof vi.fn>;
  cancelPlacement: ReturnType<typeof vi.fn>;
  toggleDynamitePlacement: ReturnType<typeof vi.fn>;
  toggleContainer: ReturnType<typeof vi.fn>;
  closeContainer: ReturnType<typeof vi.fn>;
  closeWreck: ReturnType<typeof vi.fn>;
  openNearest: ReturnType<typeof vi.fn>;
  closeStation: ReturnType<typeof vi.fn>;
  closeExtractor: ReturnType<typeof vi.fn>;
  toast: ReturnType<typeof vi.fn>;
  tryAutoAudio: ReturnType<typeof vi.fn>;
}

const detachers: (() => void)[] = [];

afterEach(() => {
  for (const detach of detachers.splice(0)) detach();
});

function harness(): Harness {
  const context = {
    state: createInitialState(),
    actions: createActionsSpy(),
    move: vi.fn(),
    restartGame: vi.fn(),
    closeShipScreen: vi.fn(),
    closeInfoScreen: vi.fn(),
    // Nothing armed by default, so Escape stays as unhandled as it ever was.
    cancelPlacement: vi.fn(() => false),
    toggleDynamitePlacement: vi.fn(),
    toggleContainer: vi.fn(),
    closeContainer: vi.fn(),
    closeWreck: vi.fn(),
    openNearest: vi.fn(),
    closeStation: vi.fn(),
    closeExtractor: vi.fn(),
    closeTrade: vi.fn(),
    toast: vi.fn(),
    tryAutoAudio: vi.fn()
  };
  const input = createInput({
    ...context,
    isOpenMovementDestination: () => true
  });
  detachers.push(input.attach());
  return {...context, input};
}

function press(key: string, target: EventTarget = window): void {
  target.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
}

function release(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keyup', {key, bubbles: true, cancelable: true}));
}

function pointerDown(target: EventTarget = document.body): void {
  target.dispatchEvent(new Event('pointerdown', {bubbles: true, cancelable: true}));
}

beforeEach(() => {
  uiStore.getState().setPhase('intro');
  uiStore.getState().setActiveOverlay(null);
  document.body.innerHTML = '';
});

describe('phase gating', () => {
  it('ignores keys on the splash, then obeys them in the run', () => {
    const h = harness();

    press('s');
    h.input.tick();
    expect(h.move).not.toHaveBeenCalled();

    uiStore.getState().setPhase('playing');
    press('s');
    h.input.tick();
    expect(h.move).toHaveBeenCalledWith(0, 1, false);
  });

  it('keeps counting ticks before the run so enemy cooldowns stay coherent', () => {
    const h = harness();

    h.input.tick();
    h.input.tick();

    expect(h.state.tick).toBe(2);
  });

  it('leaves held keys behind when the run starts', () => {
    const h = harness();

    // Pressed while the splash was up: never recorded, so nothing auto-repeats.
    press('d');
    uiStore.getState().setPhase('playing');
    h.input.tick();

    expect(h.move).not.toHaveBeenCalled();
  });

  it('routes Escape to whichever dialog is open', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');

    uiStore.getState().setActiveOverlay('ship');
    press('Escape');
    expect(h.closeShipScreen).toHaveBeenCalledOnce();

    // Opening the other overlay replaces the ship screen rather than stacking on
    // it, so Escape only ever reaches one of them.
    uiStore.getState().setActiveOverlay('info');
    press('Escape');
    expect(h.closeInfoScreen).toHaveBeenCalledOnce();
    expect(h.closeShipScreen).toHaveBeenCalledOnce();

    uiStore.getState().setActiveOverlay('container');
    press('Escape');
    expect(h.closeContainer).toHaveBeenCalledOnce();
    expect(h.closeInfoScreen).toHaveBeenCalledOnce();

    uiStore.getState().setActiveOverlay('station');
    press('Escape');
    expect(h.closeStation).toHaveBeenCalledOnce();

    uiStore.getState().setActiveOverlay('extractor');
    press('Escape');
    expect(h.closeExtractor).toHaveBeenCalledOnce();
  });
});

describe('the home-station key', () => {
  it('opens the nearest station on Space, and shuts the open one instead of moving', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');

    press(' ');
    expect(h.openNearest).toHaveBeenCalledOnce();

    // With the station screen up, Space is the round trip: it closes, and no move.
    uiStore.getState().setActiveOverlay('station');
    press(' ');
    press('d');
    h.input.tick();
    expect(h.closeStation).toHaveBeenCalledOnce();
    expect(h.openNearest).toHaveBeenCalledOnce();
    expect(h.move).not.toHaveBeenCalled();
  });
});

describe('the boost gate', () => {
  it('only sprints on Shift once a Booster is fitted', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');

    // No booster fitted: Shift is inert, so the move is unboosted.
    press('Shift');
    press('d');
    h.input.tick();
    expect(h.move).toHaveBeenLastCalledWith(1, 0, false);
    expect(h.state.input.sprintDirection).toBeNull();

    // Fit a booster and the same held Shift now sprints.
    h.state.player.boost = true;
    h.state.input.lastKeyboardMove = 0;
    h.input.tick();
    expect(h.move).toHaveBeenLastCalledWith(1, 0, true);
    expect(h.state.input.sprintDirection).toEqual([1, 0]);
  });
});

describe('the cargo container key', () => {
  it('opens the crate under the ship on C, once per press, and only during a run', () => {
    const h = harness();

    press('c');
    expect(h.toggleContainer).not.toHaveBeenCalled();

    uiStore.getState().setPhase('playing');
    press('c');
    expect(h.toggleContainer).toHaveBeenCalledOnce();
    // Holding the key down must not open and shut it over and over.
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'c', repeat: true, bubbles: true, cancelable: true}));
    expect(h.toggleContainer).toHaveBeenCalledOnce();
  });

  it('shuts the open menu rather than reopening it, and never moves the ship', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');
    uiStore.getState().setActiveOverlay('container');

    press('c');
    press('d');
    h.input.tick();

    expect(h.closeContainer).toHaveBeenCalledOnce();
    expect(h.toggleContainer).not.toHaveBeenCalled();
    expect(h.move).not.toHaveBeenCalled();
  });
});

describe('deployable placement keys', () => {
  it('arms dynamite on E, once per press, and only during a run', () => {
    const h = harness();

    press('e');
    expect(h.toggleDynamitePlacement).not.toHaveBeenCalled();

    uiStore.getState().setPhase('playing');
    press('e');
    expect(h.toggleDynamitePlacement).toHaveBeenCalledOnce();
    // Holding the key down must not toggle it back off again.
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'e', repeat: true, bubbles: true, cancelable: true}));
    expect(h.toggleDynamitePlacement).toHaveBeenCalledOnce();
  });

  it('lets Escape stand an armed deployable down, and otherwise leaves it alone', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');

    const ignored = new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true});
    window.dispatchEvent(ignored);
    expect(h.cancelPlacement).toHaveBeenCalledOnce();
    expect(ignored.defaultPrevented).toBe(false);

    h.cancelPlacement.mockReturnValue(true);
    const consumed = new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true});
    window.dispatchEvent(consumed);
    expect(consumed.defaultPrevented).toBe(true);
  });
});

describe('restarting after a death', () => {
  it('deploys the next ship on a press, but only once the ship is gone', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');

    pointerDown();
    expect(h.restartGame).not.toHaveBeenCalled();

    h.state.gameOver = true;
    pointerDown();
    expect(h.restartGame).toHaveBeenCalledOnce();
    // The same press is the browser's chance to unlock audio.
    expect(h.tryAutoAudio).toHaveBeenCalledOnce();
  });

  it('ignores presses inside the info dialog', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');
    h.state.gameOver = true;
    document.body.innerHTML = '<dialog id="info-screen"><button id="infoCloseBtn">Close</button></dialog>';

    pointerDown(document.getElementById('infoCloseBtn')!);

    expect(h.restartGame).not.toHaveBeenCalled();
  });

  it('never restarts from a press on the splash', () => {
    const h = harness();
    h.state.gameOver = true;

    pointerDown();

    expect(h.restartGame).not.toHaveBeenCalled();
  });

  it('restarts on R at once after death, and asks twice mid-run', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');

    press('r');
    expect(h.restartGame).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Press R again'));

    press('r');
    expect(h.restartGame).toHaveBeenCalledOnce();

    h.state.gameOver = true;
    h.input.reset();
    press('r');
    expect(h.restartGame).toHaveBeenCalledTimes(2);
  });
});

describe('wheel zoom', () => {
  /**
   * Every harness in this file leaves its wheel listener attached, so one event
   * can be handled several times over. Only the direction of the change and the
   * cancellation are asserted, never the size of a single notch.
   */
  function gameSurface(): HTMLElement {
    document.body.innerHTML = '<section id="game-panel"><canvas id="game"></canvas>'
      + '<dialog id="info-screen"><div id="infoBody">Info</div></dialog></section>';
    return document.getElementById('game')!;
  }

  function wheel(target: EventTarget, init: {deltaY: number; ctrlKey?: boolean}): Event {
    const event = new WheelEvent('wheel', {...init, bubbles: true, cancelable: true});
    target.dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
    setViewportZoom(1);
  });

  it('zooms in on scroll up and out on scroll down, and swallows the scroll', () => {
    harness();
    uiStore.getState().setPhase('playing');
    const canvas = gameSurface();

    const zoomIn = wheel(canvas, {deltaY: -120});
    expect(viewport.targetZoom).toBeGreaterThan(1);
    expect(zoomIn.defaultPrevented).toBe(true);

    setViewportZoom(1);
    wheel(canvas, {deltaY: 120});
    expect(viewport.targetZoom).toBeLessThan(1);
  });

  it('treats a trackpad pinch as zoom, so the browser never zooms the page', () => {
    harness();
    uiStore.getState().setPhase('playing');
    const canvas = gameSurface();

    const pinch = wheel(canvas, {deltaY: -8, ctrlKey: true});

    expect(pinch.defaultPrevented).toBe(true);
    expect(viewport.targetZoom).toBeGreaterThan(1);
  });

  it('stays inside the supported range however hard the wheel is spun', () => {
    harness();
    uiStore.getState().setPhase('playing');
    const canvas = gameSurface();

    for (let i = 0; i < 60; i++) wheel(canvas, {deltaY: -240});
    expect(viewport.targetZoom).toBe(MAX_ZOOM);

    for (let i = 0; i < 60; i++) wheel(canvas, {deltaY: 240});
    expect(viewport.targetZoom).toBe(MIN_ZOOM);
  });

  it('leaves scrolling alone before the run, in the dialogs, and off the game surface', () => {
    const h = harness();
    const canvas = gameSurface();

    const beforeRun = wheel(canvas, {deltaY: -120});
    expect(beforeRun.defaultPrevented).toBe(false);
    expect(viewport.targetZoom).toBe(1);

    uiStore.getState().setPhase('playing');
    uiStore.getState().setActiveOverlay('info');
    wheel(document.getElementById('infoBody')!, {deltaY: -120});
    expect(viewport.targetZoom).toBe(1);

    uiStore.getState().setActiveOverlay(null);
    wheel(document.body, {deltaY: -120});
    expect(viewport.targetZoom).toBe(1);

    // …and the surface itself still zooms, so the gates above are not vacuous.
    wheel(canvas, {deltaY: -120});
    expect(viewport.targetZoom).toBeGreaterThan(1);
    expect(h.move).not.toHaveBeenCalled();
  });
});

describe('held keys', () => {
  it('auto-repeats a held direction and stops on release', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');

    press('a');
    h.input.tick();
    expect(h.move).toHaveBeenCalledWith(-1, 0, false);

    h.state.input.lastKeyboardMove = 0;
    h.input.tick();
    expect(h.move).toHaveBeenCalledTimes(2);

    release('a');
    h.state.input.lastKeyboardMove = 0;
    h.input.tick();
    expect(h.move).toHaveBeenCalledTimes(2);
  });
});

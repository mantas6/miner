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
import { createInput, RESET_CONFIRM_TICKS, type GameInput } from './input';
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
  closeChest: ReturnType<typeof vi.fn>;
  closeGrave: ReturnType<typeof vi.fn>;
  openNearest: ReturnType<typeof vi.fn>;
  closeStation: ReturnType<typeof vi.fn>;
  closePortal: ReturnType<typeof vi.fn>;
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
    closeChest: vi.fn(),
    closeGrave: vi.fn(),
    openNearest: vi.fn(),
    closeStation: vi.fn(),
    closeTrade: vi.fn(),
    closePortal: vi.fn(),
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

    // Both home-station screens shut through the one close.
    uiStore.getState().setActiveOverlay('extractor');
    press('Escape');
    expect(h.closeStation).toHaveBeenCalledTimes(2);
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

describe('the grave stone', () => {
  it('puts the stone away on Escape, Enter or Space, and keeps the keys off the mine', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');
    uiStore.getState().setActiveOverlay('grave');

    press('Escape');
    press('Enter');
    press(' ');
    press('d');
    press('c');
    h.input.tick();

    expect(h.closeGrave).toHaveBeenCalledTimes(3);
    expect(h.openNearest).not.toHaveBeenCalled();
    expect(h.toggleContainer).not.toHaveBeenCalled();
    expect(h.move).not.toHaveBeenCalled();
  });

  it('does not put away the stone a held Space just raised', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');
    uiStore.getState().setActiveOverlay('grave');

    window.dispatchEvent(new KeyboardEvent('keydown', {key: ' ', repeat: true, bubbles: true, cancelable: true}));

    expect(h.closeGrave).not.toHaveBeenCalled();
    expect(h.openNearest).not.toHaveBeenCalled();
  });
});

describe('the editable-element guard', () => {
  it('ignores keys while a text field is focused, and Escape blurs it back to the game', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    expect(document.activeElement).toBe(field);

    // A movement key typed into the field must not also drive the ship.
    press('s', field);
    h.input.tick();
    expect(h.move).not.toHaveBeenCalled();

    // Escape is the way out: it drops focus so the keys return to the mine.
    press('Escape', field);
    expect(document.activeElement).not.toBe(field);
  });

  it('keeps the overlay open on an Escape that only leaves the field', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');
    uiStore.getState().setPortalUi({mode: 'travel', destinations: []});
    uiStore.getState().setActiveOverlay('portal');
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();

    const escape = new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true});
    field.dispatchEvent(escape);

    // Swallowed, so the UA does not also turn it into the dialog's close request…
    expect(escape.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(field);
    // …and the game's own close did not run either. The next Escape is the dialog's.
    expect(h.closePortal).not.toHaveBeenCalled();
    press('Escape');
    expect(h.closePortal).toHaveBeenCalledOnce();
  });

  it('lets go of a key released inside a text field', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');
    press('d');
    h.input.tick();
    expect(h.move).toHaveBeenCalledOnce();

    // Focus moves into a field with the key still down; its release lands there.
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    field.dispatchEvent(new KeyboardEvent('keyup', {key: 'd', bubbles: true, cancelable: true}));
    field.blur();

    h.state.input.lastKeyboardMove = 0;
    h.input.tick();
    expect(h.move).toHaveBeenCalledOnce();
  });
});

describe('focused controls', () => {
  it('leaves Space and Enter on a focused button to the button', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

    const down = new KeyboardEvent('keydown', {key: ' ', bubbles: true, cancelable: true});
    button.dispatchEvent(down);
    const up = new KeyboardEvent('keyup', {key: ' ', bubbles: true, cancelable: true});
    button.dispatchEvent(up);
    press('Enter', button);

    // Neither half of the press was cancelled, so the button still activates…
    expect(down.defaultPrevented).toBe(false);
    expect(up.defaultPrevented).toBe(false);
    // …and the station behind it was not toggled as well.
    expect(h.openNearest).not.toHaveBeenCalled();
  });

  it('leaves Space on a focused button in an open screen to that button', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');
    uiStore.getState().setActiveOverlay('station');
    const button = document.createElement('button');
    button.id = 'stowAllBtn';
    document.body.appendChild(button);
    button.focus();

    press(' ', button);

    expect(h.closeStation).not.toHaveBeenCalled();
    // Space from anywhere else in the screen is still the round trip.
    press(' ');
    expect(h.closeStation).toHaveBeenCalledOnce();
  });

});

describe('the portal overlay', () => {
  it('closes on Escape/Space in travel mode but ignores them in respawn mode', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');
    uiStore.getState().setPortalUi({mode: 'travel', destinations: []});
    uiStore.getState().setActiveOverlay('portal');

    press('Escape');
    expect(h.closePortal).toHaveBeenCalledOnce();

    // The respawn prompt has no way out but a pick: Escape and Space are swallowed.
    uiStore.getState().setPortalUi({mode: 'respawn', destinations: []});
    press('Escape');
    press(' ');
    expect(h.closePortal).toHaveBeenCalledOnce();
  });

  it('suppresses the restart tap while any overlay is open', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');
    h.state.gameOver = true;
    uiStore.getState().setActiveOverlay('portal');

    pointerDown();

    expect(h.restartGame).not.toHaveBeenCalled();
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

  it('shuts an open chest on C or Escape, and keeps the keys off the mine', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');
    uiStore.getState().setActiveOverlay('chest');

    press('c');
    press('Escape');
    press('d');
    h.input.tick();

    expect(h.closeChest).toHaveBeenCalledTimes(2);
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
    uiStore.getState().setActiveOverlay('info');
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

  it('lets the R confirm window lapse on sim ticks, not wall-clock time', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');

    // A paused sim: a minute of wall clock passes but no ticks, so it still confirms.
    press('r');
    const now = performance.now();
    const clock = vi.spyOn(performance, 'now').mockReturnValue(now + 60_000);
    press('r');
    clock.mockRestore();
    expect(h.restartGame).toHaveBeenCalledOnce();
    h.input.reset(); // what the real restart does

    // Run the sim through the whole window: the second press only asks again.
    press('r');
    for (let i = 0; i < RESET_CONFIRM_TICKS; i++) h.input.tick();
    press('r');
    expect(h.restartGame).toHaveBeenCalledOnce();
    expect(h.toast).toHaveBeenCalledTimes(3);

    // One tick short of that fresh deadline, a press still confirms.
    for (let i = 0; i < RESET_CONFIRM_TICKS - 1; i++) h.input.tick();
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

  it('steps the zoom on + / = and -, holding at the ends of the range', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');

    press('+');
    expect(viewport.targetZoom).toBe(1.25);
    press('=');
    expect(viewport.targetZoom).toBe(1.5);
    press('-');
    press('-');
    press('-');
    expect(viewport.targetZoom).toBe(0.75);
    for (let i = 0; i < 5; i++) press('-');
    expect(viewport.targetZoom).toBe(MIN_ZOOM);
    for (let i = 0; i < 10; i++) press('+');
    expect(viewport.targetZoom).toBe(MAX_ZOOM);
    expect(h.move).not.toHaveBeenCalled();
  });

  it('leaves the zoom keys alone on the splash, under an overlay, and with a modifier held', () => {
    harness();
    press('+');
    expect(viewport.targetZoom).toBe(1);

    uiStore.getState().setPhase('playing');
    uiStore.getState().setActiveOverlay('info');
    press('+');
    expect(viewport.targetZoom).toBe(1);

    uiStore.getState().setActiveOverlay(null);
    // Ctrl + `=` is the browser's own page zoom.
    const browserZoom = new KeyboardEvent('keydown', {key: '=', ctrlKey: true, bubbles: true, cancelable: true});
    window.dispatchEvent(browserZoom);
    expect(viewport.targetZoom).toBe(1);
    expect(browserZoom.defaultPrevented).toBe(false);
  });
});

describe('held keys', () => {
  it('stops a held direction the moment an overlay opens, and does not resume it', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');

    press('d');
    h.input.tick();
    expect(h.move).toHaveBeenCalledOnce();

    // The key is still down when the screen rises: nothing moves under it.
    uiStore.getState().setActiveOverlay('station');
    h.state.input.lastKeyboardMove = 0;
    h.input.tick();
    expect(h.move).toHaveBeenCalledOnce();

    // What the game does as it raises an overlay: forget what was held, so putting
    // the screen away does not drive the ship off on a key released behind it.
    h.input.clearKeys();
    uiStore.getState().setActiveOverlay(null);
    h.state.input.lastKeyboardMove = 0;
    h.input.tick();
    expect(h.move).toHaveBeenCalledOnce();
  });

  it('drops a queued impulse when an overlay covers the mine', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');

    press('s');
    uiStore.getState().setActiveOverlay('ship');
    h.input.tick();
    uiStore.getState().setActiveOverlay(null);
    release('s');
    h.input.tick();

    expect(h.move).not.toHaveBeenCalled();
  });

  it('forgets every held key when the window loses focus', () => {
    const h = harness();
    uiStore.getState().setPhase('playing');

    press('a');
    h.input.tick();
    expect(h.move).toHaveBeenCalledOnce();

    // The keyup for a key released in another window never arrives here.
    window.dispatchEvent(new Event('blur'));
    h.state.input.lastKeyboardMove = 0;
    h.input.tick();
    expect(h.move).toHaveBeenCalledOnce();
  });

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

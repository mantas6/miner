// Keyboard, wheel-zoom, and restart-pointer handling.
//
// Owns the held-key set (input state, deliberately not part of the DOM layer),
// the impulse/auto-repeat rules that turn key presses into moves, and the
// dialog/action key routing. A single window-level capture listener per
// event type is enough: window is the first node of every capture path, so a
// handler there sees the key before any dialog or canvas listener.
//
// Nothing here reacts before the run is live: the store's `phase` gates the whole
// module, so the splash and the lobby own their own keys and presses. Which
// dialog is up is read from the same store rather than from class names, and Tab
// containment is the modal `<dialog>`'s job now, not ours.

import { activeSprintDirection, keyboardMovementRepeatMs } from '../core/movement';
import type { Direction, GameState } from '../core/types';
import { uiStore, type OverlayId } from '../ui/store';
import { requestViewportZoom, viewport } from './viewport';
import { zoomAfterWheel } from './zoom';
import type { GameActions } from './actions';

/**
 * Grace window, in sim ticks (~3.5 s at 60 tps), in which a second R press
 * confirms resetting a live run. Counted in ticks rather than wall-clock time so
 * it runs on the sim's clock: a paused sim (the agent harness between decisions)
 * holds the window open instead of letting it lapse unseen.
 */
export const RESET_CONFIRM_TICKS = 210;

/** The mine is the only surface that scrolls; the dialogs above it keep their own. */
const ZOOM_SURFACE = '#game-panel';

/**
 * Controls that answer Space/Enter themselves. A keyboard press on one of these is
 * the control's (a focused Stow all, a tab, the rename field), never the mine's
 * station toggle as well.
 */
const SELF_ACTIVATING = 'button, input, [role=tab], a';

const movementKeys: Record<string, Direction> = {
  arrowleft: [-1, 0], a: [-1, 0],
  arrowright: [1, 0], d: [1, 0],
  arrowup: [0, -1], w: [0, -1],
  arrowdown: [0, 1], s: [0, 1]
};

/** Held-key priority when several directions are down at once. */
const HELD_DIRECTIONS: {keys: string[]; direction: Direction}[] = [
  {keys: ['arrowleft', 'a'], direction: [-1, 0]},
  {keys: ['arrowright', 'd'], direction: [1, 0]},
  {keys: ['arrowup', 'w'], direction: [0, -1]},
  {keys: ['arrowdown', 's'], direction: [0, 1]}
];

export interface GameInput {
  /** One simulation step of keyboard movement: impulse first, then auto-repeat. */
  tick(): void;
  /**
   * Forget held keys (and a queued impulse), so a key held when an overlay rose or
   * the window lost focus does not keep driving the ship once it is back.
   */
  clearKeys(): void;
  /** Drop every scrap of keyboard/aim state (restart, world reset). */
  reset(): void;
  /**
   * Register the window-level keyboard and restart-pointer listeners, returning
   * the detach function. Every listener has to be revocable: React may remount
   * the runtime (StrictMode, Fast Refresh), and a second set of capture handlers
   * would double every keypress.
   */
  attach(): () => void;
}

export interface GameInputDeps {
  state: GameState;
  actions: GameActions;
  /** Attempt a move; the same entry point the loop uses. */
  move(dx: number, dy: number, sprinting: boolean): void;
  /** Whether the ship would fly (not drill) into this direction's destination. */
  isOpenMovementDestination(dx: number, dy: number): boolean;
  restartGame(): void;
  closeShipScreen(): void;
  closeInfoScreen(): void;
  /** Stand down anything armed for placement. Reports whether the press was consumed. */
  cancelPlacement(): boolean;
  /** E: arm a carried stick of dynamite for planting, or stand it down again. */
  toggleDynamitePlacement(): void;
  /** C: open the cargo container under or beside the ship, or shut the open one. */
  toggleContainer(): void;
  /** Escape while the transfer menu is up. */
  closeContainer(): void;
  /** Escape/C while the wreck salvage menu is up. */
  closeWreck(): void;
  /** Escape/C while a chest's menu is up. */
  closeChest(): void;
  /** Escape/Enter/Space while a grave's stone is up. */
  closeGrave(): void;
  /** Space: open the nearest home station, or toggle the open one shut. */
  openNearest(): void;
  /** Escape/Space while a home-station screen (manufacturer or extractor) is up. */
  closeStation(): void;
  /** Escape/Space while the trading-post screen is up. */
  closeTrade(): void;
  /** Escape/Space while the portal overlay is up (ignored in respawn mode). */
  closePortal(): void;
  toast(message: string): void;
  /** Enable sound on the first trusted gesture, when the browser allows it. */
  tryAutoAudio(event?: Event): void;
}

export function createInput(deps: GameInputDeps): GameInput {
  const {state, actions} = deps;
  /** Lower-cased keys currently held down. */
  const keys = new Set<string>();

  function clearKeys(): void {
    keys.clear();
    state.input.keyImpulse = null;
  }

  /**
   * What each overlay answers on the keyboard while it is up: the keys that shut it
   * and how. Every other key is swallowed by the overlay rather than reaching the
   * mine. `locked` vetoes the close (the respawn prompt has no way out but a pick)
   * while still keeping its keys off the mine.
   *
   * Space opened the station-like screens and Space shuts them again — the round
   * trip on one key; C does the same for the crate, the wreck and the chest. The
   * grave's one OK is the whole stone, so every dismissal key is it.
   */
  const OVERLAY_KEYS: Record<OverlayId, {keys: string[]; close: () => void; locked?: () => boolean}> = {
    ship: {keys: ['escape'], close: () => deps.closeShipScreen()},
    info: {keys: ['escape'], close: () => deps.closeInfoScreen()},
    container: {keys: ['escape', 'c'], close: () => deps.closeContainer()},
    wreck: {keys: ['escape', 'c'], close: () => deps.closeWreck()},
    chest: {keys: ['escape', 'c'], close: () => deps.closeChest()},
    grave: {keys: ['escape', 'enter', ' '], close: () => deps.closeGrave()},
    station: {keys: ['escape', ' '], close: () => deps.closeStation()},
    extractor: {keys: ['escape', ' '], close: () => deps.closeStation()},
    trade: {keys: ['escape', ' '], close: () => deps.closeTrade()},
    portal: {keys: ['escape', ' '], close: () => deps.closePortal(), locked: () => uiStore.getState().portal?.mode === 'respawn'}
  };

  function reset(): void {
    keys.clear();
    state.input.resetConfirmUntil = 0;
    state.input.keyImpulse = null;
    state.input.sprintDirection = null;
    state.input.sprintMomentum = null;
    state.input.lastKeyboardMove = 0;
  }

  function heldKeyDirection(): Direction | null {
    for (const {keys: candidates, direction} of HELD_DIRECTIONS) {
      if (candidates.some(key => keys.has(key))) return direction;
    }
    return null;
  }

  /** R resets a finished run outright, but asks for confirmation mid-run. */
  function requestReset(): void {
    if (state.gameOver) { deps.restartGame(); return; }
    if (state.tick < state.input.resetConfirmUntil) {
      deps.restartGame();
      return;
    }
    state.input.resetConfirmUntil = state.tick + RESET_CONFIRM_TICKS;
    deps.toast('Press R again to reset progress in this run.');
  }

  function isPlaying(): boolean {
    return uiStore.getState().phase === 'playing';
  }

  function tick(): void {
    state.tick++;
    state.input.sprintDirection = null;
    if (!isPlaying()) return;
    // An overlay covers the mine: nothing held or queued may drive the ship under it.
    if (uiStore.getState().activeOverlay !== null) {
      state.input.keyImpulse = null;
      return;
    }
    const now = performance.now();
    // Shift only sprints with a Booster fitted; without one the key does nothing.
    const sprinting = keys.has('shift') && state.player.boost;
    const impulse = state.input.keyImpulse;
    if (impulse) {
      state.input.keyImpulse = null;
      state.input.lastKeyboardMove = now;
      state.input.sprintDirection = activeSprintDirection(!state.gameOver && sprinting, deps.isOpenMovementDestination(impulse[0], impulse[1]), impulse[0], impulse[1]);
      deps.move(impulse[0], impulse[1], sprinting);
      return;
    }
    const held = heldKeyDirection();
    const destinationOpen = held ? deps.isOpenMovementDestination(held[0], held[1]) : false;
    if (held) state.input.sprintDirection = activeSprintDirection(!state.gameOver && sprinting, destinationOpen, held[0], held[1]);
    if (held && now - state.input.lastKeyboardMove >= keyboardMovementRepeatMs(state.input.keyboardRepeatMs, sprinting, destinationOpen)) {
      state.input.lastKeyboardMove = now;
      deps.move(held[0], held[1], sprinting);
    }
  }

  /** Whether keystrokes belong to a focused text field, not the mine. */
  function editingText(): boolean {
    const active = document.activeElement;
    return active !== null && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
  }

  /** Whether a Space/Enter press belongs to the focused control it landed on. */
  function isControlActivation(e: KeyboardEvent): boolean {
    if (e.key !== ' ' && e.key !== 'Enter') return false;
    const target = e.target as Element | null;
    return typeof target?.closest === 'function' && target.closest(SELF_ACTIVATING) !== null;
  }

  function handleKeyDown(e: KeyboardEvent): void {
    // A focused text field — the portal rename input — owns its own keystrokes, so
    // the mine must not also drive on them. Escape is the way out: it blurs the
    // field first, handing the keyboard back to the game, and swallows this press
    // so the UA does not also turn it into a close request for the dialog.
    if (editingText()) {
      if (e.key === 'Escape') {
        (document.activeElement as HTMLElement).blur();
        e.preventDefault();
      }
      return;
    }
    // Space/Enter on a focused button, tab or link is that control's activation;
    // it must not also toggle the station behind it.
    if (isControlActivation(e)) return;
    // Keyboard movement must work even before the browser grants audio permission.
    // Audio can still be enabled with the HUD buttons or any pointer/touch input.
    const key = e.key.toLowerCase();
    const ui = uiStore.getState();
    // The splash and the lobby are React's; they handle their own keys.
    if (ui.phase !== 'playing') return;
    if (ui.activeOverlay !== null) {
      const overlay = OVERLAY_KEYS[ui.activeOverlay];
      if (!overlay.keys.includes(key)) return;
      // Handled here so the dialog closes through the same path as its buttons;
      // preventDefault keeps the UA from also firing its own close request. A held
      // key auto-repeats, and must not shut the screen its first press just raised.
      if (!e.repeat && !overlay.locked?.()) overlay.close();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const dir = movementKeys[key];
    if (key === 'shift') {
      keys.add(key);
      return;
    }
    // Only an armed device consumes Escape, and a stray Escape on the mine keeps
    // meaning nothing.
    if (key === 'escape' && deps.cancelPlacement()) { e.preventDefault(); e.stopPropagation(); return; }
    if (dir) {
      if (e.shiftKey) keys.add('shift');
      if (!keys.has(key) && !e.repeat) state.input.keyImpulse = dir;
      keys.add(key);
      e.preventDefault();
      return;
    }
    // Space opens whichever station-like thing the ship is parked beside — a home
    // station, a trading post, or a grave.
    if (key === ' ') { if (!e.repeat) deps.openNearest(); e.preventDefault(); e.stopPropagation(); return; }
    // E is the shortcut for the dynamite slot, not a detonator: it arms a stick
    // for planting, and the press on the mine that follows is what lights it.
    if (key === 'e') { if (!e.repeat) deps.toggleDynamitePlacement(); e.preventDefault(); e.stopPropagation(); return; }
    if (key === 't') { if (!e.repeat) actions.useTeleporter(); e.preventDefault(); e.stopPropagation(); return; }
    if (key === 'c') { if (!e.repeat) deps.toggleContainer(); e.preventDefault(); e.stopPropagation(); return; }
    if (key === 'r') { if (!e.repeat) requestReset(); e.preventDefault(); e.stopPropagation(); }
  }

  function handleKeyUp(e: KeyboardEvent): void {
    // A release always lets go of the key, even inside a text field: a direction
    // held into the rename input must not stay down once it is released there.
    keys.delete(e.key.toLowerCase());
    // A focused text field owns its keystrokes; leave the rest of its releases to it.
    if (editingText()) return;
    // Space on a focused button fires its click on keyup, so it has to reach it.
    if (isControlActivation(e)) return;
    if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); }
  }

  /**
   * Wheel and trackpad pinch both zoom the mine. Nothing on the game surface
   * scrolls, so the default is always cancelled — which is also what stops a
   * ctrl-held pinch from zooming the whole browser page instead.
   */
  function handleWheel(e: WheelEvent): void {
    if (!isPlaying()) return;
    if (uiStore.getState().activeOverlay !== null) return;
    const target = e.target as Element | null;
    if (!target?.closest || !target.closest(ZOOM_SURFACE)) return;
    e.preventDefault();
    // Accumulate against the requested level, not the easing one, so a fast
    // scroll is not swallowed by the frames it takes the view to settle.
    requestViewportZoom(zoomAfterWheel(viewport.targetZoom, e));
  }

  /** Tap/click anywhere outside the dialogs to deploy a replacement ship. */
  function handleRestartPointer(e: Event): void {
    if (!isPlaying() || !state.gameOver) return;
    // An overlay owns its own presses — above all the no-close respawn prompt,
    // where a tap anywhere must not bypass the redeploy choice into a home restart.
    if (uiStore.getState().activeOverlay !== null) return;
    deps.tryAutoAudio(e);
    deps.restartGame();
    e.preventDefault();
    e.stopPropagation();
  }

  function attach(): () => void {
    const capture = {capture: true};
    // Active listeners: a passive one may not cancel the browser's page zoom, and
    // touch needs one so the synthetic click can be suppressed.
    const activeCapture = {capture: true, passive: false};
    addEventListener('keydown', handleKeyDown, capture);
    addEventListener('keyup', handleKeyUp, capture);
    addEventListener('pointerdown', handleRestartPointer, capture);
    addEventListener('wheel', handleWheel, activeCapture);
    addEventListener('touchstart', handleRestartPointer, activeCapture);
    // A key released while another window has focus never sends its keyup here.
    addEventListener('blur', clearKeys);

    return () => {
      removeEventListener('keydown', handleKeyDown, capture);
      removeEventListener('keyup', handleKeyUp, capture);
      removeEventListener('pointerdown', handleRestartPointer, capture);
      removeEventListener('wheel', handleWheel, activeCapture);
      removeEventListener('touchstart', handleRestartPointer, activeCapture);
      removeEventListener('blur', clearKeys);
    };
  }

  return {tick, clearKeys, reset, attach};
}

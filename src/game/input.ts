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
import { uiStore } from '../ui/store';
import { requestViewportZoom, viewport } from './viewport';
import { zoomAfterWheel } from './zoom';
import type { GameActions } from './actions';

/** Grace window (ms) in which a second R press confirms resetting a live run. */
const RESET_CONFIRM_MS = 3500;

/** The mine is the only surface that scrolls; the dialogs above it keep their own. */
const ZOOM_SURFACE = '#game-panel';
const DIALOG_SURFACES = '#info-screen, #cargo-screen, #ship-screen, #station-screen, #extractor-screen, #trade-screen';

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
  /** Forget held keys, so a modal action does not resume movement afterwards. */
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
  /** Space: open the nearest home station, or toggle the open one shut. */
  openNearest(): void;
  /** Escape/Space while the manufacturing station screen is up. */
  closeStation(): void;
  /** Escape/Space while the oil extractor screen is up. */
  closeExtractor(): void;
  /** Escape/Space while the trading-post screen is up. */
  closeTrade(): void;
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
  }

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
    const now = performance.now();
    if (now < state.input.resetConfirmUntil) {
      deps.restartGame();
      return;
    }
    state.input.resetConfirmUntil = now + RESET_CONFIRM_MS;
    deps.toast('Press R again to reset progress in this run.');
  }

  function isPlaying(): boolean {
    return uiStore.getState().phase === 'playing';
  }

  function tick(): void {
    state.tick++;
    state.input.sprintDirection = null;
    if (!isPlaying()) return;
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

  function handleKeyDown(e: KeyboardEvent): void {
    // Keyboard movement must work even before the browser grants audio permission.
    // Audio can still be enabled with the HUD buttons or any pointer/touch input.
    const key = e.key.toLowerCase();
    const ui = uiStore.getState();
    // The splash and the lobby are React's; they handle their own keys.
    if (ui.phase !== 'playing') return;
    if (ui.activeOverlay === 'ship') {
      // Escape is handled here so the dialog closes through the same path as the
      // buttons; preventDefault keeps the UA from also firing its close request.
      if (key === 'escape') { deps.closeShipScreen(); e.preventDefault(); e.stopPropagation(); }
      return;
    }
    if (ui.activeOverlay === 'info') {
      if (key === 'escape') { deps.closeInfoScreen(); e.preventDefault(); e.stopPropagation(); }
      return;
    }
    if (ui.activeOverlay === 'container') {
      // C shuts the crate it opened, so the one key is the whole round trip.
      if (key === 'escape' || key === 'c') { deps.closeContainer(); e.preventDefault(); e.stopPropagation(); }
      return;
    }
    if (ui.activeOverlay === 'station') {
      // Space opened it and Space shuts it again, the round trip on one key.
      if (key === 'escape' || key === ' ') { deps.closeStation(); e.preventDefault(); e.stopPropagation(); }
      return;
    }
    if (ui.activeOverlay === 'extractor') {
      if (key === 'escape' || key === ' ') { deps.closeExtractor(); e.preventDefault(); e.stopPropagation(); }
      return;
    }
    if (ui.activeOverlay === 'trade') {
      // Space opened it and Space shuts it again, the round trip on one key.
      if (key === 'escape' || key === ' ') { deps.closeTrade(); e.preventDefault(); e.stopPropagation(); }
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
    // Space opens whichever home station the ship is parked beside.
    if (key === ' ') { deps.openNearest(); e.preventDefault(); e.stopPropagation(); return; }
    // E is the shortcut for the dynamite slot, not a detonator: it arms a stick
    // for planting, and the press on the mine that follows is what lights it.
    if (key === 'e') { if (!e.repeat) deps.toggleDynamitePlacement(); e.preventDefault(); e.stopPropagation(); return; }
    if (key === 't') { if (!e.repeat) actions.useTeleporter(); e.preventDefault(); e.stopPropagation(); return; }
    if (key === 'c') { if (!e.repeat) deps.toggleContainer(); e.preventDefault(); e.stopPropagation(); return; }
    if (key === 'r') { if (!e.repeat) requestReset(); e.preventDefault(); e.stopPropagation(); }
  }

  function handleKeyUp(e: KeyboardEvent): void {
    keys.delete(e.key.toLowerCase());
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
    if (!target?.closest || target.closest(DIALOG_SURFACES) || !target.closest(ZOOM_SURFACE)) return;
    e.preventDefault();
    // Accumulate against the requested level, not the easing one, so a fast
    // scroll is not swallowed by the frames it takes the view to settle.
    requestViewportZoom(zoomAfterWheel(viewport.targetZoom, e));
  }

  /** Tap/click anywhere outside the dialogs to deploy a replacement ship. */
  function handleRestartPointer(e: Event): void {
    if (!isPlaying() || !state.gameOver) return;
    const target = e.target as Element;
    if (target.closest && target.closest('#info-screen')) return;
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

    return () => {
      removeEventListener('keydown', handleKeyDown, capture);
      removeEventListener('keyup', handleKeyUp, capture);
      removeEventListener('pointerdown', handleRestartPointer, capture);
      removeEventListener('wheel', handleWheel, activeCapture);
      removeEventListener('touchstart', handleRestartPointer, activeCapture);
    };
  }

  return {tick, clearKeys, reset, attach};
}

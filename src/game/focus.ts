// Keyboard focus on the mine.
//
// The canvas is the game surface's only tab stop, so putting focus on it is also
// what makes the focus ring land on the thing the keys drive. Everything here is
// best-effort: while a modal dialog is up the rest of the page is inert and a
// focus call does nothing, which is exactly what should happen.

import type { DisposalScope } from './disposal';

export interface CanvasFocus {
  /** Put the keyboard on the mine. */
  focusGame(): void;
  /**
   * Drop the keyboard focus ring after a pointer press without giving up the keys.
   * `:focus-visible` is a modality heuristic the browser only re-decides when
   * focus moves, so a click on the already-focused canvas leaves a keyboard-seeded
   * ring up — including through a device placement. A blur-then-refocus inside the
   * pointer gesture reseats the flag as pointer-driven, so the ring goes and the
   * mine keeps the keys. Only when the canvas actually holds focus: elsewhere the
   * browser's own decision is already right.
   */
  resetFocusRing(): void;
  /**
   * Take the keyboard for a run that has just started. `focusGame()` cannot do it
   * on the spot: the intro overlay may still hold focus until React commits the
   * phase change, so the call would be a silent no-op and the run would begin with
   * focus on `<body>`. Retrying for a few frames covers the flush React gives the
   * press that started the run.
   */
  claimForRun(attempts?: number): void;
}

export function createCanvasFocus(canvas: HTMLCanvasElement, scope: DisposalScope): CanvasFocus {
  function focusGame(): void {
    try { canvas.focus({preventScroll: true}); }
    catch { try { canvas.focus(); } catch { /* focus is best-effort */ } }
  }

  function claimForRun(attempts = 4): void {
    focusGame();
    if (document.activeElement === canvas || attempts <= 0) return;
    scope.timeout(() => claimForRun(attempts - 1), 16);
  }

  return {
    focusGame,
    resetFocusRing() {
      if (document.activeElement !== canvas) return;
      canvas.blur();
      focusGame();
    },
    claimForRun
  };
}

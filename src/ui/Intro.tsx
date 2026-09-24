import { useEffect } from 'react';
import { uiCommands } from './commands';
import styles from './Intro.module.css';
import '../styles/intro-art.css';

/**
 * Title card: the first and only screen before the run. Any press starts a shift.
 *
 * The overlay is translucent: the slice of mine behind it is not React's work but
 * the runtime's, painted onto the game canvas by `src/game/intro-showcase.ts`.
 *
 * Deliberately short. The full rules live in the in-game Info / Cargo overlay
 * (`InfoScreen.tsx`), which the player can open at any time, so the splash only
 * carries the name, one line of flavour, the three keys needed to start, and
 * the prompt to begin.
 *
 * The prompt is a real `<button>`, so activation is the browser's job in every
 * mode it can happen: a mouse click, Enter or Space on the focused button, or the
 * synthetic click a screen reader dispatches when the user activates it in browse
 * mode. The card around it keeps its own press handler for the "tap anywhere"
 * affordance, but it claims no role for it — a `role="button"` the size of the
 * screen that only listened for `pointerdown` promised a keyboard and
 * screen-reader activation it never implemented.
 *
 * The window key listener stays as well, because the canvas holds focus at boot
 * and Enter has to work from there. It only exists while this overlay is mounted,
 * so it cannot leak into the run.
 */
export function Intro() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      // Both keys activate a focused button by themselves, so a press aimed at
      // the start button is left to the browser rather than answered twice.
      if (event.target instanceof HTMLElement && event.target.closest('button')) return;
      // A key press cannot unlock audio, so no event is forwarded here.
      uiCommands.playSolo();
      event.preventDefault();
    }
    addEventListener('keydown', onKeyDown, {capture: true});
    return () => removeEventListener('keydown', onKeyDown, {capture: true});
  }, []);

  return (
    // A press anywhere on the card starts the game, which is the shortcut a mouse
    // or a thumb expects. It is not announced as a control: the button below is.
    <div
      id="intro"
      className={styles.intro}
      // Cancelling the press keeps the touch-compatibility click from landing on
      // the HUD button that appears underneath the moment this card unmounts.
      onPointerDown={event => { uiCommands.playSolo(event.nativeEvent); event.preventDefault(); }}
    >
      <div className={styles.card}>
        <div className={styles.emblem} aria-hidden="true">
          <div className="soviet-badge">
            <div className="lenin-face">
              <div className="lenin-hair"></div>
              <div className="lenin-brow left"></div><div className="lenin-brow right"></div>
              <div className="lenin-eye left"></div><div className="lenin-eye right"></div>
              <div className="lenin-nose"></div>
              <div className="lenin-moustache"></div>
              <div className="lenin-beard"></div>
            </div>
            <div className="badge-star">★</div>
            <div className="badge-sickle">☭</div>
          </div>
          <div className="soviet-ribbon">СССР</div>
        </div>
        <div className={styles.copy}>
          <p className={styles.kicker}>☭ Workers of the mine, unite! ☭</p>
          <h2>Stalinload</h2>
          <p className={styles.tagline}>Dig for the Motherland. Fill the quota.</p>
          <p className={styles.hint}>
            <kbd>WASD</kbd> dig · <kbd>Space</kbd> use station · rest in Info / Cargo
          </p>
          <div className={styles.actions}>
            {/* A pointer press has already been handled by the card above by the
                time the click arrives, and the run has started — so this path is
                only ever the one that had no pointer press to begin with: a screen
                reader's synthetic click. */}
            <button
              id="introStartBtn"
              className={styles.cta}
              type="button"
              onClick={event => uiCommands.playSolo(event.nativeEvent)}
            >★ Press Enter to start ★</button>
          </div>
        </div>
      </div>
    </div>
  );
}

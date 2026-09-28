// The gravestone.
//
// A small modal card: a cross, the miner's name, the years they lived, and what
// the mine did to them, with one OK to put it away. Everything is painted from the
// store's `grave` slice, which the game writes on open and clears on close, so the
// card holds no copy of anything. Enter, Space and Escape dismiss it through the
// keyboard layer (`input.ts`); OK, the backdrop and the dialog's own close request
// all dispatch the same `closeGrave`.
//
// The shell is the trade and cargo dialogs', for the same reasons.

import { useEffect, useRef } from 'react';
import { uiCommands } from './commands';
import { useUiStore } from './store';
import styles from './GraveScreen.module.css';

export function GraveScreen() {
  const open = useUiStore(state => state.activeOverlay === 'grave');
  const epitaph = useUiStore(state => state.grave);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const visible = open && epitaph !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (visible && !dialog.open) {
      dialog.showModal();
      okRef.current?.focus({preventScroll: true});
    } else if (!visible && dialog.open) {
      dialog.close();
    }
  }, [visible]);

  return (
    <dialog
      id="grave-screen"
      ref={dialogRef}
      className={styles.screen}
      aria-labelledby="grave-name"
      aria-describedby="grave-cause"
      onClose={() => uiCommands.closeGrave()}
      onPointerDown={event => { if (event.target === dialogRef.current) uiCommands.closeGrave(); }}
    >
      {visible && (
        <div id="grave-card" className={styles.card}>
          <span className={styles.cross} aria-hidden="true" />
          <h2 id="grave-name" className={styles.name}>{epitaph.name}</h2>
          <p id="grave-years" className={styles.years}>{epitaph.born} – {epitaph.died}</p>
          <p id="grave-cause" className={styles.cause}>{epitaph.cause}</p>
          <button
            id="graveOkBtn"
            ref={okRef}
            type="button"
            className={styles.ok}
            onClick={event => { event.stopPropagation(); uiCommands.closeGrave(); }}
          >OK</button>
        </div>
      )}
    </dialog>
  );
}

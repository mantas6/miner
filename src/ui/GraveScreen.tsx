// The gravestone.
//
// A small modal card: a cross, the miner's name, the years they lived, and what
// the mine did to them, with one OK to put it away. Everything is painted from the
// store's `grave` overlay, which the game raises on open and drops on close, so the
// card holds no copy of anything. Enter, Space and Escape dismiss it through the
// keyboard layer (`input.ts`); OK, the backdrop and the dialog's own close request
// all dispatch the same `closeGrave`.
//
// The `<dialog>` itself and its close requests are `ModalShell`'s; the OK takes the
// shell's first focus, as a card's close button does elsewhere.

import type { Epitaph } from '../core/grave';
import { uiCommands } from './commands';
import { ModalShell, useModalFocus } from './ModalShell';
import { overlayOf, useUiStore } from './store';
import styles from './GraveScreen.module.css';

export function GraveScreen() {
  const epitaph = useUiStore(state => overlayOf(state, 'grave')?.epitaph ?? null);
  const visible = epitaph !== null;

  return (
    <ModalShell
      id="grave-screen"
      titleId="grave-name"
      describedById="grave-cause"
      open={visible}
      onRequestClose={() => uiCommands.closeGrave()}
    >
      {visible && <GraveCard epitaph={epitaph} />}
    </ModalShell>
  );
}

function GraveCard({epitaph}: {epitaph: Epitaph}) {
  const okRef = useModalFocus();
  return (
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
  );
}

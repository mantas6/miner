// The oil extractor screen.
//
// A Phase 4 placeholder: it shows the two buffers — coal queued for conversion and
// fuel already stored — and offers the two transfers, "Load coal" (queue every
// coal aboard) and "Refuel ship" (top the tank up from stored fuel). Phase 5 wires
// the timed coal → fuel conversion behind it; the numbers here already come from
// the store, so they will animate the moment the conversion runs.
//
// The shell/card split and the backdrop press are the other dialogs', for the
// same reasons.

import { useEffect, useRef, type RefObject } from 'react';
import { uiCommands } from './commands';
import { useUiStore } from './store';
import styles from './ExtractorScreen.module.css';

export function ExtractorScreen() {
  const open = useUiStore(state => state.activeOverlay === 'extractor');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      closeRef.current?.focus({preventScroll: true});
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      id="extractor-screen"
      ref={dialogRef}
      className={styles.screen}
      aria-labelledby="extractor-title"
      onClose={() => uiCommands.closeExtractor()}
      onPointerDown={event => { if (event.target === dialogRef.current) uiCommands.closeExtractor(); }}
    >
      {open && <ExtractorCard closeRef={closeRef} />}
    </dialog>
  );
}

function ExtractorCard({closeRef}: {closeRef: RefObject<HTMLButtonElement | null>}) {
  const coal = useUiStore(state => state.extractor.coal);
  const fuel = useUiStore(state => state.extractor.fuel);

  return (
    <div id="extractor-card" className={styles.card}>
      <div className={styles.header}>
        <h2 id="extractor-title">Oil Extractor</h2>
        <button
          id="extractorCloseBtn"
          ref={closeRef}
          className={styles.closeBtn}
          aria-label="Close oil extractor"
          onClick={event => { event.stopPropagation(); uiCommands.closeExtractor(); }}
        >×</button>
      </div>
      <div className={styles.body}>
        <dl className={styles.buffers}>
          <div className={styles.buffer}>
            <dt>Coal queued</dt>
            <dd id="extractorCoal">{Math.round(coal)}</dd>
          </div>
          <div className={styles.buffer}>
            <dt>Fuel stored</dt>
            <dd id="extractorFuel">{Math.round(fuel)}</dd>
          </div>
        </dl>
        <div className={styles.actions}>
          <button id="loadCoalBtn" type="button" className={styles.action} onClick={() => uiCommands.loadCoal()}>
            Load coal
          </button>
          <button id="refuelBtn" type="button" className={styles.action} onClick={() => uiCommands.refuelFromExtractor()}>
            Refuel ship
          </button>
        </div>
      </div>
    </div>
  );
}

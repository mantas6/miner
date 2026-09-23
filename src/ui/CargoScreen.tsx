// The cargo container's transfer menu.
//
// Two columns of stacks — the ship's bay on the left, the crate on the right —
// and one rule: a press on a stack sends it to the other side. Each stack also
// carries a "1" button that moves a single unit, for splitting a stack across the
// gap; the stack itself moves the whole thing. There is no drag and no confirm,
// because there is nothing else to decide: a stack is either aboard or it is in
// the crate, and the only question the menu ever asks is which, and how much.
//
// Both columns are painted from the store, and both are live. The bay's stacks are
// the same ones the HUD panel shows, synced every frame; the crate's are pushed by
// the game after each transfer. So the menu holds no copy of anything and cannot
// disagree with the simulation behind it. Each column heads with how full it is —
// items held over its capacity — since neither side shows empty slots any more.
//
// The shell/card split, the fixed header over a scrolling body, and the backdrop
// press are the ship screen's and the info screen's, for the same reasons.

import { useEffect, useRef, type RefObject } from 'react';
import { CARGO_CONTAINER } from '../core/cargo-container';
import type { InventoryItemKind } from '../core/inventory';
import { uiCommands } from './commands';
import { useUiStore, type InventorySlotView } from './store';
import styles from './CargoScreen.module.css';

export function CargoScreen() {
  // One `<dialog>` serves both the crate's two-way transfer menu and the wreck's
  // take-only salvage menu: they never coexist (one `activeOverlay` at a time), and
  // sharing the shell keeps a second near-identical modal out of the tree.
  const mode = useUiStore(state =>
    state.activeOverlay === 'container' ? 'container' : state.activeOverlay === 'wreck' ? 'wreck' : null);
  const open = mode !== null;
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

  // A native close request (Escape reaching the UA, a form submit) must not leave
  // the game thinking the crate or wreck is still open.
  const close = () => { if (mode === 'wreck') uiCommands.closeWreck(); else uiCommands.closeContainer(); };

  return (
    <dialog
      id="cargo-screen"
      ref={dialogRef}
      className={styles.screen}
      aria-labelledby="cargo-title"
      onClose={close}
      onPointerDown={event => { if (event.target === dialogRef.current) close(); }}
    >
      {mode === 'container' && <CargoCard closeRef={closeRef} />}
      {mode === 'wreck' && <WreckCard closeRef={closeRef} />}
    </dialog>
  );
}

/** The wreck's salvage menu: one take-only column, plus a loot-all shortcut. */
function WreckCard({closeRef}: {closeRef: RefObject<HTMLButtonElement | null>}) {
  const wreckSlots = useUiStore(state => state.wreckSlots);
  const used = wreckSlots.reduce((count, slot) => count + slot.count, 0);

  return (
    <div id="cargo-card" className={styles.card}>
      <div className={styles.header}>
        <h2 id="cargo-title">Wreck</h2>
        <button
          id="cargoCloseBtn"
          ref={closeRef}
          className={styles.closeBtn}
          aria-label="Close wreck"
          onClick={event => { event.stopPropagation(); uiCommands.closeWreck(); }}
        >×</button>
      </div>
      <div className={styles.body}>
        <section className={styles.column} aria-labelledby="wreckSlots-title">
          <div className={styles.columnHeading}>
            <h3 id="wreckSlots-title">Salvage <span className={styles.count}>{used}</span></h3>
            <span>Press a stack to haul it aboard, or 1 for a single unit</span>
          </div>
          <button
            id="lootAllBtn"
            type="button"
            className={styles.lootAll}
            onClick={() => uiCommands.lootAll()}
            disabled={wreckSlots.length === 0}
          >Loot all</button>
          <ul id="wreckSlots" className={styles.slots}>
            {wreckSlots.length === 0 && <li className={styles.empty}><span className={styles.emptyLabel}>Empty</span></li>}
            {wreckSlots.map(slot => (
              <li key={slot.index}>
                <button
                  type="button"
                  className={styles.slot}
                  data-cargo-action="take"
                  data-cargo-kind={slot.kind}
                  onClick={() => uiCommands.takeFromWreck(slot.kind, false)}
                >
                  <span className={styles.icon} style={{background: slot.color}} aria-hidden="true" />
                  <span className={styles.label}>{slot.label}</span>
                  <span className={styles.count}>×{slot.count}</span>
                </button>
                <button
                  type="button"
                  className={styles.one}
                  data-cargo-action="take-one"
                  data-cargo-kind={slot.kind}
                  aria-label={`Salvage one ${slot.label}`}
                  onClick={() => uiCommands.takeFromWreck(slot.kind, true)}
                >1</button>
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            The corpse of your last ship: its ore and fitted upgrades, waiting to be salvaged.
            Anything hauled aboard still obeys the cargo-bay limit, and the wreck is gone once emptied.
          </p>
        </section>
      </div>
    </div>
  );
}

function CargoCard({closeRef}: {closeRef: RefObject<HTMLButtonElement | null>}) {
  const containerSlots = useUiStore(state => state.containerSlots);
  const shipSlots = useUiStore(state => state.inventorySlots);
  const cargoMax = useUiStore(state => state.hud.cargoMax);

  return (
    <div id="cargo-card" className={styles.card}>
      <div className={styles.header}>
        <h2 id="cargo-title">Cargo Container</h2>
        <button
          id="cargoCloseBtn"
          ref={closeRef}
          className={styles.closeBtn}
          aria-label="Close cargo container"
          onClick={event => { event.stopPropagation(); uiCommands.closeContainer(); }}
        >×</button>
      </div>
      <div className={styles.body}>
        <div className={styles.columns}>
          <SlotColumn
            listId="shipSlots"
            title="Cargo Bay"
            hint="Press a stack to store it, or 1 for a single unit"
            slots={shipSlots}
            capacity={cargoMax}
            action="store"
            onPress={(kind, single) => uiCommands.storeInContainer(kind, single)}
          />
          <SlotColumn
            listId="containerSlots"
            title="Container"
            hint="Press a stack to take it aboard, or 1 for a single unit"
            slots={containerSlots}
            capacity={CARGO_CONTAINER.capacity}
            action="take"
            onPress={(kind, single) => uiCommands.takeFromContainer(kind, single)}
          />
        </div>
        <p className={styles.note}>
          Holds up to {CARGO_CONTAINER.capacity} items and keeps them through death and reload.
          Anything taken back aboard still obeys the cargo-bay limit.
        </p>
      </div>
    </div>
  );
}

interface SlotColumnProps {
  listId: string;
  title: string;
  hint: string;
  slots: InventorySlotView[];
  /** Total items this side can hold, shown beside the title. */
  capacity: number;
  /** Which direction a press on this column moves a stack; also the test hook. */
  action: 'store' | 'take';
  /** `single` is true for the per-row "1" button, asking for one unit only. */
  onPress(kind: InventoryItemKind, single: boolean): void;
}

/** One side of the transfer: the stacks it holds, headed by how full it is. */
function SlotColumn({listId, title, hint, slots, capacity, action, onPress}: SlotColumnProps) {
  const used = slots.reduce((count, slot) => count + slot.count, 0);
  const verb = action === 'store' ? 'Store' : 'Take';
  return (
    <section className={styles.column} aria-labelledby={`${listId}-title`}>
      <div className={styles.columnHeading}>
        <h3 id={`${listId}-title`}>{title} <span className={styles.count}>{used}/{capacity}</span></h3>
        <span>{hint}</span>
      </div>
      <ul id={listId} className={styles.slots}>
        {slots.length === 0 && <li className={styles.empty}><span className={styles.emptyLabel}>Empty</span></li>}
        {slots.map(slot => (
          <li key={slot.index}>
            <button
              type="button"
              className={styles.slot}
              data-cargo-action={action}
              data-cargo-kind={slot.kind}
              onClick={() => onPress(slot.kind, false)}
            >
              <span className={styles.icon} style={{background: slot.color}} aria-hidden="true" />
              <span className={styles.label}>{slot.label}</span>
              <span className={styles.count}>×{slot.count}</span>
            </button>
            <button
              type="button"
              className={styles.one}
              data-cargo-action={`${action}-one`}
              data-cargo-kind={slot.kind}
              aria-label={`${verb} one ${slot.label}`}
              onClick={() => onPress(slot.kind, true)}
            >1</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

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
import { useItemTooltip } from './Tooltip';
import styles from './CargoScreen.module.css';

export function CargoScreen() {
  // One `<dialog>` serves the crate's two-way transfer menu and the take-only menus
  // of a wreck and a chest: they never coexist (one `activeOverlay` at a time), and
  // sharing the shell keeps near-identical modals out of the tree.
  const mode = useUiStore(state => {
    const overlay = state.activeOverlay;
    return overlay === 'container' || overlay === 'wreck' || overlay === 'chest' ? overlay : null;
  });
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
  // the game thinking the crate, wreck or chest is still open.
  const close = () => {
    if (mode === 'wreck') uiCommands.closeWreck();
    else if (mode === 'chest') uiCommands.closeChest();
    else uiCommands.closeContainer();
  };

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
      {mode === 'chest' && <ChestCard closeRef={closeRef} />}
    </dialog>
  );
}

/** What one take-only menu — the wreck's, or a chest's — lists and dispatches to. */
interface LootCardProps {
  closeRef: RefObject<HTMLButtonElement | null>;
  title: string;
  /** Id stem for the slot list and its heading, e.g. `wreckSlots`. */
  listId: string;
  slots: InventorySlotView[];
  note: string;
  close(): void;
  take(kind: InventoryItemKind, single: boolean): void;
  lootAll(): void;
}

/** The wreck's salvage menu: one take-only column, plus a loot-all shortcut. */
function WreckCard({closeRef}: {closeRef: RefObject<HTMLButtonElement | null>}) {
  const wreckSlots = useUiStore(state => state.wreckSlots);
  return (
    <LootCard
      closeRef={closeRef}
      title="Wreck"
      listId="wreckSlots"
      slots={wreckSlots}
      note={'The corpse of your last ship: its ore and fitted upgrades, waiting to be salvaged. '
        + 'Anything hauled aboard still obeys the cargo-bay limit, and the wreck is gone once emptied.'}
      close={() => uiCommands.closeWreck()}
      take={(kind, single) => uiCommands.takeFromWreck(kind, single)}
      lootAll={() => uiCommands.lootAll()}
    />
  );
}

/** A buried chest's menu: the wreck's layout, dispatching to the chest commands. */
function ChestCard({closeRef}: {closeRef: RefObject<HTMLButtonElement | null>}) {
  const chestSlots = useUiStore(state => state.chestSlots);
  return (
    <LootCard
      closeRef={closeRef}
      title="Chest"
      listId="chestSlots"
      slots={chestSlots}
      note={'Buried loot, waiting to be claimed. Anything hauled aboard still obeys the cargo-bay limit, '
        + 'and the chest is gone once emptied.'}
      close={() => uiCommands.closeChest()}
      take={(kind, single) => uiCommands.takeFromChest(kind, single)}
      lootAll={() => uiCommands.lootAllChest()}
    />
  );
}

/** One take-only column headed by its item count, plus a loot-all shortcut. */
function LootCard({closeRef, title, listId, slots, note, close, take, lootAll}: LootCardProps) {
  const used = slots.reduce((count, slot) => count + slot.count, 0);

  return (
    <div id="cargo-card" className={styles.card}>
      <div className={styles.header}>
        <h2 id="cargo-title">{title}</h2>
        <button
          id="cargoCloseBtn"
          ref={closeRef}
          className={styles.closeBtn}
          aria-label={`Close ${title.toLowerCase()}`}
          onClick={event => { event.stopPropagation(); close(); }}
        >×</button>
      </div>
      <div className={styles.body}>
        <section className={styles.column} aria-labelledby={`${listId}-title`}>
          <div className={styles.columnHeading}>
            <h3 id={`${listId}-title`}>Salvage <span className={styles.count}>{used}</span></h3>
            <span>Press a stack to haul it aboard, or 1 for a single unit</span>
          </div>
          <button
            id="lootAllBtn"
            type="button"
            className={styles.lootAll}
            onClick={() => lootAll()}
            disabled={slots.length === 0}
          >Loot all</button>
          <ul id={listId} className={styles.slots}>
            {slots.length === 0 && <li className={styles.empty}><span className={styles.emptyLabel}>Empty</span></li>}
            {slots.map(slot => <LootRow key={slot.index} slot={slot} take={take} />)}
          </ul>
          <p className={styles.note}>{note}</p>
        </section>
      </div>
    </div>
  );
}

/** One salvage stack: a take-the-stack button and a single-unit "1", both take-only. */
function LootRow({slot, take}: {slot: InventorySlotView; take(kind: InventoryItemKind, single: boolean): void}) {
  const tooltip = useItemTooltip(slot.kind);
  return (
    <li>
      <button
        type="button"
        className={styles.slot}
        data-cargo-action="take"
        data-cargo-kind={slot.kind}
        onClick={() => take(slot.kind, false)}
        {...tooltip}
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
        onClick={() => take(slot.kind, true)}
      >1</button>
    </li>
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
          <TransferSlot key={slot.index} slot={slot} action={action} verb={verb} onPress={onPress} />
        ))}
      </ul>
    </section>
  );
}

/** One transfer stack: the whole-stack button and its single-unit "1", either direction. */
function TransferSlot({slot, action, verb, onPress}: {
  slot: InventorySlotView;
  action: 'store' | 'take';
  verb: string;
  onPress(kind: InventoryItemKind, single: boolean): void;
}) {
  const tooltip = useItemTooltip(slot.kind);
  return (
    <li>
      <button
        type="button"
        className={styles.slot}
        data-cargo-action={action}
        data-cargo-kind={slot.kind}
        onClick={() => onPress(slot.kind, false)}
        {...tooltip}
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
  );
}

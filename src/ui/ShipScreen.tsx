// The ship equipment screen.
//
// Two lists, one rule each. On top, the fitting slots: every slot is a row that
// either names the upgrade it holds — with an Unfit button — or reads "Empty".
// Below, the upgrades sitting in the cargo bay, each with a Fit button that drops
// it into the first free slot (or swaps into the first slot when both are full).
//
// Both lists are painted from the store and both are live: the slots come from a
// snapshot the game pushes on open and after every change, and the bay upgrades
// are filtered out of the same `inventorySlots` the HUD panel already syncs. So
// the screen holds no copy of anything and cannot disagree with the simulation.
//
// The shell/card split, the fixed header over a scrolling body, and the backdrop
// press are the cargo and info dialogs', for the same reasons.

import { useEffect, useRef, type RefObject } from 'react';
import { isUpgradeKind, type UpgradeKind } from '../core/inventory';
import { uiCommands } from './commands';
import { useUiStore, type InventorySlotView, type ShipSlotView } from './store';
import { useItemTooltip } from './Tooltip';
import styles from './ShipScreen.module.css';

export function ShipScreen() {
  const open = useUiStore(state => state.activeOverlay === 'ship');
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
      id="ship-screen"
      ref={dialogRef}
      className={styles.screen}
      aria-labelledby="ship-title"
      // A native close request (Escape reaching the UA, a form submit) must not
      // leave the game thinking the screen is still open.
      onClose={() => uiCommands.closeShip()}
      onPointerDown={event => { if (event.target === dialogRef.current) uiCommands.closeShip(); }}
    >
      {open && <ShipCard closeRef={closeRef} />}
    </dialog>
  );
}

function ShipCard({closeRef}: {closeRef: RefObject<HTMLButtonElement | null>}) {
  const equipment = useUiStore(state => state.shipEquipment);
  const inventorySlots = useUiStore(state => state.inventorySlots);
  const bayUpgrades = inventorySlots.filter(slot => isUpgradeKind(slot.kind));

  return (
    <div id="ship-card" className={styles.card}>
      <div className={styles.header}>
        <h2 id="ship-title">Ship</h2>
        <button
          id="shipCloseBtn"
          ref={closeRef}
          className={styles.closeBtn}
          aria-label="Close ship equipment"
          onClick={event => { event.stopPropagation(); uiCommands.closeShip(); }}
        >×</button>
      </div>
      <div className={styles.body}>
        <section className={styles.column} aria-labelledby="shipSlots-title">
          <div className={styles.columnHeading}>
            <h3 id="shipSlots-title">Fitting Slots</h3>
            <span>Fitted upgrades stack; duplicates add.</span>
          </div>
          <ul id="shipSlots" className={styles.slots}>
            {equipment.map(slot => <FittingSlot key={slot.index} slot={slot} />)}
          </ul>
        </section>
        <section className={styles.column} aria-labelledby="shipBay-title">
          <div className={styles.columnHeading}>
            <h3 id="shipBay-title">Upgrades in Bay</h3>
            <span>Fit an upgrade into a free slot.</span>
          </div>
          <ul id="shipBay" className={styles.slots}>
            {bayUpgrades.length === 0 && (
              <li className={styles.empty}><span className={styles.emptyLabel}>No upgrades aboard</span></li>
            )}
            {bayUpgrades.map(slot => <BayUpgradeRow key={slot.index} slot={slot} />)}
          </ul>
        </section>
      </div>
    </div>
  );
}

/**
 * One fitting slot. A filled slot carries the upgrade's tooltip (and is focusable
 * for it); an empty slot has nothing to describe, so it stays a plain, un-hovered row.
 */
function FittingSlot({slot}: {slot: ShipSlotView}) {
  if (!slot.kind) {
    return (
      <li>
        <div className={styles.slot} data-ship-slot={slot.index}>
          <span className={styles.icon} aria-hidden="true" />
          <span className={styles.emptyLabel}>{slot.label}</span>
          <button
            type="button"
            className={styles.action}
            data-ship-unequip={slot.index}
            disabled
            onClick={event => { event.stopPropagation(); uiCommands.unequipUpgrade(slot.index); }}
          >Unfit</button>
        </div>
      </li>
    );
  }
  return <FilledFittingSlot slot={slot} kind={slot.kind} />;
}

function FilledFittingSlot({slot, kind}: {slot: ShipSlotView; kind: UpgradeKind}) {
  const tooltip = useItemTooltip(kind);
  return (
    <li>
      <div className={styles.slot} data-ship-slot={slot.index} {...tooltip}>
        <span className={styles.icon} style={{background: slot.color}} aria-hidden="true" />
        <span className={styles.label}>{slot.label}</span>
        <button
          type="button"
          className={styles.action}
          data-ship-unequip={slot.index}
          onClick={event => { event.stopPropagation(); uiCommands.unequipUpgrade(slot.index); }}
        >Unfit</button>
      </div>
    </li>
  );
}

/** One upgrade sitting in the bay, with its tooltip and a Fit button. */
function BayUpgradeRow({slot}: {slot: InventorySlotView}) {
  const tooltip = useItemTooltip(slot.kind);
  return (
    <li>
      <div className={styles.slot} {...tooltip}>
        <span className={styles.icon} style={{background: slot.color}} aria-hidden="true" />
        <span className={styles.label}>{slot.label}</span>
        <span className={styles.count}>×{slot.count}</span>
        <button
          type="button"
          className={styles.action}
          data-ship-equip={slot.kind}
          onClick={event => { event.stopPropagation(); uiCommands.equipUpgrade(slot.kind as UpgradeKind); }}
        >Fit</button>
      </div>
    </li>
  );
}

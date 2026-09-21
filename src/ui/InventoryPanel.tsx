import clsx from 'clsx';
import { useState } from 'react';
import { CARGO_CONTAINER_ITEM } from '../core/cargo-container';
import { DYNAMITE, DYNAMITE_ITEM } from '../core/dynamite';
import type { InventoryItemKind } from '../core/inventory';
import { SCANNER_ITEM } from '../core/scanner-device';
import { uiCommands } from './commands';
import { useUiStore } from './store';
import styles from './InventoryPanel.module.css';

/** The kinds that are placed rather than merely carried, and how their slot acts. */
const PLACEABLE: Partial<Record<InventoryItemKind, {
  buttonId: string;
  idle: string;
  armed: string;
  toggle(): void;
}>> = {
  [SCANNER_ITEM.kind]: {
    buttonId: 'scannerSlotBtn',
    idle: 'Deploy a scanner in the mine',
    armed: 'Click a mapped tile to deploy · Esc cancels',
    toggle: () => uiCommands.toggleScannerPlacement()
  },
  [DYNAMITE_ITEM.kind]: {
    buttonId: 'dynamiteSlotBtn',
    idle: 'Plant dynamite in the mine (E)',
    armed: `Click a mapped tile to plant · ${DYNAMITE.fuseSeconds} s fuse · Esc cancels`,
    toggle: () => uiCommands.toggleDynamitePlacement()
  },
  [CARGO_CONTAINER_ITEM.kind]: {
    buttonId: 'containerSlotBtn',
    idle: 'Set a cargo container down in the mine',
    armed: 'Click a mapped tile to set it down · Esc cancels',
    toggle: () => uiCommands.toggleContainerPlacement()
  }
};

/**
 * The cargo bay, on screen.
 *
 * The bay is bounded by a total item count, not a fixed row of slots, so the
 * header carries the whole "how full" story — `12/20` items — and the list below
 * shows only the stacks actually aboard. An empty bay is an empty list under a
 * `0/20`, which says as much as a row of "Empty" boxes did and takes less room.
 *
 * The stack holding a deployable is also the control that places it: pressing it
 * arms placement, and the next press on the mine puts the item down. That keeps
 * the whole gesture inside the panel that already shows the item, rather than
 * adding a button to the action bar for something used a handful of times a run.
 *
 * Collapsing is local state on purpose. It is a preference about this glance,
 * not about the save: nothing here is worth a storage key, and a panel that
 * remembered being shut would hide itself from the next run without explanation.
 */
export function InventoryPanel() {
  const slots = useUiStore(state => state.inventorySlots);
  const capacity = useUiStore(state => state.hud.cargoMax);
  const gameOver = useUiStore(state => state.hud.gameOver);
  const armedPlacement = useUiStore(state => state.armedPlacement);
  const [collapsed, setCollapsed] = useState(false);
  const used = slots.reduce((count, slot) => count + slot.count, 0);

  return (
    <section id="inventory" className={styles.inventory} aria-label="Inventory" hidden={gameOver}>
      <button
        id="inventoryToggleBtn"
        type="button"
        className={styles.toggle}
        aria-expanded={!collapsed}
        // Only points at the list while there is one to point at.
        aria-controls={collapsed ? undefined : 'inventorySlots'}
        onClick={() => setCollapsed(value => !value)}
      >
        <span className={styles.title}>Inventory</span>
        <span className={styles.used}>{used}/{capacity}</span>
        <span className={styles.chevron} aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <ul id="inventorySlots" className={styles.slots}>
          {slots.length === 0 && <li className={clsx(styles.slot, styles.empty)}><span className={styles.emptyLabel}>Empty</span></li>}
          {slots.map(slot => {
            const stack = (
              <>
                <span className={styles.icon} style={{background: slot.color}} aria-hidden="true" />
                <span className={styles.label}>{slot.label}</span>
                <span className={styles.count}>×{slot.count}</span>
              </>
            );
            const placeable = PLACEABLE[slot.kind];
            const armed = placeable !== undefined && armedPlacement === slot.kind;
            return (
              <li key={slot.index} className={styles.slot}>
                {placeable
                  ? (
                    <button
                      id={placeable.buttonId}
                      type="button"
                      className={clsx(styles.place, armed && styles.armed)}
                      aria-pressed={armed}
                      title={armed ? placeable.armed : placeable.idle}
                      onClick={placeable.toggle}
                    >{stack}</button>
                  )
                  : stack}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

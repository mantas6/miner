import clsx from 'clsx';
import { CARGO_CONTAINER_ITEM } from '../core/cargo-container';
import { DYNAMITE, DYNAMITE_ITEM } from '../core/dynamite';
import type { DecorKind, InventoryItemKind } from '../core/inventory';
import { itemForKind } from '../core/items';
import { SCANNER_ITEM } from '../core/scanner-device';
import { uiCommands } from './commands';
import { DECOR_KINDS, SLOT_BUTTON_IDS, decorSlotButtonId } from './inventory-slot-ids';
import { uiStore, useUiStore, type InventorySlotView } from './store';
import { useItemTooltip } from './Tooltip';
import styles from './InventoryPanel.module.css';

/** The kinds that are placed rather than merely carried, and how their slot acts. */
const PLACEABLE: Partial<Record<InventoryItemKind, {
  buttonId: string;
  idle: string;
  armed: string;
  toggle(): void;
}>> = {
  [SCANNER_ITEM.kind]: {
    buttonId: SLOT_BUTTON_IDS.scanner,
    idle: 'Deploy a scanner in the mine',
    armed: 'Click a mapped tile to deploy · Esc cancels',
    toggle: () => uiCommands.toggleScannerPlacement()
  },
  [DYNAMITE_ITEM.kind]: {
    buttonId: SLOT_BUTTON_IDS.dynamite,
    idle: 'Plant dynamite in the mine (E)',
    armed: `Click a mapped tile to plant · ${DYNAMITE.fuseSeconds} s fuse · Esc cancels`,
    toggle: () => uiCommands.toggleDynamitePlacement()
  },
  [CARGO_CONTAINER_ITEM.kind]: {
    buttonId: SLOT_BUTTON_IDS.container,
    idle: 'Set a cargo container down in the mine',
    armed: 'Click a mapped tile to set it down · Esc cancels',
    toggle: () => uiCommands.toggleContainerPlacement()
  },
  'device:manufacturer': {
    buttonId: SLOT_BUTTON_IDS['device:manufacturer'],
    idle: 'Set a Manufacturing Station down in the mine',
    armed: 'Click a mapped tile to set it down · Esc cancels',
    toggle: () => uiCommands.toggleManufacturerPlacement()
  },
  'device:extractor': {
    buttonId: SLOT_BUTTON_IDS['device:extractor'],
    idle: 'Set a Fuel Extractor down in the mine',
    armed: 'Click a mapped tile to set it down · Esc cancels',
    toggle: () => uiCommands.toggleExtractorPlacement()
  },
  'device:portal': {
    buttonId: SLOT_BUTTON_IDS['device:portal'],
    idle: 'Set a Portal down in the mine',
    armed: 'Click a mapped tile to set it down · Esc cancels',
    toggle: () => uiCommands.togglePortalPlacement()
  },
  toolkit: {
    buttonId: SLOT_BUTTON_IDS.toolkit,
    idle: 'Pack an empty station, portal or container back into the bay',
    armed: 'Click an empty station, portal or container to pack it up · Esc cancels',
    toggle: () => uiCommands.toggleToolkit()
  },
  ...Object.fromEntries(DECOR_KINDS.map(kind => [kind, decorPlaceable(kind)]))
};

/** One decoration's placeable slot: armed, it writes the panel onto the next tile pressed. */
function decorPlaceable(kind: DecorKind) {
  return {
    buttonId: decorSlotButtonId(kind),
    idle: `Set ${itemForKind(kind).label} down in the mine`,
    armed: 'Click a mapped tile to set it down · Esc cancels',
    toggle: () => uiCommands.toggleDecorPlacement(kind)
  };
}

/** The kinds spent from their slot with a single press, and how that press acts. */
const USABLE: Partial<Record<InventoryItemKind, {buttonId: string; title: string; use(): void}>> = {
  repairKit: {
    buttonId: SLOT_BUTTON_IDS.repairKit,
    title: 'Use a repair kit to patch the hull',
    use: () => uiCommands.useRepairKit()
  },
  fuelCell: {
    buttonId: SLOT_BUTTON_IDS.fuelCell,
    title: 'Use a fuel cell to fill the tank',
    use: () => uiCommands.useFuelCell()
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
 * Collapsing is a store flag (so the agent's observation can see the list is
 * shut) but never persisted. It is a preference about this glance, not about the
 * save: nothing here is worth a storage key, and a panel that remembered being
 * shut would hide itself from the next page load without explanation.
 */
export function InventoryPanel() {
  const slots = useUiStore(state => state.inventorySlots);
  const capacity = useUiStore(state => state.hud.cargoMax);
  const gameOver = useUiStore(state => state.hud.gameOver);
  const armedPlacement = useUiStore(state => state.armedPlacement);
  const collapsed = useUiStore(state => state.inventoryCollapsed);
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
        onClick={() => uiStore.getState().setInventoryCollapsed(!collapsed)}
      >
        <span className={styles.title}>Inventory</span>
        <span className={styles.used}>{used}/{capacity}</span>
        <span className={styles.chevron} aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <ul id="inventorySlots" className={styles.slots}>
          {slots.length === 0 && <li className={clsx(styles.slot, styles.empty)}><span className={styles.emptyLabel}>Empty</span></li>}
          {slots.map(slot => (
            <InventoryRow key={slot.index} slot={slot} armed={armedPlacement === slot.kind} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One bay stack. A placeable arms placement, a usable spends on press, and both are
 * buttons; a plain stack is a focusable row so its tooltip is reachable by keyboard.
 * Either way the row carries the item's tooltip.
 */
function InventoryRow({slot, armed}: {slot: InventorySlotView; armed: boolean}) {
  const placeable = PLACEABLE[slot.kind];
  const usable = USABLE[slot.kind];
  // What a press on the slot does rides in the item's own tooltip, rather than a
  // native `title` popping up a second box on top of it.
  const hint = placeable ? (armed ? placeable.armed : placeable.idle) : usable?.title;
  const tooltip = useItemTooltip(slot.kind, hint === undefined ? undefined : [hint]);
  const stack = (
    <>
      <span className={styles.icon} style={{background: slot.color}} aria-hidden="true" />
      <span className={styles.label}>{slot.label}</span>
      <span className={styles.count}>×{slot.count}</span>
    </>
  );
  if (placeable) {
    return (
      <li className={styles.slot}>
        <button
          id={placeable.buttonId}
          type="button"
          className={clsx(styles.place, armed && styles.armed)}
          aria-pressed={armed}
          onClick={placeable.toggle}
          {...tooltip}
        >{stack}</button>
      </li>
    );
  }
  if (usable) {
    return (
      <li className={styles.slot}>
        <button
          id={usable.buttonId}
          type="button"
          className={styles.place}
          onClick={usable.use}
          {...tooltip}
        >{stack}</button>
      </li>
    );
  }
  // A plain stack has no control of its own, so the row itself carries the tooltip
  // and is made focusable for it; its spans stay direct grid children of the slot.
  return (
    <li
      className={styles.slot}
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      {...tooltip}
    >{stack}</li>
  );
}

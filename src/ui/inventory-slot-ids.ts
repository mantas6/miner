// The element ids of the inventory panel's actionable slots.
//
// A stack whose item is placed (a scanner, a station device, a decoration) or
// spent with a press (a repair kit) is a button, and its id is the contract the
// e2e suite and the agent harness click it by. The table lives here, apart from
// the component, so the harness's allowlist (`agent/targets.ts`) derives the same
// ids from the same source instead of keeping a hand-copied list in step.

import { DECOR_IDS } from '../../shared/constants';
import { decorKindForId } from '../core/decor';
import type { DecorKind, DeviceKind, InventoryItemKind } from '../core/inventory';

/** Every placeable decoration's stack kind, in catalogue order. */
export const DECOR_KINDS: readonly DecorKind[] = DECOR_IDS.map(decorKindForId);

/** The fixed slot ids: the deployables, the station devices, the toolkit and the repair kit. */
export const SLOT_BUTTON_IDS = {
  scanner: 'scannerSlotBtn',
  dynamite: 'dynamiteSlotBtn',
  container: 'containerSlotBtn',
  repairKit: 'repairKitSlotBtn',
  'device:manufacturer': 'manufacturerSlotBtn',
  'device:extractor': 'extractorSlotBtn',
  'device:portal': 'portalSlotBtn',
  toolkit: 'toolkitSlotBtn'
} as const satisfies Partial<Record<InventoryItemKind, string>> & Record<DeviceKind, string>;

/** A decoration's slot id, e.g. `decor:lampPanelSlotBtn`. */
export function decorSlotButtonId(kind: DecorKind): string {
  return `${kind}SlotBtn`;
}

/** Every actionable inventory-slot id the panel can render. */
export function allSlotButtonIds(): string[] {
  return [...Object.values(SLOT_BUTTON_IDS), ...DECOR_KINDS.map(decorSlotButtonId)];
}

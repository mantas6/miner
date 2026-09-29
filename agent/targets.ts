// The harness's click allowlist: every UI control the agent may press, by id or
// by attribute.
//
// Kept apart from `agent/session.ts` on purpose: that module pulls Playwright and
// Vite in at runtime, while this one is plain data, so the Vitest guard in
// `src/agent/allowlist.test.ts` can import it and check it against the controls
// the React tree actually renders. Anything interactive in `src/ui/` must either
// be listed here or be excluded there with a reason.
//
// The inventory-slot ids are derived from the same table the inventory panel
// renders them from (`src/ui/inventory-slot-ids.ts`), so a new decoration or a
// renamed slot can never leave the allowlist behind.

import { allSlotButtonIds } from '../src/ui/inventory-slot-ids';

/** Ids clickable on their own, with no attribute value. Ids with a `:` and all. */
export const ID_TARGETS: ReadonlySet<string> = new Set([
  // HUD / action bar.
  'shipBtn', 'teleporterBtn', 'infoBtn', 'musicBtn', 'sfxBtn', 'inventoryToggleBtn',
  // Inventory slots (the deployables, station devices, toolkit, repair kit, decorations).
  ...allSlotButtonIds(),
  // Ship screen.
  'shipCloseBtn',
  // Station screen.
  'stowAllBtn', 'stationCloseBtn',
  // Fuel extractor screen (extractorBuyFuelBtn only at the base's extractor).
  'loadCoalBtn', 'refuelBtn', 'extractorBuyFuelBtn', 'extractorCloseBtn',
  // Cargo container / wreck / chest screen.
  'cargoCloseBtn', 'lootAllBtn',
  // Trading-post screen.
  'tradeFuelBtn', 'tradeCloseBtn',
  // Grave stone.
  'graveOkBtn',
  // Portal screen.
  'portalCloseBtn', 'portalNameInput', 'portalNameSaveBtn',
  // Info / cargo screen.
  'infoCloseBtn',
  // Info → Settings tab (reach it with data-info-section=info-settings). The two
  // reset confirms and the import confirm reload the page; `click` waits it out.
  'settingsMusicBtn', 'settingsSfxBtn', 'cheatsToggleBtn', 'resetPlayerDataBtn', 'resetWorldStateBtn',
  'exportSaveBtn', 'importSaveText', 'importSaveBtn', 'importSaveConfirmBtn', 'importSaveCancelBtn',
  'resetGameBtn', 'resetGameCancelBtn', 'resetGameConfirmBtn',
  // Intro.
  'introStartBtn',
  // The runtime-failure / interface-crash notice.
  'failureReloadBtn'
]);

/** Attribute controls, each needing a value (some need a value and a kind). */
export const ATTR_TARGETS: ReadonlySet<string> = new Set([
  'data-ship-equip', 'data-ship-unequip', 'data-craft', 'data-supply', 'data-info-section', 'data-cargo', 'data-station', 'data-trade', 'data-portal'
]);

/**
 * Attribute controls that take no value: the bare attribute marks the one button.
 * The cheat menu's two grants (Info → Settings → cheatsToggleBtn first).
 */
export const FLAG_ATTR_TARGETS: ReadonlySet<string> = new Set([
  'data-developer-grant-ores', 'data-developer-fill-extractor'
]);

/**
 * The transfer controls that carry two attributes: an action `value` and a stack
 * `kind`. `data-cargo` → `data-cargo-action`/`data-cargo-kind`, `data-station` →
 * `data-station`/`data-station-kind`. Their `value,kind` string form joins the two
 * with a comma.
 */
export const KIND_TARGETS: ReadonlySet<string> = new Set(['data-cargo', 'data-station', 'data-trade']);

/** The two attribute names a two-value transfer control resolves to. */
export function kindTargetAttrs(name: string): {action: string; kind: string} {
  // `data-cargo` addresses its action through `data-cargo-action`; `data-station`
  // and `data-trade` through their bare attribute. All three name the kind with `-kind`.
  return {action: name === 'data-cargo' ? 'data-cargo-action' : name, kind: `${name}-kind`};
}

/** Every DOM attribute name some allowlisted target addresses a control by. */
export function addressedAttributes(): Set<string> {
  const names = new Set<string>(FLAG_ATTR_TARGETS);
  for (const name of ATTR_TARGETS) {
    if (!KIND_TARGETS.has(name)) { names.add(name); continue; }
    const attrs = kindTargetAttrs(name);
    names.add(attrs.action);
    names.add(attrs.kind);
  }
  return names;
}

/** A human-readable roster of everything `click` accepts, for the refusal message. */
export function allowedTargetsDescription(): string {
  return [
    `ids: ${[...ID_TARGETS].join(' ')}`,
    `attributes (need a value): ${[...ATTR_TARGETS].filter(a => !KIND_TARGETS.has(a)).join(' ')}`,
    `attributes (no value): ${[...FLAG_ATTR_TARGETS].join(' ')}`,
    'transfers (need value=action and kind): data-cargo (e.g. data-cargo=take,ore:Iron), data-station (e.g. data-station=stow-one,ore:Coal), data-trade (e.g. data-trade=sell,ore:Iron or data-trade=buy,repairKit)'
  ].join('; ');
}

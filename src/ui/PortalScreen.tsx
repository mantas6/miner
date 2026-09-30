// The portal overlay: one screen for the whole travel network.
//
// It wears three hats, told apart by `portal.mode`. In `travel` it hangs off the
// portal the ship is parked at: a rename field, a paid hull repair while the hull
// is short, and the list of every *other* portal the ship can jump to for free. In `teleporter` it is the same list,
// filtered to the portals out of reach, that a carried teleporter charge would
// spend to reach. In `respawn` it is the no-close redeploy prompt a lost ship
// with two or more portals answers before the world is rebuilt.
//
// Everything is painted from the store: the game pushes `portal` on open, after a
// rename, and after each republish, so the screen holds no copy of anything. The
// rename field is uncontrolled and keyed to the source name, so a rename the game
// echoes back re-seeds it without fighting the player's typing.
//
// The `<dialog>` itself, its focus and its close requests are `ModalShell`'s —
// respawn mode, which has no way out but to pick, is its non-dismissible case: the
// backdrop press and the UA's cancel are vetoed there (and, via input.ts, Escape
// and Space).

import { useRef } from 'react';
import { MAX_PORTAL_NAME_LENGTH } from '../core/portal';
import { shipFor } from '../core/ships';
import { hullRepair, hullRepairPointPrice } from '../core/trading';
import { uiCommands } from './commands';
import { CardHeader, ModalShell } from './ModalShell';
import { overlayOf, useUiStore, type PortalDestinationView, type PortalView } from './store';
import styles from './PortalScreen.module.css';

/** The header each mode wears; travel appends the source portal's name. */
function headerFor(portal: PortalView): string {
  switch (portal.mode) {
    case 'travel':
      return `Portal · ${portal.source?.name ?? ''}`;
    case 'teleporter':
      return 'Teleporter';
    case 'respawn':
      return 'Ship lost — choose where to redeploy';
  }
}

/** The line shown when a mode's list is empty; respawn always has candidates. */
function emptyLineFor(mode: PortalView['mode']): string {
  return mode === 'travel' ? 'No other portals built yet.' : 'Every portal is within reach.';
}

export function PortalScreen() {
  const open = useUiStore(state => state.overlay?.kind === 'portal');
  const mode = useUiStore(state => overlayOf(state, 'portal')?.portal.mode);
  return (
    <ModalShell
      id="portal-screen"
      titleId="portal-title"
      open={open}
      onRequestClose={() => uiCommands.closePortal()}
      dismissible={mode !== 'respawn'}
    >
      {open && <PortalCard />}
    </ModalShell>
  );
}

function PortalCard() {
  const portal = useUiStore(state => overlayOf(state, 'portal')?.portal ?? null);
  if (!portal) return null;
  const {mode, source, destinations} = portal;

  return (
    <div id="portal-card" className={styles.card}>
      <CardHeader
        titleId="portal-title"
        title={headerFor(portal)}
        titleClassName={styles.title}
        closeId="portalCloseBtn"
        closeLabel="Close portal list"
        onClose={mode === 'respawn' ? undefined : () => uiCommands.closePortal()}
      />
      <div className={styles.body}>
        {mode === 'travel' && source && <NameEditor key={source.name} name={source.name} />}
        {mode === 'travel' && source && <RepairRow />}
        <ul id="portalList" className={styles.slots}>
          {destinations.length === 0 && (
            <li className={styles.empty}><span className={styles.emptyLabel}>{emptyLineFor(mode)}</span></li>
          )}
          {destinations.map(destination => (
            <DestinationRow key={`${destination.x},${destination.y}`} destination={destination} />
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * The travel-mode rename field. Uncontrolled and keyed to the source name by the
 * caller, so a rename the game publishes re-seeds it without stepping on typing.
 * Enter inside the field saves, exactly as the button does; the field is a real
 * `<input>`, so input.ts's editable guard keeps game keys from firing while it holds
 * focus.
 */
function NameEditor({name}: {name: string}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const save = () => uiCommands.renamePortal(inputRef.current?.value ?? '');
  return (
    <div className={styles.rename}>
      <input
        id="portalNameInput"
        ref={inputRef}
        className={styles.nameInput}
        type="text"
        maxLength={MAX_PORTAL_NAME_LENGTH}
        defaultValue={name}
        aria-label="Portal name"
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); save(); } }}
      />
      <button
        id="portalNameSaveBtn"
        type="button"
        className={styles.action}
        onClick={save}
      >Save</button>
    </div>
  );
}

/**
 * The travel-mode hull repair: patch as much of the missing hull as the wallet
 * covers, priced like a post's Repair Kits (`hullRepair`). Painted live from the
 * HUD's hull and wallet, so it follows every bite and every sale; only shown while
 * the hull is short of whole, and dead while the wallet cannot cover one point.
 */
function RepairRow() {
  const hull = useUiStore(state => state.hud.hull);
  const hullMax = useUiStore(state => state.hud.hullMax);
  const cash = useUiStore(state => state.hud.cash);
  if (hullMax - hull < 1) return null;
  const {amount, cost} = hullRepair(hull, hullMax, cash);
  const restored = Math.round(amount);
  const rate = `$${hullRepairPointPrice(hullMax).toFixed(2)} a hull point`;
  return (
    <div className={styles.repair} title={`Hull repair: ${rate}.`}>
      <span className={styles.label}>Repair hull</span>
      <span className={styles.meta}>{amount > 0 ? `+${restored}` : rate}</span>
      <button
        id="portalRepairBtn"
        type="button"
        className={styles.action}
        disabled={amount <= 0}
        aria-label={amount > 0 ? `Repair hull +${restored} for $${cost}` : 'Repair hull'}
        onClick={() => uiCommands.repairHullAtPortal()}
      >{amount > 0 ? `$${cost}` : '—'}</button>
    </div>
  );
}

/**
 * How much of a tank a respawn at a portal deploys with: "full tank" when the
 * home extractor covers one, "½ tank" at a field portal or from a dry store, or
 * the units when the share is anything else.
 * `fuelMax` is the hull's bare base tank — the replacement keeps the hull but not
 * its fitted upgrades.
 */
function respawnTankLabel(fuel: number, fuelMax: number): string {
  if (fuel >= fuelMax) return 'full tank';
  if (fuel * 2 === fuelMax) return '½ tank';
  return `${fuel}/${fuelMax} fuel`;
}

/**
 * One destination: its name, depth (metres, 0 at the surface) and distance in
 * tiles — and, in the respawn prompt, the tank the replacement would deploy with.
 */
function DestinationRow({destination}: {destination: PortalDestinationView}) {
  const baseTank = useUiStore(state => shipFor(state.ship.id).base.fuelMax);
  return (
    <li>
      <button
        type="button"
        className={styles.slot}
        data-portal={`${destination.x},${destination.y}`}
        onClick={() => uiCommands.travelToPortal(destination.x, destination.y)}
      >
        <span className={styles.label}>{destination.name}</span>
        <span className={styles.meta}>{destination.depthMeters} m</span>
        <span className={styles.meta}>{destination.distance} tiles</span>
        {destination.respawnFuel !== undefined && (
          <span className={styles.meta}>{respawnTankLabel(destination.respawnFuel, baseTank)}</span>
        )}
      </button>
    </li>
  );
}

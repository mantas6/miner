// The portal overlay: one screen for the whole travel network.
//
// It wears three hats, told apart by `portal.mode`. In `travel` it hangs off the
// portal the ship is parked at: a rename field over the list of every *other*
// portal the ship can jump to for free. In `teleporter` it is the same list,
// filtered to the portals out of reach, that a carried teleporter charge would
// spend to reach. In `respawn` it is the no-close redeploy prompt a lost ship
// with two or more portals answers before the world is rebuilt.
//
// Everything is painted from the store: the game pushes `portal` on open, after a
// rename, and after each republish, so the screen holds no copy of anything. The
// rename field is uncontrolled and keyed to the source name, so a rename the game
// echoes back re-seeds it without fighting the player's typing.
//
// The shell/card split and the backdrop press are the other dialogs', for the same
// reasons — except respawn mode, which has no way out but to pick, so it swallows
// the backdrop press (and, via input.ts, Escape).

import { useEffect, useRef, type RefObject } from 'react';
import { MAX_PORTAL_NAME_LENGTH } from '../core/portal';
import { uiCommands } from './commands';
import { useUiStore, type PortalDestinationView, type PortalView } from './store';
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
  const open = useUiStore(state => state.activeOverlay === 'portal' && state.portal !== null);
  const mode = useUiStore(state => state.portal?.mode);
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
      id="portal-screen"
      ref={dialogRef}
      className={styles.screen}
      aria-labelledby="portal-title"
      onClose={() => uiCommands.closePortal()}
      // Respawn mode has no way out but to pick, so the native Escape dismissal is
      // vetoed here just as the window key layer ignores it.
      onCancel={event => { if (mode === 'respawn') event.preventDefault(); }}
      onPointerDown={event => {
        if (event.target === dialogRef.current && mode !== 'respawn') uiCommands.closePortal();
      }}
    >
      {open && <PortalCard closeRef={closeRef} />}
    </dialog>
  );
}

function PortalCard({closeRef}: {closeRef: RefObject<HTMLButtonElement | null>}) {
  const portal = useUiStore(state => state.portal);
  if (!portal) return null;
  const {mode, source, destinations} = portal;

  return (
    <div id="portal-card" className={styles.card}>
      <div className={styles.header}>
        <h2 id="portal-title">{headerFor(portal)}</h2>
        {mode !== 'respawn' && (
          <button
            id="portalCloseBtn"
            ref={closeRef}
            className={styles.closeBtn}
            aria-label="Close portal list"
            onClick={event => { event.stopPropagation(); uiCommands.closePortal(); }}
          >×</button>
        )}
      </div>
      <div className={styles.body}>
        {mode === 'travel' && source && <NameEditor key={source.name} name={source.name} />}
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

/** One destination: its name, depth (metres, 0 at the surface) and distance in tiles. */
function DestinationRow({destination}: {destination: PortalDestinationView}) {
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
      </button>
    </li>
  );
}

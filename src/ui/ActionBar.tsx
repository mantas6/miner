import { uiCommands } from './commands';
import { useUiStore } from './store';
import styles from './ActionBar.module.css';

/**
 * The surface/underground action buttons. Keyboard equivalents live in input.ts.
 *
 * Deployables are not here: a scanner and a stick of dynamite are placed from the
 * inventory slot that holds them. The teleporter is carried the same way but kept
 * on the bar, because it is not aimed at a tile: it acts on the ship, and the bar
 * is where its state — deep enough, how many are left — is shown.
 */
export function ActionBar() {
  const atSurface = useUiStore(state => state.hud.atSurface);
  const gameOver = useUiStore(state => state.hud.gameOver);
  const teleporters = useUiStore(state => state.hud.teleporters);
  const teleportReturn = useUiStore(state => state.hud.teleportReturn);
  const teleportUsable = useUiStore(state => state.hud.teleportUsable);

  // TODO(portals phase 4): the teleporter opens the portal list; there is no depth
  // gate, so the label no longer carries a "usable from N m" branch.
  const teleportLabel = atSurface ? 'Return (T)' : `Teleport (T) · x${teleporters}`;

  return (
    <div className={styles.actionBar}>
      {/* `hidden` is the only gate on where a button applies (the CSS hides it and
          the UA takes it out of the tab order); `disabled` only says why an
          otherwise-visible button cannot fire, so the two never repeat a term.
          The ship screen fits and unfits upgrades from the cargo bay; it needs no
          proximity to a station, so the button is never hidden. */}
      <button
        id="shipBtn"
        className={styles.openShipBtn}
        onClick={event => { event.stopPropagation(); uiCommands.openShip(); }}
      >Ship</button>
      {/* Underground the button is only worth showing with a teleporter aboard;
          at home base it is the stored return point, not an item, that the trip
          back spends. */}
      <button
        id="teleporterBtn"
        hidden={atSurface ? !teleportReturn : teleporters <= 0}
        disabled={gameOver || !teleportUsable}
        onClick={() => uiCommands.useTeleporter()}
      >{teleportLabel}</button>
      <button id="infoBtn" onClick={event => { event.stopPropagation(); uiCommands.openInfo(); }}>Info / Cargo</button>
    </div>
  );
}

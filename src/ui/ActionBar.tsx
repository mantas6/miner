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
  const gameOver = useUiStore(state => state.hud.gameOver);
  const teleportCount = useUiStore(state => state.hud.teleport.count);
  const teleportUsable = useUiStore(state => state.hud.teleport.usable);

  // The teleporter opens the portal list; there is no depth gate and no return
  // point, so the label is simply the charges aboard, and the tooltip says what the
  // press does — or, while it is dead, why it cannot.
  const teleportLabel = `Teleport (T) · x${teleportCount}`;
  const teleportTitle = teleportUsable
    ? 'Teleporter — open the portal list'
    : 'Teleporter — every portal is already within reach';

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
      {/* The teleporter is a carried charge that opens the portal list, so the
          button is only worth showing with one aboard, wherever the ship is. */}
      <button
        id="teleporterBtn"
        hidden={teleportCount <= 0}
        disabled={gameOver || !teleportUsable}
        title={teleportTitle}
        onClick={() => uiCommands.useTeleporter()}
      >{teleportLabel}</button>
      <button id="infoBtn" onClick={event => { event.stopPropagation(); uiCommands.openInfo(); }}>Info / Cargo</button>
    </div>
  );
}

// The station keyboard prompt, centred over the mine.
//
// It sits where the fuel banner sits — the one spot the game reserves for the line
// worth reading mid-run — but as plain text, not a banner: "press Space" is an
// offer, not an emergency. The hint names whichever station is in reach; the game
// leaves it empty when none is. Under a modal overlay it would only prompt at a
// backdrop, so it is hidden then.

import { useUiStore } from './store';
import styles from './StationHint.module.css';

export function StationHint() {
  const hint = useUiStore(state => state.hud.stationHint);
  const overlayOpen = useUiStore(state => state.activeOverlay !== null);
  const shown = overlayOpen ? '' : hint;
  return (
    <div id="stationHint" className={styles.hint} aria-live="polite" hidden={!shown}>{shown}</div>
  );
}

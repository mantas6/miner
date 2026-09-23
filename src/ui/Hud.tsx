import clsx from 'clsx';
import { ActionBar } from './ActionBar';
import { FuelGauge } from './FuelGauge';
import { InventoryPanel } from './InventoryPanel';
import { Scanner } from './Scanner';
import { StatsGrid } from './StatsGrid';
import { uiCommands } from './commands';
import { useUiStore } from './store';
import styles from './Hud.module.css';

/** The always-on overlay: audio, meters, readouts, actions. */
export function Hud() {
  const musicOn = useUiStore(state => state.musicOn);
  const musicLabel = useUiStore(state => state.musicLabel);
  const sfxOn = useUiStore(state => state.sfxOn);
  const sfxLabel = useUiStore(state => state.sfxLabel);

  return (
    <div id="hud" className={styles.hud} aria-label="Game status and actions">
      <div className={styles.top}>
        {/* The soundtrack and the effects mute independently, one button each. */}
        <button
          id="musicBtn"
          className={clsx(styles.soundBtn, !musicOn && styles.mutedNote)}
          aria-label={musicLabel}
          aria-pressed={musicOn}
          title={musicLabel}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); uiCommands.toggleMusic(); }}
        >🎵</button>
        <button
          id="sfxBtn"
          className={clsx(styles.soundBtn, !sfxOn && styles.muted)}
          aria-label={sfxLabel}
          aria-pressed={sfxOn}
          title={sfxLabel}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); uiCommands.toggleSfx(); }}
        >{sfxOn ? '🔊' : '🔇'}</button>
      </div>

      <StatsGrid />
      {/* The left column of the middle row: readouts that stack downward from
          under the sound strip, clear of the meters pinned to the bottom. */}
      <div className={styles.middle}>
        <Scanner />
        <InventoryPanel />
      </div>
      <FuelGauge />
      <ActionBar />
    </div>
  );
}

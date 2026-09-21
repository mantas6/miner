import { DEVELOPER_EXTRACTOR_COAL, DEVELOPER_ORE_BUNDLE } from '../core/developer';
import { uiCommands } from './commands';
import styles from './DeveloperPanel.module.css';

/**
 * The cheat menu, disclosed from the Settings tab.
 *
 * Two grants and two resets. Nothing here reads the live ship snapshot, so the
 * panel does not subscribe to a 60 Hz store slice while it is out of sight.
 */
export function DeveloperPanel() {
  return (
    <div id="cheat-menu" className={styles.section} role="group" aria-labelledby="settings-cheats-title">
      <p className={styles.warning}><strong>Cheats:</strong> grant materials or stock the oil extractor for exactly $0. These controls work above or below the surface.</p>
      <div id="developerUpgrades" className={styles.upgrades} aria-label="Free developer controls">
        <div className={styles.upgrade}>
          <div>
            <strong>Grant ores</strong>
            <span>Fills the cargo bay, then the station stock</span>
          </div>
          <button
            type="button"
            data-developer-grant-ores
            onClick={() => uiCommands.grantDeveloperOres()}
          >Developer: Grant {DEVELOPER_ORE_BUNDLE}× every ore</button>
        </div>
        <div className={styles.upgrade}>
          <div>
            <strong>Fill extractor</strong>
            <span>Queues coal and stores fuel</span>
          </div>
          <button
            type="button"
            data-developer-fill-extractor
            onClick={() => uiCommands.fillExtractor()}
          >Developer: Load {DEVELOPER_EXTRACTOR_COAL} coal + fill fuel</button>
        </div>
      </div>
      <div className={styles.playerDataReset} aria-labelledby="player-data-reset-title">
        <h4 id="player-data-reset-title">Player Data</h4>
        <p>Start this player over without regenerating or repairing the mine terrain.</p>
        <button
          id="resetPlayerDataBtn"
          type="button"
          onClick={event => { event.stopPropagation(); uiCommands.resetPlayerData(); }}
        >Reset All Player Data</button>
      </div>
      <div className={styles.worldStateReset} aria-labelledby="world-state-reset-title">
        <h4 id="world-state-reset-title">World State</h4>
        <p>Regenerate terrain and world enemies for this mine without changing your cash, equipment, inventory, stats, ship condition, or settings. Explored fog is cleared so regenerated terrain is not revealed.</p>
        <button
          id="resetWorldStateBtn"
          type="button"
          onClick={event => { event.stopPropagation(); uiCommands.resetWorldState(); }}
        >Reset World State</button>
      </div>
    </div>
  );
}

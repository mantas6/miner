import { formatDepthMilestone } from '../core/depth-milestone';
import { useUiStore } from './store';
import styles from './StatsGrid.module.css';

/** Cash and depth readouts. Each cell subscribes to its own number. */
export function StatsGrid() {
  const cash = useUiStore(state => state.hud.cash);
  const depthMeters = useUiStore(state => state.hud.depthMeters);
  // The next depth landmark rides under the depth number; crossing one also toasts.
  const depthTarget = useUiStore(state => state.hud.depthTarget);
  const depthTargetKind = useUiStore(state => state.hud.depthTargetKind);
  const depthTargetRemaining = useUiStore(state => state.hud.depthTargetRemaining);
  const depthTargetRecord = useUiStore(state => state.hud.depthTargetRecord);
  const caption = formatDepthMilestone({target: depthTarget, remainingMeters: depthTargetRemaining, recordMeters: depthTargetRecord});
  return (
    <div className={styles.statsGrid}>
      <div className={styles.stat}><span>Cash</span><strong id="cash">${Math.floor(cash)}</strong></div>
      <div className={styles.stat}>
        <span>Depth</span>
        <strong id="depth">{depthMeters} m</strong>
        <em id="depthTarget" className={styles.target} data-kind={depthTargetKind}>{caption}</em>
      </div>
    </div>
  );
}

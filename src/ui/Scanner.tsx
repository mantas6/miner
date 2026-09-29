import { useUiStore } from './store';
import styles from './Scanner.module.css';

/**
 * Terrain readout for the tile the drill is aimed at. The game re-formats it only
 * when the target, its hit points, or what is standing in it change, so this
 * repaints on a new tile rather than on every frame. A second line, the
 * trading-post beacon, shows only while a post is near.
 */
export function Scanner() {
  const scanner = useUiStore(state => state.hud.scanner);
  const postHint = useUiStore(state => state.hud.postHint);
  const gameOver = useUiStore(state => state.hud.gameOver);
  return (
    <div id="scanner" className={styles.scanner} hidden={gameOver}>
      {scanner}
      <div id="postHint" className={styles.postHint} hidden={!postHint}>{postHint}</div>
    </div>
  );
}

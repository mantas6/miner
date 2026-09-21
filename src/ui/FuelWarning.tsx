import clsx from 'clsx';
import { useUiStore } from './store';
import styles from './FuelWarning.module.css';

/**
 * One banner, two reasons to panic: the tank is nearly dry, or there is still
 * fuel but no longer enough to climb home from this depth. A dry tank wins the
 * wording, because refuelling is the only cure for it; the depth-aware warning
 * only speaks up while the tank still looks healthy.
 */
export function FuelWarning() {
  const lowFuel = useUiStore(state => state.hud.fuelAlert);
  const reserveUrgent = useUiStore(state => state.hud.fuelReserveStatus === 'urgent');
  const gameOver = useUiStore(state => state.hud.gameOver);
  const atSurface = useUiStore(state => state.hud.atSurface);
  const noReturnFuel = reserveUrgent && !gameOver && !atSurface;

  return (
    <div id="fuel-warning" className={clsx(styles.warning, (lowFuel || noReturnFuel) && styles.show)} role="alert">
      {lowFuel ? '⚠ LOW FUEL — return home to refuel' : '⚠ RETURN FUEL SPENT — climb home now'}
    </div>
  );
}

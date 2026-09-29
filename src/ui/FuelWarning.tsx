import clsx from 'clsx';
import { useUiStore } from './store';
import styles from './FuelWarning.module.css';

/**
 * One banner, two reasons to panic: the tank is nearly dry, or there is still
 * fuel but no longer enough to climb home from this depth. A dry tank wins the
 * wording, because refuelling is the only cure for it; the depth-aware warning
 * only speaks up while the tank still looks healthy, and names the exit the
 * forecast is priced to — home, or the portal a jump home leaves from.
 */
export function FuelWarning() {
  const lowFuel = useUiStore(state => state.hud.fuelAlert);
  const reserveUrgent = useUiStore(state => state.hud.fuelReserveStatus === 'urgent');
  const exit = useUiStore(state => state.hud.fuelReserveExit);
  const gameOver = useUiStore(state => state.hud.gameOver);
  const atSurface = useUiStore(state => state.hud.atSurface);
  const noReturnFuel = reserveUrgent && !gameOver && !atSurface;
  const spent = exit === 'Home' ? 'climb home now' : `make for ${exit} now`;

  return (
    <div id="fuel-warning" className={clsx(styles.warning, (lowFuel || noReturnFuel) && styles.show)} role="alert">
      {lowFuel ? '⚠ LOW FUEL — return home to refuel' : `⚠ RETURN FUEL SPENT — ${spent}`}
    </div>
  );
}

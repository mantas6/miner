import clsx from 'clsx';
import type { ReactNode } from 'react';
import { getFuelGaugeSegments } from '../core/fuel-reserve';
import { useUiStore } from './store';
import styles from './BarRow.module.css';

interface GaugeProps {
  id: string;
  name: string;
  value: number;
  max: number;
  status?: string;
  /** Hover text, for the one gauge that has more to say than its caption. */
  title?: string;
  children: ReactNode;
}

/**
 * The track every bar is drawn in: a box this file owns, filled by its children.
 *
 * Hull and cargo used to be native `<meter>`s, which is why the three bars were
 * never the same height. A meter's painted bar belongs to the engine, not to the
 * page: Chrome 151 draws it at half the element's height, centred, and ignores
 * `height` on `::-webkit-meter-bar` and `::-webkit-meter-optimum-value` even with
 * `!important`, while Gecko's `::-moz-meter-bar` fills the box. So an 18px meter
 * showed a 9px bar next to the fuel gauge's 18px one in Chrome and an 18px bar in
 * Firefox — the box was deterministic all along, the paint was not.
 *
 * Drawing all three the same way is the only way to make them agree. `role="meter"`
 * keeps the semantics the element carried; the cost is that a div is not labelable,
 * so the caption is a plain `<span>` and the name comes from `aria-label`, exactly
 * as the fuel gauge has always done.
 */
function Gauge({id, name, value, max, status, title, children}: GaugeProps) {
  return (
    <div
      id={id}
      className={clsx(styles.gauge, status && styles[status])}
      data-status={status}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={name}
      title={title}
    >
      {children}
    </div>
  );
}

interface BarProps {
  id: string;
  label: string;
  value: number;
  max: number;
  text: string;
  alert: boolean;
}

/**
 * One labelled meter. The caption is the whole accessible name — the numbers are
 * already in the gauge's value, so repeating them there would have a screen reader
 * read "hull 70/100, 70 out of 100". The value text is for the eye only.
 */
function Bar({id, label, value, max, text, alert}: BarProps) {
  return (
    <div className={clsx(styles.bar, alert && styles.alert)}>
      <span className={styles.barCaption}>{label}</span>
      <Gauge id={id} name={label} value={value} max={max}>
        <span className={styles.gaugeFill} style={{width: `${max > 0 ? Math.min(1, value / max) * 100 : 0}%`}} />
      </Gauge>
      <span id={`${id}Label`} className={styles.barValue}>{text}</span>
    </div>
  );
}

/**
 * The fuel meter, split where the climb home ends: the first slice is fuel the
 * return trip will burn, the second is what would still be aboard at the depot.
 *
 * The forecast used to be its own widget under the meter, which said the same
 * thing twice in two places. Now the gauge is the forecast — a shrinking bright
 * slice means the surplus is running out, and once the climb costs more than the
 * tank holds the bright slice is gone and the whole fill reads urgent. The
 * numbers behind it stay in the accessible name, so nothing new competes for
 * screen space with the low-fuel banner.
 */
function FuelBar() {
  const fuel = useUiStore(state => state.hud.fuel);
  const fuelMax = useUiStore(state => state.hud.fuelMax);
  const alert = useUiStore(state => state.hud.fuelAlert);
  const status = useUiStore(state => state.hud.fuelReserveStatus);
  const needed = useUiStore(state => state.hud.fuelReserveNeeded);
  const margin = useUiStore(state => state.hud.fuelReserveMargin);
  const atSurface = useUiStore(state => state.hud.atSurface);

  const value = Math.max(0, fuel);
  const text = `${Math.ceil(value)}/${fuelMax}`;
  const {returnFraction, surplusFraction} = getFuelGaugeSegments(value, fuelMax, needed);
  const label = atSurface
    ? `Fuel ${text}`
    : status === 'urgent'
      ? `Fuel ${text} — climb home needs ${needed}`
      : `Fuel ${text} — ${margin} left after climbing home`;

  return (
    <div className={clsx(styles.bar, alert && styles.alert)}>
      <span className={styles.barCaption}>Fuel</span>
      {/* The one bar whose name carries numbers: the forecast is a sentence, and
          the gauge's value alone cannot say how much of it the climb home owes. */}
      <Gauge id="fuel" name={label} value={value} max={fuelMax} status={status} title={label}>
        <span id="fuelReturn" className={styles.gaugeReturn} style={{width: `${returnFraction * 100}%`}} />
        <span id="fuelSurplus" className={styles.gaugeSurplus} style={{width: `${surplusFraction * 100}%`}} />
      </Gauge>
      <span id="fuelLabel" className={styles.barValue}>{text}</span>
    </div>
  );
}

/** Fuel, hull and cargo meters. */
export function BarRow() {
  const hull = useUiStore(state => state.hud.hull);
  const hullMax = useUiStore(state => state.hud.hullMax);
  const hullAlert = useUiStore(state => state.hud.hullAlert);
  const cargo = useUiStore(state => state.hud.cargo);
  const cargoMax = useUiStore(state => state.hud.cargoMax);
  const cargoAlert = useUiStore(state => state.hud.cargoAlert);

  return (
    <div className={styles.barRow}>
      <FuelBar />
      <Bar id="hull" label="Hull" value={Math.max(0, hull)} max={hullMax} text={`${Math.ceil(Math.max(0, hull))}/${hullMax}`} alert={hullAlert} />
      <Bar id="cargo" label="Cargo" value={cargo} max={cargoMax} text={`${cargo}/${cargoMax}`} alert={cargoAlert} />
    </div>
  );
}

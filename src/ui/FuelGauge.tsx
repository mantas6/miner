import clsx from 'clsx';
import { useUiStore } from './store';
import styles from './FuelGauge.module.css';

/**
 * The dial is a quarter circle pivoting in its bottom-left corner, so it tucks
 * into the HUD's bottom-left corner: F is at 12 o'clock (needle up, full), E at
 * 3 o'clock (needle right, empty), and the needle climbs counter-clockwise as
 * the tank fills. All geometry is in the 96×96 viewBox's user units.
 */
const PIVOT_X = 12;
const PIVOT_Y = 84;
const RADIUS = 66;
const NEEDLE_LEN = 60;

/** A point on the dial at `angle` degrees (−90 = up/F, 0 = right/E) and radius `r`. */
function polar(angle: number, r: number): [number, number] {
  const rad = (angle * Math.PI) / 180;
  return [PIVOT_X + r * Math.cos(rad), PIVOT_Y + r * Math.sin(rad)];
}

/** An SVG arc path along the scale circle, sweeping clockwise from `from` to `to`. */
function arc(from: number, to: number): string {
  const [x1, y1] = polar(from, RADIUS);
  const [x2, y2] = polar(to, RADIUS);
  return `M ${x1} ${y1} A ${RADIUS} ${RADIUS} 0 0 1 ${x2} ${y2}`;
}

/** One radial tick from `inner` to the scale circle at `angle`. */
function tick(angle: number, inner: number): {x1: number; y1: number; x2: number; y2: number} {
  const [x1, y1] = polar(angle, inner);
  const [x2, y2] = polar(angle, RADIUS);
  return {x1, y1, x2, y2};
}

/** The F letter sits above the arc's top end, E just past its right end. */
const [fX, fY] = polar(-90, RADIUS);
const [eX, eY] = polar(0, RADIUS);
// The low-fuel LED sits below the pivot's horizontal line (y = PIVOT_Y) and just
// right of the E letter. The needle only ever sweeps the quarter disc above that
// line (angles −90°..0°), so it can never pass over the LED at any fuel level.
// Both coordinates stay inside the 96×96 viewBox so the panel padding holds.
const ledX = eX + 13;
const ledY = eY + 4;

/**
 * The bottom-left HUD panel: an analog fuel gauge over plain fuel and hull
 * readouts, each a caption and a `current/max` number. The cargo bar is gone —
 * the objective line and the spoken status carry a full hold.
 */
export function FuelGauge() {
  const fuel = useUiStore(state => state.hud.fuel);
  const fuelMax = useUiStore(state => state.hud.fuelMax);
  const fuelAlert = useUiStore(state => state.hud.fuelAlert);
  const status = useUiStore(state => state.hud.fuelReserveStatus);
  const needed = useUiStore(state => state.hud.fuelReserveNeeded);
  const margin = useUiStore(state => state.hud.fuelReserveMargin);
  const atSurface = useUiStore(state => state.hud.atSurface);
  const hull = useUiStore(state => state.hud.hull);
  const hullMax = useUiStore(state => state.hud.hullMax);
  const hullAlert = useUiStore(state => state.hud.hullAlert);

  const value = Math.max(0, fuel);
  const text = `${Math.ceil(value)}/${fuelMax}`;
  // The gauge no longer draws the forecast, but its wording is still the one the
  // banner and the screen reader carry, so it stays on the accessible name.
  const label = atSurface
    ? `Fuel ${text}`
    : status === 'urgent'
      ? `Fuel ${text} — climb home needs ${needed}`
      : `Fuel ${text} — ${margin} left after climbing home`;

  const fraction = fuelMax > 0 ? Math.min(1, Math.max(0, value / fuelMax)) : 0;
  // E = 0° (needle right), F = −90° (needle up); the tank fills counter-clockwise.
  const angle = -90 * fraction;

  const hullValue = Math.max(0, hull);

  return (
    <div className={styles.panel}>
      <div
        id="fuel"
        className={styles.gauge}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={fuelMax}
        aria-valuenow={value}
        aria-label={label}
        title={label}
      >
        <svg className={styles.dial} viewBox="0 0 96 96" aria-hidden="true">
          <path className={styles.arc} d={arc(-90, 0)} />
          {/* Low-fuel band: the E-side quarter of the scale, in muted red. */}
          <path className={styles.redBand} d={arc(-22.5, 0)} />
          {[-90, -45, 0].map(a => {
            const t = tick(a, RADIUS - 8);
            return <line key={a} className={styles.tick} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />;
          })}
          {[-67.5, -22.5].map(a => {
            const t = tick(a, RADIUS - 5);
            return <line key={a} className={styles.tickMinor} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />;
          })}
          <text className={styles.letter} x={fX} y={fY - 6} textAnchor="middle">F</text>
          <text className={styles.letter} x={eX + 4} y={eY + 4} textAnchor="middle">E</text>
          <line
            id="fuelNeedle"
            className={styles.needle}
            x1={PIVOT_X}
            y1={PIVOT_Y}
            x2={PIVOT_X + NEEDLE_LEN}
            y2={PIVOT_Y}
            style={{transform: `rotate(${angle}deg)`, transformOrigin: `${PIVOT_X}px ${PIVOT_Y}px`}}
          />
          <circle className={styles.hub} cx={PIVOT_X} cy={PIVOT_Y} r={3.5} />
          {/* The banner announces low fuel; this is the same alarm for the eye. It
              sits below the pivot line, clear of the needle's sweep, so a low tank's
              needle resting near E can't cover the lit LED. */}
          <circle id="fuelLed" className={clsx(styles.led, fuelAlert && styles.on)} cx={ledX} cy={ledY} r={3.5} />
        </svg>
      </div>
      <div id="fuelReadout" className={clsx(styles.line, fuelAlert && styles.alert)}>
        <span className={styles.caption}>Fuel</span>
        <span id="fuelLabel" className={styles.value}>{text}</span>
      </div>
      <div id="hull" className={clsx(styles.line, hullAlert && styles.alert)}>
        <span className={styles.caption}>Hull</span>
        <span id="hullLabel" className={styles.value}>{`${Math.ceil(hullValue)}/${hullMax}`}</span>
      </div>
    </div>
  );
}

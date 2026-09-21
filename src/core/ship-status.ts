// The state of the ship as one spoken line.
//
// Everything else the HUD says is on screen: the meters carry fuel, hull and
// cargo, the scanner carries what the drill is pointed at, and the toasts carry
// events. What was only ever legible from the canvas is the ship's *situation* —
// parked at home base or out in the mine, holds full, hull about to give — so
// this is the one readout that exists for the live region rather than for the
// layout.
//
// It is deliberately built from thresholds and nothing else. A live region that
// changed with a continuous value would talk over itself sixty times a second, so
// there is no depth, no litre count and no cash here: those are numbers a reader
// can go and read, while these are the four transitions worth interrupting for.
//
// Like the home prompt next door, the wording is a lookup rather than a joined
// string, because this runs once per animation frame.

export interface ShipStatusInput {
  gameOver: boolean;
  atSurface: boolean;
  /** The cargo bay cannot take another ore. */
  cargoFull: boolean;
  /** The hull is inside its warning fraction. */
  hullCritical: boolean;
}

const SHIP_LOST = 'Ship lost. Press R to deploy a replacement.';

const SURFACE = 0b100;
const CARGO_FULL = 0b010;
const HULL_CRITICAL = 0b001;

/** Indexed by the flag bits below: location first, then whatever is going wrong. */
const STATUS_BY_FLAGS: readonly string[] = [
  'In the mine.',
  'In the mine. Hull critical.',
  'In the mine. Cargo hold full.',
  'In the mine. Cargo hold full. Hull critical.',
  'At home base.',
  'At home base. Hull critical.',
  'At home base. Cargo hold full.',
  'At home base. Cargo hold full. Hull critical.'
];

/** What a player who cannot see the mine needs to hear about the ship in it. */
export function formatShipStatusAnnouncement({
  gameOver,
  atSurface,
  cargoFull,
  hullCritical
}: ShipStatusInput): string {
  if (gameOver) return SHIP_LOST;
  return STATUS_BY_FLAGS[
    (atSurface ? SURFACE : 0) | (cargoFull ? CARGO_FULL : 0) | (hullCritical ? HULL_CRITICAL : 0)
  ];
}

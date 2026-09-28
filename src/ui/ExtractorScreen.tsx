// The fuel extractor screen.
//
// It shows the two buffers — coal queued for conversion and fuel already stored,
// read as `n / cap` — and, while a coal is burning, how long until the next unit
// of fuel lands. Below sit the two transfers: "Load coal (n)" queues every coal
// in the bay, and "Refuel ship (+n)" tops the tank up from stored fuel. Each names
// the amount it would move and goes dead when that amount is zero. The tank also
// tops up on its own the moment the ship parks on the extractor tile; the button
// is there to top off again while parked as more fuel converts.
//
// Everything is painted from the store: the buffers and progress animate as the
// fixed-step extractor tick pushes fresh values in while the screen is open, and
// the button amounts follow the bay and the tank. The screen holds no copy of any
// of it.
//
// The `<dialog>` itself, its focus and its close requests are `ModalShell`'s. Its
// close is the home-station one the manufacturer's screen dispatches too.

import { EXTRACTOR } from '../core/balance';
import { oreKind } from '../core/inventory';
import { uiCommands } from './commands';
import { CardHeader, ModalShell } from './ModalShell';
import { overlayOf, useUiStore } from './store';
import styles from './ExtractorScreen.module.css';

const COAL_KIND = oreKind('Coal');

/** Fixed-step ticks are 60 Hz, so this many ticks is one on-screen second. */
const TICKS_PER_SECOND = 60;

export function ExtractorScreen() {
  const open = useUiStore(state => state.overlay?.kind === 'extractor');
  return (
    <ModalShell id="extractor-screen" titleId="extractor-title" open={open} onRequestClose={() => uiCommands.closeStation()}>
      {open && <ExtractorCard />}
    </ModalShell>
  );
}

function ExtractorCard() {
  const coal = useUiStore(state => overlayOf(state, 'extractor')?.extractor.coal ?? 0);
  const fuel = useUiStore(state => overlayOf(state, 'extractor')?.extractor.fuel ?? 0);
  const progress = useUiStore(state => overlayOf(state, 'extractor')?.extractor.progress ?? 0);
  // The ship's tank, off the HUD snapshot the loop refreshes every frame.
  const playerFuel = useUiStore(state => state.hud.fuel);
  const fuelMax = useUiStore(state => state.hud.fuelMax);
  const bayCoal = useUiStore(state => state.inventorySlots.find(slot => slot.kind === COAL_KIND)?.count ?? 0);

  const storedFuel = Math.round(fuel);
  // Room the tank has left, and what one refuel would pour in: never more than is stored.
  const refuelAmount = Math.round(Math.min(fuel, Math.max(0, fuelMax - playerFuel)));
  // Only count down while a coal is actually burning — full tank or empty queue, it idles.
  const converting = coal > 0 && fuel < EXTRACTOR.fuelCap;
  const secondsToNext = converting
    ? Math.max(1, Math.ceil((EXTRACTOR.ticksPerCoal - progress) / TICKS_PER_SECOND))
    : 0;

  return (
    <div id="extractor-card" className={styles.card}>
      <CardHeader
        titleId="extractor-title"
        title="Fuel Extractor"
        closeId="extractorCloseBtn"
        closeLabel="Close fuel extractor"
        onClose={() => uiCommands.closeStation()}
      />
      <div className={styles.body}>
        <dl className={styles.buffers}>
          <div className={styles.buffer}>
            <dt>Coal queued</dt>
            <dd id="extractorCoal">{Math.round(coal)}</dd>
          </div>
          <div className={styles.buffer}>
            <dt>Fuel stored</dt>
            <dd id="extractorFuel">{storedFuel} <span className={styles.cap}>/ {EXTRACTOR.fuelCap}</span></dd>
          </div>
        </dl>
        <p id="extractorStatus" className={styles.status}>
          {converting
            ? `Converting — next fuel in ${secondsToNext}s.`
            : coal > 0
              ? 'Fuel store full — refuel to resume converting.'
              : 'Idle — load coal to make fuel.'}
        </p>
        <div className={styles.actions}>
          <button
            id="loadCoalBtn"
            type="button"
            className={styles.action}
            disabled={bayCoal <= 0}
            onClick={() => uiCommands.loadCoal()}
          >
            Load coal ({bayCoal})
          </button>
          <button
            id="refuelBtn"
            type="button"
            className={styles.action}
            disabled={refuelAmount <= 0}
            onClick={() => uiCommands.refuelFromExtractor()}
          >
            Refuel ship (+{refuelAmount})
          </button>
        </div>
      </div>
    </div>
  );
}

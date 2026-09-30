// The fuel extractor screen.
//
// It shows the two buffers — coal queued for conversion and fuel already stored,
// read as `n / cap` — and, while a coal is burning, how long until the next unit
// of fuel lands. Below sit the two transfers: "Load coal (n)" queues every coal
// in the bay, and "Refuel ship (+n)" tops the tank up from stored fuel. Each names
// the amount it would move and goes dead when that amount is zero. A ship parked
// on the extractor tile or beside it — the same reach this screen opens from — is
// kept topped up on its own, fresh conversions included, so with the screen up
// the Refuel button has nothing left to pour and stays dead. The
// base's own extractor adds a third: "Buy fuel (+n) $c" orders up to
// `EXTRACTOR_FUEL_ORDER` fuel into the store for cash, dead while the store is full
// or the wallet cannot cover a unit — and then it still quotes the rate
// ("Buy fuel ($29 per 100)"), so the price is known before it is needed.
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
import { EXTRACTOR_FUEL_ORDER, extractorFuelOrder, extractorFuelOrderPrice } from '../core/trading';
import { uiCommands } from './commands';
import { CardHeader, ModalShell } from './ModalShell';
import { overlayOf, useUiStore } from './store';
import styles from './ExtractorScreen.module.css';

const COAL_KIND = oreKind('Coal');

/** The order button's rate while it has nothing to buy: "Buy fuel ($29 per 100)". */
const ORDER_RATE_LABEL = `Buy fuel ($${extractorFuelOrderPrice()} per ${EXTRACTOR_FUEL_ORDER})`;

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
  const supply = useUiStore(state => overlayOf(state, 'extractor')?.extractor.supply ?? false);
  const cash = useUiStore(state => state.hud.cash);
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
  const order = extractorFuelOrder(fuel, cash);

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
          {supply && (
            <button
              id="extractorBuyFuelBtn"
              type="button"
              className={styles.wide}
              disabled={order.amount <= 0}
              onClick={() => uiCommands.buyExtractorFuel()}
            >
              {order.amount > 0 ? `Buy fuel (+${Math.round(order.amount)}) $${order.cost}` : ORDER_RATE_LABEL}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

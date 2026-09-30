// The trading-post screen.
//
// Two columns. On the left, Sell: every ore stack aboard, each with a Sell button
// that empties the stack for cash and a "1" that sells a single unit. On the right,
// Buy: first the fuel row, which fills the tank as far as the wallet reaches and is
// never out of stock; then the post's 2–3 offers, each a finished item with its
// price and remaining stock, its button live only while the player can afford it,
// the post still has one, and the bay has room. The header carries the wallet,
// which is the whole point of the screen, and the post's fuel price per unit —
// dearer the deeper the post stands.
//
// Everything is painted from the store and is live: the sell side is the same bay
// stacks the HUD panel shows, synced every frame; the buy side is pushed by the game
// on open and after every purchase; the cash header follows the HUD. So the screen
// holds no copy of anything and cannot disagree with the simulation.
//
// The `<dialog>` itself, its focus and its close requests are `ModalShell`'s.

import { isOreKind, type InventoryItemKind } from '../core/inventory';
import { fuelPurchase, fuelUnitPrice } from '../core/trading';
import { uiCommands } from './commands';
import { overlayOf, useUiStore, type InventorySlotView, type TradeOfferView } from './store';
import { CardHeader, ModalShell } from './ModalShell';
import { useItemTooltip } from './Tooltip';
import styles from './TradeScreen.module.css';

/** A stable stand-in while no post is open, so the selector never returns a fresh array. */
const NO_OFFERS: TradeOfferView[] = [];

export function TradeScreen() {
  const open = useUiStore(state => state.overlay?.kind === 'trade');
  return (
    <ModalShell id="trade-screen" titleId="trade-title" open={open} onRequestClose={() => uiCommands.closeTrade()}>
      {open && <TradeCard />}
    </ModalShell>
  );
}

function TradeCard() {
  const cash = useUiStore(state => state.hud.cash);
  const cargo = useUiStore(state => state.hud.cargo);
  const cargoMax = useUiStore(state => state.hud.cargoMax);
  const baySlots = useUiStore(state => state.inventorySlots);
  const buyOffers = useUiStore(state => overlayOf(state, 'trade')?.offers ?? NO_OFFERS);
  const fuelPrice = useUiStore(state => overlayOf(state, 'trade')?.fuelPrice ?? fuelUnitPrice());
  const oreSlots = baySlots.filter(slot => isOreKind(slot.kind));
  const bayFull = cargo >= cargoMax;

  return (
    <div id="trade-card" className={styles.card}>
      <CardHeader
        titleId="trade-title"
        title="Trading Post"
        closeId="tradeCloseBtn"
        closeLabel="Close trading post"
        onClose={() => uiCommands.closeTrade()}
      >
        <span id="tradeFuelPrice" className={styles.fuelPrice}>Fuel ${fuelPrice.toFixed(2)}/unit</span>
        <span id="tradeCash" className={styles.cash}>${cash}</span>
      </CardHeader>
      <div className={styles.body}>
        <div className={styles.columns}>
          <section className={styles.column} aria-labelledby="tradeSell-title">
            <div className={styles.columnHeading}>
              <h3 id="tradeSell-title">Sell ore</h3>
              <span>Sell a whole stack, or 1, for cash.</span>
            </div>
            <ul id="tradeSell" className={styles.slots}>
              {oreSlots.length === 0 && (
                <li className={styles.empty}><span className={styles.emptyLabel}>No ore aboard</span></li>
              )}
              {oreSlots.map(slot => <SellRow key={slot.index} slot={slot} />)}
            </ul>
          </section>
          <section className={styles.column} aria-labelledby="tradeBuy-title">
            <div className={styles.columnHeading}>
              <h3 id="tradeBuy-title">Buy gear</h3>
              <span>Limited stock — once it is gone, it is gone.</span>
            </div>
            <ul id="tradeBuy" className={styles.slots}>
              <FuelRow cash={cash} unitPrice={fuelPrice} />
              {buyOffers.length === 0 && (
                <li className={styles.empty}><span className={styles.emptyLabel}>Nothing for sale</span></li>
              )}
              {buyOffers.map(offer => <BuyRow key={offer.kind} offer={offer} cash={cash} bayFull={bayFull} />)}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

/** One ore stack, with a whole-stack Sell and a single-unit "1". */
function SellRow({slot}: {slot: InventorySlotView}) {
  const sell = (kind: InventoryItemKind, single: boolean) => uiCommands.sellToPost(kind, single);
  const tooltip = useItemTooltip(slot.kind);
  return (
    <li>
      <div className={styles.slot} {...tooltip}>
        <span className={styles.icon} style={{background: slot.color}} aria-hidden="true" />
        <span className={styles.label}>{slot.label}</span>
        <span className={styles.count}>×{slot.count}</span>
        <button
          type="button"
          className={styles.action}
          data-trade="sell"
          data-trade-kind={slot.kind}
          aria-label={`Sell all ${slot.label}`}
          onClick={() => sell(slot.kind, false)}
        >Sell</button>
        <button
          type="button"
          className={styles.action}
          data-trade="sell-one"
          data-trade-kind={slot.kind}
          aria-label={`Sell one ${slot.label}`}
          onClick={() => sell(slot.kind, true)}
        >1</button>
      </div>
    </li>
  );
}

/** Swatch for the fuel row, the amber of a fuel light. */
const FUEL_COLOR = '#e0a13a';

/**
 * Fuel for cash: fills the tank as far as the wallet reaches. Not a stocked offer —
 * a post never runs dry of fuel — so it is its own row, dead only while the tank is
 * full or the wallet cannot cover one unit.
 */
function FuelRow({cash, unitPrice}: {cash: number; unitPrice: number}) {
  const fuel = useUiStore(state => state.hud.fuel);
  const fuelMax = useUiStore(state => state.hud.fuelMax);
  const {amount, cost} = fuelPurchase(fuel, fuelMax, cash, unitPrice);
  const full = fuelMax - fuel < 1;
  const poured = Math.round(amount);
  return (
    <li>
      <div className={styles.slot} title={`Fuel: $${unitPrice.toFixed(2)} a unit.`}>
        <span className={styles.icon} style={{background: FUEL_COLOR}} aria-hidden="true" />
        <span className={styles.label}>Fill tank</span>
        <span className={styles.stock}>{full ? 'Full' : `+${poured}`}</span>
        <button
          id="tradeFuelBtn"
          type="button"
          className={styles.action}
          disabled={amount <= 0}
          aria-label={amount > 0 ? `Fill tank +${poured} for $${cost}` : 'Fill tank'}
          onClick={() => uiCommands.buyFuelFromPost()}
        >{amount > 0 ? `$${cost}` : '—'}</button>
      </div>
    </li>
  );
}

/** One buy offer: price and stock, disabled when unaffordable, sold out, or bay-full. */
function BuyRow({offer, cash, bayFull}: {offer: TradeOfferView; cash: number; bayFull: boolean}) {
  const soldOut = offer.stock <= 0;
  const unaffordable = cash < offer.price;
  const disabled = soldOut || unaffordable || bayFull;
  const tooltip = useItemTooltip(offer.kind);
  return (
    <li>
      <div className={styles.slot} {...tooltip}>
        <span className={styles.icon} style={{background: offer.color}} aria-hidden="true" />
        <span className={styles.label}>{offer.label}</span>
        <span className={styles.stock}>{soldOut ? 'Sold out' : `×${offer.stock}`}</span>
        <button
          type="button"
          className={styles.action}
          data-trade="buy"
          data-trade-kind={offer.kind}
          disabled={disabled}
          aria-label={`Buy ${offer.label} for $${offer.price}`}
          onClick={() => uiCommands.buyFromPost(offer.kind)}
        >${offer.price}</button>
      </div>
    </li>
  );
}

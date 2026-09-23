// The trading-post screen.
//
// Two columns. On the left, Sell: every ore stack aboard, each with a Sell button
// that empties the stack for cash and a "1" that sells a single unit. On the right,
// Buy: the post's 2–3 offers, each a finished item with its price and remaining
// stock, its button live only while the player can afford it, the post still has
// one, and the bay has room. The header carries the wallet, which is the whole point
// of the screen.
//
// Everything is painted from the store and is live: the sell side is the same bay
// stacks the HUD panel shows, synced every frame; the buy side is pushed by the game
// on open and after every purchase; the cash header follows the HUD. So the screen
// holds no copy of anything and cannot disagree with the simulation.
//
// The shell/card split, the fixed header over a scrolling body, and the backdrop
// press are the cargo and station dialogs', for the same reasons.

import { useEffect, useRef, type RefObject } from 'react';
import { isOreKind, type InventoryItemKind } from '../core/inventory';
import { uiCommands } from './commands';
import { useUiStore, type InventorySlotView, type TradeOfferView } from './store';
import { useItemTooltip } from './Tooltip';
import styles from './TradeScreen.module.css';

export function TradeScreen() {
  const open = useUiStore(state => state.activeOverlay === 'trade');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      closeRef.current?.focus({preventScroll: true});
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      id="trade-screen"
      ref={dialogRef}
      className={styles.screen}
      aria-labelledby="trade-title"
      onClose={() => uiCommands.closeTrade()}
      onPointerDown={event => { if (event.target === dialogRef.current) uiCommands.closeTrade(); }}
    >
      {open && <TradeCard closeRef={closeRef} />}
    </dialog>
  );
}

function TradeCard({closeRef}: {closeRef: RefObject<HTMLButtonElement | null>}) {
  const cash = useUiStore(state => state.hud.cash);
  const cargo = useUiStore(state => state.hud.cargo);
  const cargoMax = useUiStore(state => state.hud.cargoMax);
  const baySlots = useUiStore(state => state.inventorySlots);
  const buyOffers = useUiStore(state => state.tradeBuy);
  const oreSlots = baySlots.filter(slot => isOreKind(slot.kind));
  const bayFull = cargo >= cargoMax;

  return (
    <div id="trade-card" className={styles.card}>
      <div className={styles.header}>
        <h2 id="trade-title">Trading Post</h2>
        <span id="tradeCash" className={styles.cash}>${cash}</span>
        <button
          id="tradeCloseBtn"
          ref={closeRef}
          className={styles.closeBtn}
          aria-label="Close trading post"
          onClick={event => { event.stopPropagation(); uiCommands.closeTrade(); }}
        >×</button>
      </div>
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
          onClick={() => uiCommands.buyFromPost(offer.kind)}
        >${offer.price}</button>
      </div>
    </li>
  );
}

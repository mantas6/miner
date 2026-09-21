import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import {
  SHOP_ITEMS,
  SHOP_SERVICES,
  SHOP_UPGRADES,
  itemRowState,
  serviceRowState,
  shopSummary,
  upgradeRowState,
  type ShopItemId,
  type ShopRowState
} from '../core/shop-catalog';
import { uiCommands } from './commands';
import { useUiStore } from './store';
import styles from './ShopScreen.module.css';
import '../styles/icons.css';

/** Keyboard hints, per shelf. Markup, so they stay out of the data catalog. */
const HINTS: Record<string, ReactNode> = {
  gun: <>Control: <kbd>G</kbd>, then a direction · <kbd>G</kbd>/<kbd>Esc</kbd> cancels</>,
  dynamite: <>Control: <kbd>E</kbd> or its inventory slot, then a mine tile · <kbd>Esc</kbd> cancels</>,
  teleporter: <>Control: <kbd>T</kbd> or Teleport / Return</>,
  scanner: <>Control: inventory slot, then a mine tile · <kbd>Esc</kbd> cancels</>,
  container: <>Control: inventory slot, then a mine tile · <kbd>C</kbd> or a press on the crate opens it</>
};

/** Consumable shelves, by id: the button the tests address and what it buys. */
const ITEM_PURCHASES: Record<ShopItemId, {buttonId: string; buy(): void}> = {
  dynamite: {buttonId: 'shopDynamiteBtn', buy: () => uiCommands.buyDynamite()},
  teleporter: {buttonId: 'shopTeleporterBtn', buy: () => uiCommands.buyTeleporter()},
  scanner: {buttonId: 'shopScannerBtn', buy: () => uiCommands.buyScanner()},
  gun: {buttonId: 'shopGunBtn', buy: () => uiCommands.buyGun()},
  container: {buttonId: 'shopContainerBtn', buy: () => uiCommands.buyContainer()}
};

interface ShopItemProps {
  row: ShopRowState;
  buttonId: string;
  hint?: ReactNode;
  onBuy(): void;
  /** Marker attributes kept as the stable hooks for tests and tooling. */
  marker: Record<string, string | boolean>;
}

function ShopItem({row, buttonId, hint, onBuy, marker}: ShopItemProps) {
  return (
    <article className={styles.item} {...marker}>
      <span className={`equipment-icon icon-${row.icon}`} aria-hidden="true"><i></i></span>
      <div className={styles.itemCopy}>
        <h4>{row.title}</h4>
        <p>{row.copy}</p>
        <strong data-shop-current>{row.current}</strong>
        {row.benefit !== undefined && <span data-shop-benefit>{row.benefit}</span>}
        {hint && <span>{hint}</span>}
      </div>
      <span className={styles.state} data-shop-status>{row.status}</span>
      <button id={buttonId} type="button" disabled={row.buttonDisabled} onClick={onBuy}>{row.buttonLabel}</button>
    </article>
  );
}

/**
 * The dialog shell. It owns the element the browser opens and closes and nothing
 * else, so a shut shop subscribes to one boolean and the catalog below — which
 * reprices itself off the wallet and the ship on every purchase — does not exist
 * at all while the player is underground.
 */
export function ShopScreen() {
  const open = useUiStore(state => state.activeOverlay === 'shop');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // The card mounts with the dialog, so it is already scrolled to the top and
      // needs no reset here.
      dialog.showModal();
      closeRef.current?.focus({preventScroll: true});
    } else if (!open && dialog.open) {
      dialog.close();
      document.getElementById('shopBtn')?.focus({preventScroll: true});
    }
  }, [open]);

  return (
    <dialog
      id="shop-screen"
      ref={dialogRef}
      className={styles.screen}
      aria-labelledby="shop-title"
      // A native close request (Escape reaching the UA, a form submit) must not
      // leave the store thinking the shop is still open.
      onClose={() => uiCommands.closeShop()}
      onPointerDown={event => { if (event.target === dialogRef.current) uiCommands.closeShop(); }}
    >
      {open && <ShopCard closeRef={closeRef} />}
    </dialog>
  );
}

/** Depot services, permanent upgrades and consumables, priced from one catalog. */
function ShopCard({closeRef}: {closeRef: RefObject<HTMLButtonElement | null>}) {
  const cash = useUiStore(state => state.hud.cash);
  const atSurface = useUiStore(state => state.hud.atSurface);
  const player = useUiStore(state => state.player);

  const summary = shopSummary(cash, atSurface);
  const rowArgs = [player, cash, atSurface] as const;

  return (
    <div id="shop-card" className={styles.card}>
      {/* Outside the scrolling body on purpose: the close button stays reachable
          however far the shelves below are scrolled. */}
      <div className={styles.header}>
        <div>
          <p className={styles.kicker}>Depot supply counter</p>
          <h2 id="shop-title">Shop &amp; Equipment</h2>
        </div>
        <button
          id="shopCloseBtn"
          ref={closeRef}
          className={styles.closeBtn}
          aria-label="Close shop"
          onClick={event => { event.stopPropagation(); uiCommands.closeShop(); }}
        >×</button>
      </div>
      <div className={styles.body}>
        <div className={styles.summary} aria-live="polite">
          <strong data-shop-cash>{summary.cash}</strong>
          <span data-shop-location>{summary.location}</span>
        </div>

        <section className={styles.section} aria-labelledby="shop-services-title">
          <div className={styles.sectionHeading}><h3 id="shop-services-title">Depot Services</h3><span>Pay what you have for a proportional partial service</span></div>
          <div className={styles.grid}>
            {SHOP_SERVICES.map(service => (
              <ShopItem
                key={service.id}
                row={serviceRowState(service.id, ...rowArgs)}
                buttonId={service.id === 'fuel' ? 'fuelBtn' : 'repairBtn'}
                marker={{'data-shop-service': service.id}}
                onBuy={() => (service.id === 'fuel' ? uiCommands.refuel() : uiCommands.repair())}
              />
            ))}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="shop-upgrades-title">
          <div className={styles.sectionHeading}><h3 id="shop-upgrades-title">Permanent Upgrades</h3><span>Installed permanently · prices rise by level</span></div>
          <div className={styles.grid}>
            {SHOP_UPGRADES.map(upgrade => (
              <ShopItem
                key={upgrade.id}
                row={upgradeRowState(upgrade.id, ...rowArgs)}
                buttonId={`${upgrade.id}Btn`}
                marker={{'data-shop-upgrade': upgrade.id}}
                onBuy={() => uiCommands.buyUpgrade(upgrade.id)}
              />
            ))}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="shop-equipment-title">
          <div className={styles.sectionHeading}><h3 id="shop-equipment-title">Consumable Equipment</h3><span>Each use spends one carried item</span></div>
          <div className={styles.grid}>
            {SHOP_ITEMS.map(item => (
              <ShopItem
                key={item.id}
                row={itemRowState(item.id, ...rowArgs)}
                buttonId={ITEM_PURCHASES[item.id].buttonId}
                hint={HINTS[item.id]}
                marker={{'data-shop-item': item.id}}
                onBuy={ITEM_PURCHASES[item.id].buy}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

// The manufacturing station screen.
//
// Two halves. On top, the transfer: the ship's bay beside the station's own
// stock. Every bay stack carries a Stow and a "1" button that push the whole stack
// or a single unit into the station; a "Stow all" empties what fits of the bay in
// one press. Every station stack carries a Take and a "1" that pull the whole
// stack or a single unit back aboard. Below, the recipes: one row each, its inputs
// listed, a Craft button that is live only while the station holds the materials
// and names what is missing when it does not (aria-disabled, so it stays focusable).
// A recipe still locked (the deep alternates, before the first Mk II) is not listed
// at all; once unlocked, an alternate sits under its own name beside the standard
// row, its Craft button told apart by the `:alt` on its `data-craft` id.
// The home-cavern Manufacturer adds a Supply counter between the two: a short list
// of basics (`SUPPLY_POOL`) bought for cash straight into the station stock, each
// button dead while the wallet cannot cover its price. Every Manufacturer carries a
// Shipyard above the recipes: the hull the ship flies and the one next up the
// ladder (`core/ships.ts`), built from the stock like a recipe but swapped in
// rather than stocked; its shortfall line counts the ore aboard, naming what is
// left to mine apart from what only needs stowing.
//
// Everything is painted from the store and is live: the station stock and the bay
// are snapshots the game pushes on open and after every change, so the screen
// holds no copy of anything and cannot disagree with the simulation. The recipe
// affordances are derived from the station stock the same way the sim checks them.
//
// The `<dialog>` itself, its focus and its close requests are `ModalShell`'s.

import { useMemo } from 'react';
import {
  canCraft,
  formatPooledShortfall,
  missingInputs,
  pooledShortfall,
  recipeId,
  recipeLabel,
  unlockedRecipes,
  type Recipe
} from '../core/crafting';
import { addItem, createInventory, type Inventory, type InventoryItemKind } from '../core/inventory';
import { recipeInputLines } from '../core/item-info';
import { itemForKind } from '../core/items';
import { formatShipGains, nextShip, shipFor, type ShipId } from '../core/ships';
import { SUPPLY_POOL, supplyPrice } from '../core/trading';
import { uiCommands } from './commands';
import { overlayOf, useUiStore, type InventorySlotView, type ShipView } from './store';
import { CardHeader, ModalShell } from './ModalShell';
import { useItemTooltip } from './Tooltip';
import styles from './StationScreen.module.css';

/** A stable stand-in while the station is shut, so the selector never returns a fresh array. */
const NO_SLOTS: InventorySlotView[] = [];

export function StationScreen() {
  const open = useUiStore(state => state.overlay?.kind === 'station');
  return (
    <ModalShell id="station-screen" titleId="station-title" open={open} onRequestClose={() => uiCommands.closeStation()}>
      {open && <StationCard />}
    </ModalShell>
  );
}

/** Build a station-stock inventory from its slot views, to check recipe affordances. */
function slotsToInventory(slots: InventorySlotView[]): Inventory {
  return slots.reduce((inventory, slot) => addItem(inventory, itemForKind(slot.kind), slot.count), createInventory());
}

function StationCard() {
  const stationSlots = useUiStore(state => overlayOf(state, 'station')?.slots ?? NO_SLOTS);
  const baySlots = useUiStore(state => state.inventorySlots);
  const supply = useUiStore(state => overlayOf(state, 'station')?.supply ?? false);
  const bestMark = useUiStore(state => overlayOf(state, 'station')?.bestMarkCrafted ?? 0);
  const stock = useMemo(() => slotsToInventory(stationSlots), [stationSlots]);
  const bay = useMemo(() => slotsToInventory(baySlots), [baySlots]);
  const recipes = useMemo(() => unlockedRecipes(bestMark), [bestMark]);

  return (
    <div id="station-card" className={styles.card}>
      <CardHeader
        titleId="station-title"
        title="Manufacturing Station"
        closeId="stationCloseBtn"
        closeLabel="Close manufacturing station"
        onClose={() => uiCommands.closeStation()}
      />
      <div className={styles.body}>
        <section className={styles.columns} aria-label="Storage">
          <div className={styles.column}>
            <div className={styles.columnHeading}>
              <h3>Cargo Bay</h3>
              <button
                id="stowAllBtn"
                type="button"
                className={styles.action}
                onClick={() => uiCommands.stowAll()}
              >Stow all</button>
            </div>
            <ul id="stationBay" className={styles.slots}>
              {baySlots.length === 0 && (
                <li className={styles.empty}><span className={styles.emptyLabel}>Empty</span></li>
              )}
              {baySlots.map(slot => (
                <TransferRow key={slot.index} slot={slot} action="stow" />
              ))}
            </ul>
          </div>
          <div className={styles.column}>
            <div className={styles.columnHeading}>
              <h3>Station Stock</h3>
              <span>Take a stack, or 1, aboard.</span>
            </div>
            <ul id="stationStock" className={styles.slots}>
              {stationSlots.length === 0 && (
                <li className={styles.empty}><span className={styles.emptyLabel}>Empty</span></li>
              )}
              {stationSlots.map(slot => (
                <TransferRow key={slot.index} slot={slot} action="take" />
              ))}
            </ul>
          </div>
        </section>
        {supply && <SupplySection />}
        <ShipyardSection stock={stock} bay={bay} />
        <section className={styles.recipes} aria-labelledby="recipes-title">
          <div className={styles.columnHeading}>
            <h3 id="recipes-title">Recipes</h3>
            <span>Crafted items land in the station stock. Take them aboard.</span>
          </div>
          <ul id="recipeList" className={styles.slots}>
            {recipes.map(recipe => (
              <RecipeRow key={recipeId(recipe)} recipe={recipe} stock={stock} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

/**
 * One transfer stack — a bay stack that stows into the station, or a station stack
 * that comes back aboard. Either way it is a whole-stack button beside a "1" that
 * moves a single unit, both routed to the same command with the `single` flag.
 */
function TransferRow({slot, action}: {slot: InventorySlotView; action: 'stow' | 'take'}) {
  const move = action === 'stow' ? uiCommands.stowStack : uiCommands.takeFromStation;
  const verb = action === 'stow' ? 'Stow' : 'Take';
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
          data-station={action}
          data-station-kind={slot.kind}
          aria-label={`${verb} all ${slot.label}`}
          onClick={() => move(slot.kind, false)}
        >{verb}</button>
        <button
          type="button"
          className={styles.action}
          data-station={`${action}-one`}
          data-station-kind={slot.kind}
          aria-label={`${verb} one ${slot.label}`}
          onClick={() => move(slot.kind, true)}
        >1</button>
      </div>
    </li>
  );
}

/** The home base's Supply counter: basics for cash, delivered into the station stock. */
function SupplySection() {
  const cash = useUiStore(state => state.hud.cash);
  return (
    <section className={styles.recipes} aria-labelledby="supply-title">
      <div className={styles.columnHeading}>
        <h3 id="supply-title">Supply</h3>
        <span>Bought for cash into the station stock. Take them aboard.</span>
      </div>
      <ul id="supplyList" className={styles.slots}>
        {SUPPLY_POOL.map(kind => <SupplyRow key={kind} kind={kind} cash={cash} />)}
      </ul>
    </section>
  );
}

/** One Supply item: its price on the button, which is dead while it is unaffordable. */
function SupplyRow({kind, cash}: {kind: InventoryItemKind; cash: number}) {
  const item = itemForKind(kind);
  const price = supplyPrice(kind);
  const tooltip = useItemTooltip(kind);
  return (
    <li>
      <div className={styles.slot} {...tooltip}>
        <span className={styles.icon} style={{background: item.color}} aria-hidden="true" />
        <span className={styles.label}>{item.label}</span>
        <button
          type="button"
          className={styles.action}
          data-supply={kind}
          disabled={cash < price}
          aria-label={`Buy ${item.label} for $${price}`}
          onClick={() => uiCommands.buySupply(kind)}
        >${price}</button>
      </div>
    </li>
  );
}

/** The Shipyard: the hull flown now, and the one next up the ladder — or word that there is none. */
function ShipyardSection({stock, bay}: {stock: Inventory; bay: Inventory}) {
  const ship = useUiStore(state => state.ship);
  const next = nextShip(ship.id);
  return (
    <section className={styles.recipes} aria-labelledby="shipyard-title">
      <div className={styles.columnHeading}>
        <h3 id="shipyard-title">Shipyard</h3>
        <span id="shipyardCurrent">Flying the {ship.label} · {ship.slots} slots</span>
      </div>
      <ul id="shipyardList" className={styles.slots}>
        {next
          ? <ShipRow ship={ship} next={next} stock={stock} bay={bay} />
          : <li className={styles.empty}><span className={styles.emptyLabel}>Top of the ladder — no bigger ship to build</span></li>}
      </ul>
    </section>
  );
}

/**
 * The next hull: what it adds, what it costs, and a Build button live only while
 * the stock covers it. The shortfall counts the ore aboard too — it is built from
 * the stock, so what the bay holds is named as stowing still to do, not as missing.
 */
function ShipRow({ship, next, stock, bay}: {ship: ShipView; next: ShipId; stock: Inventory; bay: Inventory}) {
  const def = shipFor(next);
  const affordable = canCraft(stock, def);
  const inputs = affordable
    ? def.inputs.map(input => `${input.count} ${itemForKind(input.kind).label}`).join(' · ')
    : formatPooledShortfall(pooledShortfall(bay, stock, def));
  const inputsId = `ship-inputs-${next}`;
  return (
    <li>
      <div className={styles.recipe}>
        <span className={styles.icon} style={{background: def.hull[1]}} aria-hidden="true" />
        <span className={styles.recipeText}>
          <span className={styles.label}>{def.label} · {formatShipGains(ship.id, next)}</span>
          <span id={inputsId} className={styles.recipeInputs}>{inputs}</span>
        </span>
        <button
          type="button"
          className={styles.action}
          data-craft-ship={next}
          aria-label={`Build the ${def.label}`}
          aria-describedby={inputsId}
          aria-disabled={!affordable}
          onClick={() => uiCommands.craftShip(next)}
        >Build</button>
      </div>
    </li>
  );
}

/**
 * One recipe. An unaffordable Craft button is `aria-disabled`, not `disabled`: it
 * stays in the tab order with the shortfall as its description, and a press still
 * reaches the sim, whose refusal toast names what is missing. The harness reads
 * `aria-disabled` as disabled too, so an agent click is still refused up front.
 */
function RecipeRow({recipe, stock}: {recipe: Recipe; stock: Inventory}) {
  const item = itemForKind(recipe.output);
  const id = recipeId(recipe);
  const label = recipeLabel(recipe);
  const affordable = canCraft(stock, recipe);
  const missing = affordable ? [] : missingInputs(stock, recipe);
  const inputs = recipe.inputs.map(input => `${input.count} ${itemForKind(input.kind).label}`).join(' · ');
  const tooltip = useItemTooltip(recipe.output, recipeInputLines(recipe, stock));
  const inputsId = `recipe-inputs-${id}`;
  return (
    <li>
      <div className={styles.recipe} {...tooltip}>
        <span className={styles.icon} style={{background: item.color}} aria-hidden="true" />
        <span className={styles.recipeText}>
          <span className={styles.label}>{label}</span>
          <span id={inputsId} className={styles.recipeInputs}>
            {affordable
              ? inputs
              : `Need ${missing.map(input => `${input.count} ${itemForKind(input.kind).label}`).join(', ')}`}
          </span>
        </span>
        <button
          type="button"
          className={styles.action}
          data-craft={id}
          aria-label={`Craft ${label}`}
          aria-describedby={inputsId}
          aria-disabled={!affordable}
          onClick={() => uiCommands.craft(id)}
        >Craft</button>
      </div>
    </li>
  );
}

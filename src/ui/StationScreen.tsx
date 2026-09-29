// The manufacturing station screen.
//
// Two halves. On top, the transfer: the ship's bay beside the station's own
// stock. Every bay stack carries a Stow and a "1" button that push the whole stack
// or a single unit into the station; a "Stow all" empties what fits of the bay in
// one press. Every station stack carries a Take and a "1" that pull the whole
// stack or a single unit back aboard. Below, the recipes: one row each, its inputs
// listed, a Craft button that is live only while the station holds the materials
// and names what is missing when it does not (aria-disabled, so it stays focusable).
// The home-cavern Manufacturer adds a Supply counter between the two: a short list
// of basics (`SUPPLY_POOL`) bought for cash straight into the station stock, each
// button dead while the wallet cannot cover its price.
//
// Everything is painted from the store and is live: the station stock and the bay
// are snapshots the game pushes on open and after every change, so the screen
// holds no copy of anything and cannot disagree with the simulation. The recipe
// affordances are derived from the station stock the same way the sim checks them.
//
// The `<dialog>` itself, its focus and its close requests are `ModalShell`'s.

import { useMemo } from 'react';
import { canCraft, missingInputs, RECIPES, type Recipe } from '../core/crafting';
import { addItem, createInventory, type Inventory, type InventoryItemKind } from '../core/inventory';
import { recipeInputLines } from '../core/item-info';
import { itemForKind } from '../core/items';
import { SUPPLY_POOL, supplyPrice } from '../core/trading';
import { uiCommands } from './commands';
import { overlayOf, useUiStore, type InventorySlotView } from './store';
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
  const stock = useMemo(() => slotsToInventory(stationSlots), [stationSlots]);

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
        <section className={styles.recipes} aria-labelledby="recipes-title">
          <div className={styles.columnHeading}>
            <h3 id="recipes-title">Recipes</h3>
            <span>Crafted items land in the station stock. Take them aboard.</span>
          </div>
          <ul id="recipeList" className={styles.slots}>
            {RECIPES.map((recipe, index) => (
              <RecipeRow key={recipe.output} recipe={recipe} index={index} stock={stock} />
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

/**
 * One recipe. An unaffordable Craft button is `aria-disabled`, not `disabled`: it
 * stays in the tab order with the shortfall as its description, and a press still
 * reaches the sim, whose refusal toast names what is missing. The harness reads
 * `aria-disabled` as disabled too, so an agent click is still refused up front.
 */
function RecipeRow({recipe, index, stock}: {recipe: Recipe; index: number; stock: Inventory}) {
  const item = itemForKind(recipe.output);
  const affordable = canCraft(stock, recipe);
  const missing = affordable ? [] : missingInputs(stock, recipe);
  const inputs = recipe.inputs.map(input => `${input.count} ${itemForKind(input.kind).label}`).join(' · ');
  const tooltip = useItemTooltip(recipe.output, recipeInputLines(recipe, stock));
  const inputsId = `recipe-inputs-${recipe.output}`;
  return (
    <li>
      <div className={styles.recipe} {...tooltip}>
        <span className={styles.icon} style={{background: item.color}} aria-hidden="true" />
        <span className={styles.recipeText}>
          <span className={styles.label}>{item.label}</span>
          <span id={inputsId} className={styles.recipeInputs}>
            {affordable
              ? inputs
              : `Need ${missing.map(input => `${input.count} ${itemForKind(input.kind).label}`).join(', ')}`}
          </span>
        </span>
        <button
          type="button"
          className={styles.action}
          data-craft={recipe.output}
          aria-label={`Craft ${item.label}`}
          aria-describedby={inputsId}
          aria-disabled={!affordable}
          onClick={() => uiCommands.craft(index)}
        >Craft</button>
      </div>
    </li>
  );
}

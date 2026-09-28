// The manufacturing station screen.
//
// Two halves. On top, the transfer: the ship's bay beside the station's own
// stock. Every bay stack carries a Stow and a "1" button that push the whole stack
// or a single unit into the station; a "Stow all" empties what fits of the bay in
// one press. Every station stack carries a Take and a "1" that pull the whole
// stack or a single unit back aboard. Below, the recipes: one row each, its inputs
// listed, a Craft button that is live only while the station holds the materials
// and names what is missing when it does not.
//
// Everything is painted from the store and is live: the station stock and the bay
// are snapshots the game pushes on open and after every change, so the screen
// holds no copy of anything and cannot disagree with the simulation. The recipe
// affordances are derived from the station stock the same way the sim checks them.
//
// The `<dialog>` itself, its focus and its close requests are `ModalShell`'s.

import { useMemo } from 'react';
import { canCraft, missingInputs, RECIPES, type Recipe } from '../core/crafting';
import { addItem, createInventory, type Inventory } from '../core/inventory';
import { recipeInputLines } from '../core/item-info';
import { itemForKind } from '../core/items';
import { uiCommands } from './commands';
import { useUiStore, type InventorySlotView } from './store';
import { CardHeader, ModalShell } from './ModalShell';
import { useItemTooltip } from './Tooltip';
import styles from './StationScreen.module.css';

export function StationScreen() {
  const open = useUiStore(state => state.activeOverlay === 'station');
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
  const stationSlots = useUiStore(state => state.stationSlots);
  const baySlots = useUiStore(state => state.inventorySlots);
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
          onClick={() => move(slot.kind, false)}
        >{action === 'stow' ? 'Stow' : 'Take'}</button>
        <button
          type="button"
          className={styles.action}
          data-station={`${action}-one`}
          data-station-kind={slot.kind}
          aria-label={`${action === 'stow' ? 'Stow' : 'Take'} one ${slot.label}`}
          onClick={() => move(slot.kind, true)}
        >1</button>
      </div>
    </li>
  );
}

function RecipeRow({recipe, index, stock}: {recipe: Recipe; index: number; stock: Inventory}) {
  const item = itemForKind(recipe.output);
  const affordable = canCraft(stock, recipe);
  const missing = affordable ? [] : missingInputs(stock, recipe);
  const inputs = recipe.inputs.map(input => `${input.count} ${itemForKind(input.kind).label}`).join(' · ');
  const tooltip = useItemTooltip(recipe.output, recipeInputLines(recipe, stock));
  return (
    <li>
      <div className={styles.recipe} {...tooltip}>
        <span className={styles.icon} style={{background: item.color}} aria-hidden="true" />
        <span className={styles.recipeText}>
          <span className={styles.label}>{item.label}</span>
          <span className={styles.recipeInputs}>
            {affordable
              ? inputs
              : `Need ${missing.map(input => `${input.count} ${itemForKind(input.kind).label}`).join(', ')}`}
          </span>
        </span>
        <button
          type="button"
          className={styles.action}
          data-craft={recipe.output}
          disabled={!affordable}
          onClick={() => uiCommands.craft(index)}
        >Craft</button>
      </div>
    </li>
  );
}

// The manufacturing station screen.
//
// Two halves. On top, the transfer: the station's own stock beside the ship's
// bay, with a "Stow all" that empties what fits of the bay into the station and a
// Take on every station stack that pulls it back aboard. Below, the recipes: one
// row each, its inputs listed, a Craft button that is live only while the station
// holds the materials and names what is missing when it does not.
//
// Everything is painted from the store and is live: the station stock and the bay
// are snapshots the game pushes on open and after every change, so the screen
// holds no copy of anything and cannot disagree with the simulation. The recipe
// affordances are derived from the station stock the same way the sim checks them.
//
// The shell/card split, the fixed header over a scrolling body, and the backdrop
// press are the cargo and ship dialogs', for the same reasons.

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { canCraft, missingInputs, RECIPES, type Recipe } from '../core/crafting';
import { addItem, createInventory, type Inventory } from '../core/inventory';
import { itemForKind } from '../core/items';
import { uiCommands } from './commands';
import { useUiStore, type InventorySlotView } from './store';
import styles from './StationScreen.module.css';

export function StationScreen() {
  const open = useUiStore(state => state.activeOverlay === 'station');
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
      id="station-screen"
      ref={dialogRef}
      className={styles.screen}
      aria-labelledby="station-title"
      onClose={() => uiCommands.closeStation()}
      onPointerDown={event => { if (event.target === dialogRef.current) uiCommands.closeStation(); }}
    >
      {open && <StationCard closeRef={closeRef} />}
    </dialog>
  );
}

/** Build a station-stock inventory from its slot views, to check recipe affordances. */
function slotsToInventory(slots: InventorySlotView[]): Inventory {
  return slots.reduce((inventory, slot) => addItem(inventory, itemForKind(slot.kind), slot.count), createInventory());
}

function StationCard({closeRef}: {closeRef: RefObject<HTMLButtonElement | null>}) {
  const stationSlots = useUiStore(state => state.stationSlots);
  const baySlots = useUiStore(state => state.inventorySlots);
  const stock = useMemo(() => slotsToInventory(stationSlots), [stationSlots]);

  return (
    <div id="station-card" className={styles.card}>
      <div className={styles.header}>
        <h2 id="station-title">Manufacturing Station</h2>
        <button
          id="stationCloseBtn"
          ref={closeRef}
          className={styles.closeBtn}
          aria-label="Close manufacturing station"
          onClick={event => { event.stopPropagation(); uiCommands.closeStation(); }}
        >×</button>
      </div>
      <div className={styles.body}>
        <section className={styles.columns} aria-label="Storage">
          <div className={styles.column}>
            <div className={styles.columnHeading}>
              <h3>Station Stock</h3>
              <span>Press Take to pull a stack aboard.</span>
            </div>
            <ul id="stationStock" className={styles.slots}>
              {stationSlots.length === 0 && (
                <li className={styles.empty}><span className={styles.emptyLabel}>Empty</span></li>
              )}
              {stationSlots.map(slot => (
                <li key={slot.index}>
                  <div className={styles.slot}>
                    <span className={styles.icon} style={{background: slot.color}} aria-hidden="true" />
                    <span className={styles.label}>{slot.label}</span>
                    <span className={styles.count}>×{slot.count}</span>
                    <button
                      type="button"
                      className={styles.action}
                      data-station-take={slot.kind}
                      onClick={event => uiCommands.takeFromStation(slot.kind, event.ctrlKey || event.metaKey)}
                    >Take</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
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
                <li key={slot.index}>
                  <div className={styles.slot}>
                    <span className={styles.icon} style={{background: slot.color}} aria-hidden="true" />
                    <span className={styles.label}>{slot.label}</span>
                    <span className={styles.count}>×{slot.count}</span>
                  </div>
                </li>
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

function RecipeRow({recipe, index, stock}: {recipe: Recipe; index: number; stock: Inventory}) {
  const item = itemForKind(recipe.output);
  const affordable = canCraft(stock, recipe);
  const missing = affordable ? [] : missingInputs(stock, recipe);
  const inputs = recipe.inputs.map(input => `${input.count} ${itemForKind(input.kind).label}`).join(' · ');
  return (
    <li>
      <div className={styles.recipe}>
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

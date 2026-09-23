// The one-way door from the React tree back into the game.
//
// Components never import `game.ts` (that would drag the whole simulation into
// the UI module graph and back again through the store). Instead the game
// registers a flat command table while it boots, and buttons dispatch into it.
// Every command is a no-op until registration and again after teardown, so
// rendering the UI without a running game — in tests, between a StrictMode
// double-mount, after a crash — is harmless.

import type { DecorKind, InventoryItemKind, UpgradeKind } from '../core/inventory';

export interface UiCommands {
  useTeleporter(): void;
  /**
   * Arm a carried scanner for placement, or disarm the one already waiting. The
   * press that follows on the mine is what actually deploys it.
   */
  toggleScannerPlacement(): void;
  /**
   * The same gesture for a stick of dynamite, which the press on the mine plants
   * and lights. Arming one stands the other down: the mine takes one press.
   */
  toggleDynamitePlacement(): void;
  /**
   * The same gesture for a cargo container, which the press on the mine sets
   * down. Arming any of the three stands the other two down.
   */
  toggleContainerPlacement(): void;
  /** Shut the transfer menu; also what the dialog's own close request reports. */
  closeContainer(): void;
  /** Move a stack of this kind out of the bay into the open container; `single` moves one. */
  storeInContainer(kind: InventoryItemKind, single?: boolean): void;
  /** Move it back, as far as the cargo-bay limit allows; `single` moves one. */
  takeFromContainer(kind: InventoryItemKind, single?: boolean): void;
  /** Open the ship equipment screen, from anywhere. */
  openShip(): void;
  /** Shut the ship equipment screen; also what its dialog's close request reports. */
  closeShip(): void;
  /**
   * Fit an upgrade of `kind` from the bay. With no `slot`, it lands in the first
   * empty slot, or swaps into slot 0 when every slot is full.
   */
  equipUpgrade(kind: UpgradeKind, slot?: number): void;
  /** Take the upgrade out of `slot` and drop it back into the bay. */
  unequipUpgrade(slot: number): void;
  /** Arm a decoration of `kind` for placement, or stand the armed one down. */
  toggleDecorPlacement(kind: DecorKind): void;
  /** Spend one repair kit from the bay to patch the hull. */
  useRepairKit(): void;
  /** Shut the manufacturing station screen; also what its dialog's close reports. */
  closeStation(): void;
  /** Shut the oil extractor screen; also what its dialog's close reports. */
  closeExtractor(): void;
  /** Move everything that fits from the bay into the station stock. */
  stowAll(): void;
  /** Move a stack (or one unit) of `kind` from the bay into the station stock. */
  stowStack(kind: InventoryItemKind, single?: boolean): void;
  /** Take a stack (or one unit) of `kind` back out of the station stock. */
  takeFromStation(kind: InventoryItemKind, single?: boolean): void;
  /** Craft a recipe at the station, by table index or output kind. */
  craft(recipe: number | InventoryItemKind): void;
  /** Queue every coal aboard into the extractor. */
  loadCoal(): void;
  /** Top the ship's tank up from the extractor's stored fuel. */
  refuelFromExtractor(): void;
  openInfo(): void;
  closeInfo(): void;
  toggleMusic(): void;
  toggleSfx(): void;
  /** Start the run. The splash's default: any press on the card lands here. */
  playSolo(event?: Event): void;
  /** Grant a bundle of every ore into the bay and the station stock. */
  grantDeveloperOres(): void;
  /** Queue coal and fill the oil extractor's stored fuel. */
  fillExtractor(): void;
  resetPlayerData(): void;
  resetWorldState(): void;
  /**
   * Wipe every stored key and reload. The Settings tab asks for confirmation
   * first; by the time this is called the player has already agreed.
   */
  resetGame(): void;
}

function noop(): void {
  /* no game is wired up yet */
}

/**
 * A fresh table of no-ops. Also what teardown restores: a disposed runtime must
 * not stay reachable through the buttons, or a click would drive a simulation
 * whose listeners, timers and animation frames are already gone.
 */
function noopCommands(): UiCommands {
  return {
    useTeleporter: noop,
    toggleScannerPlacement: noop,
    toggleDynamitePlacement: noop,
    toggleContainerPlacement: noop,
    closeContainer: noop,
    storeInContainer: noop,
    takeFromContainer: noop,
    openShip: noop,
    closeShip: noop,
    equipUpgrade: noop,
    unequipUpgrade: noop,
    toggleDecorPlacement: noop,
    useRepairKit: noop,
    closeStation: noop,
    closeExtractor: noop,
    stowAll: noop,
    stowStack: noop,
    takeFromStation: noop,
    craft: noop,
    loadCoal: noop,
    refuelFromExtractor: noop,
    openInfo: noop,
    closeInfo: noop,
    toggleMusic: noop,
    toggleSfx: noop,
    playSolo: noop,
    grantDeveloperOres: noop,
    fillExtractor: noop,
    resetPlayerData: noop,
    resetWorldState: noop,
    resetGame: noop
  };
}

/** The live table. Mutated in place, so every holder sees the current game. */
export const uiCommands: UiCommands = noopCommands();

/** Install (or override, in tests) the command implementations. */
export function setUiCommands(commands: Partial<UiCommands>): void {
  Object.assign(uiCommands, commands);
}

/** Point every command back at a no-op (runtime teardown). */
export function resetUiCommands(): void {
  Object.assign(uiCommands, noopCommands());
}

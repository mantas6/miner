// The one-way door from the React tree back into the game.
//
// Components never import `game.ts` (that would drag the whole simulation into
// the UI module graph and back again through the store). Instead the game
// registers a flat command table while it boots, and buttons dispatch into it.
// Every command is a no-op until registration and again after teardown, so
// rendering the UI without a running game — in tests, between a StrictMode
// double-mount, after a crash — is harmless.

import type { InventoryItemKind } from '../core/inventory';
import type { DeveloperServiceId } from '../core/developer';
import type { PlayerUpgradeId } from '../core/upgrades';

export interface UiCommands {
  sell(): void;
  refuel(): void;
  repair(): void;
  buyUpgrade(id: PlayerUpgradeId): void;
  buyDynamite(): void;
  buyTeleporter(): void;
  buyScanner(): void;
  buyGun(): void;
  buyContainer(): void;
  useTeleporter(): void;
  toggleGunArmed(): void;
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
  openShop(): void;
  closeShop(): void;
  openInfo(): void;
  closeInfo(): void;
  toggleMusic(): void;
  toggleSfx(): void;
  /** Start the run. The splash's default: any press on the card lands here. */
  playSolo(event?: Event): void;
  grantDeveloperCash(): void;
  runDeveloperService(id: DeveloperServiceId): void;
  grantDeveloperUpgrade(id: PlayerUpgradeId): void;
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
    sell: noop,
    refuel: noop,
    repair: noop,
    buyUpgrade: noop,
    buyDynamite: noop,
    buyTeleporter: noop,
    buyScanner: noop,
    buyGun: noop,
    buyContainer: noop,
    useTeleporter: noop,
    toggleGunArmed: noop,
    toggleScannerPlacement: noop,
    toggleDynamitePlacement: noop,
    toggleContainerPlacement: noop,
    closeContainer: noop,
    storeInContainer: noop,
    takeFromContainer: noop,
    openShop: noop,
    closeShop: noop,
    openInfo: noop,
    closeInfo: noop,
    toggleMusic: noop,
    toggleSfx: noop,
    playSolo: noop,
    grantDeveloperCash: noop,
    runDeveloperService: noop,
    grantDeveloperUpgrade: noop,
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

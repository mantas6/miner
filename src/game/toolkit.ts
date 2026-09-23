// The Construction Toolkit: lifting an empty station or container back into the bay.
//
// It is the inverse of the placement gesture. The inventory slot arms the toolkit
// (sharing the single `armedPlacement` slot with every other armed tool), and the
// next press on a station or container tile the ship can reach packs it up: the
// entity leaves the mine and its device item lands in the cargo bay. The toolkit
// itself is durable — it is never consumed, so the same one lifts as many things
// as the player has room to carry.
//
// It refuses to pack anything that still holds cargo ("Empty it first"), and it
// refuses when the bay has no room for the device it would hand back. Both
// refusals surface through the same toast the placements use, and the armed state
// shows on the slot (and so in the observation) like every other armed tool.

import {
  CARGO_CONTAINER_ITEM,
  containerAt,
  isWithinContainerReach
} from '../core/cargo-container';
import { addItem, countItem, isFull, totalItems } from '../core/inventory';
import { itemForKind } from '../core/items';
import {
  isStationReachable,
  stationAt,
  stationDeviceItemKind,
  type PlacedStation
} from '../core/stations';
import type { AudioController, GameState } from '../core/types';

/** The durable toolkit item, carried in the bay like the other equipment. */
export const TOOLKIT_ITEM = itemForKind('toolkit');

export interface ToolkitSim {
  /** Whether the toolkit is armed, waiting for a station or container to lift. */
  readonly armed: boolean;
  /** Inventory-slot press: arm the toolkit, or stand it down. */
  toggleArmed(): void;
  /** Disarm without complaint (Escape, an overlay opening, a lost ship). */
  disarm(): boolean;
  /** A press on the mine while armed. Reports whether something was lifted. */
  liftAt(x: number, y: number): boolean;
  /** One fixed 60 Hz step: only a lost ship to tidy up after. */
  tick(): void;
}

export interface ToolkitDeps {
  state: GameState;
  audio: AudioController;
  toast(message: string): void;
  saveProgress(): void;
  /** Paint the armed toolkit onto the inventory slot, or clear it. */
  setArmedUi(armed: boolean): void;
}

export function createToolkit(deps: ToolkitDeps): ToolkitSim {
  const {state, audio, toast, saveProgress} = deps;
  let armed = false;

  function setArmed(next: boolean): void {
    if (armed === next) return;
    armed = next;
    deps.setArmedUi(next);
  }

  function disarm(): boolean {
    if (!armed) return false;
    setArmed(false);
    return true;
  }

  function toggleArmed(): void {
    if (armed) {
      setArmed(false);
      return toast('Toolkit stowed.');
    }
    if (state.gameOver) return;
    if (countItem(state.player.inventory, TOOLKIT_ITEM.kind) <= 0) {
      audio.alarm();
      return toast('No Construction Toolkit aboard. Craft one at the Manufacturing Station.');
    }
    setArmed(true);
    toast('Toolkit ready — press an empty station or container to pack it up. Escape cancels.');
  }

  /** Whether the emptied device would fit in the bay before we remove the entity. */
  function bayHasRoom(): boolean {
    if (isFull(state.player.inventory, state.player.cargoMax)) {
      audio.alarm();
      toast(`Cargo bay is full at ${state.player.cargoMax} items. Make room before packing anything up.`);
      return false;
    }
    return true;
  }

  /** Pack a station up: refuse a loaded one, else hand back its device item. */
  function liftStation(station: PlacedStation): boolean {
    const holdsStock = station.kind === 'manufacturer'
      ? totalItems(station.inventory) > 0
      : station.coal > 0 || station.fuel > 0;
    if (holdsStock) {
      audio.alarm();
      toast('Empty it first — the station still holds stock.');
      return false;
    }
    if (!bayHasRoom()) return false;
    state.stations = state.stations.filter(entry => entry !== station);
    const item = itemForKind(stationDeviceItemKind(station.kind));
    state.player.inventory = addItem(state.player.inventory, item);
    saveProgress();
    audio.blip(440, .09, 'square', .045, 60);
    toast(`${item.label} packed into the bay.`);
    return true;
  }

  /** Pack a container up: refuse a loaded one, else hand back its container item. */
  function liftContainer(x: number, y: number): boolean {
    const container = containerAt(state.cargoContainers, x, y);
    if (!container) return false;
    if (!isWithinContainerReach(container, state.player.x, state.player.y)) {
      toast('Too far from the container. Fly alongside it first.');
      return false;
    }
    if (totalItems(container.inventory) > 0) {
      audio.alarm();
      toast('Empty it first — the container still holds cargo.');
      return false;
    }
    if (!bayHasRoom()) return false;
    state.cargoContainers = state.cargoContainers.filter(entry => entry !== container);
    state.player.inventory = addItem(state.player.inventory, CARGO_CONTAINER_ITEM);
    saveProgress();
    audio.blip(440, .09, 'square', .045, 60);
    toast('Container packed into the bay.');
    return true;
  }

  function liftAt(x: number, y: number): boolean {
    if (!armed) return false;
    // The bay can empty between arming and pressing — a reset, a lost ship.
    if (state.gameOver || countItem(state.player.inventory, TOOLKIT_ITEM.kind) <= 0) {
      setArmed(false);
      return false;
    }
    const station = stationAt(state.stations, x, y);
    if (station) {
      if (!isStationReachable(station, state.player.x, state.player.y)) {
        toast('Too far from the station. Fly alongside it first.');
        return false;
      }
      return liftStation(station);
    }
    // Not a station: it may still be a container. A press on bare rock lifts
    // nothing and leaves the toolkit armed for the next try.
    return liftContainer(x, y);
  }

  function tick(): void {
    if (state.gameOver) disarm();
  }

  return {
    get armed() {
      return armed;
    },
    toggleArmed,
    disarm,
    liftAt,
    tick
  };
}

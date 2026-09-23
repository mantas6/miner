// Placing the two stations: arming a carried device and setting it down in the mine.
//
// `core/stations.ts` holds the rules (which tiles take a station, how far its
// screen opens from, the soft cap per kind); this is the part that touches the
// running game — the cargo bay the device comes out of, and the `state.stations`
// array a placement grows. It mirrors `cargo-containers.ts`: the inventory slot
// arms a specific kind, and the next press on the mine sets it down.
//
// One kind is ever armed, and it shares the single `armedPlacement` slot with the
// deployables, the decorations, and the toolkit — arming a station stands any of
// them down, and vice versa. The armed pointer never survives a reload: it is
// about what the player is doing this instant, not what they own.

import { containerAt } from '../core/cargo-container';
import { countItem, removeItem } from '../core/inventory';
import { inMineBounds } from '../core/placement';
import {
  STATION_DEVICE,
  createExtractor,
  createManufacturer,
  stationAt,
  stationDeviceItemKind,
  stationPlacementRefusal,
  type StationKind
} from '../core/stations';
import type { AudioController, GameState } from '../core/types';
import type { WorldGrid } from './world-grid';

export interface StationDeviceSim {
  /** The station kind waiting for a tile, or `null` when nothing is armed. */
  readonly armed: StationKind | null;
  /** Inventory-slot press: arm this station kind, or stand the armed one down. */
  toggleArmed(kind: StationKind): void;
  /** Disarm without complaint (Escape, an overlay opening, a lost ship). */
  disarm(): boolean;
  /** A press on the mine while armed. Reports whether a station was set down. */
  placeAt(x: number, y: number): boolean;
  /** One fixed 60 Hz step: only a lost ship to tidy up after. */
  tick(): void;
}

export interface StationDeviceDeps {
  state: GameState;
  grid: WorldGrid;
  audio: AudioController;
  toast(message: string): void;
  saveProgress(): void;
  /** Paint the armed station onto the inventory slot, or clear it with `null`. */
  setArmedUi(kind: StationKind | null): void;
}

/** The player-facing name of a station kind, for the placement toasts. */
function stationLabel(kind: StationKind): string {
  return kind === 'manufacturer' ? 'Manufacturing Station' : 'Oil Extractor';
}

export function createStationDevices(deps: StationDeviceDeps): StationDeviceSim {
  const {state, grid, audio, toast, saveProgress} = deps;
  let armed: StationKind | null = null;

  function setArmed(next: StationKind | null): void {
    if (armed === next) return;
    armed = next;
    deps.setArmedUi(next);
  }

  function disarm(): boolean {
    if (!armed) return false;
    setArmed(null);
    return true;
  }

  /** How many stations of `kind` already stand in the mine. */
  function count(kind: StationKind): number {
    return state.stations.filter(station => station.kind === kind).length;
  }

  function toggleArmed(kind: StationKind): void {
    if (armed === kind) {
      setArmed(null);
      return toast(`${stationLabel(kind)} placement cancelled.`);
    }
    if (state.gameOver) return;
    if (countItem(state.player.inventory, stationDeviceItemKind(kind)) <= 0) {
      audio.alarm();
      return toast(`No ${stationLabel(kind)} aboard. Craft one at the Manufacturing Station.`);
    }
    if (count(kind) >= STATION_DEVICE[kind].maxPlaced) {
      audio.alarm();
      return toast(`Only ${STATION_DEVICE[kind].maxPlaced} ${stationLabel(kind)}s can stand in the mine at once.`);
    }
    setArmed(kind);
    toast(`${stationLabel(kind)} ready — press a mapped tile in the mine. Escape cancels.`);
  }

  /** Whether any placed entity already occupies this tile. */
  function occupied(x: number, y: number): boolean {
    return stationAt(state.stations, x, y) !== null
      || containerAt(state.cargoContainers, x, y) !== null
      || state.scannerDevices.some(device => device.x === x && device.y === y)
      || state.placedDynamite.some(stick => stick.x === x && stick.y === y);
  }

  function placeAt(x: number, y: number): boolean {
    const kind = armed;
    if (!kind) return false;
    const itemKind = stationDeviceItemKind(kind);
    // The bay can empty between arming and pressing — a reset, a lost ship — and a
    // station set down out of an empty bay would be one the player never bought.
    if (state.gameOver || countItem(state.player.inventory, itemKind) <= 0) {
      setArmed(null);
      return false;
    }
    const refusal = stationPlacementRefusal(x, y, kind, {
      explored: state.exploredTiles,
      open: inMineBounds(x, y) && grid.get(x, y).type === 'air',
      occupied: occupied(x, y),
      count: count(kind)
    });
    if (refusal) {
      audio.alarm();
      toast(refusal);
      return false;
    }
    state.player.inventory = removeItem(state.player.inventory, itemKind);
    state.stations.push(kind === 'manufacturer' ? createManufacturer(x, y) : createExtractor(x, y));
    setArmed(null);
    saveProgress();
    audio.blip(320, .1, 'square', .045, -40);
    toast(`${stationLabel(kind)} set down. Stand beside it and press it to use it.`);
    return true;
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
    placeAt,
    tick
  };
}

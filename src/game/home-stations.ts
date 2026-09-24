// The mine's stations: opening them, moving cargo across, crafting, and the
// extractor's coal/fuel transfers.
//
// `core/stations.ts` holds the rules (which station a parked ship can reach, what
// a transfer is allowed to move) and `core/crafting.ts` the recipe table; this is
// the part that touches the running game — the cargo bay the stock comes out of,
// the manufacturer stock crafting consumes and produces, the ship's tank the
// extractors top up, and the save each change schedules.
//
// Opening a station is the *un*armed press the cargo container already models: a
// click on a station tile the ship is standing on or beside, or Space with none
// named. The screen it raises is a modal overlay, so — like the crate menu — it
// holds no copy of anything: the sim pushes the current stock and buffers into the
// store after every change, and the screens paint what they are given.
//
// A station is now a placed entity, not a fixed world object, so this module holds
// a reference to whichever one is open (rather than a `'manufacturer'` string) and
// tidies up when the Construction Toolkit lifts one out from under an open screen.

import {
  craft as craftRecipe,
  RECIPES,
  type Recipe
} from '../core/crafting';
import {
  findStack,
  oreKind,
  removeItem,
  totalItems,
  type Inventory,
  type InventoryItemKind
} from '../core/inventory';
import { itemForKind } from '../core/items';
import {
  nearestStation,
  stationAt,
  isStationReachable,
  stowAll as stowAllStation,
  stowStack as stowStackStation,
  takeFromStation,
  tickExtractor,
  type ExtractorStation,
  type ManufacturerStation,
  type PlacedStation
} from '../core/stations';
import type { AudioController, GameState } from '../core/types';

/** The buffers the extractor screen paints, plus the current coal's tick progress. */
export interface ExtractorView {
  coal: number;
  fuel: number;
  /** Ticks toward the current coal, so the screen can word "next in Xs". */
  progress: number;
}

export interface HomeStationsSim {
  /** Which station's screen is up, or `null`. */
  readonly openStation: PlacedStation | null;
  /** Space, or a click with no tile named: open the nearest station, or toggle the open one shut. */
  openNearest(): boolean;
  /** A press on the mine that landed on a station tile the ship can reach. */
  openAt(x: number, y: number): boolean;
  /** Shut whichever station screen is up. Idempotent. */
  close(): void;
  /** Move everything that fits from the bay into the open manufacturer's stock. */
  stowAll(): void;
  /** Move a stack (or one unit) of `kind` from the bay into the station stock. */
  stow(kind: InventoryItemKind, single?: boolean): void;
  /** Take a stack (or one unit) of `kind` back out of the station stock. */
  take(kind: InventoryItemKind, single?: boolean): void;
  /** Craft a recipe, by table index or by output kind, at the open manufacturer. */
  craft(recipe: number | InventoryItemKind): void;
  /** Queue every coal aboard into the open extractor. */
  loadCoal(): void;
  /** Top the ship's tank up from the open extractor's stored fuel. */
  refuel(): void;
  /** One fixed 60 Hz step: run every extractor, and tidy up after a lost ship. */
  tick(): void;
}

export interface HomeStationsDeps {
  state: GameState;
  audio: AudioController;
  toast(message: string): void;
  saveProgress(): void;
  /** Show the manufacturing screen for this stock, or take it away with `null`. */
  setStationUi(inventory: Inventory | null): void;
  /** Show the extractor screen with these buffers, or take it away with `null`. */
  setExtractorUi(view: ExtractorView | null): void;
  /** Re-derive the HUD player snapshot (fuel changes on a refuel). */
  syncPlayer(): void;
}

export function createHomeStations(deps: HomeStationsDeps): HomeStationsSim {
  const {state, audio, toast, saveProgress} = deps;
  let open: PlacedStation | null = null;
  // Auto-refuel fires once when the ship arrives on an extractor tile, and re-arms
  // the moment it leaves. A respawn drops the ship on the spawn tile, not on an
  // extractor, so the flag re-arms on its own — no reset hook needed.
  let wasOnExtractor = false;

  function show(station: PlacedStation): boolean {
    open = station;
    if (station.kind === 'manufacturer') deps.setStationUi(station.inventory);
    else if (station.kind === 'extractor') deps.setExtractorUi(extractorView(station));
    // TODO(portals phase 3): a portal opens the travel list, not a station screen.
    return true;
  }

  function extractorView(station: ExtractorStation): ExtractorView {
    return {coal: station.coal, fuel: station.fuel, progress: station.progress};
  }

  function close(): void {
    if (!open) return;
    const was = open;
    open = null;
    if (was.kind === 'manufacturer') deps.setStationUi(null);
    else if (was.kind === 'extractor') deps.setExtractorUi(null);
  }

  /** Re-publish the open screen's data after a change. */
  function repaint(): void {
    if (!open) return;
    if (open.kind === 'manufacturer') deps.setStationUi(open.inventory);
    else if (open.kind === 'extractor') deps.setExtractorUi(extractorView(open));
  }

  /** The open manufacturer, or `null` when the screen up is something else. */
  function openManufacturer(): ManufacturerStation | null {
    return open && open.kind === 'manufacturer' ? open : null;
  }

  /** The open extractor, or `null` when the screen up is something else. */
  function openExtractor(): ExtractorStation | null {
    return open && open.kind === 'extractor' ? open : null;
  }

  function openNearest(): boolean {
    if (state.gameOver) return false;
    if (open) { close(); return true; }
    const near = nearestStation(state.stations, state.player);
    if (!near) {
      toast('No station within reach. Return to the home base.');
      return false;
    }
    return show(near);
  }

  function openAt(x: number, y: number): boolean {
    if (state.gameOver) return false;
    const station = stationAt(state.stations, x, y);
    if (!station) return false;
    if (!isStationReachable(station, state.player.x, state.player.y)) {
      toast('Too far from the station. Fly alongside it first.');
      return false;
    }
    return show(station);
  }

  function stowAll(): void {
    const manufacturer = openManufacturer();
    if (!manufacturer || state.gameOver) return;
    const before = totalItems(state.player.inventory);
    const {bay, station} = stowAllStation(state.player.inventory, manufacturer.inventory);
    if (totalItems(bay) === before) {
      audio.alarm();
      return toast('Nothing to stow, or the station stock is full.');
    }
    state.player.inventory = bay;
    manufacturer.inventory = station;
    repaint();
    saveProgress();
    audio.blip(420, .06, 'triangle', .035);
    toast('Stowed cargo at the station.');
  }

  function stow(kind: InventoryItemKind, single = false): void {
    const manufacturer = openManufacturer();
    if (!manufacturer || state.gameOver) return;
    const {bay, station, moved} = stowStackStation(
      state.player.inventory, manufacturer.inventory, kind, single ? 1 : Infinity
    );
    if (moved <= 0) {
      audio.alarm();
      return toast('Nothing to stow, or the station stock is full.');
    }
    state.player.inventory = bay;
    manufacturer.inventory = station;
    repaint();
    saveProgress();
    audio.blip(420, .06, 'triangle', .035);
    toast(`Stowed ${moved} × ${itemForKind(kind).label} at the station.`);
  }

  function take(kind: InventoryItemKind, single = false): void {
    const manufacturer = openManufacturer();
    if (!manufacturer || state.gameOver) return;
    const {bay, station, moved} = takeFromStation(
      state.player.inventory, manufacturer.inventory, kind, single ? 1 : Infinity, state.player.cargoMax
    );
    if (moved <= 0) {
      audio.alarm();
      return toast('Cargo bay is full, or none of that is in the station.');
    }
    state.player.inventory = bay;
    manufacturer.inventory = station;
    repaint();
    saveProgress();
    audio.blip(620, .05, 'triangle', .035);
    toast(`Took ${moved} × ${itemForKind(kind).label} aboard.`);
  }

  function craft(reference: number | InventoryItemKind): void {
    const manufacturer = openManufacturer();
    if (!manufacturer || state.gameOver) return;
    const recipe: Recipe | undefined = typeof reference === 'number'
      ? RECIPES[reference]
      : RECIPES.find(entry => entry.output === reference);
    if (!recipe) return;
    const result = craftRecipe(manufacturer.inventory, recipe);
    if (!result) {
      audio.alarm();
      return toast(`Not enough materials for ${itemForKind(recipe.output).label}.`);
    }
    manufacturer.inventory = result;
    repaint();
    saveProgress();
    audio.blip(700, .07, 'square', .04, 60);
    toast(`Crafted ${recipe.count} × ${itemForKind(recipe.output).label}. Take it from the station.`);
  }

  function loadCoal(): void {
    const extractor = openExtractor();
    if (!extractor || state.gameOver) return;
    const coal = findStack(state.player.inventory, oreKind('Coal'));
    if (!coal) {
      audio.alarm();
      return toast('No coal aboard to load.');
    }
    extractor.coal += coal.count;
    state.player.inventory = removeItem(state.player.inventory, coal.kind, coal.count);
    repaint();
    saveProgress();
    audio.blip(300, .08, 'sawtooth', .04);
    toast(`Loaded ${coal.count} coal into the extractor.`);
  }

  /** Pour as much stored fuel into the tank as it will take. Returns the amount moved. */
  function pourFuel(extractor: ExtractorStation): number {
    const p = state.player;
    const moved = Math.min(p.fuelMax - p.fuel, extractor.fuel);
    if (moved <= 0) return 0;
    p.fuel += moved;
    extractor.fuel -= moved;
    return moved;
  }

  function refuel(): void {
    const extractor = openExtractor();
    if (!extractor || state.gameOver) return;
    const moved = pourFuel(extractor);
    if (moved <= 0) {
      audio.alarm();
      return toast(state.player.fuel >= state.player.fuelMax ? 'Fuel tank already full.' : 'No fuel stored in the extractor yet.');
    }
    deps.syncPlayer();
    repaint();
    saveProgress();
    audio.blip(500, .08, 'triangle', .045, 40);
    toast(`Refueled +${Math.round(moved)} from the extractor.`);
  }

  /** The extractor the ship is parked on, or `null`. */
  function extractorUnderShip(): ExtractorStation | null {
    const station = stationAt(state.stations, state.player.x, state.player.y);
    return station && station.kind === 'extractor' ? station : null;
  }

  function tick(): void {
    if (state.gameOver) { close(); return; }
    // The Construction Toolkit can lift the open station out from under its screen.
    if (open && !state.stations.includes(open)) close();
    // Park on an extractor and it tops the tank up on the spot — once per visit,
    // re-armed on leaving. Silent when there is nothing to move (full tank, empty store).
    const parked = extractorUnderShip();
    if (parked && !wasOnExtractor) {
      const moved = pourFuel(parked);
      if (moved > 0) {
        deps.syncPlayer();
        if (open === parked) repaint();
        saveProgress();
        audio.blip(500, .08, 'triangle', .045, 40);
        toast(`Refueled +${Math.round(moved)} from the extractor.`);
      }
    }
    wasOnExtractor = parked !== null;
    // Every extractor works whether or not the player is watching. A steady tick
    // that neither advances progress nor converts hands back the same buffer, so
    // most extractors fall out here doing nothing.
    for (const station of state.stations) {
      if (station.kind !== 'extractor') continue;
      const before = {coal: station.coal, fuel: station.fuel, progress: station.progress};
      const next = tickExtractor(before);
      if (next === before) continue;
      station.coal = next.coal;
      station.fuel = next.fuel;
      station.progress = next.progress;
      // Banking a whole coal's fuel is worth persisting on the spot, so a crash
      // between visits cannot lose it; a bare progress tick is transient.
      if (next.coal !== before.coal) saveProgress();
      if (open === station) deps.setExtractorUi(extractorView(station));
    }
  }

  return {
    get openStation() {
      return open;
    },
    openNearest,
    openAt,
    close,
    stowAll,
    stow,
    take,
    craft,
    loadCoal,
    refuel,
    tick
  };
}

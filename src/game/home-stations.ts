// The mine's stations: opening them, moving cargo across, crafting, the
// extractor's coal/fuel transfers, and the base's cash sinks — the home Supply
// on the home-cavern Manufacturer and fuel ordered into the home extractor.
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
  canCraft,
  craft as craftRecipe,
  RECIPES,
  type Recipe
} from '../core/crafting';
import {
  addItem,
  findStack,
  oreKind,
  removeItem,
  roomLeft,
  totalItems,
  type InventoryItemKind
} from '../core/inventory';
import { EXTRACTOR } from '../core/balance';
import { itemForKind } from '../core/items';
import {
  STATION_CAPACITY,
  isHomeStation,
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
import { extractorFuelOrder, isSupplyKind, supplyPrice } from '../core/trading';
import type { AudioController, GameState } from '../core/types';
import type { PortalsSim } from './portals';

/** The buffers the extractor screen paints, plus the current coal's tick progress. */
export interface ExtractorView {
  coal: number;
  fuel: number;
  /** Ticks toward the current coal, so the screen can word "next in Xs". */
  progress: number;
  /** Whether this is the base's extractor, which takes fuel ordered for cash. */
  supply: boolean;
}

/** The extractor screen's view of one extractor. */
export function extractorView(station: ExtractorStation): ExtractorView {
  return {coal: station.coal, fuel: station.fuel, progress: station.progress, supply: isHomeStation(station)};
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
  /** Buy one of a home Supply item into the open home-cavern manufacturer's stock. */
  buySupply(kind: InventoryItemKind): void;
  /** Order fuel for cash into the open home extractor's store (`extractorFuelOrder`). */
  buyExtractorFuel(): void;
  /** One fixed 60 Hz step: run every extractor, and tidy up after a lost ship. */
  tick(): void;
}

export interface HomeStationsDeps {
  state: GameState;
  audio: AudioController;
  toast(message: string): void;
  saveProgress(): void;
  /** Move the wallet (negative to spend); the caller saves. */
  addCash(amount: number): void;
  /** Show the manufacturing screen for this station, or take it away with `null`. */
  setStationUi(station: ManufacturerStation | null): void;
  /** Show the extractor screen with these buffers, or take it away with `null`. */
  setExtractorUi(view: ExtractorView | null): void;
  /** The portal sim: a press on a portal tile opens its travel list. */
  portals: PortalsSim;
}

export function createHomeStations(deps: HomeStationsDeps): HomeStationsSim {
  const {state, audio, toast, saveProgress} = deps;
  let open: PlacedStation | null = null;
  // A ship parked on an extractor tile is refuelled every tick — so fuel a coal
  // converts while it waits lands in the tank at once — but only the pour on
  // arrival toasts and plays the cue; later top-ups are silent. The flag re-arms
  // the moment the ship leaves. A respawn drops the ship on the spawn tile, not on
  // an extractor, so it re-arms on its own — no reset hook needed.
  let wasOnExtractor = false;

  function show(station: PlacedStation): boolean {
    if (station.kind === 'portal') {
      // A portal has no station screen of its own: it opens the free travel list.
      // It is not held in `open` — the toolkit-lift tidy-up below is the station
      // screens' concern, and the portal overlay closes itself on a lift in its
      // own tick — so opening one first shuts whatever station screen was up.
      close();
      return deps.portals.openTravel(station);
    }
    open = station;
    if (station.kind === 'manufacturer') deps.setStationUi(station);
    else deps.setExtractorUi(extractorView(station));
    return true;
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
    if (open.kind === 'manufacturer') deps.setStationUi(open);
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
    audio.stow();
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
    audio.stow();
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
    audio.take();
    toast(`Took ${moved} × ${itemForKind(kind).label} aboard.`);
  }

  function craft(reference: number | InventoryItemKind): void {
    const manufacturer = openManufacturer();
    if (!manufacturer || state.gameOver) return;
    const recipe: Recipe | undefined = typeof reference === 'number'
      ? RECIPES[reference]
      : RECIPES.find(entry => entry.output === reference);
    if (!recipe) return;
    if (!canCraft(manufacturer.inventory, recipe)) {
      audio.alarm();
      return toast(`Not enough materials for ${itemForKind(recipe.output).label}.`);
    }
    // The only other refusal: the batch would push the stock past its capacity.
    const result = craftRecipe(manufacturer.inventory, recipe, STATION_CAPACITY);
    if (!result) {
      audio.alarm();
      return toast(`Station stock is full at ${STATION_CAPACITY} items. Take something out first.`);
    }
    manufacturer.inventory = result;
    repaint();
    saveProgress();
    audio.craft();
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
    // The hopper holds as much as a manufacturer's stock; the rest stays aboard.
    const loaded = Math.min(coal.count, STATION_CAPACITY - extractor.coal);
    if (loaded <= 0) {
      audio.alarm();
      return toast(`The extractor's hopper is full at ${STATION_CAPACITY} coal.`);
    }
    extractor.coal += loaded;
    state.player.inventory = removeItem(state.player.inventory, coal.kind, loaded);
    repaint();
    saveProgress();
    audio.stow();
    toast(`Loaded ${loaded} coal into the extractor.`);
  }

  function buySupply(kind: InventoryItemKind): void {
    const manufacturer = openManufacturer();
    if (!manufacturer || state.gameOver) return;
    if (!isSupplyKind(kind)) return;
    const label = itemForKind(kind).label;
    if (!isHomeStation(manufacturer)) {
      audio.alarm();
      return toast('Supply is only sold at the home base\'s Manufacturing Station.');
    }
    const price = supplyPrice(kind);
    if (state.cash < price) {
      audio.alarm();
      return toast(`Not enough cash for ${label} ($${price}).`);
    }
    if (roomLeft(manufacturer.inventory, STATION_CAPACITY) <= 0) {
      audio.alarm();
      return toast(`Station stock is full at ${STATION_CAPACITY} items. Take something out first.`);
    }
    deps.addCash(-price);
    manufacturer.inventory = addItem(manufacturer.inventory, itemForKind(kind), 1);
    repaint();
    saveProgress();
    audio.buy();
    toast(`Bought ${label} for $${price}. Take it from the station.`);
  }

  function buyExtractorFuel(): void {
    const extractor = openExtractor();
    if (!extractor || state.gameOver) return;
    if (!isHomeStation(extractor)) {
      audio.alarm();
      return toast('Fuel is only delivered to the home base\'s Fuel Extractor.');
    }
    const {amount, cost} = extractorFuelOrder(extractor.fuel, state.cash);
    if (amount <= 0) {
      audio.alarm();
      return toast(EXTRACTOR.fuelCap - extractor.fuel < 1
        ? `The extractor's store is full at ${EXTRACTOR.fuelCap} fuel.`
        : 'Not enough cash to order fuel.');
    }
    deps.addCash(-cost);
    extractor.fuel = Math.min(EXTRACTOR.fuelCap, extractor.fuel + amount);
    repaint();
    saveProgress();
    audio.buy();
    toast(`Ordered ${Math.round(amount)} fuel into the extractor for $${cost}.`);
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
    repaint();
    saveProgress();
    audio.refuel();
    toast(`Refueled +${Math.round(moved)} from the extractor.`);
  }

  /** The extractor the ship is parked on, or `null`. */
  function extractorUnderShip(): ExtractorStation | null {
    const station = stationAt(state.stations, state.player.x, state.player.y);
    return station && station.kind === 'extractor' ? station : null;
  }

  function tick(): void {
    if (state.gameOver) { close(); return; }
    // The Construction Toolkit can lift the open station out from under its screen,
    // and a ship that has left its reach (a fall, a harness tile press) is no longer
    // working it: the reach it took to open the screen is what keeps it open.
    if (open && (!state.stations.includes(open) || !isStationReachable(open, state.player.x, state.player.y))) close();
    // Park on an extractor and it keeps the tank topped up for as long as the ship
    // stays: every tick pours whatever the store holds and the tank has room for.
    // The toast and cue mark the arrival only, so a coal converting mid-visit tops
    // up quietly. Nothing to move (full tank, empty store) is silent throughout.
    const parked = extractorUnderShip();
    if (parked) {
      const moved = pourFuel(parked);
      if (moved > 0) {
        if (open === parked) repaint();
        // The save is debounced, so a top-up per converted coal costs one write.
        saveProgress();
        if (!wasOnExtractor) {
          audio.refuel();
          toast(`Refueled +${Math.round(moved)} from the extractor.`);
        }
      }
    }
    wasOnExtractor = parked !== null;
    // Every extractor works whether or not the player is watching. A steady tick
    // that neither advances progress nor converts hands back the same buffer, so
    // most extractors fall out here doing nothing.
    for (const station of state.stations) {
      if (station.kind !== 'extractor') continue;
      // The station is its own buffer: a steady tick hands the same reference back
      // without a copy, and only a moving one allocates its next state.
      const next = tickExtractor(station);
      if (next === station) continue;
      const coalBefore = station.coal;
      station.coal = next.coal;
      station.fuel = next.fuel;
      station.progress = next.progress;
      // Banking a whole coal's fuel is worth persisting on the spot, so a crash
      // between visits cannot lose it; a bare progress tick is transient.
      if (next.coal !== coalBefore) saveProgress();
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
    buySupply,
    buyExtractorFuel,
    tick
  };
}

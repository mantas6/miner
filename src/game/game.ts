// Game orchestrator: owns one runtime's state, audio and renderer, wires the
// feature modules together, and runs the fixed-step loop.
//
// `createGameRuntime()` is a factory, not a module-level boot: it takes the
// canvas and panel React mounted, and returns a `dispose()` that undoes every
// listener, timer and animation frame it installed. That is what makes the
// runtime survivable — React may tear a mount down and rebuild it immediately
// (StrictMode in dev, Fast Refresh, an error boundary remounting after a crash),
// and a runtime that could not be disposed left a second simulation running
// behind the first, doubling keypresses, saves and audio.
//
// Anything with a life of its own lives next door: `enemies.ts` (enemy
// simulation), `actions.ts` (player transactions), `move.ts` (one step of the
// ship), `run.ts` (run lifecycle and death), `input.ts` (keyboard),
// `world-grid.ts` (tile access). What stays here is the glue those modules
// share — progress saving, particles, the UI sync, and the loop itself.
//
// The UI is React reading `src/ui/store.ts`. This module pushes a snapshot into
// that store once per frame (`syncUi()`) and exposes a flat command table
// (`src/ui/commands.ts`) for the buttons to dispatch into; it never reads or
// writes UI DOM apart from the canvas.

import { START_Y, TILE, WORLD_W } from '../../shared/constants';
import { createDisposalScope } from './disposal';
import { createGameSurface, type GameSurfaceRefs } from './dom';
import { advanceViewportZoom, drawnCamera, setViewportZoom, tileAtViewportPoint, viewport } from './viewport';
import { recenteredCamera } from './zoom';
import { loadZoomLevel, saveZoomLevel } from './zoom-settings';
import { createAudio } from '../audio/audio';
import { shouldAttemptAutoAudio } from '../audio/audio-permission';
import { createDefaultStats, createInitialState, isAtHome } from '../core/state';
import { createRenderer, type Renderer } from '../render/renderer';
import { FUEL, REVEAL_FOOTPRINT } from '../core/balance';
import { countItem, totalItems, type Inventory, type InventoryItemKind, type UpgradeKind } from '../core/inventory';
import { manufacturerStock, nearestStation, stationDeviceItemKind } from '../core/stations';
import { equip, unequip } from '../core/ship-upgrades';
import { isPlaceableKind } from '../core/placement-overlay';
import { CARGO_CONTAINER_ITEM } from '../core/cargo-container';
import { DYNAMITE_ITEM } from '../core/dynamite';
import { SCANNER_ITEM } from '../core/scanner-device';
import { shouldCargoBarFlash, shouldFuelBarFlash, shouldHullBarFlash } from '../core/hud-alerts';
import { formatExpeditionObjective } from '../core/objective';
import { load, save } from '../persistence';
import { clearPersistedGameData } from '../persistence-reset';
import { formatShipStatusAnnouncement } from '../core/ship-status';
import { formatExpeditionStats } from '../core/stats';
import { rand } from '../world/world';
import { resetUiCommands, setUiCommands } from '../ui/commands';
import { resetAgentBridge, setAgentBridge } from '../agent/bridge';
import { buildCargoRows, buildInventorySlots, buildShipSlots, pushToast as toast, uiStore, type HudSnapshot, type PlayerSnapshot } from '../ui/store';

import { TELEPORTER_ITEM, advanceTeleportEffect, canTeleport, canUseTeleporter } from '../core/teleporter';
import type { AudioController } from '../core/types';
import { revealFootprint } from '../../shared/exploration-codec';
import { confirmPlayerDataReset, resetPlayerData } from '../core/player-data-reset';
import { fillDeveloperExtractor, grantDeveloperOres } from '../core/developer';
import { confirmWorldStateReset } from '../world/world-state';
import { createFixedStepper } from '../core/fixed-step';
import { recordTileDiff } from '../world/tile-diff';
import { createWorldGrid, type WorldGrid } from './world-grid';
import { createEnemySim, type EnemySim } from './enemies';
import { createActions, type GameActions } from './actions';
import { createScannerDevices, type ScannerDeviceSim } from './scanner-devices';
import { createDynamiteSticks, type DynamiteSim } from './dynamite-sticks';
import { createCargoContainers, type CargoContainerSim } from './cargo-containers';
import { createWrecks, type WreckSim } from './wrecks';
import { reachableContainer } from '../core/cargo-container';
import { reachableWreck } from '../core/wreck';
import { createHomeStations, type HomeStationsSim } from './home-stations';
import { createTrading, type TradingSim } from './trading';
import { createStationDevices, type StationDeviceSim } from './station-devices';
import { createToolkit, TOOLKIT_ITEM, type ToolkitSim } from './toolkit';
import { createDecor, type DecorSim } from './decor';
import { createMovement } from './move';
import { createReadouts, type HudReadouts } from './readouts';
import { createRun, type GameRun } from './run';
import { createInput, type GameInput } from './input';

export type GameRuntimeOptions = GameSurfaceRefs;

export interface GameRuntime {
  /**
   * Undo everything the runtime installed: window/document listeners, the save
   * interval, the animation-frame loop, the audio graph and the command table.
   * Idempotent, and safe to call from a React effect cleanup.
   */
  dispose(): void;
}

/**
 * Build a runtime around a mounted canvas/panel pair and start it. Throws if the
 * surface is unusable; the caller turns that into the visible `failed` state.
 */
export function createGameRuntime(options: GameRuntimeOptions): GameRuntime {
  // Every side effect below registers its own undo here.
  const scope = createDisposalScope();
  const surface = createGameSurface(options, scope);
  const state = createInitialState();
  let audio: AudioController;
  let renderer: Renderer | undefined;

  /**
   * Whether the simulation is frozen between an agent's decisions. `draw()` and
   * `syncUi()` keep running while paused so the window stays live and the
   * observation stays current; only `stepper.advance()` is held.
   */
  let paused = false;

  // Feature modules, constructed by wireModules() once audio exists.
  let grid: WorldGrid;
  let enemies: EnemySim;
  let actions: GameActions;
  let run: GameRun;
  let gameInput: GameInput;
  let readouts: HudReadouts;
  let scanners: ScannerDeviceSim;
  let dynamite: DynamiteSim;
  let containers: CargoContainerSim;
  let wrecks: WreckSim;
  let homeStations: HomeStationsSim;
  let trading: TradingSim;
  let stationDevices: StationDeviceSim;
  let toolkit: ToolkitSim;
  let decor: DecorSim;

  state.stats = createDefaultStats();

  function loadProgress() { load(state); renderer?.invalidateFog(); }

  /**
   * Set by a full reset, and never cleared: the page is on its way out, and
   * `beforeunload`, the minute interval and the visibility handler would
   * otherwise write the keys straight back before the reload takes effect.
   */
  let persistenceCleared = false;

  function saveProgress() { if (!persistenceCleared) save(state); }

  function persistZoom() { if (!persistenceCleared) saveZoomLevel(viewport.targetZoom); }

  /** A trailing-edge debounce, so a long tunnel does not save on every tile. */
  function createDebouncedSave(flush: () => void, delayMs: number) {
    let timer = 0;
    return {
      schedule(){ clearTimeout(timer); timer = window.setTimeout(flush, delayMs); },
      cancel(){ clearTimeout(timer); }
    };
  }
  /** Cheap progress the ship changes constantly: its tile and the fog it reveals. */
  const progressSave = createDebouncedSave(saveProgress, 500);
  /**
   * The camera framing, saved apart from the run. Debounced against the glide
   * rather than the wheel: one scroll is dozens of events and dozens of eased
   * frames, and `localStorage` is synchronous, so only the level the view settles
   * on is written.
   */
  const zoomSave = createDebouncedSave(persistZoom, 500);
  function flushZoomSave() { zoomSave.cancel(); persistZoom(); }

  // Fog is cached per chunk, so every newly explored tile has to mark its chunk dirty.
  function invalidateFogTiles(indexes: number[]) {
    for (const index of indexes) renderer?.invalidateFog(index % WORLD_W, Math.floor(index / WORLD_W));
  }
  function revealAtPlayer() {
    const added = revealFootprint(state.exploredTiles, state.player.x, state.player.y, REVEAL_FOOTPRINT);
    if (!added.length) return;
    invalidateFogTiles(added);
    progressSave.schedule();
  }
  /** Explore individual tiles — what a deployed scanner reports. */
  function revealTiles(indexes: number[]) {
    const added: number[] = [];
    for (const index of indexes) {
      if (state.exploredTiles.has(index)) continue;
      state.exploredTiles.add(index);
      added.push(index);
    }
    if (!added.length) return;
    invalidateFogTiles(added);
    progressSave.schedule();
  }

  function addCash(amount: number) {
    state.cash += amount;
    if (amount > 0) state.stats.totalCashEarned += amount;
    saveProgress();
  }

  /**
   * Record which device is armed for placement, for both the canvas grid (read
   * off `state`) and the HUD slot (read off the store). Disarming also drops the
   * hover tile, so a stale highlight never outlives the grid it belonged to.
   */
  function paintArmedPlacement(kind: InventoryItemKind | null) {
    state.armedPlacement = kind;
    if (!kind) state.hoverTile = null;
    uiStore.getState().setArmedPlacement(kind);
  }

  function cargoUsed(){ return totalItems(state.player.inventory); }
  /** Whether the ship is parked at the home base, where the stations live. */
  function atSurface(){ return isAtHome(state.player); }

  function spawnDust(x: number, y: number, color='#9d6a42', amount=10){
    for (let i=0;i<amount;i++) state.particles.push({x:x+0.5,y:y+0.5,vx:(Math.random()-.5)*.08,vy:(Math.random()-.7)*.09,life:22+Math.random()*18,color,size:.035+Math.random()*.045});
  }
  function spawnExplosion(x: number, y: number){
    const colors = ['#ffec8b','#ff9f1c','#ff4d2d','#7a1f16','#d7e7ff'];
    for (let i=0;i<70;i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = .035 + Math.random() * .16;
      state.particles.push({x:x+0.5,y:y+0.5,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-.04,life:34+Math.random()*34,color:colors[i%colors.length],size:.045+Math.random()*.085});
    }
  }
  // --- Cheat menu -----------------------------------------------------------
  function grantDeveloperOresCheat(){
    const granted = grantDeveloperOres(state);
    saveProgress();
    syncPlayerSnapshot();
    // Repaint the station screen if it happens to be open, so the overflow shows.
    const open = homeStations.openStation;
    if (open?.kind === 'manufacturer') setStationUi(open.inventory);
    toast(granted > 0 ? `Developer action: granted ${granted} ore for $0.` : 'Developer action: no room for more ore.');
  }
  function fillExtractorCheat(){
    fillDeveloperExtractor(state);
    saveProgress();
    // Repaint the extractor screen if it is open, so the new buffers show at once.
    const open = homeStations.openStation;
    if (open?.kind === 'extractor') setExtractorUi({coal: open.coal, fuel: open.fuel, progress: open.progress});
    toast('Developer action: extractor stocked for $0.');
  }

  // --- Screens and UI sync -------------------------------------------------
  /** Register the button/dialog dispatch table the React tree calls into. */
  function registerUiCommands(){
    setUiCommands({
      // Only one press on the mine is available, so arming any deployable stands
      // the others down.
      toggleScannerPlacement: () => { standDownExcept('scanner'); scanners.toggleArmed(); },
      toggleDynamitePlacement: () => { standDownExcept('dynamite'); dynamite.toggleArmed(); },
      toggleContainerPlacement: () => { standDownExcept('container'); containers.toggleArmed(); },
      toggleManufacturerPlacement: () => { standDownExcept('stationDevices'); stationDevices.toggleArmed('manufacturer'); },
      toggleExtractorPlacement: () => { standDownExcept('stationDevices'); stationDevices.toggleArmed('extractor'); },
      toggleToolkit: () => { standDownExcept('toolkit'); toolkit.toggleArmed(); },
      closeContainer: () => containers.close(),
      storeInContainer: (kind, single) => containers.store(kind, single),
      takeFromContainer: (kind, single) => containers.take(kind, single),
      closeWreck: () => wrecks.close(),
      takeFromWreck: (kind, single) => wrecks.take(kind, single),
      lootAll: () => wrecks.lootAll(),
      closeTrade: () => trading.close(),
      sellToPost: (kind, single) => trading.sell(kind, single),
      buyFromPost: kind => trading.buy(kind),
      useTeleporter: () => actions.useTeleporter(),
      openShip: openShipScreen,
      closeShip: closeShipScreen,
      equipUpgrade: (kind, slot) => equipUpgrade(kind, slot),
      unequipUpgrade: slot => unequipUpgrade(slot),
      toggleDecorPlacement: kind => { standDownExcept('decor'); decor.toggleArmed(kind); },
      useRepairKit: () => { actions.useRepairKit(); syncPlayerSnapshot(); },
      closeStation: () => homeStations.close(),
      closeExtractor: () => homeStations.close(),
      stowAll: () => homeStations.stowAll(),
      stowStack: (kind, single) => homeStations.stow(kind, single),
      takeFromStation: (kind, single) => homeStations.take(kind, single),
      craft: recipe => homeStations.craft(recipe),
      loadCoal: () => homeStations.loadCoal(),
      refuelFromExtractor: () => homeStations.refuel(),
      openInfo: openInfoScreen,
      closeInfo: closeInfoScreen,
      toggleMusic: () => { void audio.toggleMusic(); },
      toggleSfx: () => { void audio.toggleSfx(); },
      playSolo: event => playSolo(event),
      grantDeveloperOres: grantDeveloperOresCheat,
      fillExtractor: fillExtractorCheat,
      resetPlayerData: () => {
        if (!confirmPlayerDataReset(message => window.confirm(message))) return;
        progressSave.cancel();
        gameInput.clearKeys();
        resetPlayerData(state);
        readouts.reset();
        revealAtPlayer();
        progressSave.cancel();
        saveProgress();
        closeInfoScreen();
        toast('Player data reset. Mine terrain preserved.');
      },
      resetWorldState: () => {
        if (!confirmWorldStateReset(message => window.confirm(message))) return;
        run.clearWorldRuntime();
        saveProgress();
        toast('World state reset. Player progress preserved.');
        closeInfoScreen();
      },
      resetGame: () => {
        // Order matters: silence every writer *before* the keys go, or a pending
        // debounce — or the unload save the reload itself triggers — would put
        // the run back on disk between the wipe and the fresh boot.
        persistenceCleared = true;
        progressSave.cancel();
        zoomSave.cancel();
        clearPersistedGameData();
        window.location.reload();
      }
    });
  }
  /** The armed-tool groups that all share the single press on the mine. */
  type ArmGroup = 'scanner' | 'dynamite' | 'container' | 'decor' | 'stationDevices' | 'toolkit';
  /** Stand every armed tool down except the one about to be (re)armed. */
  function standDownExcept(keep: ArmGroup): void {
    if (keep !== 'scanner') scanners.disarm();
    if (keep !== 'dynamite') dynamite.disarm();
    if (keep !== 'container') containers.disarm();
    if (keep !== 'decor') decor.disarm();
    if (keep !== 'stationDevices') stationDevices.disarm();
    if (keep !== 'toolkit') toolkit.disarm();
  }
  /** Stand down whichever deployable is waiting for a press on the mine. */
  function disarmPlacements(): boolean {
    // All of them, and not short-circuited: only one can be armed, but a disarm
    // must never depend on which.
    const hadScanner = scanners.disarm();
    const hadDynamite = dynamite.disarm();
    const hadDecor = decor.disarm();
    const hadStation = stationDevices.disarm();
    const hadToolkit = toolkit.disarm();
    return containers.disarm() || hadToolkit || hadStation || hadDecor || hadDynamite || hadScanner;
  }
  /** Push the current fitting slots to the store for the Ship screen to paint. */
  function syncShipUpgrades(){
    uiStore.getState().setShipEquipment(buildShipSlots(state.player.equipment));
  }
  function openShipScreen(){
    // An overlay covers the mine, so a pointer armed for placement has nothing
    // left to aim at. The ship screen opens anywhere — it needs no station.
    disarmPlacements();
    syncShipUpgrades();
    syncPlayerSnapshot();
    uiStore.getState().setActiveOverlay('ship');
  }
  function closeShipScreen(){
    uiStore.getState().closeOverlay('ship');
  }
  /**
   * Publish the manufacturing station's stock to the store and raise its screen,
   * or take the screen away with `null`. An overlay covers the mine, so opening one
   * stands any armed placement down first.
   */
  function setStationUi(inventory: Inventory | null){
    const store = uiStore.getState();
    if (!inventory) return store.closeOverlay('station');
    disarmPlacements();
    store.setStationSlots(buildInventorySlots(inventory));
    syncPlayerSnapshot();
    store.setActiveOverlay('station');
  }
  function setExtractorUi(view: {coal: number; fuel: number; progress: number} | null){
    const store = uiStore.getState();
    if (!view) return store.closeOverlay('extractor');
    disarmPlacements();
    store.setExtractor(view);
    syncPlayerSnapshot();
    store.setActiveOverlay('extractor');
  }
  /** Space, or a click with no tile named: open the nearest station. */
  function openNearestStation(){
    homeStations.openNearest();
  }
  /**
   * Space, or a click with no tile named, weighing the home stations against a
   * trading post: whichever station-like thing is nearest wins, and a station
   * breaks a tie. Toggles the open one shut, and stands any placement down before
   * covering the mine with a new screen.
   */
  function openNearestStationLike(){
    if (homeStations.openStation) return homeStations.close();
    if (trading.open) return trading.close();
    disarmPlacements();
    const station = nearestStation(state.stations, state.player);
    const stationDistance = station
      ? Math.abs(station.x - state.player.x) + Math.abs(station.y - state.player.y)
      : Infinity;
    const post = trading.nearestPost();
    if (post && post.distance < stationDistance) trading.openNearest();
    else openNearestStation();
  }
  /**
   * The `c` key, weighing a cargo container against a wreck: open whichever
   * salvageable stash is nearest, a container breaking a tie. Toggles the open one
   * shut first, and stands any placement down before covering the mine.
   */
  function openNearestContainerOrWreck(){
    if (containers.open) return containers.close();
    if (wrecks.open) return wrecks.close();
    disarmPlacements();
    const {x, y} = state.player;
    const container = reachableContainer(state.cargoContainers, x, y);
    const wreck = reachableWreck(state.wrecks, x, y);
    if (!container && !wreck) return void containers.openNearest();
    const containerDistance = container ? Math.abs(container.x - x) + Math.abs(container.y - y) : Infinity;
    const wreckDistance = wreck ? Math.abs(wreck.x - x) + Math.abs(wreck.y - y) : Infinity;
    if (wreck && wreckDistance < containerDistance) wrecks.openNearest();
    else containers.openNearest();
  }
  /** The slot a fit lands in when none is given: the first empty one, else slot 0. */
  function firstFittingSlot(){
    const empty = state.player.equipment.findIndex(slot => slot === null);
    return empty === -1 ? 0 : empty;
  }
  function equipUpgrade(kind: UpgradeKind, slot?: number){
    const result = equip(state.player, slot ?? firstFittingSlot(), kind);
    if (!result.ok) { audio.alarm(); return toast(result.reason); }
    saveProgress();
    syncShipUpgrades();
    syncPlayerSnapshot();
    audio.blip(520, .05, 'triangle', .04);
    toast('Upgrade fitted.');
  }
  function unequipUpgrade(slot: number){
    const result = unequip(state.player, slot);
    if (!result.ok) { audio.alarm(); return toast(result.reason); }
    saveProgress();
    syncShipUpgrades();
    syncPlayerSnapshot();
    audio.blip(360, .05, 'triangle', .04);
    toast('Upgrade returned to the cargo bay.');
  }
  function openInfoScreen(){
    disarmPlacements();
    syncPlayerSnapshot();
    syncInfoDetails();
    uiStore.getState().setActiveOverlay('info');
  }
  function closeInfoScreen(){
    uiStore.getState().closeOverlay('info');
  }
  /**
   * Reused scratch snapshots. The loop fills them every frame and the store copies
   * them only when a value actually changed, so a steady HUD allocates nothing.
   */
  const hudScratch: HudSnapshot = {...uiStore.getState().hud};
  const playerScratch: PlayerSnapshot = {...uiStore.getState().player};

  function syncPlayerSnapshot(){
    const p = state.player;
    playerScratch.fuel = p.fuel;
    playerScratch.fuelMax = p.fuelMax;
    playerScratch.hull = p.hull;
    playerScratch.hullMax = p.hullMax;
    playerScratch.cargoMax = p.cargoMax;
    playerScratch.drill = p.drill;
    playerScratch.teleporters = countItem(p.inventory, TELEPORTER_ITEM.kind);
    playerScratch.scanners = countItem(p.inventory, SCANNER_ITEM.kind);
    playerScratch.dynamite = countItem(p.inventory, DYNAMITE_ITEM.kind);
    playerScratch.containers = countItem(p.inventory, CARGO_CONTAINER_ITEM.kind);
    uiStore.getState().syncPlayer(playerScratch);
  }
  function syncInfoDetails(){
    const store = uiStore.getState();
    store.setCargoRows(buildCargoRows(state.player.inventory));
    store.setStatRows(formatExpeditionStats(state.stats));
  }
  /**
   * The inventory panel is on screen the whole run, so this runs every frame.
   * The bay is immutable — every load, sale and respawn hands back a new array —
   * so one reference comparison is enough to skip rebuilding the slot views, and
   * a ship that mined nothing this frame allocates nothing.
   */
  let syncedInventory: Inventory | null = null;
  function syncInventory(){
    if (state.player.inventory === syncedInventory) return;
    syncedInventory = state.player.inventory;
    uiStore.getState().setInventorySlots(buildInventorySlots(syncedInventory));
  }
  function updateAnimation(){
    const p = state.player;
    p.drawX += (p.x - p.drawX) * 0.23;
    p.drawY += (p.y - p.drawY) * 0.23;
    p.bob *= 0.86;
    p.drillAnim *= 0.90;
    state.teleportEffect = advanceTeleportEffect(state.teleportEffect);
    // A settling zoom grows the view around its own centre, so the ship stays put
    // instead of sliding in from a corner while the follow easing catches up.
    const previousTilesX = viewport.tilesX, previousTilesY = viewport.tilesY;
    if (advanceViewportZoom()) {
      state.camX = Math.max(0, recenteredCamera(state.camX, previousTilesX, viewport.tilesX));
      state.camY = Math.max(0, recenteredCamera(state.camY, previousTilesY, viewport.tilesY));
      // Trailing edge: the glide only stops moving once the wheel has, so this
      // fires once per gesture, with the level that was actually landed on.
      zoomSave.schedule();
    }
    const targetCamX = Math.max(0, Math.min(WORLD_W-viewport.tilesX, p.drawX - viewport.tilesX/2 + 0.5));
    const targetCamY = Math.max(0, p.drawY - viewport.tilesY/2 + 0.5);
    state.camX += (targetCamX - state.camX) * 0.12;
    state.camY += (targetCamY - state.camY) * 0.12;
    state.particles = state.particles.filter(pt => {
      pt.x += pt.vx; pt.y += pt.vy; pt.vy += .003; pt.life -= 1;
      return pt.life > 0;
    });
  }
  /** Publish this frame's UI state. The only place the game talks to the chrome. */
  function syncUi(){
    const p = state.player;
    const surf = atSurface();
    const lowFuel = shouldFuelBarFlash(state);

    hudScratch.cash = state.cash;
    hudScratch.depthMeters = Math.max(0, p.y - START_Y) * 10;
    hudScratch.fuel = p.fuel;
    hudScratch.fuelMax = p.fuelMax;
    hudScratch.hull = p.hull;
    hudScratch.hullMax = p.hullMax;
    hudScratch.cargo = cargoUsed();
    hudScratch.cargoMax = p.cargoMax;
    hudScratch.fuelAlert = lowFuel;
    hudScratch.hullAlert = shouldHullBarFlash(state);
    hudScratch.cargoAlert = shouldCargoBarFlash(state);
    hudScratch.objective = formatExpeditionObjective({
      player: p,
      cargoCount: hudScratch.cargo,
      atSurface: surf,
      bay: p.inventory,
      station: manufacturerStock(state.stations)
    });
    hudScratch.atSurface = surf;
    hudScratch.gameOver = state.gameOver;
    const near = nearestStation(state.stations, p);
    hudScratch.stationHint = near?.kind === 'manufacturer'
      ? 'Space: Manufacturing Station'
      : near?.kind === 'extractor'
        ? 'Space: Oil Extractor'
        : '';
    hudScratch.teleporters = countItem(p.inventory, TELEPORTER_ITEM.kind);
    hudScratch.teleportReturn = state.teleportReturnPosition !== null;
    hudScratch.teleportDepthReached = canTeleport(p);
    hudScratch.teleportUsable = canUseTeleporter(p, state.teleportReturnPosition);
    // The canvas, spoken: the one HUD field that exists for the live region rather
    // than the layout. Thresholds only, so it changes when the ship crosses one and
    // is byte-identical (and therefore silent) on every frame in between.
    hudScratch.announcement = formatShipStatusAnnouncement({
      gameOver: state.gameOver,
      atSurface: surf,
      cargoFull: hudScratch.cargoAlert,
      hullCritical: hudScratch.hullAlert
    });
    // Scanner line, return-fuel forecast, and depth landmark, each recomputed only
    // when its own inputs moved. Milestone crossings toast from in here.
    readouts.sync(hudScratch);

    const store = uiStore.getState();
    store.syncHud(hudScratch);
    syncInventory();
    if (store.activeOverlay !== null) syncPlayerSnapshot();
    if (store.activeOverlay === 'info') syncInfoDetails();

    if (lowFuel && !surf && performance.now() - audio.lastLowFuel > FUEL.lowFuelWarnMs) { audio.lowFuel(); audio.lastLowFuel = performance.now(); }
  }
  // Everything tuned in ticks lives here: `state.tick`, enemy cooldowns, keyboard
  // repeat, and the per-step easing in updateAnimation(). It runs a whole number of
  // times per frame at exactly 60 Hz, independent of the display's refresh rate.
  function step(){
    gameInput.tick();
    if (isPlaying()) {
      // Deployed hardware keeps working while the ship is elsewhere, but only
      // while the run is live: a paused splash must not burn survey time, and a
      // fuse must not burn down behind a title card.
      scanners.tick();
      dynamite.tick();
      containers.tick();
      wrecks.tick();
      stationDevices.tick();
      toolkit.tick();
      decor.tick();
      homeStations.tick();
      trading.tick();
      enemies.update();
    }
    updateAnimation();
  }
  const stepper = createFixedStepper(step);
  // Rendering is once per animation frame against the latest simulated state; the
  // 60 Hz step is small enough that interpolation buys nothing visible. The scope
  // owns the rescheduling, so disposing stops the loop after the current frame.
  function loop(now: number){
    // A paused sim still paints and syncs, so the human's window and the agent's
    // observation both stay live; only the fixed-step advance is held.
    if (!paused) stepper.advance(now);
    renderer?.draw();
    syncUi();
  }
  /**
   * Freeze or resume the simulation for programmatic play. Resuming discards the
   * wall-clock gap the pause opened up — the same reset the visibility handler
   * uses — so the sim carries on from now rather than fast-forwarding the frozen
   * interval in one burst.
   */
  function setPaused(value: boolean){
    if (paused === value) return;
    paused = value;
    if (!value) stepper.reset();
  }
  /**
   * Canvas client coordinates of a tile's centre, inverting `tileAtViewportPoint`:
   * undo the camera and the zoom, then map the viewport CSS pixels back onto the
   * canvas's laid-out size. Returns `null` when the tile is off-screen or the
   * canvas has no layout box, so a harness never clicks a point that is not there.
   */
  function screenPointForTile(tx: number, ty: number): {x: number; y: number} | null {
    const rect = surface.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const camera = drawnCamera(state.camX, state.camY);
    const viewX = (tx + 0.5 - camera.x) * TILE * viewport.zoom;
    const viewY = (ty + 0.5 - camera.y) * TILE * viewport.zoom;
    if (viewX < 0 || viewY < 0 || viewX > viewport.widthPx || viewY > viewport.heightPx) return null;
    return {
      x: rect.left + viewX * (rect.width / viewport.widthPx),
      y: rect.top + viewY * (rect.height / viewport.heightPx)
    };
  }
  /** Enable sound on the first trusted pointer gesture, if the player wants it. */
  function tryAutoAudio(event?: Event) {
    if (shouldAttemptAutoAudio({
      wantsSound: audio.wantsSound,
      enabled: audio.enabled,
      eventType: event?.type,
      isTrusted: event?.isTrusted
    })) audio.enable();
  }
  /**
   * Put the keyboard on the mine. The canvas is the surface's only tab stop, so
   * this is also what makes the focus ring land on the thing the keys drive; while
   * a modal dialog is up the rest of the page is inert and the call does nothing,
   * which is exactly what should happen.
   */
  function focusGame(){
    try { surface.canvas.focus({preventScroll:true}); }
    catch { try { surface.canvas.focus(); } catch { /* focus is best-effort */ } }
  }
  /**
   * Drop the keyboard focus ring from the canvas after a pointer press, without
   * giving up the keyboard. `:focus-visible` is a modality heuristic the browser
   * only re-decides when focus moves, so a click on the already-focused canvas
   * leaves a keyboard-seeded ring up — including through a device placement. A
   * blur-then-refocus inside the pointer gesture reseats the flag as pointer-
   * driven, so the ring goes and the mine keeps the keys. Only when the canvas
   * actually holds focus: elsewhere the browser's own decision is already right.
   */
  function resetCanvasFocusRing(){
    if (document.activeElement !== surface.canvas) return;
    surface.canvas.blur();
    focusGame();
  }
  /**
   * Take the keyboard for a run that has just started. `focusGame()` cannot do it
   * on the spot: the intro overlay may still hold focus until React commits the
   * phase change, so the call would be a silent no-op and the run would begin with
   * focus on `<body>`. Retrying for a few frames covers the flush React gives the
   * press that started the run.
   */
  function claimFocusForRun(attempts = 4){
    focusGame();
    if (document.activeElement === surface.canvas || attempts <= 0) return;
    scope.timeout(() => claimFocusForRun(attempts - 1), 16);
  }
  /** Whether the run is live. The simulation and the keyboard both hang off this. */
  function isPlaying(){
    return uiStore.getState().phase === 'playing';
  }
  /**
   * Splash → run. The splash's default: any press on the title card, and the
   * Enter or Space that reaches it from the canvas, comes here.
   *
   * The press that got us here is also the audio-unlock gesture, spent by
   * `startGame()`.
   */
  function playSolo(event?: Event){
    if (uiStore.getState().phase !== 'intro') return;
    startGame(event);
  }
  /** The one way into the run, so the start-of-run side effects exist exactly once. */
  function startGame(event?: Event){
    const store = uiStore.getState();
    if (store.phase === 'playing') return;
    store.setPhase('playing');
    claimFocusForRun();
    tryAutoAudio(event);
    toast('Drill ready. Mine ore, stow it at the home base, and watch your fuel.');
  }

  /**
   * Build the feature modules and connect them. A few dependencies are late-bound
   * closures because the graph has cycles by design: the enemy simulation writes
   * tiles back through the grid it reads from.
   */
  function wireModules(){
    grid = createWorldGrid({
      state,
      invalidateTerrain: (x, y) => renderer?.invalidateTerrain(x, y),
      // A world regenerates from its seed on every restart, so the diff is the
      // only record that a tunnel was ever dug.
      onTileSet: (x, y, tile) => recordTileDiff(state.soloTileDiff, {x, y, tile})
    });
    run = createRun({
      state,
      audio,
      enemies: () => enemies,
      input: () => gameInput,
      toast,
      saveProgress,
      revealAtPlayer,
      spawnExplosion,
      invalidateTerrain: () => renderer?.invalidateTerrain(),
      invalidateFog: () => renderer?.invalidateFog()
    });
    enemies = createEnemySim({
      state,
      grid,
      audio,
      toast,
      addCash,
      saveProgress,
      damagePlayer: run.damage,
      spawnDust,
      spawnExplosion
    });
    const movement = createMovement({
      state,
      grid,
      enemies,
      audio,
      toast,
      saveProgress,
      scheduleSave: () => progressSave.schedule(),
      revealAtPlayer,
      damage: run.damage,
      gameOver: run.gameOver,
      spawnDust,
      spawnExplosion
    });
    actions = createActions({
      state,
      audio,
      toast,
      saveProgress,
      atSurface
    });
    readouts = createReadouts({state, grid, enemies, atSurface, toast});
    scanners = createScannerDevices({
      state,
      grid,
      audio,
      toast,
      saveProgress,
      revealTiles,
      setArmedUi: value => paintArmedPlacement(value ? SCANNER_ITEM.kind : null)
    });
    dynamite = createDynamiteSticks({
      state,
      grid,
      audio,
      toast,
      saveProgress,
      wakeEnemiesNear: (x, y) => enemies.wakeEnemiesNear(x, y),
      spawnExplosion,
      damagePlayer: run.damage,
      setArmedUi: value => paintArmedPlacement(value ? DYNAMITE_ITEM.kind : null)
    });
    containers = createCargoContainers({
      state,
      grid,
      audio,
      toast,
      saveProgress,
      setArmedUi: value => paintArmedPlacement(value ? CARGO_CONTAINER_ITEM.kind : null),
      setOpenUi: contents => {
        const store = uiStore.getState();
        if (!contents) return store.closeOverlay('container');
        store.setContainerSlots(buildInventorySlots(contents));
        store.setActiveOverlay('container');
      }
    });
    wrecks = createWrecks({
      state,
      audio,
      toast,
      saveProgress,
      setOpenUi: contents => {
        const store = uiStore.getState();
        if (!contents) return store.closeOverlay('wreck');
        store.setWreckSlots(buildInventorySlots(contents));
        store.setActiveOverlay('wreck');
      }
    });
    decor = createDecor({
      state,
      grid,
      audio,
      toast,
      saveProgress,
      setArmedUi: kind => paintArmedPlacement(kind)
    });
    homeStations = createHomeStations({
      state,
      audio,
      toast,
      saveProgress,
      setStationUi,
      setExtractorUi,
      syncPlayer: syncPlayerSnapshot
    });
    trading = createTrading({
      state,
      audio,
      toast,
      saveProgress,
      addCash,
      setOpenUi: offers => {
        const store = uiStore.getState();
        if (!offers) return store.closeOverlay('trade');
        disarmPlacements();
        store.setTradeBuy(offers);
        store.setActiveOverlay('trade');
      }
    });
    stationDevices = createStationDevices({
      state,
      grid,
      audio,
      toast,
      saveProgress,
      setArmedUi: kind => paintArmedPlacement(kind ? stationDeviceItemKind(kind) : null)
    });
    toolkit = createToolkit({
      state,
      audio,
      toast,
      saveProgress,
      setArmedUi: value => paintArmedPlacement(value ? TOOLKIT_ITEM.kind : null)
    });
    gameInput = createInput({
      state,
      actions,
      move: movement.move,
      isOpenMovementDestination: movement.isOpenMovementDestination,
      // A replacement ship deploys with empty fitting slots, so the Ship screen's
      // store snapshot has to be re-synced or it would still paint the dead ship's
      // upgrades until the screen is next reopened.
      restartGame: () => { run.restartGame(); syncShipUpgrades(); },
      closeShipScreen,
      closeInfoScreen,
      cancelPlacement: disarmPlacements,
      toggleDynamitePlacement: () => { standDownExcept('dynamite'); dynamite.toggleArmed(); },
      // A crate's or wreck's menu covers the mine, so nothing may be left waiting
      // for a press on it — including the two deployables this module does not own.
      toggleContainer: () => { if (!containers.open && !wrecks.open) disarmPlacements(); openNearestContainerOrWreck(); },
      closeContainer: () => containers.close(),
      closeWreck: () => wrecks.close(),
      // Space opens whichever station-like thing is in reach — a home station or a
      // trading post; a placement pointer has nothing left to aim at once its screen
      // covers the mine.
      openNearest: openNearestStationLike,
      closeStation: () => homeStations.close(),
      closeExtractor: () => homeStations.close(),
      closeTrade: () => trading.close(),
      toast,
      tryAutoAudio
    });
  }

  /**
   * A press on the mine while a deployable is armed puts it on the tile pressed;
   * an unarmed one opens the cargo container standing on that tile, if the ship is
   * beside it. Registered on the canvas rather than the window so the HUD's own
   * buttons — which sit over the same pixels — keep their clicks.
   *
   * The press is deliberately left to run its course afterwards: it is also the
   * gesture that unlocks audio, and it is what hands the keyboard back to the
   * canvas after a click on the inventory slot took it away.
   */
  function handleMinePointerDown(event: PointerEvent){
    if (!isPlaying()) return;
    // A press on the mine is the mouse taking over, so the keyboard focus ring
    // must not linger on the canvas afterwards. `:focus-visible` is only
    // re-decided when focus actually moves, and this press lands on the canvas
    // that already holds focus, so the ring would otherwise stay up through a
    // placement and beyond it. Re-focusing during the pointer gesture reseats the
    // flag as pointer-driven (no ring) while keeping the keys on the mine; the
    // next Tab or keyboard focus brings the ring back, so nothing is lost.
    resetCanvasFocusRing();
    const armed = scanners.armed || dynamite.armed || containers.armed
      || stationDevices.armed !== null || toolkit.armed || decor.armed !== null;
    // Nothing is armed and something is already over the mine: the press belongs
    // to whatever is on top of it, not to the tile underneath.
    if (!armed && uiStore.getState().activeOverlay !== null) return;
    const rect = surface.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    // The canvas may be laid out at a different size than it is drawn at, so the
    // press is normalised into the CSS pixels the viewport is expressed in first.
    const point = tileAtViewportPoint(
      (event.clientX - rect.left) * (viewport.widthPx / rect.width),
      (event.clientY - rect.top) * (viewport.heightPx / rect.height),
      state.camX,
      state.camY
    );
    if (scanners.armed) scanners.placeAt(point.x, point.y);
    else if (dynamite.armed) dynamite.placeAt(point.x, point.y);
    else if (containers.armed) containers.placeAt(point.x, point.y);
    else if (stationDevices.armed) stationDevices.placeAt(point.x, point.y);
    else if (toolkit.armed) toolkit.liftAt(point.x, point.y);
    else if (decor.armed) decor.placeAt(point.x, point.y);
    // An unarmed press opens a station tile the ship can reach, a trading post, the
    // crate, or the wreck on the tile; a press on bare rock is not a refusal, it was
    // about none of them.
    else if (!homeStations.openAt(point.x, point.y) && !trading.openAt(point.x, point.y)
      && !containers.openAt(point.x, point.y)) wrecks.openAt(point.x, point.y);
  }

  /**
   * Track the tile under the pointer while a device is armed, so the renderer can
   * highlight where a press would land. Only while armed: the hover grid is a
   * placement aid, not a permanent cursor, and computing it otherwise is wasted
   * work on every mouse move.
   */
  function handleMinePointerMove(event: PointerEvent){
    if (!isPlaying() || !isPlaceableKind(state.armedPlacement)) {
      state.hoverTile = null;
      return;
    }
    const rect = surface.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    state.hoverTile = tileAtViewportPoint(
      (event.clientX - rect.left) * (viewport.widthPx / rect.width),
      (event.clientY - rect.top) * (viewport.heightPx / rect.height),
      state.camX,
      state.camY
    );
  }

  /** The pointer left the mine: drop the hover highlight it was driving. */
  function handleMinePointerLeave(){
    state.hoverTile = null;
  }

  /** Hand the runtime back to the mount that owns it. */
  function dispose(){
    if (scope.disposed) return;
    // A teardown is indistinguishable from a tab close as far as the save is
    // concerned, so bank the run before anything is unwired.
    progressSave.cancel();
    saveProgress();
    flushZoomSave();
    audio.stopMusic();
    // A leaked AudioContext survives the mount and browsers only allow a handful.
    void audio.ctx?.close().catch(() => { /* already closed */ });
    scope.dispose();
    // Buttons must not reach a runtime whose listeners and frames are gone, and a
    // replacement runtime re-announces its own boot toast.
    resetUiCommands();
    resetAgentBridge();
    uiStore.getState().clearToasts();
    // An armed slot outlives its runtime otherwise, and there is nothing left to
    // take the press it is waiting for. A crate's transfer menu is worse: every
    // button in it would dispatch into a table of no-ops.
    uiStore.getState().setArmedPlacement(null);
    uiStore.getState().closeOverlay('container');
    uiStore.getState().closeOverlay('wreck');
    uiStore.getState().closeOverlay('station');
    uiStore.getState().closeOverlay('extractor');
    uiStore.getState().closeOverlay('trade');
  }

  // --- Boot ------------------------------------------------------------------
  /** Construct the world, wire the listeners, and start the loop. */
  function boot(): void {
    audio = createAudio(toast);
    state.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    // Adopt the remembered framing before anything reads the viewport: the tile
    // extents it derives feed the renderer's caches and the camera, and jumping
    // straight to it (rather than easing) keeps the first frame from sliding.
    setViewportZoom(loadZoomLevel());
    wireModules();
    renderer = createRenderer({
      state,
      canvas: surface.canvas,
      ctx: surface.ctx,
      get: (x: number, y: number) => grid.get(x, y),
      rand
    });
    loadProgress();
    scope.onWindow('touchstart', tryAutoAudio, {passive:true});
    surface.canvas.addEventListener('pointerdown', handleMinePointerDown);
    scope.add(() => surface.canvas.removeEventListener('pointerdown', handleMinePointerDown));
    surface.canvas.addEventListener('pointermove', handleMinePointerMove);
    scope.add(() => surface.canvas.removeEventListener('pointermove', handleMinePointerMove));
    surface.canvas.addEventListener('pointerleave', handleMinePointerLeave);
    scope.add(() => surface.canvas.removeEventListener('pointerleave', handleMinePointerLeave));
    scope.add(gameInput.attach());
    scope.onWindow('focus', focusGame);
    scope.onDocument('visibilitychange', () => {
      // Mobile browsers routinely discard a hidden tab without ever firing
      // `beforeunload`, so hiding is the last reliable chance to keep the run.
      if (document.hidden) { progressSave.cancel(); saveProgress(); flushZoomSave(); return; }
      // Animation frames stop while hidden; discard the gap instead of fast-forwarding.
      stepper.reset();
      focusGame();
    });
    scope.onWindow('pointerdown', tryAutoAudio);
    registerUiCommands();
    setAgentBridge({
      getState: () => state,
      getUi: () => uiStore.getState(),
      getTile: (x, y) => grid.get(x, y),
      setPaused,
      isPaused: () => paused,
      screenPointForTile
    });
    run.resume();
    scope.interval(saveProgress, 60000);
    scope.onWindow('beforeunload', () => { saveProgress(); flushZoomSave(); });
    focusGame();
    scope.timeout(focusGame, 60);
    scope.frameLoop(loop);
  }

  boot();

  return {dispose};
}

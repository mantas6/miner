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
// `world-grid.ts` (tile access), `save-scheduler.ts` (when the run is written),
// `overlays.ts` (raising and dropping the modal screens), `ui-sync.ts` (the
// per-frame store publish), `placement-router.ts` (the armed tools sharing the
// press on the mine), `interactables.ts` (what Space and C would open),
// `particles.ts`, `focus.ts` and `cheats.ts`. What stays here is the wiring
// between them and the loop itself.
//
// The UI is React reading `src/ui/store.ts`. This module pushes a snapshot into
// that store once per frame and exposes a flat command table (`src/ui/commands.ts`)
// for the buttons to dispatch into; it never reads or writes UI DOM apart from
// the canvas.

import { TILE, WORLD_W } from '../../shared/constants';
import { createDisposalScope } from './disposal';
import { createGameSurface, type GameSurface, type GameSurfaceRefs } from './dom';
import { advanceViewportZoom, drawnCamera, setViewportZoom, tileAtViewportPoint, viewport } from './viewport';
import { recenteredCamera } from './zoom';
import { loadZoomLevel, saveZoomLevel } from './zoom-settings';
import { createAudio } from '../audio/audio';
import { shouldAttemptAutoAudio } from '../audio/audio-permission';
import { createDefaultStats, createInitialState, isAtHome } from '../core/state';
import { createRenderer, type Renderer } from '../render/renderer';
import { createIntroShowcase, type IntroShowcase } from './intro-showcase';
import { REVEAL_FOOTPRINT } from '../core/balance';
import type { Inventory, InventoryItemKind, UpgradeKind } from '../core/inventory';
import type { Epitaph } from '../core/grave';
import { isHomeStation, stationDeviceItemKind, type ManufacturerStation } from '../core/stations';
import { equip, unequip } from '../core/ship-upgrades';
import { isPlaceableKind } from '../core/placement-overlay';
import { CARGO_CONTAINER_ITEM } from '../core/cargo-container';
import { DYNAMITE_ITEM } from '../core/dynamite';
import { SCANNER_ITEM } from '../core/scanner-device';
import { SAVE_EXPORT_FILENAME, SAVE_KEY, discardSave, load, parseImportedSave, save, serializeProgress } from '../persistence';
import { clearPersistedGameData } from '../persistence-reset';
import { rand } from '../world/world';
import { resetUiCommands, setUiCommands } from '../ui/commands';
import { resetAgentBridge, setAgentBridge } from '../agent/bridge';
import { buildInventorySlots, pushToast as toast, uiStore, type ExtractorView, type PortalView, type TradeOfferView } from '../ui/store';

import { advanceTeleportEffect } from '../core/teleporter';
import type { AudioController } from '../core/types';
import { revealFootprint } from '../../shared/exploration-codec';
import { confirmWorldStateReset } from '../world/world-state';
import { createFixedStepper } from '../core/fixed-step';
import { recordTileDiff } from '../world/tile-diff';
import { canLandOn, createWorldGrid, type WorldGrid } from './world-grid';
import { createEnemySim, type EnemySim } from './enemies';
import { createActions, type GameActions } from './actions';
import { createScannerDevices, type ScannerDeviceSim } from './scanner-devices';
import { createDynamiteSticks, type DynamiteSim } from './dynamite-sticks';
import { createCargoContainers, type CargoContainerSim } from './cargo-containers';
import { createWrecks, type WreckSim } from './wrecks';
import { createChests, type ChestSim } from './chests';
import { createGraves, type GraveSim } from './graves';
import { createHomeStations, extractorView, type HomeStationsSim } from './home-stations';
import { createPortalsSim, type PortalsSim } from './portals';
import { createTrading, type TradingSim } from './trading';
import { createStationDevices, type StationDeviceSim } from './station-devices';
import { createToolkit, TOOLKIT_ITEM, type ToolkitSim } from './toolkit';
import { createDecor, type DecorSim } from './decor';
import { createMovement } from './move';
import { createReadouts, type HudReadouts } from './readouts';
import { confirmPlayerDataReset, createRun, type GameRun } from './run';
import { createInput, type GameInput } from './input';
import { createSaveScheduler } from './save-scheduler';
import { advanceParticles, spawnDust, spawnExplosion } from './particles';
import { createOverlaySession } from './overlays';
import { createUiSync, type UiSync } from './ui-sync';
import { createArmedSlot, createPlacementRouter, type PlacementRouter } from './placement-router';
import { createCanvasFocus, type CanvasFocus } from './focus';
import { watchReducedMotion } from './reduced-motion';
import { createCheats, type Cheats } from './cheats';
import { nearestInteractable } from './interactables';

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
 * surface is unusable or the boot fails part-way; whatever was already installed
 * is torn down first, and the caller turns the throw into the visible `failed`
 * state (`useGameRuntime` → `RuntimeFailure`, and the observation's `runtime`).
 */
export function createGameRuntime(options: GameRuntimeOptions): GameRuntime {
  // Every side effect below registers its own undo here.
  const scope = createDisposalScope();
  const state = createInitialState();
  let surface: GameSurface;
  let audio: AudioController;
  /** Set once `audio` exists, so a boot that failed before it knows not to close it. */
  let audioStarted = false;
  let renderer: Renderer | undefined;
  /** The title screen's mine backdrop; dropped once the run leaves the intro. */
  let introShowcase: IntroShowcase | undefined;
  let focus: CanvasFocus;

  /**
   * Whether the simulation is frozen between an agent's decisions. `draw()` and
   * `uiSync.sync()` keep running while paused so the window stays live and the
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
  let uiSync: UiSync;
  let scanners: ScannerDeviceSim;
  let dynamite: DynamiteSim;
  let containers: CargoContainerSim;
  let wrecks: WreckSim;
  let chests: ChestSim;
  let graves: GraveSim;
  let homeStations: HomeStationsSim;
  let portals: PortalsSim;
  let trading: TradingSim;
  let stationDevices: StationDeviceSim;
  let toolkit: ToolkitSim;
  let decor: DecorSim;
  let placements: PlacementRouter;
  let cheats: Cheats;

  state.stats = createDefaultStats();
  /** Whether the ship could land on a tile — what a teleporter's portal list is filtered by. */
  const canLand = canLandOn(state);

  const saves = createSaveScheduler({
    writeRun: () => save(state),
    writeZoom: () => saveZoomLevel(viewport.targetZoom)
  });
  const scheduleSave = () => saves.schedule();

  const overlays = createOverlaySession({
    // Read at call time: the session is built before the audio graph it cues.
    get audio() { return audio; },
    clearKeys: () => gameInput.clearKeys(),
    isGameOver: () => state.gameOver,
    disarmPlacements: () => { placements.disarmAll(); }
  });

  // Fog is cached per chunk, so every newly explored tile has to mark its chunk dirty.
  function invalidateFogTiles(indexes: number[]) {
    for (const index of indexes) renderer?.invalidateFog(index % WORLD_W, Math.floor(index / WORLD_W));
  }
  function revealAtPlayer() {
    const added = revealFootprint(state.exploredTiles, state.player.x, state.player.y, REVEAL_FOOTPRINT);
    if (!added.length) return;
    invalidateFogTiles(added);
    scheduleSave();
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
    scheduleSave();
  }

  /** Credit (or debit) the wallet. Callers schedule the save with the rest of their change. */
  function addCash(amount: number) {
    state.cash += amount;
    if (amount > 0) state.stats.totalCashEarned += amount;
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

  const dust = (x: number, y: number, color?: string, amount?: number) => spawnDust(state.particles, x, y, color, amount);
  const explosion = (x: number, y: number) => spawnExplosion(state.particles, x, y);

  // --- Screens ---------------------------------------------------------------
  // Each feature module drives its screen through one of these: show these
  // contents, or take the screen away with `null`. The screens that cover the
  // mine with nothing of the mine left to aim at stand an armed placement down.
  const setStationUi = overlays.publisher('station', (station: ManufacturerStation) =>
    ({kind: 'station', slots: buildInventorySlots(station.inventory), supply: isHomeStation(station)}), {standDown: true});
  const setExtractorUi = overlays.publisher('extractor', (extractor: ExtractorView) =>
    ({kind: 'extractor', extractor}), {standDown: true});
  const setPortalUi = overlays.publisher('portal', (portal: PortalView) =>
    ({kind: 'portal', portal}), {standDown: true});
  const setTradeUi = overlays.publisher('trade', (offers: TradeOfferView[]) =>
    ({kind: 'trade', offers}), {standDown: true});
  // The bell (`grave`, played by the sim) is the stone's open cue.
  const setGraveUi = overlays.publisher('grave', (epitaph: Epitaph) =>
    ({kind: 'grave', epitaph}), {standDown: true, cue: false});
  // The stashes' own openers stand their placements down (C does it for them).
  const setContainerUi = overlays.publisher('container', (contents: Inventory) =>
    ({kind: 'container', slots: buildInventorySlots(contents)}));
  const setWreckUi = overlays.publisher('wreck', (contents: Inventory) =>
    ({kind: 'wreck', slots: buildInventorySlots(contents)}));
  // The lid's own creak (`chestOpen`, played by the sim) is the open cue.
  const setChestUi = overlays.publisher('chest', (contents: Inventory) =>
    ({kind: 'chest', slots: buildInventorySlots(contents)}), {cue: false});

  function openShipScreen(){
    // An overlay covers the mine, so a pointer armed for placement has nothing
    // left to aim at. The ship screen opens anywhere — it needs no station.
    placements.disarmAll();
    uiSync.syncShipUpgrades();
    overlays.raise({kind: 'ship'});
  }
  function closeShipScreen(){
    overlays.drop('ship');
  }
  function openInfoScreen(){
    placements.disarmAll();
    uiSync.syncInfoDetails(true);
    overlays.raise({kind: 'info'});
  }
  function closeInfoScreen(){
    overlays.drop('info');
  }

  /**
   * Space, or a click with no tile named: whichever station-like thing is nearest
   * wins — a home station, a trading post, a grave (`nearestInteractable`). Toggles
   * the open one shut, and stands any placement down before covering the mine with
   * a new screen. Nothing in reach is the home stations' refusal to word.
   */
  function openNearestStationLike(){
    if (homeStations.openStation) return homeStations.close();
    if (trading.open) return trading.close();
    if (graves.open) return graves.close();
    placements.disarmAll();
    const target = nearestInteractable(state, 'space');
    if (target?.kind === 'grave') graves.openNearest();
    else if (target?.kind === 'post') trading.openNearest();
    else homeStations.openNearest();
  }
  /**
   * The `c` key: open whichever stash is nearest — a cargo container, a wreck, a
   * chest (`nearestInteractable`). Toggles the open one shut first, and stands any
   * placement down before covering the mine. Nothing in reach is the crate's
   * refusal to word.
   */
  function openNearestStash(){
    if (containers.open) return containers.close();
    if (wrecks.open) return wrecks.close();
    if (chests.open) return chests.close();
    placements.disarmAll();
    const target = nearestInteractable(state, 'stash');
    if (target?.kind === 'chest') chests.openNearest();
    else if (target?.kind === 'wreck') wrecks.openNearest();
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
    scheduleSave();
    uiSync.syncShipUpgrades();
    audio.upgradeFit();
    toast('Upgrade fitted.');
  }
  function unequipUpgrade(slot: number){
    const result = unequip(state.player, slot);
    if (!result.ok) { audio.alarm(); return toast(result.reason); }
    scheduleSave();
    uiSync.syncShipUpgrades();
    audio.upgradeRemove();
    toast('Upgrade returned to the cargo bay.');
  }

  // --- Command table ---------------------------------------------------------
  /** Register the button/dialog dispatch table the React tree calls into. */
  function registerUiCommands(){
    setUiCommands({
      // Only one press on the mine is available, so arming any deployable stands
      // the others down.
      toggleScannerPlacement: () => placements.toggle('scanner', () => scanners.toggleArmed()),
      toggleDynamitePlacement: () => placements.toggle('dynamite', () => dynamite.toggleArmed()),
      toggleContainerPlacement: () => placements.toggle('container', () => containers.toggleArmed()),
      toggleManufacturerPlacement: () => placements.toggle('stationDevices', () => stationDevices.toggleArmed('manufacturer')),
      toggleExtractorPlacement: () => placements.toggle('stationDevices', () => stationDevices.toggleArmed('extractor')),
      togglePortalPlacement: () => placements.toggle('stationDevices', () => stationDevices.toggleArmed('portal')),
      toggleToolkit: () => placements.toggle('toolkit', () => toolkit.toggleArmed()),
      closeContainer: () => containers.close(),
      storeInContainer: (kind, single) => containers.store(kind, single),
      takeFromContainer: (kind, single) => containers.take(kind, single),
      closeWreck: () => wrecks.close(),
      takeFromWreck: (kind, single) => wrecks.take(kind, single),
      lootAll: () => wrecks.lootAll(),
      closeChest: () => chests.close(),
      takeFromChest: (kind, single) => chests.take(kind, single),
      lootAllChest: () => chests.lootAll(),
      closeGrave: () => graves.close(),
      closeTrade: () => trading.close(),
      sellToPost: (kind, single) => trading.sell(kind, single),
      buyFromPost: kind => trading.buy(kind),
      buyFuelFromPost: () => trading.buyFuel(),
      closePortal: () => portals.close(),
      renamePortal: name => portals.rename(name),
      travelToPortal: (x, y) => portals.travelTo(x, y),
      useTeleporter: () => actions.useTeleporter(),
      openShip: openShipScreen,
      closeShip: closeShipScreen,
      equipUpgrade: (kind, slot) => equipUpgrade(kind, slot),
      unequipUpgrade: slot => unequipUpgrade(slot),
      toggleDecorPlacement: kind => placements.toggle('decor', () => decor.toggleArmed(kind)),
      useRepairKit: () => actions.useRepairKit(),
      closeStation: () => homeStations.close(),
      stowAll: () => homeStations.stowAll(),
      stowStack: (kind, single) => homeStations.stow(kind, single),
      takeFromStation: (kind, single) => homeStations.take(kind, single),
      craft: recipe => homeStations.craft(recipe),
      loadCoal: () => homeStations.loadCoal(),
      refuelFromExtractor: () => homeStations.refuel(),
      buySupply: kind => homeStations.buySupply(kind),
      buyExtractorFuel: () => homeStations.buyExtractorFuel(),
      openInfo: openInfoScreen,
      closeInfo: closeInfoScreen,
      // The switches are the only pure-UI commands with no cue of their own; every
      // other command here already sounds (open/close, arm/disarm, or its action).
      toggleMusic: () => { audio.click(); void audio.toggleMusic(); },
      toggleSfx: () => { audio.click(); void audio.toggleSfx(); },
      beginRun: event => beginRun(event),
      grantDeveloperOres: () => cheats.grantOres(),
      fillExtractor: () => cheats.fillExtractor(),
      resetPlayerData: () => {
        if (!confirmPlayerDataReset(message => window.confirm(message))) return;
        gameInput.clearKeys();
        // The bay is about to be emptied, so nothing it held may stay armed.
        placements.disarmAll();
        run.resetPlayer(true);
        readouts.reset();
        // Replace the save outright; `saveNow` also drops any pending debounce.
        discardSave();
        saves.saveNow();
        closeInfoScreen();
        toast('Player data reset. Mine terrain preserved.');
      },
      resetWorldState: () => {
        if (!confirmWorldStateReset(message => window.confirm(message))) return;
        run.clearWorldRuntime();
        saves.saveNow();
        toast('World state reset. Player progress preserved.');
        closeInfoScreen();
      },
      resetGame: () => {
        // Order matters: silence every writer *before* the keys go, or a pending
        // debounce — or the unload save the reload itself triggers — would put
        // the run back on disk between the wipe and the fresh boot.
        saves.silence();
        clearPersistedGameData();
        window.location.reload();
      },
      exportSave: () => {
        const json = JSON.stringify(serializeProgress(state));
        uiStore.getState().setSaveExport(json);
        downloadSaveFile(json);
        audio.click();
        toast(`Save exported as ${SAVE_EXPORT_FILENAME}.`);
      },
      importSave: text => {
        const imported = parseImportedSave(text);
        if (!imported.ok) { audio.alarm(); toast(imported.reason); return; }
        // The same order as a full reset: silence every writer first, or a pending
        // debounce — or the unload save the reload itself triggers — would write
        // the run being replaced straight over the one just imported.
        saves.silence();
        try {
          localStorage.setItem(SAVE_KEY, imported.json);
        } catch {
          // Nothing was replaced, so the run goes on and keeps saving as before.
          saves.resume();
          audio.alarm();
          toast('Could not store the imported save: browser storage refused it.');
          return;
        }
        window.location.reload();
      }
    });
  }
  /**
   * Offer the save as a file download. Skipped where there is no DOM to click a
   * link in or no Blob URLs to point it at (tests, very old browsers); the text
   * box in Settings still carries the export.
   */
  function downloadSaveFile(json: string) {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return;
    try {
      const url = URL.createObjectURL(new Blob([json], {type: 'application/json'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = SAVE_EXPORT_FILENAME;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      console.warn('Could not download the exported save:', err);
    }
  }

  // --- Loop --------------------------------------------------------------------
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
      saves.scheduleZoom();
    }
    const targetCamX = Math.max(0, Math.min(WORLD_W-viewport.tilesX, p.drawX - viewport.tilesX/2 + 0.5));
    const targetCamY = Math.max(0, p.drawY - viewport.tilesY/2 + 0.5);
    state.camX += (targetCamX - state.camX) * 0.12;
    state.camY += (targetCamY - state.camY) * 0.12;
    advanceParticles(state.particles);
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
      chests.tick();
      graves.tick();
      stationDevices.tick();
      toolkit.tick();
      decor.tick();
      homeStations.tick();
      portals.tick();
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
    // The splash paints its own fog-free slice of the mine behind the card. The
    // phase never returns to `intro`, so the showcase is released on leaving it.
    if (uiStore.getState().phase === 'intro' && introShowcase) introShowcase.draw(now);
    else { introShowcase = undefined; renderer?.draw(); }
    uiSync.sync();
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
  /** Map a pointer event onto the tile under it, or `null` when the canvas has no layout box. */
  function tileAtPointer(event: PointerEvent): {x: number; y: number} | null {
    const rect = surface.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    // The canvas may be laid out at a different size than it is drawn at, so the
    // press is normalised into the CSS pixels the viewport is expressed in first.
    return tileAtViewportPoint(
      (event.clientX - rect.left) * (viewport.widthPx / rect.width),
      (event.clientY - rect.top) * (viewport.heightPx / rect.height),
      state.camX,
      state.camY
    );
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
  function beginRun(event?: Event){
    if (uiStore.getState().phase !== 'intro') return;
    startGame(event);
  }
  /** The one way into the run, so the start-of-run side effects exist exactly once. */
  function startGame(event?: Event){
    const store = uiStore.getState();
    if (store.phase === 'playing') return;
    store.setPhase('playing');
    focus.claimForRun();
    tryAutoAudio(event);
    // Heard when audio is already live; a gesture that is only now unlocking it
    // gets the unlock chirp instead.
    audio.respawn();
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
      refreshTileDamage: (x, y) => renderer?.refreshTileDamage(x, y),
      // A world regenerates from its seed on every restart, so the diff is the
      // only record that a tunnel was ever dug.
      onTileSet: (x, y, tile) => { recordTileDiff(state.tileDiff, {x, y, tile}); saves.markDirty(); }
    });
    run = createRun({
      state,
      audio,
      enemies: () => enemies,
      input: () => gameInput,
      portals: () => portals,
      toast,
      saveProgress: () => saves.saveNow(),
      revealAtPlayer,
      spawnExplosion: explosion,
      invalidateTerrain: () => renderer?.invalidateTerrain(),
      invalidateFog: () => renderer?.invalidateFog()
    });
    enemies = createEnemySim({
      state,
      grid,
      audio,
      toast,
      addCash,
      saveProgress: scheduleSave,
      damagePlayer: run.damage,
      spawnDust: dust,
      spawnExplosion: explosion
    });
    const movement = createMovement({
      state,
      grid,
      enemies,
      audio,
      toast,
      saveProgress: scheduleSave,
      scheduleSave,
      revealAtPlayer,
      damage: run.damage,
      gameOver: run.gameOver,
      spawnDust: dust,
      spawnExplosion: explosion
    });
    portals = createPortalsSim({
      state,
      audio,
      toast,
      saveProgress: scheduleSave,
      setPortalUi,
      revealAtPlayer
    });
    actions = createActions({
      state,
      audio,
      toast,
      saveProgress: scheduleSave,
      portals
    });
    readouts = createReadouts({state, grid, enemies, audio, atSurface: () => isAtHome(state.player), toast});
    uiSync = createUiSync({state, audio, readouts, canLand});
    scanners = createScannerDevices({
      state,
      grid,
      audio,
      toast,
      saveProgress: scheduleSave,
      revealTiles,
      setArmedUi: value => paintArmedPlacement(value ? SCANNER_ITEM.kind : null)
    });
    dynamite = createDynamiteSticks({
      state,
      grid,
      audio,
      toast,
      saveProgress: scheduleSave,
      wakeEnemiesNear: (x, y) => enemies.wakeEnemiesNear(x, y),
      spawnExplosion: explosion,
      damagePlayer: run.damage,
      setArmedUi: value => paintArmedPlacement(value ? DYNAMITE_ITEM.kind : null)
    });
    containers = createCargoContainers({
      state,
      grid,
      audio,
      toast,
      saveProgress: scheduleSave,
      setArmedUi: value => paintArmedPlacement(value ? CARGO_CONTAINER_ITEM.kind : null),
      setOpenUi: setContainerUi
    });
    wrecks = createWrecks({
      state,
      audio,
      toast,
      saveProgress: scheduleSave,
      setOpenUi: setWreckUi
    });
    chests = createChests({
      state,
      audio,
      toast,
      saveProgress: scheduleSave,
      setOpenUi: setChestUi
    });
    graves = createGraves({
      state,
      audio,
      toast,
      setGraveUi
    });
    decor = createDecor({
      state,
      grid,
      audio,
      toast,
      saveProgress: scheduleSave,
      setArmedUi: kind => paintArmedPlacement(kind)
    });
    homeStations = createHomeStations({
      state,
      audio,
      toast,
      saveProgress: scheduleSave,
      addCash,
      setStationUi,
      setExtractorUi,
      portals
    });
    trading = createTrading({
      state,
      audio,
      toast,
      saveProgress: scheduleSave,
      addCash,
      setOpenUi: setTradeUi
    });
    stationDevices = createStationDevices({
      state,
      grid,
      audio,
      toast,
      saveProgress: scheduleSave,
      setArmedUi: kind => paintArmedPlacement(kind ? stationDeviceItemKind(kind) : null)
    });
    toolkit = createToolkit({
      state,
      audio,
      toast,
      saveProgress: scheduleSave,
      setArmedUi: value => paintArmedPlacement(value ? TOOLKIT_ITEM.kind : null)
    });
    // Every tool that waits for the press on the mine, in press priority order.
    placements = createPlacementRouter({
      scanner: createArmedSlot(scanners, (x, y) => scanners.placeAt(x, y)),
      dynamite: createArmedSlot(dynamite, (x, y) => dynamite.placeAt(x, y)),
      container: createArmedSlot(containers, (x, y) => containers.placeAt(x, y)),
      stationDevices: createArmedSlot(stationDevices, (x, y) => stationDevices.placeAt(x, y)),
      toolkit: createArmedSlot(toolkit, (x, y) => toolkit.liftAt(x, y)),
      decor: createArmedSlot(decor, (x, y) => decor.placeAt(x, y))
    });
    cheats = createCheats({
      state,
      openStation: () => homeStations.openStation,
      scheduleSave,
      repaintStation: station => setStationUi(station),
      repaintExtractor: station => setExtractorUi(extractorView(station)),
      toast
    });
    gameInput = createInput({
      state,
      actions,
      move: movement.move,
      isOpenMovementDestination: movement.isOpenMovementDestination,
      // A replacement ship deploys with empty fitting slots, so the Ship screen's
      // store snapshot has to be re-synced or it would still paint the dead ship's
      // upgrades until the screen is next reopened.
      restartGame: () => { run.restartGame(); uiSync.syncShipUpgrades(); },
      closeShipScreen,
      closeInfoScreen,
      // Escape on an armed device: the same stand-down cue as the slot's own cancel.
      cancelPlacement: () => {
        const cancelled = placements.disarmAll();
        if (cancelled) audio.disarm();
        return cancelled;
      },
      toggleDynamitePlacement: () => placements.toggle('dynamite', () => dynamite.toggleArmed()),
      // A crate's or wreck's menu covers the mine, so nothing may be left waiting
      // for a press on it — including the two deployables this module does not own.
      toggleContainer: () => { if (!containers.open && !wrecks.open && !chests.open) placements.disarmAll(); openNearestStash(); },
      closeContainer: () => containers.close(),
      closeWreck: () => wrecks.close(),
      closeChest: () => chests.close(),
      closeGrave: () => graves.close(),
      // Space opens whichever station-like thing is in reach — a home station, a
      // trading post or a grave; a placement pointer has nothing left to aim at once
      // its screen covers the mine.
      openNearest: openNearestStationLike,
      closeStation: () => homeStations.close(),
      closeTrade: () => trading.close(),
      closePortal: () => portals.close(),
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
    focus.resetFocusRing();
    // Nothing is armed and something is already over the mine: the press belongs
    // to whatever is on top of it, not to the tile underneath.
    if (!placements.anyArmed() && overlays.active() !== null) return;
    const point = tileAtPointer(event);
    if (!point) return;
    if (placements.pressAt(point.x, point.y)) return;
    // An unarmed press opens a station tile the ship can reach, a trading post, the
    // crate, the wreck, the chest or the grave on the tile; a press on bare rock is
    // not a refusal, it was about none of them.
    if (!homeStations.openAt(point.x, point.y) && !trading.openAt(point.x, point.y)
      && !containers.openAt(point.x, point.y) && !wrecks.openAt(point.x, point.y)
      && !chests.openAt(point.x, point.y)) graves.openAt(point.x, point.y);
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
    const point = tileAtPointer(event);
    if (point) state.hoverTile = point;
  }

  /** The pointer left the mine: drop the hover highlight it was driving. */
  function handleMinePointerLeave(){
    state.hoverTile = null;
  }

  /**
   * Undo everything installed so far. `bankRun` is false for a boot that failed
   * part-way: a half-built run must never be written over the save it came from.
   */
  function teardown(bankRun: boolean){
    if (scope.disposed) return;
    // A teardown is indistinguishable from a tab close as far as the save is
    // concerned, so bank the run before anything is unwired.
    if (bankRun) saves.flushAll();
    else saves.silence();
    // Stops the loop, frees the soundtrack element and closes the context.
    if (audioStarted) audio.dispose();
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
    overlays.closeRuntimeScreens();
  }

  /** Hand the runtime back to the mount that owns it. */
  function dispose(){
    teardown(true);
  }

  // --- Boot ------------------------------------------------------------------
  /** Construct the world, wire the listeners, and start the loop. */
  function boot(): void {
    surface = createGameSurface(options, scope);
    focus = createCanvasFocus(surface.canvas, scope);
    audio = createAudio(toast);
    audioStarted = true;
    // Followed live: an OS toggle mid-session reaches the renderer and the intro.
    state.reducedMotion = watchReducedMotion(scope, reduced => {
      state.reducedMotion = reduced;
      introShowcase?.setReducedMotion(reduced);
    });
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
    introShowcase = createIntroShowcase({
      canvas: surface.canvas,
      ctx: surface.ctx,
      reducedMotion: state.reducedMotion
    });
    load(state);
    renderer.invalidateFog();
    scope.onWindow('touchstart', tryAutoAudio, {passive:true});
    surface.canvas.addEventListener('pointerdown', handleMinePointerDown);
    scope.add(() => surface.canvas.removeEventListener('pointerdown', handleMinePointerDown));
    surface.canvas.addEventListener('pointermove', handleMinePointerMove);
    scope.add(() => surface.canvas.removeEventListener('pointermove', handleMinePointerMove));
    surface.canvas.addEventListener('pointerleave', handleMinePointerLeave);
    scope.add(() => surface.canvas.removeEventListener('pointerleave', handleMinePointerLeave));
    scope.add(gameInput.attach());
    scope.onWindow('focus', focus.focusGame);
    scope.onWindow('pointerdown', tryAutoAudio);
    registerUiCommands();
    setAgentBridge({
      getState: () => state,
      getUi: () => uiStore.getState(),
      getTile: (x, y) => grid.get(x, y),
      setPaused,
      isPaused: () => paused,
      screenPointForTile,
      getZoom: () => viewport.targetZoom
    });
    run.resume();
    // The minute interval, the unload save, and the hidden-tab save; a tab coming
    // back discards the gap its stopped animation frames left instead of
    // fast-forwarding it, and hands the keyboard back to the mine.
    saves.attach(scope, () => { stepper.reset(); focus.focusGame(); });
    focus.focusGame();
    scope.timeout(focus.focusGame, 60);
    scope.frameLoop(loop);
  }

  try {
    boot();
  } catch (error) {
    // Nothing half-built may keep running behind the failure notice: every
    // listener, timer, frame and command installed so far goes, and the throw
    // reaches the mount, which reports it.
    teardown(false);
    throw error;
  }

  return {dispose};
}

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

import { START_Y, SURFACE_HEIGHT, WORLD_W } from '../../shared/constants';
import { createDisposalScope } from './disposal';
import { createGameSurface, type GameSurfaceRefs } from './dom';
import { advanceViewportZoom, setViewportZoom, tileAtViewportPoint, viewport } from './viewport';
import { recenteredCamera } from './zoom';
import { loadZoomLevel, saveZoomLevel } from './zoom-settings';
import { createAudio } from '../audio/audio';
import { shouldAttemptAutoAudio } from '../audio/audio-permission';
import { createDefaultStats, createInitialState } from '../core/state';
import { createRenderer, type Renderer } from '../render/renderer';
import { FUEL, ECONOMY, REVEAL_FOOTPRINT } from '../core/balance';
import { cargoCost, tankCost, hullCost, drillCost, cargoValue } from '../core/economy';
import { countItem, totalItems, type Inventory, type InventoryItemKind } from '../core/inventory';
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
import { formatSurfaceActionHint } from '../core/surface-hint';
import { rand } from '../world/world';
import { resetUiCommands, setUiCommands } from '../ui/commands';
import { buildCargoRows, buildInventorySlots, pushToast as toast, uiStore, type HudSnapshot, type PlayerSnapshot } from '../ui/store';

import { formatExtractionPresentation } from '../core/extraction-presentation';
import { TELEPORTER_ITEM, advanceTeleportEffect, canTeleportToSurface, canUseTeleporter } from '../core/teleporter';
import type { AudioController } from '../core/types';
import { applyPlayerUpgrade, type PlayerUpgradeId } from '../core/upgrades';
import { revealFootprint } from '../../shared/exploration-codec';
import { confirmPlayerDataReset, resetPlayerData } from '../core/player-data-reset';
import { DEVELOPER_CASH_GRANT, developerRefuel, developerRepairHull, grantDeveloperCash, type DeveloperServiceId } from '../core/developer';
import { confirmWorldStateReset } from '../world/world-state';
import { createFixedStepper } from '../core/fixed-step';
import { recordTileDiff } from '../world/tile-diff';
import { createWorldGrid, type WorldGrid } from './world-grid';
import { createEnemySim, type EnemySim } from './enemies';
import { createActions, type GameActions } from './actions';
import { createScannerDevices, type ScannerDeviceSim } from './scanner-devices';
import { createDynamiteSticks, type DynamiteSim } from './dynamite-sticks';
import { createCargoContainers, type CargoContainerSim } from './cargo-containers';
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
  function currentCargoValue(){ return cargoValue(state.player.inventory); }
  function atSurface(){ return state.player.y < SURFACE_HEIGHT; }

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
  function grantDeveloperUpgrade(id: PlayerUpgradeId){
    if (!applyPlayerUpgrade(state.player, id)) return toast('Developer upgrade already at maximum level.');
    saveProgress();
    syncPlayerSnapshot();
    toast('Developer action: upgrade granted for $0.');
  }
  function grantDeveloperMoney(){
    grantDeveloperCash(state);
    saveProgress();
    toast(`Developer action: +$${DEVELOPER_CASH_GRANT.toLocaleString('en-US')} granted.`);
  }
  function runDeveloperService(id: DeveloperServiceId){
    const changed = id === 'fuel'
      ? developerRefuel(state.player)
      : developerRepairHull(state.player);
    if (!changed) return toast(id === 'fuel' ? 'Fuel tank already full.' : 'Hull already at full strength.');
    saveProgress();
    syncPlayerSnapshot();
    toast(id === 'fuel' ? 'Developer action: refueled for $0.' : 'Developer action: hull repaired for $0.');
  }

  // --- Screens and UI sync -------------------------------------------------
  /** Purchase confirmations, paired with the price each upgrade is charged at. */
  const UPGRADE_PURCHASES: Record<PlayerUpgradeId, {cost(): number; message: string}> = {
    cargo: {cost: () => cargoCost(state.player), message: 'Cargo bay expanded.'},
    tank: {cost: () => tankCost(state.player), message: 'Fuel tank upgraded.'},
    hull: {cost: () => hullCost(state.player), message: 'Hull reinforced.'},
    drill: {cost: () => drillCost(state.player), message: 'Drill power increased.'}
  };

  /** Register the button/dialog dispatch table the React tree calls into. */
  function registerUiCommands(){
    setUiCommands({
      sell: () => actions.sell(),
      refuel: () => actions.refuel(),
      repair: () => actions.repair(),
      buyUpgrade: id => actions.buyUpgrade(id, UPGRADE_PURCHASES[id].cost(), UPGRADE_PURCHASES[id].message),
      buyDynamite: () => actions.buyDynamite(),
      buyTeleporter: () => actions.buyTeleporter(),
      buyScanner: () => actions.buyScanner(),
      // Only one press on the mine is available, so arming any deployable stands
      // the others down.
      toggleScannerPlacement: () => { dynamite.disarm(); containers.disarm(); scanners.toggleArmed(); },
      toggleDynamitePlacement: () => { scanners.disarm(); containers.disarm(); dynamite.toggleArmed(); },
      toggleContainerPlacement: () => { scanners.disarm(); dynamite.disarm(); containers.toggleArmed(); },
      closeContainer: () => containers.close(),
      storeInContainer: (kind, single) => containers.store(kind, single),
      takeFromContainer: (kind, single) => containers.take(kind, single),
      buyContainer: () => actions.buyContainer(),
      useTeleporter: () => actions.useTeleporter(),
      openShop: openShopScreen,
      closeShop: closeShopScreen,
      openInfo: openInfoScreen,
      closeInfo: closeInfoScreen,
      toggleMusic: () => { void audio.toggleMusic(); },
      toggleSfx: () => { void audio.toggleSfx(); },
      playSolo: event => playSolo(event),
      grantDeveloperCash: grantDeveloperMoney,
      runDeveloperService,
      grantDeveloperUpgrade,
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
  /** Stand down whichever deployable is waiting for a press on the mine. */
  function disarmPlacements(): boolean {
    // All of them, and not short-circuited: only one can be armed, but a disarm
    // must never depend on which.
    const hadScanner = scanners.disarm();
    const hadDynamite = dynamite.disarm();
    return containers.disarm() || hadDynamite || hadScanner;
  }
  function openShopScreen(){
    if (!atSurface()) return toast('Shop is at the surface depot.');
    // An overlay covers the mine, so a pointer armed for placement has nothing
    // left to aim at.
    disarmPlacements();
    syncPlayerSnapshot();
    uiStore.getState().setActiveOverlay('shop');
  }
  function closeShopScreen(){
    uiStore.getState().closeOverlay('shop');
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
    const extraction = formatExtractionPresentation({
      phase: state.extractionPhase,
      motherlodeExtractions: state.stats.motherlodeExtractions,
      reward: ECONOMY.artifactReward
    });

    hudScratch.cash = state.cash;
    hudScratch.depthMeters = Math.max(0, p.y - START_Y) * 10;
    hudScratch.fuel = p.fuel;
    hudScratch.fuelMax = p.fuelMax;
    hudScratch.hull = p.hull;
    hudScratch.hullMax = p.hullMax;
    hudScratch.cargo = cargoUsed();
    hudScratch.cargoMax = p.cargoMax;
    hudScratch.cargoValue = currentCargoValue();
    hudScratch.fuelAlert = lowFuel;
    hudScratch.hullAlert = shouldHullBarFlash(state);
    hudScratch.cargoAlert = shouldCargoBarFlash(state);
    hudScratch.objective = formatExpeditionObjective({
      player: p,
      cash: state.cash,
      cargoCount: hudScratch.cargo,
      currentCargoValue: hudScratch.cargoValue,
      atSurface: surf,
      extractionPhase: state.extractionPhase
    });
    hudScratch.extractionHud = extraction.hud;
    hudScratch.extractionInfo = extraction.info;
    hudScratch.atSurface = surf;
    hudScratch.gameOver = state.gameOver;
    hudScratch.teleporters = countItem(p.inventory, TELEPORTER_ITEM.kind);
    hudScratch.teleportReturn = state.teleportReturnPosition !== null;
    hudScratch.teleportDepthReached = canTeleportToSurface(p.y);
    hudScratch.teleportUsable = canUseTeleporter(p, state.teleportReturnPosition);
    // What Space would actually do if pressed right now, so the depot prompt never
    // offers a service the ship does not need or cannot pay for.
    hudScratch.surfaceHint = formatSurfaceActionHint({
      atSurface: surf,
      gameOver: state.gameOver,
      cargoValue: hudScratch.cargoValue,
      cash: state.cash,
      fuel: p.fuel,
      fuelMax: p.fuelMax,
      hull: p.hull,
      hullMax: p.hullMax
    });
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
      enemies.update();
    }
    updateAnimation();
  }
  const stepper = createFixedStepper(step);
  // Rendering is once per animation frame against the latest simulated state; the
  // 60 Hz step is small enough that interpolation buys nothing visible. The scope
  // owns the rescheduling, so disposing stops the loop after the current frame.
  function loop(now: number){
    stepper.advance(now);
    renderer?.draw();
    syncUi();
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
    toast('Drill ready. Mine ore, sell it, and watch your fuel.');
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
      addCash,
      revealAtPlayer,
      atSurface,
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
      addCash,
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
    gameInput = createInput({
      state,
      actions,
      move: movement.move,
      isOpenMovementDestination: movement.isOpenMovementDestination,
      restartGame: run.restartGame,
      closeShopScreen,
      closeInfoScreen,
      cancelPlacement: disarmPlacements,
      toggleDynamitePlacement: () => { scanners.disarm(); containers.disarm(); dynamite.toggleArmed(); },
      // A crate's menu covers the mine, so nothing may be left waiting for a
      // press on it — including the two deployables this module does not own.
      toggleContainer: () => { if (!containers.open) disarmPlacements(); containers.openNearest(); },
      closeContainer: () => containers.close(),
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
    const armed = scanners.armed || dynamite.armed || containers.armed;
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
    // A press on bare rock is not a refusal; it simply was not about a crate.
    else containers.openAt(point.x, point.y);
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
    uiStore.getState().clearToasts();
    // An armed slot outlives its runtime otherwise, and there is nothing left to
    // take the press it is waiting for. A crate's transfer menu is worse: every
    // button in it would dispatch into a table of no-ops.
    uiStore.getState().setArmedPlacement(null);
    uiStore.getState().closeOverlay('container');
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

// Unit tests for the pure observation builder. The two invariants the harness
// leans on — fog hides what the player has not seen, and an overlay is mirrored
// only while it is open — get a test each, alongside the ASCII legend, the notable
// list, and the toast ring buffer's cap.

import { describe, expect, it } from 'vitest';
import { explorationIndex } from '../../shared/exploration-codec';
import { EXTRACTOR } from '../core/balance';
import { addItem, createInventory, oreItem, oreKind, totalItems } from '../core/inventory';
import { chestLoot } from '../core/chest';
import { createInitialState } from '../core/state';
import { ITEM_CATALOG } from '../core/items';
import { applyEquipment, swapHull } from '../core/ship-upgrades';
import { createPlacedContainer } from '../core/cargo-container';
import { createWreck } from '../core/wreck';
import { createScannerDevice } from '../core/scanner-device';
import { createPlacedDynamite } from '../core/dynamite';
import { buildInventorySlots, buildShipSlots, buildShipView, uiStore, type InventorySlotView, type TradeOfferView, type UiState } from '../ui/store';
import type { Enemy, GameState, Tile } from '../core/types';
import { ORES, START_Y, WORLD_W } from '../../shared/constants';
import { chestsInRange, gravesInRange, tradingPostAt } from '../world/world';
import { appendToast, buildObservation, MAX_VIEW_RADIUS, VIEW_LEGEND } from './observation';
import { createReadouts } from '../game/readouts';
import { createAudioStub, createEnemySimStub, createFakeGrid } from '../game/test-support';
import { nth } from '../test-narrowing';
import { EXTRACTOR_FUEL_ORDER, SUPPLY_POOL, extractorFuelOrder, fuelPurchase, fuelUnitPrice, hullRepair, supplyPrice } from '../core/trading';

/** A tile grid backed by a map; anything unset reads as plain dirt. */
function tileSource(overrides: Record<string, Tile>) {
  return (x: number, y: number): Tile => overrides[`${x},${y}`] ?? {type: 'dirt', hp: 1, maxHp: 1};
}

function reveal(state: GameState, x: number, y: number): void {
  state.exploredTiles.add(explorationIndex(x, y));
}

/** Reveal every tile of an inclusive rectangle. */
function revealRect(state: GameState, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) reveal(state, x, y);
}

function oreTile(name: string): Tile {
  return {type: 'ore', ore: {name, color: '#fff', value: 10, min: 0, max: 1, chance: 1}, hp: 1, maxHp: 1};
}

function liveEnemy(x: number, y: number): Enemy {
  return {id: 1, kind: 'tunnelFiend', x, y, drawX: x, drawY: y, hp: 3, maxHp: 3, alive: true, moveTick: 0, biteTick: 0, flash: 0, origin: {x, y}};
}

/** The store's live projection, spread so a test can override just what it needs. */
function ui(overrides: Partial<UiState> = {}): UiState {
  return {...uiStore.getState(), ...overrides};
}

/** An ore row of the table, by name. */
function ore(name: string) {
  const found = ORES.find(entry => entry.name === name);
  if (!found) throw new Error(`no ore named ${name}`);
  return found;
}

function oreSlot(name: string, count: number): InventorySlotView {
  return {index: 0, kind: oreKind(name), label: name, color: '#fff', count};
}

describe('buildObservation', () => {
  it('hides fogged ore and shows explored ore, keeping fogged tiles out of notable', () => {
    const state = createInitialState();
    state.player.x = 45;
    state.player.y = 100;
    reveal(state, 43, 100); // explored ore
    // (47,100) is deliberately left fogged.
    const get = tileSource({'43,100': oreTile('Gold'), '47,100': oreTile('Gold')});

    const obs = buildObservation({state, ui: ui(), get});

    // origin is (38, 95); the ship sits at (45,100) → row 5, col 7.
    expect(obs.view.origin).toEqual({x: 38, y: 95});
    expect(obs.view.rows[5]?.[43 - 38]).toBe('o');
    expect(obs.view.rows[5]?.[47 - 38]).toBe('?');
    expect(obs.notable.some(n => n.x === 43 && n.y === 100 && n.what === 'ore')).toBe(true);
    expect(obs.notable.some(n => n.x === 47)).toBe(false);
  });

  it('mirrors the career stats, including the objective progress counters', () => {
    const state = createInitialState();
    state.stats.scannersObtained = 2;
    state.stats.bestMarkCrafted = 2;
    state.stats.oresMined.Gold = 2;
    const obs = buildObservation({state, ui: ui(), get: tileSource({})});
    expect(obs.stats).toMatchObject({scannersObtained: 2, bestMarkCrafted: 2, deaths: 0, oresMined: {Gold: 2}});
    // A copy, not the live object — the per-ore tally included.
    expect(obs.stats).not.toBe(state.stats);
    expect(obs.stats.oresMined).not.toBe(state.stats.oresMined);
  });

  it('marks the ship and publishes the legend', () => {
    const state = createInitialState();
    state.player.x = 45;
    state.player.y = 100;
    const obs = buildObservation({state, ui: ui(), get: tileSource({})});

    // 15 wide by 11 tall, ship dead centre.
    expect(obs.view.rows).toHaveLength(11);
    expect(obs.view.rows[0]).toHaveLength(15);
    expect(obs.view.rows[5]?.[7]).toBe('@');
    expect(obs.view.legend).toBe(VIEW_LEGEND);
    expect(obs.view.legend['@']).toBe('ship');
  });

  it('clamps the view radius, however large or small the request', () => {
    const state = createInitialState();
    state.player.x = 45;
    state.player.y = 100;

    const huge = buildObservation({state, ui: ui(), get: tileSource({}), radius: 1_000_000});
    expect(huge.view.rows[0]).toHaveLength(2 * MAX_VIEW_RADIUS + 1);
    expect(huge.view.rows).toHaveLength(2 * Math.round(MAX_VIEW_RADIUS * 11 / 15) + 1);

    expect(buildObservation({state, ui: ui(), get: tileSource({}), radius: 0}).view.rows[0]).toHaveLength(3);
    expect(buildObservation({state, ui: ui(), get: tileSource({}), radius: Number.NaN}).view.rows[0]).toHaveLength(15);
  });

  it('draws the columns past the world edges as rock, never aliasing a real row', () => {
    const state = createInitialState();
    state.player.x = 2;
    state.player.y = 100;
    // Explore everything around the ship; ore sits on the last column of the row
    // above, exactly where column -1 of the ship's row would alias in the fog index.
    revealRect(state, 0, 95, WORLD_W - 1, 105);
    const get = tileSource({[`${WORLD_W - 1},99`]: oreTile('Gold'), [`${WORLD_W - 1},100`]: oreTile('Gold')});

    const obs = buildObservation({state, ui: ui(), get});
    const shipRow = nth(obs.view.rows, 100 - obs.view.origin.y);
    // origin.x is -5: columns -5..-1 are off-world wall, column 0 is the first real one.
    expect(obs.view.origin.x).toBe(-5);
    expect(shipRow.slice(0, 5)).toBe('RRRRR');
    expect(shipRow[5]).toBe('#');
    expect(obs.notable.every(n => n.x >= 0 && n.x < WORLD_W)).toBe(true);

    // The far edge, too.
    state.player.x = WORLD_W - 2;
    const east = buildObservation({state, ui: ui(), get});
    const eastRow = nth(east.view.rows, 100 - east.view.origin.y);
    // Ship at column 88: columns 90..95 are wall, and 89 is the real ore.
    expect(eastRow.slice(-7)).toBe('oRRRRRR');
    expect(east.notable.filter(n => n.what === 'ore').every(n => n.x === WORLD_W - 1)).toBe(true);
  });

  it('collects ore, hazards, enemies and deployables into notable', () => {
    const state = createInitialState();
    state.player.x = 45;
    state.player.y = 100;
    revealRect(state, 38, 95, 52, 105);
    state.enemies.push(liveEnemy(42, 100));
    state.cargoContainers.push(createPlacedContainer(43, 101));
    state.scannerDevices.push(createScannerDevice(44, 101));
    state.placedDynamite.push(createPlacedDynamite(46, 101));
    const get = tileSource({'40,100': oreTile('Copper'), '41,100': {type: 'hazard', hp: 1, maxHp: 1}});

    const obs = buildObservation({state, ui: ui(), get});
    const kinds = obs.notable.map(n => n.what);

    expect(kinds).toContain('ore');
    expect(kinds).toContain('hazard');
    expect(kinds).toContain('enemy');
    expect(kinds).toContain('container');
    expect(kinds).toContain('scanner');
    expect(kinds).toContain('dynamite');
    expect(obs.notable.find(n => n.what === 'enemy')?.detail).toBe('Tunnel Fiend');
    expect(obs.view.rows[5]?.[42 - 38]).toBe('E');
    expect(obs.view.rows[6]?.[46 - 38]).toBe('*');
  });

  it('draws decor as D, never listing it in notable', () => {
    const state = createInitialState();
    state.player.x = 45;
    state.player.y = 100;
    revealRect(state, 38, 95, 52, 105);
    const get = tileSource({
      '43,100': {type: 'decor', decor: 'lampPanel', hp: 48, maxHp: 48},
      '47,100': {type: 'decor', decor: 'steelPlate', hp: 48, maxHp: 48}
    });

    const obs = buildObservation({state, ui: ui(), get});

    expect(obs.view.rows[5]?.[43 - 38]).toBe('D');
    expect(obs.view.rows[5]?.[47 - 38]).toBe('D');
    expect(obs.notable.filter(n => n.x === 43 || n.x === 47)).toEqual([]);
  });

  it('draws a wreck as W in view and notable, counting the items it holds', () => {
    const state = createInitialState();
    state.player.x = 45;
    state.player.y = 100;
    revealRect(state, 38, 95, 52, 105);
    const wreck = createWreck(43, 101, addItem(addItem(createInventory(), oreItem({name: 'Gold', color: '#fff', value: 1, min: 0, max: 1, chance: 1}), 2), {kind: 'upgrade:tank:1', label: 'Fuel Tank Mk I', color: '#5ad1ff', value: 0}));
    state.wrecks.push(wreck);

    const obs = buildObservation({state, ui: ui(), get: tileSource({})});

    expect(obs.view.rows[6]?.[43 - 38]).toBe('W');
    // A fresh wreck outlasts three more deaths; the detail counts them down.
    expect(obs.notable.find(n => n.what === 'wreck')?.detail).toBe('3 items, crumbles in 3 deaths');
    expect(VIEW_LEGEND.W).toBe('wreck');

    wreck.deathsLeft = 1;
    const last = buildObservation({state, ui: ui(), get: tileSource({})});
    expect(last.notable.find(n => n.what === 'wreck')?.detail).toBe('3 items, crumbles on the next death');
  });

  it('mirrors the wreck overlay only while it is open', () => {
    const state = createInitialState();
    const wreckSlots: InventorySlotView[] = [oreSlot('Gold', 4)];

    expect(buildObservation({state, ui: ui({overlay: null}), get: tileSource({})}).overlay).toBeNull();

    const overlay = buildObservation({
      state,
      ui: ui({overlay: {kind: 'wreck', slots: wreckSlots, deathsLeft: 2}, inventorySlots: [oreSlot('Iron', 1)]}),
      get: tileSource({})
    }).overlay;

    expect(overlay?.kind).toBe('wreck');
    if (overlay?.kind !== 'wreck') throw new Error('expected wreck overlay');
    expect(overlay.deathsLeft).toBe(2);
    expect(overlay.wreck).toMatchObject([{kind: oreKind('Gold'), label: 'Gold', count: 4}]);
    expect(overlay.ship).toMatchObject([{kind: oreKind('Iron'), label: 'Iron', count: 1}]);
    // Overlay slots carry the tooltip lines a human would read off the row.
    expect(nth(overlay.wreck, 0).info?.length).toBeGreaterThan(0);
  });

  it('draws a chest as H in view and notable, counting its loot, until it is looted bare', () => {
    const chest = nth(chestsInRange(0, 0, WORLD_W - 1, 400), 0);
    const state = createInitialState();
    state.player.x = chest.x + 1;
    state.player.y = chest.y;
    revealRect(state, chest.x - 1, chest.y - 1, chest.x + 1, chest.y + 1);
    const items = totalItems(chestLoot(chest.x, chest.y));
    // origin is (x+1-7, y-5): the chest sits at row 5, column 6.
    const glyph = (obs: ReturnType<typeof buildObservation>) => nth(obs.view.rows, 5)[6];

    // Never opened: it holds its rolled loot.
    let obs = buildObservation({state, ui: ui(), get: tileSource({})});
    expect(glyph(obs)).toBe('H');
    expect(obs.notable).toContainEqual({x: chest.x, y: chest.y, what: 'chest', detail: `${items} items`});
    expect(VIEW_LEGEND.H).toBe('chest');

    // Opened and part-looted: the ledger's count.
    state.chestLedger[`${chest.x},${chest.y}`] = [{kind: 'dynamite', count: 1}];
    obs = buildObservation({state, ui: ui(), get: tileSource({})});
    expect(obs.notable.find(n => n.what === 'chest')?.detail).toBe('1 item');

    // Looted bare: gone from the view and notable, the tile reads as what lies under it.
    state.chestLedger[`${chest.x},${chest.y}`] = [];
    obs = buildObservation({state, ui: ui(), get: tileSource({[`${chest.x},${chest.y}`]: {type: 'air'}})});
    expect(glyph(obs)).toBe('.');
    expect(obs.notable.some(n => n.what === 'chest')).toBe(false);

    // And one under fog is never shown.
    state.chestLedger = {};
    state.exploredTiles.clear();
    obs = buildObservation({state, ui: ui(), get: tileSource({})});
    expect(glyph(obs)).toBe('?');
    expect(obs.notable.some(n => n.what === 'chest')).toBe(false);
  });

  it('mirrors the chest overlay only while it is open', () => {
    const state = createInitialState();
    const chestSlots: InventorySlotView[] = [oreSlot('Coal', 3)];

    expect(buildObservation({state, ui: ui({overlay: null}), get: tileSource({})}).overlay).toBeNull();

    const overlay = buildObservation({
      state,
      ui: ui({overlay: {kind: 'chest', slots: chestSlots}, inventorySlots: [oreSlot('Iron', 1)]}),
      get: tileSource({})
    }).overlay;

    expect(overlay?.kind).toBe('chest');
    if (overlay?.kind !== 'chest') throw new Error('expected chest overlay');
    expect(overlay.chest).toMatchObject([{kind: oreKind('Coal'), label: 'Coal', count: 3}]);
    expect(overlay.ship).toMatchObject([{kind: oreKind('Iron'), label: 'Iron', count: 1}]);
    expect(nth(overlay.chest, 0).info?.length).toBeGreaterThan(0);
  });

  it('draws a grave as + in view and notable once explored', () => {
    const grave = nth(gravesInRange(0, 0, WORLD_W - 1, 400), 0);
    const state = createInitialState();
    state.player.x = grave.x + 1;
    state.player.y = grave.y;
    revealRect(state, grave.x - 1, grave.y - 1, grave.x + 1, grave.y);
    // origin is (x+1-7, y-5): the grave sits at row 5, column 6.
    const glyph = (obs: ReturnType<typeof buildObservation>) => nth(obs.view.rows, 5)[6];

    let obs = buildObservation({state, ui: ui(), get: tileSource({})});
    expect(glyph(obs)).toBe('+');
    expect(obs.notable).toContainEqual({x: grave.x, y: grave.y, what: 'grave'});
    expect(VIEW_LEGEND['+']).toBe('grave');

    // One under fog is never shown.
    state.exploredTiles.clear();
    obs = buildObservation({state, ui: ui(), get: tileSource({})});
    expect(glyph(obs)).toBe('?');
    expect(obs.notable.some(n => n.what === 'grave')).toBe(false);
  });

  it('mirrors the grave stone only while it is open', () => {
    const state = createInitialState();
    const grave = {name: 'Ivan Petrov', born: 1901, died: 1950, cause: 'Crushed under rock'};

    expect(buildObservation({state, ui: ui({overlay: null}), get: tileSource({})}).overlay).toBeNull();

    const overlay = buildObservation({state, ui: ui({overlay: {kind: 'grave', epitaph: grave}}), get: tileSource({})}).overlay;
    expect(overlay).toEqual({kind: 'grave', ...grave});
  });

  it('mirrors the info tab, adding the exported save only once there is one', () => {
    const state = createInitialState();
    const get = tileSource({});

    const plain = buildObservation({state, ui: ui({overlay: {kind: 'info'}, infoTab: 'info-settings', saveExport: null}), get}).overlay;
    expect(plain).toMatchObject({kind: 'info', tab: 'info-settings'});
    expect(plain && 'saveExport' in plain).toBe(false);

    const json = '{"version":18,"cash":5}';
    const exported = buildObservation({state, ui: ui({overlay: {kind: 'info'}, infoTab: 'info-settings', saveExport: json}), get}).overlay;
    expect(exported).toMatchObject({kind: 'info', tab: 'info-settings', saveExport: json});

    // A closed info screen mirrors nothing, export or not.
    expect(buildObservation({state, ui: ui({overlay: null, saveExport: json}), get}).overlay).toBeNull();
  });

  it('mirrors every info tab: the tablist, and only the visible tab\'s contents', () => {
    const state = createInitialState();
    const get = tileSource({});
    const info = (overrides: Partial<UiState>) => {
      const overlay = buildObservation({state, ui: ui({overlay: {kind: 'info'}, ...overrides}), get}).overlay;
      if (overlay?.kind !== 'info') throw new Error('expected the info overlay');
      return overlay;
    };

    const objective = info({
      infoTab: 'info-objective',
      cargoRows: [{name: 'Iron', color: '#fff', count: 3, value: 45}],
      hud: {...uiStore.getState().hud, objective: 'Dig deeper'}
    });
    expect(objective.sections.map(section => section.id)).toEqual([
      'info-objective', 'info-stats', 'info-prospecting', 'info-hazards', 'info-controls', 'info-settings'
    ]);
    expect(nth(objective.sections, 0).label).toBe('Objective & Cargo');
    expect(objective.objective).toEqual({status: 'Dig deeper', cargo: [{name: 'Iron', count: 3, value: 45}]});
    // Only the visible tab is mirrored.
    expect(objective.stats).toBeUndefined();
    expect(objective.settings).toBeUndefined();

    const stats = info({infoTab: 'info-stats', statRows: [{label: 'Max depth', value: '120 m', detail: 'Deepest descent saved'}]});
    expect(stats.stats).toEqual([{label: 'Max depth', value: '120 m', detail: 'Deepest descent saved'}]);
    expect(stats.objective).toBeUndefined();

    const prospecting = info({infoTab: 'info-prospecting'});
    expect(prospecting.prospecting?.tip.length).toBeGreaterThan(0);
    expect(prospecting.prospecting?.galleries).toContain('branch sideways off your shaft');
    expect(prospecting.prospecting?.ladder).toContain('Scout → Hauler → Prospector → Leviathan → Core Breaker');
    expect(prospecting.prospecting?.ores.some(ore => ore.name === 'Coal')).toBe(true);
    expect(prospecting.prospecting?.posts).toEqual([]);
    const found = info({infoTab: 'info-prospecting', postRows: [{x: 43, y: 67, depthMeters: 470}]});
    expect(found.prospecting?.posts).toEqual([{x: 43, y: 67, depth: 470}]);

    const hazards = info({infoTab: 'info-hazards'});
    expect(hazards.hazards?.rows.length).toBeGreaterThan(0);

    const controls = info({infoTab: 'info-controls'});
    expect(controls.controls).toContainEqual({
      keys: 'WASD / Arrows',
      action: 'Move, fly, and dig down or sideways (never up). Digging sideways with open air below the ship costs 25% more fuel.'
    });
    expect(controls.controls?.some(row => row.keys.startsWith('+ / -'))).toBe(true);

    const settings = info({infoTab: 'info-settings', cheatsOpen: true, confirmingReset: true, confirmingImport: false});
    expect(settings.settings).toEqual({cheatsOpen: true, confirmingReset: true, confirmingImport: false});
  });

  it('reports audio, the runtime, the zoom and the folded inventory panel', () => {
    const state = createInitialState();
    const obs = buildObservation({
      state,
      ui: ui({musicOn: true, musicLabel: 'Mute music', sfxOn: false, sfxLabel: 'Enable sound effects', inventoryCollapsed: true, runtimeStatus: 'ready', runtimeError: null}),
      get: tileSource({}),
      zoom: 1.5
    });
    expect(obs.audio).toEqual({music: true, sfx: false, musicLabel: 'Mute music', sfxLabel: 'Enable sound effects'});
    expect(obs.runtime).toEqual({status: 'ready', error: null});
    expect(obs.view.zoom).toEqual({level: 1.5, min: 0.5, max: 2});
    expect(obs.hud.inventoryCollapsed).toBe(true);

    const failed = buildObservation({state, ui: ui({runtimeStatus: 'failed', runtimeError: 'No 2D context'}), get: tileSource({})});
    expect(failed.runtime).toEqual({status: 'failed', error: 'No 2D context'});
    // Without a zoom from the runtime, the view reads as the unzoomed baseline.
    expect(failed.view.zoom.level).toBe(1);
  });

  it('describes the tile under the ship, which the @ glyph hides', () => {
    const state = createInitialState();
    state.player.x = 45;
    state.player.y = 100;
    const bare = buildObservation({state, ui: ui(), get: tileSource({'45,100': {type: 'air'}})});
    expect(bare.ship.on).toEqual({tile: 'air'});

    state.wrecks.push(createWreck(45, 100, addItem(createInventory(), oreItem({name: 'Iron', color: '#fff', value: 1, min: 0, max: 1, chance: 1}), 2)));
    const onWreck = buildObservation({state, ui: ui(), get: tileSource({'45,100': {type: 'air'}})});
    expect(onWreck.ship.on).toEqual({tile: 'air', what: 'wreck', detail: '2 items, crumbles in 3 deaths'});
    // The ship's own cell stays `@` in the view, and out of notable.
    expect(onWreck.view.rows[5]?.[7]).toBe('@');
    expect(onWreck.notable.some(n => n.x === 45 && n.y === 100)).toBe(false);
  });

  it('mirrors the placement grid while a device is armed: valid sites, and the targeted tile', () => {
    const state = createInitialState();
    state.player.x = 45;
    state.player.y = 100;
    revealRect(state, 43, 100, 47, 100);
    // (46,100) and (47,100) are open and explored; (48,100) is open but fogged;
    // (44,100) is explored dirt.
    const get = tileSource({'45,100': {type: 'air'}, '46,100': {type: 'air'}, '47,100': {type: 'air'}, '48,100': {type: 'air'}});

    expect(buildObservation({state, ui: ui(), get}).placement).toBeNull();

    state.armedPlacement = 'dynamite';
    const armed = buildObservation({state, ui: ui({armedPlacement: 'dynamite'}), get}).placement;
    if (!armed) throw new Error('expected a placement preview');
    expect(armed.kind).toBe('dynamite');
    expect(armed.sites).toContainEqual({x: 46, y: 100});
    expect(armed.sites).toContainEqual({x: 47, y: 100});
    expect(armed.sites).not.toContainEqual({x: 48, y: 100});
    expect(armed.sites).not.toContainEqual({x: 44, y: 100});
    // No tile targeted yet.
    expect(armed.target).toBeNull();
    expect(armed.valid).toBeNull();

    state.hoverTile = {x: 44, y: 100};
    expect(buildObservation({state, ui: ui(), get}).placement).toMatchObject({target: {x: 44, y: 100}, valid: false});
    state.hoverTile = {x: 47, y: 100};
    expect(buildObservation({state, ui: ui(), get}).placement).toMatchObject({target: {x: 47, y: 100}, valid: true});

    // The toolkit is armed but never placed, so it has no grid.
    state.armedPlacement = 'toolkit';
    expect(buildObservation({state, ui: ui(), get}).placement).toBeNull();
  });

  it('names the home stations in view and notable', () => {
    const state = createInitialState();
    // Ship parked at home; the two stations flank it at (44,20) and (46,20).
    revealRect(state, 38, 15, 52, 25);
    const obs = buildObservation({state, ui: ui(), get: tileSource({})});

    expect(obs.notable.some(n => n.what === 'station' && n.detail === 'Manufacturer')).toBe(true);
    expect(obs.notable.some(n => n.what === 'station' && n.detail === 'Fuel Extractor')).toBe(true);
    // Ship at (45,20) → row 5; manufacturer at col 6, extractor at col 8.
    expect(obs.view.rows[5]?.[44 - 38]).toBe('M');
    expect(obs.view.rows[5]?.[46 - 38]).toBe('X');
  });

  it('names the seeded Home portal in view and notable', () => {
    const state = createInitialState();
    revealRect(state, 38, 15, 52, 25);
    const obs = buildObservation({state, ui: ui(), get: tileSource({})});

    // The Home portal is seeded at (48,20); ship at (45,20) → row 5, col 10.
    expect(obs.view.rows[5]?.[48 - 38]).toBe('P');
    expect(obs.notable.some(n => n.what === 'station' && n.detail === 'Portal "Home"')).toBe(true);
    expect(VIEW_LEGEND.P).toBe('portal');
  });

  it('mirrors the portal travel overlay: source name, the name echo, and destinations', () => {
    const state = createInitialState();

    // Not open: nothing is mirrored.
    expect(buildObservation({state, ui: ui({overlay: null}), get: tileSource({})}).overlay).toBeNull();

    const overlay = buildObservation({
      state,
      ui: ui({
        overlay: {kind: 'portal', portal: {
          mode: 'travel',
          source: {x: 48, y: 20, name: 'Home'},
          destinations: [{x: 20, y: 200, name: 'Depot', depthMeters: 180, distance: 208}]
        }}
      }),
      get: tileSource({})
    }).overlay;

    expect(overlay?.kind).toBe('portal');
    if (overlay?.kind !== 'portal') throw new Error('expected portal overlay');
    expect(overlay.mode).toBe('travel');
    expect(overlay.source).toEqual({x: 48, y: 20, name: 'Home'});
    // Travel mode echoes the source name for rename feedback, and maps depth.
    expect(overlay.name).toBe('Home');
    expect(overlay.destinations).toEqual([{x: 20, y: 200, name: 'Depot', depth: 180, distance: 208}]);
  });

  it('quotes the travel list\'s hull repair from the live hull and the wallet, and only in travel mode', () => {
    const state = createInitialState();
    const base = uiStore.getState();
    const travel: UiState['overlay'] = {kind: 'portal', portal: {mode: 'travel', source: {x: 48, y: 20, name: 'Home'}, destinations: []}};
    const repairOf = (cash: number, overlay: UiState['overlay'] = travel) => {
      const mirrored = buildObservation({state, ui: ui({overlay, hud: {...base.hud, cash}}), get: tileSource({})}).overlay;
      if (mirrored?.kind !== 'portal') throw new Error('expected portal overlay');
      return mirrored.repair;
    };

    // A whole hull shows no repair row.
    expect(repairOf(1000)).toBeNull();

    state.player.hull = 40;
    expect(repairOf(1000)).toEqual({missing: 60, amount: 60, cost: 144, affordable: true});
    expect(repairOf(1000)).toEqual({missing: 60, ...hullRepair(40, state.player.hullMax, 1000), affordable: true});
    // A thin wallet quotes the part it covers; an empty one, nothing.
    expect(repairOf(30)).toEqual({missing: 60, amount: 12, cost: 28, affordable: true});
    expect(repairOf(0)).toEqual({missing: 60, amount: 0, cost: 0, affordable: false});

    // Away from a portal (a teleporter list) there is no repair at all.
    expect(repairOf(1000, {kind: 'portal', portal: {mode: 'teleporter', destinations: []}})).toBeUndefined();
  });

  it('mirrors the portal overlay in teleporter and respawn modes', () => {
    const state = createInitialState();

    const teleporter = buildObservation({
      state,
      ui: ui({
        overlay: {kind: 'portal', portal: {mode: 'teleporter', destinations: [{x: 20, y: 200, name: 'Depot', depthMeters: 180, distance: 208}]}}
      }),
      get: tileSource({})
    }).overlay;
    expect(teleporter?.kind).toBe('portal');
    if (teleporter?.kind !== 'portal') throw new Error('expected portal overlay');
    expect(teleporter.mode).toBe('teleporter');
    // No source, so no name echo, outside travel mode.
    expect(teleporter.source).toBeUndefined();
    expect(teleporter.name).toBeUndefined();

    const respawn = buildObservation({
      state,
      ui: ui({
        overlay: {kind: 'portal', portal: {mode: 'respawn', destinations: [
          {x: 48, y: 20, name: 'Home', depthMeters: 0, distance: 0, respawnFuel: 100},
          {x: 20, y: 200, name: 'Depot', depthMeters: 180, distance: 208, respawnFuel: 50}
        ]}}
      }),
      get: tileSource({})
    }).overlay;
    expect(respawn?.kind).toBe('portal');
    if (respawn?.kind !== 'portal') throw new Error('expected portal overlay');
    expect(respawn.mode).toBe('respawn');
    // Each row carries the absolute fuel the replacement would deploy with there.
    expect(respawn.destinations).toEqual([
      {x: 48, y: 20, name: 'Home', depth: 0, distance: 0, respawnFuel: 100},
      {x: 20, y: 200, name: 'Depot', depth: 180, distance: 208, respawnFuel: 50}
    ]);
    // Outside respawn mode there is no redeploy to price.
    expect(teleporter.destinations[0]).not.toHaveProperty('respawnFuel');
  });

  it('carries the carried-teleporter HUD state in hud.teleport', () => {
    const state = createInitialState();
    const base = uiStore.getState();
    const obs = buildObservation({
      state,
      ui: ui({hud: {...base.hud, teleport: {count: 2, usable: true}}}),
      get: tileSource({})
    });
    expect(obs.hud.teleport).toEqual({count: 2, usable: true});
  });

  it('carries the trading-post beacon in hud.postHint', () => {
    const state = createInitialState();
    const base = uiStore.getState();
    // A new game starts in the home cavern, far above any post.
    expect(buildObservation({state, ui: ui(), get: tileSource({})}).hud.postHint).toBe('');
    const near = buildObservation({
      state,
      ui: ui({hud: {...base.hud, postHint: 'Trading post ≈9 tiles ↙'}}),
      get: tileSource({})
    });
    expect(near.hud.postHint).toBe('Trading post ≈9 tiles ↙');
  });

  it('carries the scanner line, hover surcharge included, in hud.scanner', () => {
    const state = createInitialState();
    state.player.x = 45;
    state.player.y = 100;
    state.player.drillDx = 1;
    state.player.drillDy = 0;
    reveal(state, 46, 100);
    // Open air under the ship, dirt to its right: a side drill from a hover.
    const get = tileSource({'45,101': {type: 'air'}});
    const grid = createFakeGrid(get);
    const readouts = createReadouts({
      state, grid, enemies: createEnemySimStub(), audio: createAudioStub(),
      atSurface: () => false, toast: () => {}
    });
    const hud = {...uiStore.getState().hud};
    readouts.sync(hud);

    const obs = buildObservation({state, ui: ui({hud}), get});
    expect(obs.hud.scanner).toBe('Scanner →: dirt — drillable, 1 hit. Hover: +25 % fuel.');
  });

  it('carries the return forecast and the exit it is priced to in hud.fuelReserve', () => {
    const state = createInitialState();
    const base = uiStore.getState();
    // A new game is parked at home: nothing to reserve, and home is the exit.
    expect(buildObservation({state, ui: ui(), get: tileSource({})}).hud.fuelReserve)
      .toEqual({status: 'safe', needed: 0, margin: state.player.fuel, exit: 'Home'});
    const deep = buildObservation({
      state,
      ui: ui({hud: {
        ...base.hud,
        fuelReserveStatus: 'caution',
        fuelReserveNeeded: 6,
        fuelReserveMargin: 3,
        fuelReserveExit: 'Portal "Deep"'
      }}),
      get: tileSource({})
    });
    expect(deep.hud.fuelReserve).toEqual({status: 'caution', needed: 6, margin: 3, exit: 'Portal "Deep"'});
  });

  it('carries the base fuel readout in hud.base, and null without a base', () => {
    const state = createInitialState();
    const base = uiStore.getState();
    // A new game's HUD starts on the seeded, full home extractor.
    expect(buildObservation({state, ui: ui(), get: tileSource({})}).hud.base)
      .toEqual({fuel: EXTRACTOR.fuelCap, coal: 0, alert: false});

    const withBase = buildObservation({
      state,
      ui: ui({hud: {...base.hud, hasBase: true, baseFuel: 320, baseCoal: 4, baseAlert: false}}),
      get: tileSource({})
    });
    expect(withBase.hud.base).toEqual({fuel: 320, coal: 4, alert: false});

    const low = buildObservation({
      state,
      ui: ui({hud: {...base.hud, hasBase: true, baseFuel: 12, baseCoal: 0, baseAlert: true}}),
      get: tileSource({})
    });
    expect(low.hud.base).toEqual({fuel: 12, coal: 0, alert: true});

    const without = buildObservation({
      state,
      ui: ui({hud: {...base.hud, hasBase: false, baseAlert: true}}),
      get: tileSource({})
    });
    expect(without.hud.base).toBeNull();
  });

  it('mirrors the station overlay only while it is open, with recipe affordances', () => {
    const state = createInitialState();

    // No overlay open: nothing is mirrored.
    expect(buildObservation({state, ui: ui({overlay: null}), get: tileSource({})}).overlay).toBeNull();

    const overlay = buildObservation({
      state,
      ui: ui({overlay: {kind: 'station', slots: [oreSlot('Iron', 3), {...oreSlot('Copper', 1), index: 1}], supply: false, bestMarkCrafted: 0}}),
      get: tileSource({})
    }).overlay;

    expect(overlay?.kind).toBe('station');
    if (overlay?.kind !== 'station') throw new Error('expected station overlay');
    expect(overlay.stock).toMatchObject([{kind: oreKind('Iron'), label: 'Iron', count: 3}, {kind: oreKind('Copper'), label: 'Copper', count: 1}]);
    // Three Iron and a Copper afford the repair kit but not the teleporter.
    expect(overlay.recipes.find(r => r.output === 'repairKit')?.craftable).toBe(true);
    const teleporter = overlay.recipes.find(r => r.output === 'teleporter');
    expect(teleporter?.craftable).toBe(false);
    expect(teleporter?.missing.length).toBeGreaterThan(0);

    // A stock slot and every recipe carry non-empty tooltip lines; the recipe's
    // include a have/need line for each input read against the station stock.
    expect(nth(overlay.stock, 0).info?.length).toBeGreaterThan(0);
    const repairKit = overlay.recipes.find(r => r.output === 'repairKit');
    expect(repairKit?.info.length).toBeGreaterThan(0);
    expect(repairKit?.info.some(line => line.includes('Iron 3/2'))).toBe(true);
    expect(repairKit?.info.some(line => line.includes('Copper 1/1'))).toBe(true);
    // Away from the base there is no Supply counter.
    expect(overlay.supply).toEqual([]);
    // Every row names its data-craft id; before a Mk II the deep alternates are not listed.
    expect(repairKit?.id).toBe('repairKit');
    expect(overlay.recipes.some(r => r.id.endsWith(':alt'))).toBe(false);
  });

  it('lists the deep alternates beside the standard rows once a Mk II is crafted', () => {
    const overlay = buildObservation({
      state: createInitialState(),
      ui: ui({overlay: {kind: 'station', slots: [oreSlot('Ruby', 2), {...oreSlot('Emerald', 2), index: 1}, {...oreSlot('Iron', 2), index: 2}], supply: false, bestMarkCrafted: 2}}),
      get: tileSource({})
    }).overlay;
    if (overlay?.kind !== 'station') throw new Error('expected station overlay');
    const portals = overlay.recipes.filter(r => r.output === 'device:portal');
    expect(portals.map(r => [r.id, r.label, r.craftable])).toEqual([
      ['device:portal', 'Portal', false],
      ['device:portal:alt', 'Deep Portal', true]
    ]);
    const deepTeleporter = overlay.recipes.find(r => r.id === 'teleporter:alt');
    expect(deepTeleporter).toMatchObject({output: 'teleporter', label: 'Deep Teleporter', craftable: false});
    expect(deepTeleporter?.missing.map(input => [input.label, input.count])).toEqual([['Alienite', 1]]);
    expect(deepTeleporter?.inputs.map(input => [input.label, input.count])).toEqual([['Emerald', 1], ['Alienite', 1]]);
  });

  it('mirrors the Shipyard: the hull flown now, and the next one priced from the stock', () => {
    const state = createInitialState();
    const shipyard = (slots: InventorySlotView[], ship = buildShipView('scout')) => {
      const overlay = buildObservation({
        state,
        ui: ui({overlay: {kind: 'station', slots, supply: false, bestMarkCrafted: 0}, ship}),
        get: tileSource({})
      }).overlay;
      if (overlay?.kind !== 'station') throw new Error('expected station overlay');
      return overlay.shipyard;
    };

    const short = shipyard([oreSlot('Iron', 16)]);
    expect(short.current).toEqual({id: 'scout', label: 'Scout', slots: 3});
    expect(short.next).toMatchObject({
      id: 'hauler', label: 'Hauler', slots: 4, craftable: false,
      gains: {fuelMax: 50, hullMax: 25, cargoMax: 10, drill: 0},
      missing: [{kind: oreKind('Copper'), count: 10, label: 'Copper'}, {kind: oreKind('Silver'), count: 6, label: 'Silver'}]
    });
    expect(short.next?.inputs.map(input => [input.label, input.count])).toEqual([['Iron', 16], ['Copper', 10], ['Silver', 6]]);

    const stocked = shipyard([oreSlot('Iron', 16), {...oreSlot('Copper', 10), index: 1}, {...oreSlot('Silver', 6), index: 2}]);
    expect(stocked.next).toMatchObject({id: 'hauler', craftable: true, missing: []});

    // On the top rung there is nothing left to build.
    expect(shipyard([], buildShipView('corebreaker'))).toEqual({
      current: {id: 'corebreaker', label: 'Core Breaker', slots: 7},
      next: null
    });
  });

  it('carries the Shipyard at a glance in hud.nextShip, with no overlay open', () => {
    const state = createInitialState();
    const nextShip = () => buildObservation({state, ui: ui({overlay: null}), get: tileSource({})}).hud.nextShip;
    expect(nextShip()).toEqual({
      id: 'hauler', label: 'Hauler',
      missing: [
        {kind: oreKind('Iron'), count: 16, label: 'Iron'},
        {kind: oreKind('Copper'), count: 10, label: 'Copper'},
        {kind: oreKind('Silver'), count: 6, label: 'Silver'}
      ]
    });

    // Read off the first Manufacturer's stock, as the objective's ship rung is.
    const manufacturer = state.stations.find(station => station.kind === 'manufacturer');
    if (manufacturer?.kind !== 'manufacturer') throw new Error('a seeded manufacturer expected');
    manufacturer.inventory = addItem(addItem(addItem(createInventory(), oreItem(ore('Iron')), 30), oreItem(ore('Copper')), 10), oreItem(ore('Silver')), 2);
    expect(nextShip()).toEqual({id: 'hauler', label: 'Hauler', missing: [{kind: oreKind('Silver'), count: 4, label: 'Silver'}]});

    swapHull(state.player, 'leviathan');
    expect(nextShip()?.id).toBe('corebreaker');
    swapHull(state.player, 'corebreaker');
    expect(nextShip()).toBeNull();
  });

  it('names the hull in ship.class, ship.shipLabel and ship.slots, and in the ship overlay', () => {
    const state = createInitialState();
    const scout = buildObservation({state, ui: ui(), get: tileSource({})});
    expect(scout.ship).toMatchObject({class: 'scout', shipLabel: 'Scout', slots: 3});

    swapHull(state.player, 'leviathan');
    const obs = buildObservation({
      state,
      ui: ui({overlay: {kind: 'ship'}, ship: buildShipView('leviathan'), shipEquipment: buildShipSlots(state.player.equipment, 0)}),
      get: tileSource({})
    });
    expect(obs.ship).toMatchObject({class: 'leviathan', shipLabel: 'Leviathan', slots: 6, fuelMax: 275, cargoMax: 55, drill: 3});
    expect(obs.ship.equipment).toHaveLength(6);
    if (obs.overlay?.kind !== 'ship') throw new Error('expected ship overlay');
    expect(obs.overlay.ship).toEqual({id: 'leviathan', label: 'Leviathan', slots: 6});
    expect(obs.overlay.slots.map(slot => slot.locked)).toEqual([false, false, false, false, false, true]);
  });

  it('mirrors the home Supply rows with their prices and affordability', () => {
    const state = createInitialState();
    const cash = supplyPrice('dynamite');
    const overlay = buildObservation({
      state,
      ui: ui({overlay: {kind: 'station', slots: [], supply: true, bestMarkCrafted: 0}, hud: {...uiStore.getState().hud, cash}}),
      get: tileSource({})
    }).overlay;

    if (overlay?.kind !== 'station') throw new Error('expected station overlay');
    expect(overlay.supply.map(row => row.kind)).toEqual([...SUPPLY_POOL]);
    for (const row of overlay.supply) {
      expect(row.price).toBe(supplyPrice(row.kind));
      expect(row.affordable).toBe(cash >= row.price);
      expect(row.label).toBeTruthy();
      expect(row.info.length).toBeGreaterThan(0);
    }
    expect(overlay.supply.find(row => row.kind === 'dynamite')?.affordable).toBe(true);
  });

  it('keeps the top-level bay lean, with no tooltip info on its slots', () => {
    const state = createInitialState();
    const obs = buildObservation({
      state,
      ui: ui({inventorySlots: [oreSlot('Iron', 2)]}),
      get: tileSource({})
    });
    expect(obs.bay).toEqual([{kind: oreKind('Iron'), label: 'Iron', count: 2}]);
    expect(nth(obs.bay, 0).info).toBeUndefined();
  });

  it('draws a trading post as T in view and notable, and carries the wallet in hud.cash', () => {
    const state = createInitialState();
    // Find a real post and park the ship on it, revealing its 3×3 pocket.
    let post: {x: number; y: number} | null = null;
    for (let y = START_Y + 40; y < START_Y + 4000 && !post; y++) {
      for (let x = 3; x < WORLD_W - 3; x++) {
        if (tradingPostAt(x, y)) { post = {x, y}; break; }
      }
    }
    if (!post) throw new Error('no trading post found');
    // Stand one tile above the post so its own tile is visible (not under the ship).
    state.player.x = post.x;
    state.player.y = post.y - 1;
    revealRect(state, post.x - 2, post.y - 2, post.x + 2, post.y + 2);

    const obs = buildObservation({state, ui: ui({hud: {...uiStore.getState().hud, cash: 321}}), get: tileSource({})});

    expect(obs.hud.cash).toBe(321);
    expect(obs.notable.some(n => n.what === 'tradingPost' && n.x === post!.x && n.y === post!.y)).toBe(true);
  });

  it('renders a trading post glyph on a tile the ship is not standing on', () => {
    const state = createInitialState();
    let post: {x: number; y: number} | null = null;
    for (let y = START_Y + 40; y < START_Y + 4000 && !post; y++) {
      for (let x = 3; x < WORLD_W - 3; x++) {
        if (tradingPostAt(x, y)) { post = {x, y}; break; }
      }
    }
    if (!post) throw new Error('no trading post found');
    // Stand one tile above the post so its own tile paints as T.
    state.player.x = post.x;
    state.player.y = post.y - 1;
    revealRect(state, post.x - 2, post.y - 2, post.x + 2, post.y + 2);

    const obs = buildObservation({state, ui: ui(), get: tileSource({})});
    const originX = obs.view.origin.x;
    const originY = obs.view.origin.y;
    expect(obs.view.rows[post.y - originY]?.[post.x - originX]).toBe('T');
    expect(VIEW_LEGEND.T).toBe('trading post');
  });

  it('mirrors the trade overlay: the wallet, ore to sell, and the buy offers', () => {
    const state = createInitialState();
    const offers: TradeOfferView[] = [
      {index: 0, kind: 'repairKit', label: 'Repair Kit', color: '#7be08a', price: 54, stock: 2}
    ];
    const overlay = buildObservation({
      state,
      ui: ui({
        overlay: {kind: 'trade', offers, fuelPrice: fuelUnitPrice()},
        hud: {...uiStore.getState().hud, cash: 200},
        inventorySlots: [oreSlot('Iron', 5)]
      }),
      get: tileSource({})
    }).overlay;

    expect(overlay?.kind).toBe('trade');
    if (overlay?.kind !== 'trade') throw new Error('expected trade overlay');
    expect(overlay.cash).toBe(200);
    expect(overlay.sell).toMatchObject([{kind: oreKind('Iron'), label: 'Iron', count: 5, price: 12}]);
    expect(overlay.buy).toMatchObject([{kind: 'repairKit', label: 'Repair Kit', price: 54, stock: 2}]);
    expect(nth(overlay.sell, 0).info.length).toBeGreaterThan(0);
    expect(nth(overlay.buy, 0).info.length).toBeGreaterThan(0);
    // A full tank: the fuel row buys nothing, but still quotes a unit.
    expect(overlay.fuel).toEqual({unitPrice: Math.round(fuelUnitPrice() * 100) / 100, amount: 0, cost: 0});
  });

  it('mirrors the trade fuel row: the fill a tank short of fuel would buy, at the post\'s own price', () => {
    const state = createInitialState();
    state.player.fuelMax = 100;
    state.player.fuel = 60;
    // A post 4000 m down charges twice the home price.
    const deepPrice = fuelUnitPrice(4000);
    const overlay = buildObservation({
      state,
      ui: ui({overlay: {kind: 'trade', offers: [], fuelPrice: deepPrice}, hud: {...uiStore.getState().hud, cash: 200}}),
      get: tileSource({})
    }).overlay;

    if (overlay?.kind !== 'trade') throw new Error('expected trade overlay');
    const {cost} = fuelPurchase(60, 100, 200, deepPrice);
    expect(overlay.fuelPrice).toBe(Math.round(deepPrice * 100) / 100);
    expect(overlay.fuel).toMatchObject({unitPrice: overlay.fuelPrice, amount: 40, cost});
    expect(cost).toBeGreaterThan(fuelPurchase(60, 100, 200, fuelUnitPrice()).cost);
  });

  it('mirrors the extractor overlay with the refuel amount the screen would show', () => {
    const state = createInitialState();
    state.player.fuel = 50;
    state.player.fuelMax = 100;
    const overlay = buildObservation({
      state,
      ui: ui({overlay: {kind: 'extractor', extractor: {coal: 5, fuel: 40, progress: 10, supply: false}}}),
      get: tileSource({})
    }).overlay;

    expect(overlay?.kind).toBe('extractor');
    if (overlay?.kind !== 'extractor') throw new Error('expected extractor overlay');
    expect(overlay.coal).toBe(5);
    // Room in the tank is 50, but only 40 fuel is stored.
    expect(overlay.refuelAmount).toBe(40);
    // A field extractor takes no fuel orders, so it quotes no price either.
    expect(overlay.fuelOrder).toBeNull();
    expect(overlay.fuelPrice).toBeNull();
  });

  it('mirrors the base extractor\'s fuel order: what the button would buy right now', () => {
    const state = createInitialState();
    const view = (fuel: number, cash: number) => {
      const overlay = buildObservation({
        state,
        ui: ui({overlay: {kind: 'extractor', extractor: {coal: 0, fuel, progress: 0, supply: true}}, hud: {...uiStore.getState().hud, cash}}),
        get: tileSource({})
      }).overlay;
      if (overlay?.kind !== 'extractor') throw new Error('expected extractor overlay');
      return overlay;
    };

    expect(view(0, 1000).fuelOrder).toEqual({amount: EXTRACTOR_FUEL_ORDER, cost: extractorFuelOrder(0, 1000).cost});
    expect(view(EXTRACTOR.fuelCap, 1000).fuelOrder).toEqual({amount: 0, cost: 0});
    expect(view(0, 0).fuelOrder).toEqual({amount: 0, cost: 0});
    // The home price, quoted even when the button has nothing to buy.
    expect(view(0, 0).fuelPrice).toBe(Math.round(fuelUnitPrice() * 100) / 100);
  });

  it('mirrors the ship overlay, listing bay upgrades as fittable', () => {
    const state = createInitialState();
    const upgrade: InventorySlotView = {index: 0, kind: 'upgrade:drill:1', label: 'Drill Mk I', color: '#d0d6de', count: 1};
    const overlay = buildObservation({
      state,
      ui: ui({overlay: {kind: 'ship'}, inventorySlots: [upgrade]}),
      get: tileSource({})
    }).overlay;

    expect(overlay?.kind).toBe('ship');
    if (overlay?.kind !== 'ship') throw new Error('expected ship overlay');
    expect(overlay.fittable.map(slot => slot.kind)).toEqual(['upgrade:drill:1']);
    expect(overlay.slots.length).toBe(state.player.equipment.length);
  });

  it('lists a carried Fuel Cell in the bay, where its slot button spends it', () => {
    const state = createInitialState();
    state.player.inventory = addItem(createInventory(), ITEM_CATALOG.fuelCell, 2);
    const obs = buildObservation({state, ui: ui({inventorySlots: buildInventorySlots(state.player.inventory)}), get: tileSource({})});
    expect(obs.bay).toEqual([{kind: 'fuelCell', label: 'Fuel Cell', count: 2}]);
  });

  it('carries a fitted Core Drill in ship.equipment, its +7 in ship.drill, and in the ship overlay', () => {
    const state = createInitialState();
    state.stats.bestMarkCrafted = 4;
    state.player.equipment = ['upgrade:drill:4', null, null];
    applyEquipment(state.player);
    const obs = buildObservation({
      state,
      ui: ui({overlay: {kind: 'ship'}, shipEquipment: buildShipSlots(state.player.equipment, 4)}),
      get: tileSource({})
    });
    expect(obs.ship.equipment).toEqual(['upgrade:drill:4', null, null]);
    expect(obs.ship.drill).toBe(8);
    expect(obs.stats.bestMarkCrafted).toBe(4);
    if (obs.overlay?.kind !== 'ship') throw new Error('expected ship overlay');
    expect(nth(obs.overlay.slots, 0)).toMatchObject({kind: 'upgrade:drill:4', label: 'Core Drill', info: expect.arrayContaining(['+7 drill power when fitted.'])});
  });

  it('marks the third fitting slot locked until a Mk II has been crafted', () => {
    const state = createInitialState();
    const slots = (bestMarkCrafted: number) => {
      const overlay = buildObservation({
        state,
        ui: ui({overlay: {kind: 'ship'}, shipEquipment: buildShipSlots(['upgrade:tank:1', null, null], bestMarkCrafted)}),
        get: tileSource({})
      }).overlay;
      if (overlay?.kind !== 'ship') throw new Error('expected ship overlay');
      return overlay.slots;
    };

    expect(slots(1)).toEqual([
      {index: 0, kind: 'upgrade:tank:1', label: 'Fuel Tank Mk I', locked: false, info: expect.arrayContaining(['+50 max fuel when fitted.'])},
      {index: 1, kind: null, label: 'Empty', locked: false, info: []},
      {index: 2, kind: null, label: 'Locked — craft a Mk II upgrade', locked: true, info: []}
    ]);
    expect(nth(slots(2), 2)).toMatchObject({label: 'Empty', locked: false});
  });

  it('mirrors the armed station device and toolkit, like any other armed tool', () => {
    const state = createInitialState();
    expect(buildObservation({state, ui: ui({armedPlacement: 'device:extractor'}), get: tileSource({})}).armedPlacement)
      .toBe('device:extractor');
    expect(buildObservation({state, ui: ui({armedPlacement: 'toolkit'}), get: tileSource({})}).armedPlacement)
      .toBe('toolkit');
  });

  it('caps the toast ring buffer, dropping the oldest lines', () => {
    let ring = appendToast([], {tick: 1, message: 'first'}, 3);
    ring = appendToast(ring, {tick: 2, message: 'second'}, 3);
    ring = appendToast(ring, {tick: 3, message: 'third'}, 3);
    ring = appendToast(ring, {tick: 4, message: 'fourth'}, 3);

    expect(ring).toHaveLength(3);
    expect(ring.map(t => t.message)).toEqual(['second', 'third', 'fourth']);
  });

  it('carries the passed-in toast ring into the observation', () => {
    const state = createInitialState();
    const obs = buildObservation({state, ui: ui(), get: tileSource({}), toasts: [{tick: 7, message: 'hello'}]});
    expect(obs.toasts).toEqual([{tick: 7, message: 'hello'}]);
  });
});

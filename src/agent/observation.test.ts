// Unit tests for the pure observation builder. The two invariants the harness
// leans on — fog hides what the player has not seen, and an overlay is mirrored
// only while it is open — get a test each, alongside the ASCII legend, the notable
// list, and the toast ring buffer's cap.

import { describe, expect, it } from 'vitest';
import { explorationIndex } from '../../shared/exploration-codec';
import { addItem, createInventory, oreItem, oreKind } from '../core/inventory';
import { createInitialState } from '../core/state';
import { createPlacedContainer } from '../core/cargo-container';
import { createWreck } from '../core/wreck';
import { createScannerDevice } from '../core/scanner-device';
import { createPlacedDynamite } from '../core/dynamite';
import { uiStore, type InventorySlotView, type TradeOfferView, type UiState } from '../ui/store';
import type { Enemy, GameState, Tile } from '../core/types';
import { START_Y, WORLD_W } from '../../shared/constants';
import { tradingPostAt } from '../world/world';
import { appendToast, buildObservation, VIEW_LEGEND } from './observation';

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
  return {id: 1, kind: 'tunnelFiend', x, y, drawX: x, drawY: y, hp: 3, maxHp: 3, alive: true, moveTick: 0, biteTick: 0, flash: 0};
}

/** The store's live projection, spread so a test can override just what it needs. */
function ui(overrides: Partial<UiState> = {}): UiState {
  return {...uiStore.getState(), ...overrides};
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
    expect(obs.view.rows[5][43 - 38]).toBe('o');
    expect(obs.view.rows[5][47 - 38]).toBe('?');
    expect(obs.notable.some(n => n.x === 43 && n.y === 100 && n.what === 'ore')).toBe(true);
    expect(obs.notable.some(n => n.x === 47)).toBe(false);
  });

  it('marks the ship and publishes the legend', () => {
    const state = createInitialState();
    state.player.x = 45;
    state.player.y = 100;
    const obs = buildObservation({state, ui: ui(), get: tileSource({})});

    // 15 wide by 11 tall, ship dead centre.
    expect(obs.view.rows).toHaveLength(11);
    expect(obs.view.rows[0]).toHaveLength(15);
    expect(obs.view.rows[5][7]).toBe('@');
    expect(obs.view.legend).toBe(VIEW_LEGEND);
    expect(obs.view.legend['@']).toBe('ship');
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
    expect(obs.view.rows[5][42 - 38]).toBe('E');
    expect(obs.view.rows[6][46 - 38]).toBe('*');
  });

  it('draws a wreck as W in view and notable, counting the items it holds', () => {
    const state = createInitialState();
    state.player.x = 45;
    state.player.y = 100;
    revealRect(state, 38, 95, 52, 105);
    const wreck = createWreck(43, 101, addItem(addItem(createInventory(), oreItem({name: 'Gold', color: '#fff', value: 1, min: 0, max: 1, chance: 1}), 2), {kind: 'upgrade:tank:1', label: 'Fuel Tank Mk I', color: '#5ad1ff', value: 0}));
    state.wrecks.push(wreck);

    const obs = buildObservation({state, ui: ui(), get: tileSource({})});

    expect(obs.view.rows[6][43 - 38]).toBe('W');
    expect(obs.notable.find(n => n.what === 'wreck')?.detail).toBe('3 items');
    expect(VIEW_LEGEND.W).toBe('wreck');
  });

  it('mirrors the wreck overlay only while it is open', () => {
    const state = createInitialState();
    const wreckSlots: InventorySlotView[] = [oreSlot('Gold', 4)];

    expect(buildObservation({state, ui: ui({activeOverlay: null, wreckSlots}), get: tileSource({})}).overlay).toBeNull();

    const overlay = buildObservation({
      state,
      ui: ui({activeOverlay: 'wreck', wreckSlots, inventorySlots: [oreSlot('Iron', 1)]}),
      get: tileSource({})
    }).overlay;

    expect(overlay?.kind).toBe('wreck');
    if (overlay?.kind !== 'wreck') throw new Error('expected wreck overlay');
    expect(overlay.wreck).toEqual([{kind: oreKind('Gold'), label: 'Gold', count: 4}]);
    expect(overlay.ship).toEqual([{kind: oreKind('Iron'), label: 'Iron', count: 1}]);
  });

  it('names the home stations in view and notable', () => {
    const state = createInitialState();
    // Ship parked at home; the two stations flank it at (44,20) and (46,20).
    revealRect(state, 38, 15, 52, 25);
    const obs = buildObservation({state, ui: ui(), get: tileSource({})});

    expect(obs.notable.some(n => n.what === 'station' && n.detail === 'Manufacturer')).toBe(true);
    expect(obs.notable.some(n => n.what === 'station' && n.detail === 'Oil Extractor')).toBe(true);
    // Ship at (45,20) → row 5; manufacturer at col 6, extractor at col 8.
    expect(obs.view.rows[5][44 - 38]).toBe('M');
    expect(obs.view.rows[5][46 - 38]).toBe('X');
  });

  it('mirrors the station overlay only while it is open, with recipe affordances', () => {
    const state = createInitialState();

    // No overlay open: nothing is mirrored.
    expect(buildObservation({state, ui: ui({activeOverlay: null}), get: tileSource({})}).overlay).toBeNull();

    const overlay = buildObservation({
      state,
      ui: ui({activeOverlay: 'station', stationSlots: [oreSlot('Iron', 3)]}),
      get: tileSource({})
    }).overlay;

    expect(overlay?.kind).toBe('station');
    if (overlay?.kind !== 'station') throw new Error('expected station overlay');
    expect(overlay.stock).toEqual([{kind: oreKind('Iron'), label: 'Iron', count: 3}]);
    // Three Iron affords the repair kit but not the teleporter.
    expect(overlay.recipes.find(r => r.output === 'repairKit')?.craftable).toBe(true);
    const teleporter = overlay.recipes.find(r => r.output === 'teleporter');
    expect(teleporter?.craftable).toBe(false);
    expect(teleporter?.missing.length).toBeGreaterThan(0);
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
    expect(obs.view.rows[post.y - originY][post.x - originX]).toBe('T');
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
        activeOverlay: 'trade',
        hud: {...uiStore.getState().hud, cash: 200},
        inventorySlots: [oreSlot('Iron', 5)],
        tradeBuy: offers
      }),
      get: tileSource({})
    }).overlay;

    expect(overlay?.kind).toBe('trade');
    if (overlay?.kind !== 'trade') throw new Error('expected trade overlay');
    expect(overlay.cash).toBe(200);
    expect(overlay.sell).toEqual([{kind: oreKind('Iron'), label: 'Iron', count: 5, price: 12}]);
    expect(overlay.buy).toEqual([{kind: 'repairKit', label: 'Repair Kit', price: 54, stock: 2}]);
  });

  it('mirrors the extractor overlay with the refuel amount the screen would show', () => {
    const state = createInitialState();
    const base = uiStore.getState();
    const overlay = buildObservation({
      state,
      ui: ui({
        activeOverlay: 'extractor',
        extractor: {coal: 5, fuel: 40, progress: 10},
        player: {...base.player, fuel: 50, fuelMax: 100}
      }),
      get: tileSource({})
    }).overlay;

    expect(overlay?.kind).toBe('extractor');
    if (overlay?.kind !== 'extractor') throw new Error('expected extractor overlay');
    expect(overlay.coal).toBe(5);
    // Room in the tank is 50, but only 40 fuel is stored.
    expect(overlay.refuelAmount).toBe(40);
  });

  it('mirrors the ship overlay, listing bay upgrades as fittable', () => {
    const state = createInitialState();
    const upgrade: InventorySlotView = {index: 0, kind: 'upgrade:drill:1', label: 'Drill Mk I', color: '#d0d6de', count: 1};
    const overlay = buildObservation({
      state,
      ui: ui({activeOverlay: 'ship', inventorySlots: [upgrade]}),
      get: tileSource({})
    }).overlay;

    expect(overlay?.kind).toBe('ship');
    if (overlay?.kind !== 'ship') throw new Error('expected ship overlay');
    expect(overlay.fittable.map(slot => slot.kind)).toEqual(['upgrade:drill:1']);
    expect(overlay.slots.length).toBe(state.player.equipment.length);
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

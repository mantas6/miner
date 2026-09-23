// Unit tests for the pure observation builder. The two invariants the harness
// leans on — fog hides what the player has not seen, and an overlay is mirrored
// only while it is open — get a test each, alongside the ASCII legend, the notable
// list, and the toast ring buffer's cap.

import { describe, expect, it } from 'vitest';
import { explorationIndex } from '../../shared/exploration-codec';
import { oreKind } from '../core/inventory';
import { createInitialState } from '../core/state';
import { createPlacedContainer } from '../core/cargo-container';
import { createScannerDevice } from '../core/scanner-device';
import { createPlacedDynamite } from '../core/dynamite';
import { uiStore, type InventorySlotView, type UiState } from '../ui/store';
import type { Enemy, GameState, Tile } from '../core/types';
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

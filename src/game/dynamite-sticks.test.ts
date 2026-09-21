// Arming, planting, and burning down the dynamite the player leaves in the mine.
//
// The rules themselves are core/dynamite.test.ts; what is checked here is the
// wiring: the cargo bay pays for a placement, the fuse only burns while the run
// steps, and the blast reaches the terrain, the enemies and — this being the
// point of the delay — the ship that lit it.

import { describe, expect, it, vi } from 'vitest';
import { WORLD_W } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';
import { HULL } from '../core/balance';
import { DYNAMITE, DYNAMITE_ITEM, createPlacedDynamite, dynamiteHullDamage } from '../core/dynamite';
import { addItem, countItem, createInventory } from '../core/inventory';
import { createInitialState } from '../core/state';
import type { GameState, Tile } from '../core/types';
import { createDynamiteSticks, type DynamiteSim } from './dynamite-sticks';
import { createAudioStub, createFakeGrid, createToastLog, type AudioStub, type FakeGrid } from './test-support';

interface Harness {
  state: GameState;
  dynamite: DynamiteSim;
  grid: FakeGrid;
  audio: AudioStub;
  toasts: ReturnType<typeof createToastLog>;
  wakeEnemiesNear: ReturnType<typeof vi.fn>;
  spawnExplosion: ReturnType<typeof vi.fn>;
  damagePlayer: ReturnType<typeof vi.fn>;
  armedUi: boolean[];
  saveProgress: ReturnType<typeof vi.fn>;
}

/** A ship parked in cleared, explored ground with `carried` sticks aboard. */
function harness(carried = 1): Harness {
  const state = createInitialState();
  if (carried > 0) state.player.inventory = addItem(createInventory(), DYNAMITE_ITEM, carried)!;
  state.exploredTiles.add(explorationIndex(40, 100));
  // Far enough from the target tile that a blast cannot reach the ship unless a
  // test moves it in deliberately.
  Object.assign(state.player, {x: 60, y: 100});
  const context = {
    state,
    grid: createFakeGrid(),
    audio: createAudioStub(),
    toasts: createToastLog(),
    wakeEnemiesNear: vi.fn(),
    spawnExplosion: vi.fn(),
    damagePlayer: vi.fn((amount: number) => { state.player.hull -= amount; }),
    armedUi: [] as boolean[],
    saveProgress: vi.fn()
  };
  const dynamite = createDynamiteSticks({
    ...context,
    toast: context.toasts.toast,
    setArmedUi: value => context.armedUi.push(value)
  });
  return {...context, dynamite};
}

/** Step the simulation until every burning fuse has run out. */
function burnDown(dynamite: DynamiteSim): void {
  for (let step = 0; step < DYNAMITE.fuseTicks; step++) dynamite.tick();
}

describe('arming a stick', () => {
  it('arms from the slot, tells the UI, and stands down on a second press', () => {
    const h = harness();

    h.dynamite.toggleArmed();
    expect(h.dynamite.armed).toBe(true);
    expect(h.armedUi).toEqual([true]);
    expect(h.toasts.saw('press a mapped tile')).toBe(true);

    h.dynamite.toggleArmed();
    expect(h.dynamite.armed).toBe(false);
    expect(h.armedUi).toEqual([true, false]);
    expect(h.toasts.saw('cancelled')).toBe(true);
  });

  it('refuses to arm with an empty bay, and says where to craft one', () => {
    const h = harness(0);

    h.dynamite.toggleArmed();

    expect(h.dynamite.armed).toBe(false);
    expect(h.toasts.saw('Manufacturing Station')).toBe(true);
    expect(h.audio.played).toContain('alarm');
  });

  it('refuses to arm once the mine is full of burning sticks', () => {
    const h = harness();
    h.state.placedDynamite = Array.from({length: DYNAMITE.maxPlaced}, (_, i) => createPlacedDynamite(i, 500));

    h.dynamite.toggleArmed();

    expect(h.dynamite.armed).toBe(false);
    expect(h.toasts.saw(`${DYNAMITE.maxPlaced} sticks`)).toBe(true);
  });

  it('is stood down by Escape only while something is armed', () => {
    const h = harness();

    expect(h.dynamite.disarm()).toBe(false);
    h.dynamite.toggleArmed();
    expect(h.dynamite.disarm()).toBe(true);
    expect(h.dynamite.armed).toBe(false);
  });
});

describe('planting a stick', () => {
  it('spends one from the bay and lights the fuse on the tile pressed', () => {
    const h = harness(2);
    h.dynamite.toggleArmed();

    expect(h.dynamite.placeAt(40, 100)).toBe(true);
    expect(h.state.placedDynamite).toEqual([{x: 40, y: 100, fuse: DYNAMITE.fuseTicks}]);
    expect(countItem(h.state.player.inventory, DYNAMITE_ITEM.kind)).toBe(1);
    expect(h.dynamite.armed).toBe(false);
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.toasts.saw('Fuse lit')).toBe(true);
  });

  it('ignores a press on the mine when nothing is armed', () => {
    const h = harness();

    expect(h.dynamite.placeAt(40, 100)).toBe(false);
    expect(h.state.placedDynamite).toEqual([]);
    expect(countItem(h.state.player.inventory, DYNAMITE_ITEM.kind)).toBe(1);
  });

  it('keeps the stick and stays armed when the tile is refused', () => {
    const h = harness();
    h.dynamite.toggleArmed();

    // Still under fog: not a tile the player can see well enough to blast.
    expect(h.dynamite.placeAt(41, 100)).toBe(false);
    expect(h.state.placedDynamite).toEqual([]);
    expect(countItem(h.state.player.inventory, DYNAMITE_ITEM.kind)).toBe(1);
    expect(h.dynamite.armed).toBe(true);
    expect(h.toasts.saw('already explored')).toBe(true);
  });

  it('refuses solid ground, without generating rows for a press off the map', () => {
    const h = harness();
    h.grid.put(40, 100, {type: 'dirt', hp: 3, maxHp: 3});
    h.dynamite.toggleArmed();

    expect(h.dynamite.placeAt(40, 100)).toBe(false);
    expect(h.toasts.saw('cleared space')).toBe(true);

    expect(h.dynamite.placeAt(-5, 1_000_000_000)).toBe(false);
    expect(h.toasts.saw('underground')).toBe(true);
  });

  it('drops the armed pointer with the ship, and with an emptied bay', () => {
    const lost = harness();
    lost.dynamite.toggleArmed();
    lost.state.gameOver = true;
    expect(lost.dynamite.placeAt(40, 100)).toBe(false);
    expect(lost.dynamite.armed).toBe(false);

    const emptied = harness();
    emptied.dynamite.toggleArmed();
    emptied.state.player.inventory = createInventory();
    expect(emptied.dynamite.placeAt(40, 100)).toBe(false);
    expect(emptied.dynamite.armed).toBe(false);
    expect(emptied.state.placedDynamite).toEqual([]);
  });
});

describe('a burning stick', () => {
  it('waits out the whole fuse, then clears terrain, wakes enemies, and is gone', () => {
    const h = harness();
    h.dynamite.toggleArmed();
    h.dynamite.placeAt(40, 100);
    // The blast reads terrain out of the raw world rows, not the tile cache, so
    // the one destructible block in range has to be laid into the rows directly.
    for (let y = 98; y <= 102; y++) h.grid.world[y] = Array.from({length: WORLD_W}, (): Tile => ({type: 'air'}));
    h.grid.world[101][40] = {type: 'dirt', hp: 3, maxHp: 3};

    for (let step = 0; step < DYNAMITE.fuseTicks - 1; step++) h.dynamite.tick();
    expect(h.state.placedDynamite).toHaveLength(1);
    expect(h.grid.writes).toEqual([]);

    h.dynamite.tick();

    expect(h.state.placedDynamite).toEqual([]);
    expect(h.grid.writes).toContainEqual({x: 40, y: 101, tile: {type: 'air'}});
    expect(h.wakeEnemiesNear).toHaveBeenCalledWith(40, 100);
    expect(h.spawnExplosion).toHaveBeenCalledWith(40, 100);
    expect(h.audio.played).toContain('explosion');
    expect(h.toasts.saw('cleared 1 blocks')).toBe(true);
    expect(h.saveProgress).toHaveBeenCalled();
  });

  it('damages a ship still standing in the blast, and spares one that left', () => {
    const h = harness(2);
    h.dynamite.toggleArmed();
    h.dynamite.placeAt(40, 100);
    // Right on top of it when the fuse runs out.
    Object.assign(h.state.player, {x: 40, y: 100});

    burnDown(h.dynamite);

    expect(h.damagePlayer).toHaveBeenCalledWith(HULL.dynamiteBlast);
    expect(h.toasts.saw('Caught in your own blast')).toBe(true);

    // The second one goes off with the ship one tile outside the radius.
    h.state.exploredTiles.add(explorationIndex(40, 100));
    h.dynamite.toggleArmed();
    h.dynamite.placeAt(40, 100);
    Object.assign(h.state.player, {x: 40 + DYNAMITE.radius + 1, y: 100});
    h.damagePlayer.mockClear();

    burnDown(h.dynamite);

    expect(h.damagePlayer).not.toHaveBeenCalled();
  });

  it('scales the damage with how close the ship was', () => {
    const h = harness();
    h.dynamite.toggleArmed();
    h.dynamite.placeAt(40, 100);
    Object.assign(h.state.player, {x: 41, y: 100});

    burnDown(h.dynamite);

    expect(h.damagePlayer).toHaveBeenCalledWith(dynamiteHullDamage(1, 0));
    expect(h.damagePlayer.mock.calls[0][0]).toBeLessThan(HULL.dynamiteBlast);
  });

  it('costs nothing at all while nothing is planted', () => {
    const h = harness();

    burnDown(h.dynamite);

    expect(h.saveProgress).not.toHaveBeenCalled();
    expect(h.spawnExplosion).not.toHaveBeenCalled();
  });

  it('stands an armed slot down once the ship is lost', () => {
    const h = harness();
    h.dynamite.toggleArmed();
    h.state.gameOver = true;

    h.dynamite.tick();

    expect(h.dynamite.armed).toBe(false);
  });
});

// Setting crates down, opening them, and moving cargo across.
//
// The rules themselves are core/cargo-container.test.ts; what is checked here is
// the wiring: the cargo bay pays for a placement, the menu the UI paints follows
// every transfer, and both the armed pointer and the open crate are stood down by
// everything that should stand them down.

import { describe, expect, it, vi } from 'vitest';
import { explorationIndex } from '../../shared/exploration-codec';
import {
  CARGO_CONTAINER,
  CARGO_CONTAINER_ITEM,
  createPlacedContainer
} from '../core/cargo-container';
import { DYNAMITE_ITEM } from '../core/dynamite';
import { addItem, countItem, countOres, createInventory, oreItem, type Inventory } from '../core/inventory';
import { createInitialState } from '../core/state';
import type { GameState, Ore } from '../core/types';
import { createCargoContainers, type CargoContainerSim } from './cargo-containers';
import { createAudioStub, createFakeGrid, createToastLog, type AudioStub, type FakeGrid } from './test-support';
import { HOME_ROW, WORLD_W } from '../../shared/constants';
import { tradingPostAt } from '../world/world';

/** The first trading post in the interior band, for the occupancy check. */
function findPost(): {x: number; y: number} {
  for (let y = HOME_ROW + 40; y < HOME_ROW + 4000; y++) {
    for (let x = 3; x < WORLD_W - 3; x++) {
      const post = tradingPostAt(x, y);
      if (post) return post;
    }
  }
  throw new Error('no trading post found');
}

const COPPER: Ore = {name: 'Copper', color: '#c87a3a', value: 8, min: 0, max: 900, chance: 1};

interface Harness {
  state: GameState;
  containers: CargoContainerSim;
  grid: FakeGrid;
  audio: AudioStub;
  toasts: ReturnType<typeof createToastLog>;
  armedUi: boolean[];
  /** Every contents push the UI received; `null` means the menu was taken away. */
  openUi: (Inventory | null)[];
  saveProgress: ReturnType<typeof vi.fn>;
}

/** A ship parked on cleared, explored ground with `carried` containers aboard. */
function harness(carried = 1): Harness {
  const state = createInitialState();
  if (carried > 0) state.player.inventory = addItem(createInventory(), CARGO_CONTAINER_ITEM, carried)!;
  state.exploredTiles.add(explorationIndex(40, 100));
  Object.assign(state.player, {x: 40, y: 100});
  const grid = createFakeGrid();
  const audio = createAudioStub();
  const toasts = createToastLog();
  const armedUi: boolean[] = [];
  const openUi: (Inventory | null)[] = [];
  const saveProgress = vi.fn();
  const containers = createCargoContainers({
    state,
    grid,
    audio,
    toast: toasts.toast,
    saveProgress,
    setArmedUi: value => armedUi.push(value),
    setOpenUi: contents => openUi.push(contents)
  });
  return {state, containers, grid, audio, toasts, armedUi, openUi, saveProgress};
}

/** Arm and set a crate down on the ship's own tile, so it is in reach. */
function placed(h: Harness): void {
  h.containers.toggleArmed();
  h.containers.placeAt(40, 100);
}

describe('arming a container', () => {
  it('arms from the slot, tells the UI, and stands down on a second press', () => {
    const h = harness();

    h.containers.toggleArmed();
    expect(h.containers.armed).toBe(true);
    expect(h.armedUi).toEqual([true]);
    expect(h.toasts.saw('press a mapped tile')).toBe(true);

    h.containers.toggleArmed();
    expect(h.containers.armed).toBe(false);
    expect(h.armedUi).toEqual([true, false]);
    expect(h.toasts.saw('cancelled')).toBe(true);
  });

  it('refuses to arm with an empty bay, and says where to craft one', () => {
    const h = harness(0);

    h.containers.toggleArmed();

    expect(h.containers.armed).toBe(false);
    expect(h.toasts.saw('Manufacturing Station')).toBe(true);
    expect(h.audio.played).toContain('alarm');
  });

  it('refuses to arm once the mine is full of them', () => {
    const h = harness();
    h.state.cargoContainers = Array.from({length: CARGO_CONTAINER.maxPlaced}, (_, i) => createPlacedContainer(i, 500));

    h.containers.toggleArmed();

    expect(h.containers.armed).toBe(false);
    expect(h.toasts.saw(`${CARGO_CONTAINER.maxPlaced} containers`)).toBe(true);
  });

  it('shuts an open crate rather than leaving two answers for one press', () => {
    const h = harness(2);
    placed(h);
    h.containers.openAt(40, 100);
    expect(h.containers.open).not.toBeNull();

    h.containers.toggleArmed();

    expect(h.containers.open).toBeNull();
    expect(h.openUi.at(-1)).toBeNull();
    expect(h.containers.armed).toBe(true);
  });
});

describe('setting a container down', () => {
  it('spends one from the bay and leaves the crate on the tile', () => {
    const h = harness(2);

    h.containers.toggleArmed();
    expect(h.containers.placeAt(40, 100)).toBe(true);

    expect(h.state.cargoContainers).toHaveLength(1);
    expect(h.state.cargoContainers[0]).toMatchObject({x: 40, y: 100});
    expect(countItem(h.state.player.inventory, CARGO_CONTAINER_ITEM.kind)).toBe(1);
    expect(h.containers.armed).toBe(false);
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.toasts.saw('Container set down')).toBe(true);
  });

  it('ignores a press on the mine when nothing is armed', () => {
    const h = harness();

    expect(h.containers.placeAt(40, 100)).toBe(false);
    expect(h.state.cargoContainers).toEqual([]);
    expect(countItem(h.state.player.inventory, CARGO_CONTAINER_ITEM.kind)).toBe(1);
  });

  it('keeps the container and stays armed when the tile is refused', () => {
    const h = harness();
    h.containers.toggleArmed();

    // Still under fog: not somewhere the player could find it again.
    expect(h.containers.placeAt(41, 100)).toBe(false);
    expect(h.state.cargoContainers).toEqual([]);
    expect(countItem(h.state.player.inventory, CARGO_CONTAINER_ITEM.kind)).toBe(1);
    expect(h.containers.armed).toBe(true);
    expect(h.toasts.saw('already explored')).toBe(true);
  });

  it('refuses solid ground, and a press off the map', () => {
    const h = harness();
    h.grid.put(40, 100, {type: 'dirt', hp: 3, maxHp: 3});
    h.containers.toggleArmed();

    expect(h.containers.placeAt(40, 100)).toBe(false);
    expect(h.toasts.saw('cleared space')).toBe(true);

    expect(h.containers.placeAt(-5, 1_000_000_000)).toBe(false);
    expect(h.toasts.saw('underground')).toBe(true);
  });

  it('refuses a tile a trading post already stands on', () => {
    const h = harness();
    const post = findPost();
    h.state.exploredTiles.add(explorationIndex(post.x, post.y));
    h.containers.toggleArmed();

    expect(h.containers.placeAt(post.x, post.y)).toBe(false);
    expect(h.toasts.saw('already stands')).toBe(true);
    expect(h.state.cargoContainers).toEqual([]);
  });

  it('drops the armed pointer when the bay is emptied behind its back', () => {
    const h = harness();
    h.containers.toggleArmed();
    h.state.player.inventory = createInventory();

    expect(h.containers.placeAt(40, 100)).toBe(false);
    expect(h.containers.armed).toBe(false);
    expect(h.state.cargoContainers).toEqual([]);
  });

  it('drops the armed pointer with the ship', () => {
    const h = harness();
    h.containers.toggleArmed();
    h.state.gameOver = true;

    expect(h.containers.placeAt(40, 100)).toBe(false);
    expect(h.containers.armed).toBe(false);
    expect(h.state.cargoContainers).toEqual([]);
  });
});

describe('opening a container', () => {
  it('opens the crate under a press and hands its contents to the UI', () => {
    const h = harness();
    placed(h);

    expect(h.containers.openAt(40, 100)).toBe(true);
    expect(h.containers.open).toBe(h.state.cargoContainers[0]);
    expect(h.openUi.at(-1)).toBe(h.state.cargoContainers[0].inventory);
  });

  it('says nothing at all about a press on bare rock', () => {
    const h = harness();
    placed(h);
    const toasts = h.toasts.messages.length;

    expect(h.containers.openAt(12, 300)).toBe(false);
    expect(h.containers.open).toBeNull();
    expect(h.toasts.messages).toHaveLength(toasts);
  });

  it('refuses a crate the ship has flown away from', () => {
    const h = harness();
    placed(h);
    h.state.player.y = 120;

    expect(h.containers.openAt(40, 100)).toBe(false);
    expect(h.containers.open).toBeNull();
    expect(h.toasts.saw('Too far')).toBe(true);
  });

  it('ignores the press while something is waiting to be placed', () => {
    const h = harness(2);
    placed(h);
    h.containers.toggleArmed();

    expect(h.containers.openAt(40, 100)).toBe(false);
  });

  it('opens the nearest crate from the keyboard, and closes it again', () => {
    const h = harness();
    placed(h);

    expect(h.containers.openNearest()).toBe(true);
    expect(h.containers.open).not.toBeNull();

    // The same key is the way back out.
    expect(h.containers.openNearest()).toBe(true);
    expect(h.containers.open).toBeNull();
    expect(h.openUi.at(-1)).toBeNull();
  });

  it('says where to get one when the keyboard finds nothing in reach', () => {
    const h = harness();

    expect(h.containers.openNearest()).toBe(false);
    expect(h.toasts.saw('No container within reach')).toBe(true);
  });

  it('shuts the crate and the armed pointer when the ship is lost', () => {
    const h = harness();
    placed(h);
    h.containers.openAt(40, 100);
    h.state.gameOver = true;

    h.containers.tick();

    expect(h.containers.open).toBeNull();
    expect(h.openUi.at(-1)).toBeNull();
  });
});

describe('moving cargo across', () => {
  /** A crate open beside a ship carrying `ore` units of copper. */
  function opened(ore = 6): Harness {
    const h = harness();
    placed(h);
    h.state.player.inventory = addItem(h.state.player.inventory, oreItem(COPPER), ore)!;
    h.containers.openAt(40, 100);
    h.saveProgress.mockClear();
    return h;
  }

  it('stores a whole stack, repaints the menu, and banks the change', () => {
    const h = opened();

    h.containers.store(oreItem(COPPER).kind);

    expect(countOres(h.state.player.inventory)).toBe(0);
    expect(countOres(h.state.cargoContainers[0].inventory)).toBe(6);
    // The UI is handed the crate's *new* contents, not the array it opened with.
    expect(h.openUi.at(-1)).toBe(h.state.cargoContainers[0].inventory);
    expect(h.saveProgress).toHaveBeenCalled();
    expect(h.toasts.saw('Stored 6 × Copper')).toBe(true);
  });

  it('stores a single unit on the row\'s 1 button, leaving the rest aboard', () => {
    const h = opened();

    h.containers.store(oreItem(COPPER).kind, true);

    expect(countOres(h.state.player.inventory)).toBe(5);
    expect(countOres(h.state.cargoContainers[0].inventory)).toBe(1);
    expect(h.toasts.saw('Stored 1 × Copper')).toBe(true);
  });

  it('takes a single unit on the row\'s 1 button, leaving the rest stored', () => {
    const h = opened();
    h.containers.store(oreItem(COPPER).kind);

    h.containers.take(oreItem(COPPER).kind, true);

    expect(countOres(h.state.player.inventory)).toBe(1);
    expect(countOres(h.state.cargoContainers[0].inventory)).toBe(5);
    expect(h.toasts.saw('Took 1 × Copper aboard')).toBe(true);
  });

  it('takes it back again', () => {
    const h = opened();
    h.containers.store(oreItem(COPPER).kind);

    h.containers.take(oreItem(COPPER).kind);

    expect(countOres(h.state.player.inventory)).toBe(6);
    expect(countOres(h.state.cargoContainers[0].inventory)).toBe(0);
    expect(h.toasts.saw('Took 6 × Copper aboard')).toBe(true);
  });

  it('refuses what the cargo-bay limit will not take, and keeps the rest stored', () => {
    const h = opened(0);
    h.state.player.cargoMax = 2;
    h.state.cargoContainers[0].inventory = addItem(createInventory(), oreItem(COPPER), 5)!;

    h.containers.take(oreItem(COPPER).kind);

    expect(countOres(h.state.player.inventory)).toBe(2);
    expect(countOres(h.state.cargoContainers[0].inventory)).toBe(3);

    // And the next press, with the bay already at its limit, is a plain refusal.
    h.containers.take(oreItem(COPPER).kind);

    expect(countOres(h.state.player.inventory)).toBe(2);
    expect(h.toasts.saw('Cargo bay is full at 2 items')).toBe(true);
    expect(h.audio.played).toContain('alarm');
  });

  it('refuses a stack a full crate cannot take', () => {
    const h = opened(0);
    h.state.player.inventory = addItem(h.state.player.inventory, DYNAMITE_ITEM, 2);
    // The crate is already holding its whole item capacity.
    h.state.cargoContainers[0].inventory = addItem(createInventory(), oreItem(COPPER), CARGO_CONTAINER.capacity);

    h.containers.store(DYNAMITE_ITEM.kind);

    expect(countItem(h.state.player.inventory, DYNAMITE_ITEM.kind)).toBe(2);
    expect(h.toasts.saw('Container is full')).toBe(true);
    expect(h.audio.played).toContain('alarm');
  });

  it('shuts the menu instead of filling a crate a reset already removed', () => {
    const h = opened();
    h.state.cargoContainers = [];

    h.containers.store(oreItem(COPPER).kind);

    expect(h.containers.open).toBeNull();
    expect(h.openUi.at(-1)).toBeNull();
    expect(countOres(h.state.player.inventory)).toBe(6);
  });

  it('does nothing at all with no crate open', () => {
    const h = harness();
    h.state.player.inventory = addItem(h.state.player.inventory, oreItem(COPPER), 3)!;

    h.containers.store(oreItem(COPPER).kind);
    h.containers.take(oreItem(COPPER).kind);

    expect(countOres(h.state.player.inventory)).toBe(3);
    expect(h.saveProgress).not.toHaveBeenCalled();
  });
});

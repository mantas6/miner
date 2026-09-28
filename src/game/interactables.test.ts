// What Space and C would open: the nearest fixture or stash, ties by kind order,
// and the HUD hint naming exactly what Space would open.

import { describe, expect, it } from 'vitest';
import { STATIONS, WORLD_W } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';
import { createPlacedContainer } from '../core/cargo-container';
import { createInitialState } from '../core/state';
import { createPortal } from '../core/stations';
import type { GameState } from '../core/types';
import { createWreck } from '../core/wreck';
import { chestsInRange, gravesInRange, tradingPostsInRange } from '../world/world';
import { interactHint, nearestInteractable } from './interactables';
import { nth } from '../test-narrowing';

const GRAVE = nth(gravesInRange(0, 0, WORLD_W - 1, 400), 0);
const CHEST = nth(chestsInRange(0, 0, WORLD_W - 1, 400), 0);
const POST = nth(tradingPostsInRange(3, 60, WORLD_W - 4, 4000), 0);

function shipAt(x: number, y: number): GameState {
  const state = createInitialState();
  Object.assign(state.player, {x, y});
  return state;
}

describe('nearestInteractable: Space', () => {
  it('finds nothing away from every fixture', () => {
    const state = shipAt(POST.x, POST.y + 5);
    expect(nearestInteractable(state, 'space')).toBeNull();
    expect(interactHint(null)).toBe('');
  });

  it('weighs the home stations, a manufacturer breaking a tie', () => {
    // Manufacturer and extractor stand one tile either side of the berth.
    const between = shipAt(STATIONS.manufacturer.x + 1, STATIONS.manufacturer.y);
    const target = nearestInteractable(between, 'space');
    expect(target).toMatchObject({kind: 'station', x: STATIONS.manufacturer.x, distance: 1});
    expect(interactHint(target)).toBe('Space: Manufacturing Station');

    const byExtractor = shipAt(STATIONS.extractor.x, STATIONS.extractor.y);
    expect(interactHint(nearestInteractable(byExtractor, 'space'))).toBe('Space: Fuel Extractor');

    const byPortal = shipAt(STATIONS.portal.x, STATIONS.portal.y);
    expect(interactHint(nearestInteractable(byPortal, 'space'))).toBe('Space: Portal "Home"');
  });

  it('offers a trading post in reach, and a station on the same footing beats it', () => {
    const state = shipAt(POST.x, POST.y - 1);
    const target = nearestInteractable(state, 'space');
    expect(target).toMatchObject({kind: 'post', x: POST.x, y: POST.y, distance: 1});
    expect(interactHint(target)).toBe('Space: Trading Post');

    // A portal set down on the other side, just as close: the station wins the tie.
    state.stations.push(createPortal(POST.x, POST.y - 2, 'Depot'));
    expect(nearestInteractable(state, 'space')).toMatchObject({kind: 'station', distance: 1});
    // A station in reach but diagonal (distance 2) loses to the post beside the ship.
    state.player.y = POST.y;
    state.player.x = POST.x + 1;
    state.stations.pop();
    state.stations.push(createPortal(POST.x + 2, POST.y + 1, 'Depot'));
    expect(nearestInteractable(state, 'space')).toMatchObject({kind: 'post', distance: 1});
  });

  it('reads a grave only once its tile is explored', () => {
    const state = shipAt(GRAVE.x + 1, GRAVE.y);
    expect(nearestInteractable(state, 'space')?.kind).not.toBe('grave');

    state.exploredTiles.add(explorationIndex(GRAVE.x, GRAVE.y));
    const target = nearestInteractable(state, 'space');
    expect(target).toMatchObject({kind: 'grave', x: GRAVE.x, y: GRAVE.y, distance: 1});
    expect(interactHint(target)).toBe('Space: Grave');
  });
});

describe('nearestInteractable: C', () => {
  /** A ship one tile east of the first chest, the chest's tile explored. */
  function besideChest(): GameState {
    const state = shipAt(CHEST.x + 1, CHEST.y);
    state.exploredTiles.add(explorationIndex(CHEST.x, CHEST.y));
    return state;
  }

  it('finds the chest alongside', () => {
    expect(nearestInteractable(besideChest(), 'stash')).toMatchObject({kind: 'chest', x: CHEST.x, y: CHEST.y, distance: 1});
  });

  it('prefers whatever is nearer, a crate beating a wreck beating a chest on a tie', () => {
    const state = besideChest();
    const {x, y} = state.player;

    // A wreck diagonal to the ship (distance 2) loses to the chest beside it.
    state.wrecks.push(createWreck(x + 1, y + 1));
    expect(nearestInteractable(state, 'stash')?.kind).toBe('chest');

    // A wreck beside the ship ties with the chest, and wins it.
    state.wrecks.push(createWreck(x, y + 1));
    expect(nearestInteractable(state, 'stash')).toMatchObject({kind: 'wreck', distance: 1});

    // A crate on the same footing beats both.
    state.cargoContainers.push(createPlacedContainer(x, y - 1));
    expect(nearestInteractable(state, 'stash')).toMatchObject({kind: 'container', distance: 1});

    // And the tile the ship is on beats everything beside it.
    state.wrecks.push(createWreck(x, y));
    expect(nearestInteractable(state, 'stash')).toMatchObject({kind: 'wreck', distance: 0});
  });

  it('finds nothing with no stash in reach', () => {
    const state = besideChest();
    state.player.x += 3;
    expect(nearestInteractable(state, 'stash')).toBeNull();
  });
});

// What the ship is parked beside, for the keys that act on "the nearest one".
//
// Space works the station-like fixtures — a home station (manufacturer,
// extractor, portal), a trading post, a grave; C works the stashes — a cargo
// container, a wreck, a chest. Each key opens whichever of its kinds is nearest
// by Manhattan distance, and the on-screen hint names the same thing Space would
// open, so both ask this one function rather than scanning for themselves.
//
// Ties go to the earlier kind in each list: a station over a post over a grave,
// a crate over a wreck over a chest. Every kind keeps its own reach rule (the
// `reachable*` finders); this only weighs the finalists.

import { isTileExplored } from '../../shared/exploration-codec';
import { reachableContainer } from '../core/cargo-container';
import { reachableChest } from '../core/chest';
import { reachableGrave } from '../core/grave';
import { nearestStation } from '../core/stations';
import type { GameState } from '../core/types';
import { reachableWreck } from '../core/wreck';
import { reachableTradingPost } from './trading';

/** What Space would open. */
export type SpaceTarget =
  | {kind: 'station'; x: number; y: number; distance: number; station: GameState['stations'][number]}
  | {kind: 'post'; x: number; y: number; distance: number}
  | {kind: 'grave'; x: number; y: number; distance: number};

/** What C would open. */
export type StashTarget =
  | {kind: 'container'; x: number; y: number; distance: number}
  | {kind: 'wreck'; x: number; y: number; distance: number}
  | {kind: 'chest'; x: number; y: number; distance: number};

/** Which key is asking: Space's fixtures, or C's stashes. */
export type InteractGroup = 'space' | 'stash';

export type InteractableState = Pick<
  GameState,
  'player' | 'stations' | 'exploredTiles' | 'cargoContainers' | 'wrecks' | 'chestLedger'
>;

/** The candidate nearest the ship, the first in priority order winning a tie. */
function closest<T extends {distance: number}>(candidates: readonly (T | null)[]): T | null {
  let best: T | null = null;
  for (const candidate of candidates) {
    if (candidate && (!best || candidate.distance < best.distance)) best = candidate;
  }
  return best;
}

function manhattan(a: {x: number; y: number}, b: {x: number; y: number}): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function nearestSpaceTarget(state: InteractableState): SpaceTarget | null {
  const {player} = state;
  const station = nearestStation(state.stations, player);
  const post = reachableTradingPost(player.x, player.y);
  const grave = reachableGrave(player.x, player.y, (x, y) => isTileExplored(state.exploredTiles, x, y));
  return closest<SpaceTarget>([
    station && {kind: 'station', x: station.x, y: station.y, distance: manhattan(station, player), station},
    post && {kind: 'post', x: post.post.x, y: post.post.y, distance: post.distance},
    grave && {kind: 'grave', x: grave.x, y: grave.y, distance: grave.distance}
  ]);
}

function nearestStashTarget(state: InteractableState): StashTarget | null {
  const {x, y} = state.player;
  const container = reachableContainer(state.cargoContainers, x, y);
  const wreck = reachableWreck(state.wrecks, x, y);
  const chest = reachableChest(state.chestLedger, state.exploredTiles, x, y);
  return closest<StashTarget>([
    container && {kind: 'container', x: container.x, y: container.y, distance: manhattan(container, state.player)},
    wreck && {kind: 'wreck', x: wreck.x, y: wreck.y, distance: manhattan(wreck, state.player)},
    chest && {kind: 'chest', x: chest.x, y: chest.y, distance: manhattan(chest, state.player)}
  ]);
}

/** The nearest thing Space (`'space'`) or C (`'stash'`) would open, or `null` when none is in reach. */
export function nearestInteractable(state: InteractableState, group: 'space'): SpaceTarget | null;
export function nearestInteractable(state: InteractableState, group: 'stash'): StashTarget | null;
export function nearestInteractable(state: InteractableState, group: InteractGroup): SpaceTarget | StashTarget | null {
  return group === 'space' ? nearestSpaceTarget(state) : nearestStashTarget(state);
}

/** The HUD prompt for what Space would open, e.g. `Space: Fuel Extractor`; empty when nothing is in reach. */
export function interactHint(target: SpaceTarget | null): string {
  if (!target) return '';
  switch (target.kind) {
    case 'post':
      return 'Space: Trading Post';
    case 'grave':
      return 'Space: Grave';
    case 'station':
      switch (target.station.kind) {
        case 'manufacturer': return 'Space: Manufacturing Station';
        case 'extractor': return 'Space: Fuel Extractor';
        case 'portal': return `Space: Portal "${target.station.name}"`;
      }
  }
}

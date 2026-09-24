// The portal network at runtime: opening the travel list, jumping between built
// portals, spending a carried teleporter, renaming, and the lost-ship respawn.
//
// `core/portal.ts` holds the pure rules — which portals a tile can reach, how a
// raw rename is sanitized, which portals a lost ship may redeploy at — and
// `core/teleporter.ts` the instant move and the visual jump effect. This is the
// part that touches the running game: the ship it moves, the fog it reveals, the
// charge it spends, and the save each jump schedules.
//
// The overlay is modal like the station screens, so this module holds no copy of
// anything the screen paints: it pushes a `PortalView` into the store on open,
// after a rename, and after each republish, and the screen paints what it is
// given. One overlay is ever up, in one of three modes:
//   * `travel`    — free jumps between the portal the ship is parked at and the rest;
//   * `teleporter` — jumps to portals out of reach, each spending one carried charge;
//   * `respawn`   — the no-close redeploy prompt a lost ship with two or more
//                   portals answers, whose pick rebuilds the world at that portal.

import { TILE, WORLD_W } from '../../shared/constants';
import { removeItem } from '../core/inventory';
import { currentDepthMeters } from '../core/objective';
import {
  portalDestinations,
  respawnPortals,
  sanitizePortalName,
  type PortalDestination
} from '../core/portal';
import type { PortalStation } from '../core/stations';
import { TELEPORTER_ITEM, createTeleportEffect, movePlayerTo } from '../core/teleporter';
import type { AudioController, GameState } from '../core/types';
import type { PortalView } from '../ui/store';
import { viewport } from './viewport';

/** The overlay's mode, or `null` when no portal overlay is open. */
export type PortalMode = 'travel' | 'teleporter' | 'respawn';

export interface PortalsSim {
  /** Which mode the portal overlay is in, or `null` when none is up. */
  readonly mode: PortalMode | null;
  /** Open the free travel list for the portal the ship is parked at. */
  openTravel(portal: PortalStation): boolean;
  /** Open the teleporter list: the portals out of reach a carried charge can reach. */
  openTeleporter(): boolean;
  /** Open the no-close respawn prompt; `onPick` receives the chosen tile. */
  openRespawn(onPick: (at: {x: number; y: number}) => void): void;
  /** Shut the portal overlay. Ignored in respawn mode, which has no close. */
  close(): void;
  /** Rename the source portal (travel mode only), sanitizing and persisting. */
  rename(name: string): void;
  /** Travel to a listed destination; refuses coordinates not on the current list. */
  travelTo(x: number, y: number): boolean;
  /** One fixed 60 Hz step: close if the source portal was lifted (never in respawn). */
  tick(): void;
}

export interface PortalsDeps {
  state: GameState;
  audio: AudioController;
  toast(message: string): void;
  saveProgress(): void;
  /** Publish the portal overlay's contents, or take it away with `null`. */
  setPortalUi(view: PortalView | null): void;
  /** Reveal the fog footprint around the ship after a jump. */
  revealAtPlayer(): void;
}

export function createPortalsSim(deps: PortalsDeps): PortalsSim {
  const {state, audio, toast, saveProgress} = deps;
  let mode: PortalMode | null = null;
  /** The portal the travel list hangs off, so a tick can spot it being lifted. */
  let source: PortalStation | null = null;
  let destinations: PortalDestination[] = [];
  /** The respawn callback, invoked with the chosen tile before the overlay closes. */
  let onRespawn: ((at: {x: number; y: number}) => void) | null = null;

  /** Forget the open overlay's state, without touching the store. */
  function reset(): void {
    mode = null;
    source = null;
    destinations = [];
    onRespawn = null;
  }

  /** Push the current mode/source/destinations into the store. */
  function publish(): void {
    if (!mode) return;
    deps.setPortalUi({
      mode,
      source: source ? {x: source.x, y: source.y, name: source.name} : undefined,
      destinations: destinations.map(destination => ({...destination}))
    });
  }

  function openTravel(portal: PortalStation): boolean {
    if (state.gameOver) return false;
    mode = 'travel';
    source = portal;
    onRespawn = null;
    destinations = portalDestinations(state.stations, {x: portal.x, y: portal.y});
    publish();
    return true;
  }

  function openTeleporter(): boolean {
    if (state.gameOver) return false;
    mode = 'teleporter';
    source = null;
    onRespawn = null;
    destinations = portalDestinations(
      state.stations,
      {x: state.player.x, y: state.player.y},
      {excludeReachable: true}
    );
    publish();
    return true;
  }

  function openRespawn(onPick: (at: {x: number; y: number}) => void): void {
    mode = 'respawn';
    source = null;
    onRespawn = onPick;
    // Distance is measured from the death tile the ship sits on when the prompt
    // opens (restartGame drops the wreck here before rebuilding the world).
    const from = {x: state.player.x, y: state.player.y};
    destinations = respawnPortals(state.stations)
      .map(portal => ({
        x: portal.x,
        y: portal.y,
        name: portal.name,
        depthMeters: currentDepthMeters(portal.y),
        distance: Math.abs(portal.x - from.x) + Math.abs(portal.y - from.y)
      }))
      .sort((a, b) => a.distance - b.distance);
    publish();
  }

  function close(): void {
    if (!mode) return;
    // The respawn prompt has no close button: a lost ship must choose where to go.
    if (mode === 'respawn') return;
    reset();
    deps.setPortalUi(null);
  }

  function rename(name: string): void {
    if (mode !== 'travel' || !source) return;
    // An empty or all-whitespace entry keeps the current name rather than blanking it.
    source.name = sanitizePortalName(name, source.name);
    saveProgress();
    // The list is the *other* portals, so it is unchanged; republish for the name.
    publish();
    toast(`Portal renamed "${source.name}".`);
  }

  /** Snap the ship onto a tile with the jump effect, fog reveal, and a save. */
  function jumpTo(x: number, y: number): void {
    const p = state.player;
    const camX = Math.max(0, Math.min(WORLD_W - viewport.tilesX, state.camX));
    const camY = Math.max(0, state.camY);
    const originScreenX = (p.drawX - camX + .5) * TILE;
    const originScreenY = (p.drawY - camY + .5) * TILE;
    movePlayerTo(p, x, y);
    state.teleportEffect = createTeleportEffect(originScreenX, originScreenY, p.x, p.y, state.reducedMotion);
    state.input.keyImpulse = null;
    state.camX = Math.max(0, p.x - Math.floor(viewport.tilesX / 2));
    state.camY = Math.max(0, p.y - Math.floor(viewport.tilesY / 2));
    deps.revealAtPlayer();
    saveProgress();
  }

  function travelTo(x: number, y: number): boolean {
    if (!mode) return false;
    const target = destinations.find(destination => destination.x === x && destination.y === y);
    if (!target) return false;
    if (mode === 'respawn') {
      // The callback rebuilds the world and redeploys the ship at the chosen tile,
      // so the jump effect is not run here — the respawn places the ship itself.
      const pick = onRespawn;
      reset();
      deps.setPortalUi(null);
      pick?.({x: target.x, y: target.y});
      return true;
    }
    if (mode === 'teleporter') {
      state.player.inventory = removeItem(state.player.inventory, TELEPORTER_ITEM.kind);
    }
    jumpTo(target.x, target.y);
    audio.blip(500, .08, 'triangle', .045, 40);
    close();
    toast(`Travelled to "${target.name}".`);
    return true;
  }

  function tick(): void {
    if (!mode) return;
    // The respawn prompt never auto-closes, even though a death has set gameOver.
    if (mode === 'respawn') return;
    if (state.gameOver) { close(); return; }
    // The Construction Toolkit can lift the source portal out from under the list.
    if (source && !state.stations.includes(source)) close();
  }

  return {
    get mode() {
      return mode;
    },
    openTravel,
    openTeleporter,
    openRespawn,
    close,
    rename,
    travelTo,
    tick
  };
}

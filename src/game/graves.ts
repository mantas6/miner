// Graves: reading the stone of a miner who never made it back.
//
// `core/grave.ts` holds the rules (who lies where, and how far a stone reads from);
// `world.ts` places them. This is the part that touches the running game — the
// grave the UI is showing and the bell it tolls. A grave is a fixture like a
// trading post: an unarmed press on it, or Space beside it, raises a modal with its
// epitaph, and nothing about it is ever consumed or saved.

import { isTileExplored } from '../../shared/exploration-codec';
import { epitaphFor, isGraveReachable, reachableGrave, type Epitaph } from '../core/grave';
import type { AudioController, GameState } from '../core/types';
import { graveAt, type Grave } from '../world/world';

export interface GraveSim {
  /** The grave whose stone is up, or `null`. */
  readonly open: Grave | null;
  /**
   * An unarmed press on the mine. Shows the grave on that tile when the ship is
   * close enough, and reports whether it did — a press on bare rock is not a
   * refusal, it is simply not about a grave.
   */
  openAt(x: number, y: number): boolean;
  /** Space: show the grave under or beside the ship, or put the open one away. */
  openNearest(): boolean;
  /** The grave Space would show, with its Manhattan distance, or `null`. */
  nearest(): (Grave & {distance: number}) | null;
  /** Put the stone away. Idempotent; also what the dialog's own close reports. */
  close(): void;
  /** One fixed 60 Hz step: only a lost ship to tidy up after. */
  tick(): void;
}

export interface GraveDeps {
  state: GameState;
  audio: AudioController;
  toast(message: string): void;
  /** Show this epitaph, or take the stone away with `null`. The bell is this module's. */
  setGraveUi(epitaph: Epitaph | null): void;
}

export function createGraves(deps: GraveDeps): GraveSim {
  const {state, audio, toast} = deps;
  let open: Grave | null = null;

  function explored(x: number, y: number): boolean {
    return isTileExplored(state.exploredTiles, x, y);
  }

  function show(grave: Grave): boolean {
    if (open && open.x === grave.x && open.y === grave.y) return true;
    open = grave;
    audio.grave();
    deps.setGraveUi(epitaphFor(grave.x, grave.y));
    return true;
  }

  function close(): void {
    if (!open) return;
    open = null;
    deps.setGraveUi(null);
  }

  function openAt(x: number, y: number): boolean {
    if (state.gameOver) return false;
    const grave = graveAt(x, y);
    // A grave under fog is not one the player can see, so a press on it is not about one.
    if (!grave || !explored(x, y)) return false;
    if (!isGraveReachable(grave, state.player.x, state.player.y)) {
      toast('Too far from the grave. Fly alongside it first.');
      return false;
    }
    return show(grave);
  }

  function nearest(): (Grave & {distance: number}) | null {
    return reachableGrave(state.player.x, state.player.y, explored);
  }

  function openNearest(): boolean {
    if (state.gameOver) return false;
    if (open) { close(); return true; }
    const grave = nearest();
    if (!grave) {
      toast('No grave within reach.');
      return false;
    }
    return show({x: grave.x, y: grave.y});
  }

  function tick(): void {
    if (state.gameOver) { close(); return; }
    // The reach it took to read the stone is what keeps it up.
    if (open && !isGraveReachable(open, state.player.x, state.player.y)) close();
  }

  return {
    get open() {
      return open;
    },
    openAt,
    openNearest,
    nearest,
    close,
    tick
  };
}

// The overlay session: raising and dropping the one modal screen over the mine.
//
// Every screen goes up and comes down through here, so the rules hold for all of
// them at once: the open cue plays only on the transition (a repaint of a screen
// already up republishes through the same call and stays silent), a key held as a
// screen rose never drives the ship once it is put away, the close cue plays only
// if the screen was actually up (the `<dialog>` echoes every close back as a
// second request), and a screen that covers the mine stands an armed placement
// down first — its pointer has nothing left to aim at.
//
// The feature modules never see the store: each is handed a `publisher()` — one
// "show these contents, or take the screen away with `null`" callback — built
// here for its screen.

import type { AudioController } from '../core/types';
import { uiStore, type Overlay, type OverlayId, type OverlayOf } from '../ui/store';

export interface OverlaySessionDeps {
  audio: AudioController;
  /** Forget held keys, so one held as a screen rose cannot drive the ship once it is gone. */
  clearKeys(): void;
  /** A lost ship's explosion already covers the screens it tears down, so they close silently. */
  isGameOver(): boolean;
  /** Stand down whatever deployable is waiting for a press on the mine. */
  disarmPlacements(): void;
}

export interface PublisherOptions {
  /** Play the open cue. False for a screen whose module plays its own (a chest's lid, a grave's bell). */
  cue?: boolean;
  /** Stand any armed placement down before covering the mine. */
  standDown?: boolean;
}

/** Show a screen with these contents, or take it away with `null` (`quiet` skipping the close cue). */
export type OverlayPublisher<P> = (payload: P | null, quiet?: boolean) => void;

export interface OverlaySession {
  /** The screen up right now, or `null`. */
  active(): OverlayId | null;
  /** Raise a screen (or repaint the one up). `cue` false skips the open sound. */
  raise(overlay: Overlay, cue?: boolean): void;
  /** Take a screen down if it is the one up. `quiet` skips the close sound. */
  drop(kind: OverlayId, quiet?: boolean): void;
  /** The show-or-drop callback one feature module drives its screen through. */
  publisher<K extends OverlayId, P>(kind: K, build: (payload: P) => OverlayOf<K>, options?: PublisherOptions): OverlayPublisher<P>;
  /**
   * Take down every screen whose buttons dispatch into this runtime's state — the
   * transfer menus, the stations, the post, the portal list, the stone — as the
   * runtime is torn down: every button in them would reach a table of no-ops.
   */
  closeRuntimeScreens(): void;
}

/** Screens that stay coherent with no runtime behind them: they only read the store. */
const SURVIVES_TEARDOWN: ReadonlySet<OverlayId> = new Set(['info', 'ship']);

export function createOverlaySession(deps: OverlaySessionDeps): OverlaySession {
  function active(): OverlayId | null {
    return uiStore.getState().overlay?.kind ?? null;
  }

  function raise(overlay: Overlay, cue = true): void {
    if (active() !== overlay.kind && cue) deps.audio.open();
    deps.clearKeys();
    uiStore.getState().showOverlay(overlay);
  }

  function drop(kind: OverlayId, quiet = false): void {
    if (active() === kind && !quiet && !deps.isGameOver()) deps.audio.close();
    uiStore.getState().closeOverlay(kind);
  }

  return {
    active,
    raise,
    drop,
    publisher(kind, build, options = {}) {
      const {cue = true, standDown = false} = options;
      return (payload, quiet = false) => {
        if (payload === null) return drop(kind, quiet);
        if (standDown) deps.disarmPlacements();
        raise(build(payload), cue);
      };
    },
    closeRuntimeScreens() {
      const kind = active();
      if (kind && !SURVIVES_TEARDOWN.has(kind)) uiStore.getState().closeOverlay(kind);
    }
  };
}

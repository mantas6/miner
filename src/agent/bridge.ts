// The one-way door from a programmatic-play harness back into the running game.
//
// Mirrors `src/ui/commands.ts`: the game registers a flat table of hooks while it
// boots, and a harness (the Playwright session, driven by the MCP server) reaches
// the game through this singleton — imported by module URL through the Vite dev
// server, the same seam the e2e tests already use. Every method is a safe default
// until a runtime registers and again after teardown, so importing the bridge
// without a live game — in tests, between a StrictMode double-mount, after a crash
// — is harmless.
//
// The bridge owns one piece of state the observation cannot: the toast ring
// buffer. Toasts flash and vanish, so a snapshot taken between two of them would
// miss both; the bridge subscribes to the store and keeps the last few, each
// tagged with the tick it appeared on, and feeds them into every observation.

import { uiStore } from '../ui/store';
import { appendToast, buildObservation, type AgentObservation, type AgentToast } from './observation';
import type { GameState, Tile } from '../core/types';
import type { UiState } from '../ui/store';

/** Canvas client coordinates, suitable for a real Playwright mouse click. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * What a running game hands the bridge: the accessors the observation is built
 * from, and the three live controls the harness drives (pause, its readback, and
 * the tile→screen projection for canvas clicks).
 */
export interface AgentRuntimeHooks {
  getState(): GameState;
  getUi(): UiState;
  getTile(x: number, y: number): Tile;
  setPaused(paused: boolean): void;
  isPaused(): boolean;
  screenPointForTile(x: number, y: number): ScreenPoint | null;
}

export interface AgentBridge {
  /** The full observation, or `null` when no game is running. */
  observe(radius?: number): AgentObservation | null;
  /** Freeze or resume the simulation between decisions. */
  setPaused(paused: boolean): void;
  isPaused(): boolean;
  /** Canvas coordinates of a tile's centre, or `null` when off-screen or no game. */
  screenPointForTile(x: number, y: number): ScreenPoint | null;
}

let runtime: AgentRuntimeHooks | null = null;
let toastRing: AgentToast[] = [];
let lastToastId = 0;

// Watch the store for new toasts and keep the last few, each stamped with the tick
// the game was on when it fired. A dismissed toast empties the queue, which is not
// a new line, so only a fresh id is recorded.
uiStore.subscribe(state => {
  const latest = state.toasts.at(-1);
  if (!latest || latest.id === lastToastId) return;
  lastToastId = latest.id;
  toastRing = appendToast(toastRing, {tick: runtime ? runtime.getState().tick : 0, message: latest.message});
});

/** The live bridge. Its methods are safe defaults until a runtime registers. */
export const agentBridge: AgentBridge = {
  observe(radius) {
    if (!runtime) return null;
    return buildObservation({
      state: runtime.getState(),
      ui: runtime.getUi(),
      get: runtime.getTile,
      radius,
      toasts: toastRing
    });
  },
  setPaused(paused) {
    runtime?.setPaused(paused);
  },
  isPaused() {
    return runtime?.isPaused() ?? false;
  },
  screenPointForTile(x, y) {
    return runtime?.screenPointForTile(x, y) ?? null;
  }
};

/** Wire the bridge to a running game (the runtime calls this in `boot()`). */
export function setAgentBridge(hooks: AgentRuntimeHooks): void {
  runtime = hooks;
}

/**
 * Point the bridge back at its safe defaults (runtime teardown), and drop the
 * toast ring so a replacement runtime does not inherit the dead one's lines.
 */
export function resetAgentBridge(): void {
  runtime = null;
  toastRing = [];
  lastToastId = 0;
}

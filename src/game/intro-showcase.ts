// The title screen's backdrop: a slice of the mine painted behind the intro card.
//
// It is a second renderer on the same canvas, reading a world of its own. The
// terrain is regenerated from the coordinate seed exactly like the real mine, but
// into a private grid — never the game's world or its tile diff — so the splash
// shows untouched rock and ore without a fog layer, a ship, or anything the run
// has changed. The runtime draws it instead of the game renderer while the UI
// phase is `intro` and drops it once the run starts.

import { MAX_WORLD_ROW, START_Y, WORLD_W } from '../../shared/constants';
import { createRenderer, type RendererState } from '../render/renderer';
import { ensureWorldRow, makeTile, rand } from '../world/world';
import type { Tile } from '../core/types';
import { viewport } from './viewport';

/** Shallowest and deepest rows the showcase camera may start on. */
export const SHOWCASE_MIN_ROW = START_Y + 30;
export const SHOWCASE_MAX_ROW = START_Y + 700;
/** Downward drift of the camera, in tiles per second. */
export const SHOWCASE_DRIFT_TILES_PER_SECOND = 0.35;
/**
 * The longest frame gap the drift honours. A hidden tab stops animation frames,
 * and the camera should resume gliding rather than jump the whole absence.
 */
const MAX_FRAME_GAP_MS = 100;

/**
 * Pick the showcase camera: a random row between `SHOWCASE_MIN_ROW` and
 * `SHOWCASE_MAX_ROW`, and a random column that keeps `tilesX` columns inside the
 * world. Pure, so a fixed `random` always frames the same slice.
 */
export function pickShowcaseCamera(random: () => number, tilesX: number): {camX: number; camY: number} {
  const pick = (min: number, max: number) => min + Math.min(max - min, Math.floor(random() * (max - min + 1)));
  const maxX = Math.max(0, WORLD_W - tilesX);
  return {
    camX: pick(0, maxX),
    camY: pick(SHOWCASE_MIN_ROW, SHOWCASE_MAX_ROW)
  };
}

export interface IntroShowcaseDeps {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Hold the camera still instead of drifting it. */
  reducedMotion?: boolean;
  /** Source of the camera pick; defaults to `Math.random`. */
  random?: () => number;
}

export interface IntroShowcase {
  /** Paint one frame at the animation-frame timestamp `now` (milliseconds). */
  draw(now: number): void;
  /** The state the showcase renderer reads; exposed for tests. */
  readonly state: Readonly<RendererState>;
}

/** Out-of-world reads answer with indestructible rock, as the game grid does. */
function outOfBoundsTile(): Tile {
  return {type: 'rock', hp: 999};
}

export function createIntroShowcase({canvas, ctx, reducedMotion = false, random = Math.random}: IntroShowcaseDeps): IntroShowcase {
  const world: Tile[][] = [];
  const {camX, camY} = pickShowcaseCamera(random, viewport.tilesX);
  const state: RendererState = {
    world,
    camX,
    camY,
    tick: 0,
    gameOver: false,
    particles: [],
    enemies: [],
    // Never drawn (`hideShip`), but the renderer's state shape requires one.
    player: {x: camX, y: camY, drawX: camX, drawY: camY, facing: 1, bob: 0, drillAnim: 0, drillDx: 0, drillDy: 0},
    reducedMotion,
    hideShip: true
  };
  const renderer = createRenderer({
    state,
    canvas,
    ctx,
    get: (x, y) => {
      if (x < 0 || x >= WORLD_W) return outOfBoundsTile();
      return ensureWorldRow(world, y, makeTile)?.[x] ?? outOfBoundsTile();
    },
    rand
  });
  let lastFrame: number | null = null;

  return {
    state,
    draw(now) {
      if (!reducedMotion && lastFrame !== null) {
        const elapsed = Math.max(0, Math.min(MAX_FRAME_GAP_MS, now - lastFrame));
        const deepest = MAX_WORLD_ROW - viewport.tilesY - 1;
        state.camY = Math.min(deepest, state.camY + SHOWCASE_DRIFT_TILES_PER_SECOND * elapsed / 1000);
      }
      lastFrame = now;
      state.tick++;
      renderer.draw();
    }
  };
}

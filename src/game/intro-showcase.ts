// The title screen's backdrop: a slice of the mine painted behind the intro card.
//
// It is the game's own machinery pointed at a fresh run: a real initial
// `GameState` whose world is read through the same grid facade the game uses,
// drawn by the game's renderer. Nothing about what the splash can show is
// hand-picked, so anything the renderer draws from a game state appears here
// too. The only differences are presentational — no fog and no ship — and live on
// a view object, never on the state itself. The terrain is regenerated from the
// coordinate seed with no tile diff applied, so the splash shows the untouched
// mine. The runtime draws it instead of the game renderer while the UI phase is
// `intro` and drops it once the run starts.

import { MAX_WORLD_ROW, START_Y, WORLD_W } from '../../shared/constants';
import { createInitialState } from '../core/state';
import type { GameState } from '../core/types';
import { createRenderer, type RendererState } from '../render/renderer';
import { nearestMinePortrait, rand } from '../world/world';
import { viewport } from './viewport';
import { createWorldGrid } from './world-grid';

/** Shallowest and deepest rows the showcase camera may start on. */
export const SHOWCASE_MIN_ROW = START_Y + 30;
export const SHOWCASE_MAX_ROW = START_Y + 700;
/** Downward drift of the camera, in tiles per second. */
export const SHOWCASE_DRIFT_TILES_PER_SECOND = 0.35;
/** How many 16-tile chunk rings out from the random pick to look for a portrait. */
export const SHOWCASE_PORTRAIT_SEARCH_CHUNKS = 4;
/**
 * The longest frame gap the drift honours. A hidden tab stops animation frames,
 * and the camera should resume gliding rather than jump the whole absence.
 */
const MAX_FRAME_GAP_MS = 100;

interface ShowcaseCamera {
  camX: number;
  camY: number;
}

/**
 * Pick the showcase camera: a random row between `SHOWCASE_MIN_ROW` and
 * `SHOWCASE_MAX_ROW`, and a random column that keeps `tilesX` columns inside the
 * world. Pure, so a fixed `random` always frames the same slice.
 */
export function pickShowcaseCamera(random: () => number, tilesX: number): ShowcaseCamera {
  const pick = (min: number, max: number) => min + Math.min(max - min, Math.floor(random() * (max - min + 1)));
  const maxX = Math.max(0, WORLD_W - tilesX);
  return {
    camX: pick(0, maxX),
    camY: pick(SHOWCASE_MIN_ROW, SHOWCASE_MAX_ROW)
  };
}

/**
 * The row the framed portrait lands on, as a fraction of the view's height. The
 * title card covers the middle of the screen, so the portrait is hung in the
 * band above it — and the downward drift then carries it up and out of view,
 * rather than behind the card.
 */
export const SHOWCASE_PORTRAIT_ROW_FRACTION = 0.2;

/**
 * Re-frame the camera `pick` on `portrait`: the portrait's tile lands on the
 * view's centre column (`floor(tilesX / 2)`) and a fifth of the way down
 * (`SHOWCASE_PORTRAIT_ROW_FRACTION`), clear of the card, with the column clamped
 * so the view stays inside the world's width and the row kept at `y ≥ 0`. Without
 * a portrait the pick stands. Pure, so the framing is testable without generating
 * any terrain.
 */
export function frameShowcaseCamera(
  pick: ShowcaseCamera,
  portrait: {x: number; y: number} | null,
  tilesX: number,
  tilesY: number
): ShowcaseCamera {
  if (!portrait) return pick;
  const maxX = Math.max(0, WORLD_W - tilesX);
  return {
    camX: Math.max(0, Math.min(maxX, portrait.x - Math.floor(tilesX / 2))),
    camY: Math.max(0, portrait.y - Math.floor(tilesY * SHOWCASE_PORTRAIT_ROW_FRACTION))
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
  /** The fresh game state behind the showcase; exposed for tests. */
  readonly state: Readonly<GameState>;
  /** What the renderer actually reads (the state plus the intro's overrides); exposed for tests. */
  readonly view: Readonly<RendererState>;
}

export function createIntroShowcase({canvas, ctx, reducedMotion = false, random = Math.random}: IntroShowcaseDeps): IntroShowcase {
  const state = createInitialState();
  state.reducedMotion = reducedMotion;
  // A fresh solo world with no save: rows generate from the seed on first read,
  // and nothing ever writes a tile, so the render-cache and diff hooks are no-ops.
  const grid = createWorldGrid({state, invalidateTerrain: () => {}, onTileSet: () => {}});
  const {tilesX, tilesY} = viewport;
  const pick = pickShowcaseCamera(random, tilesX);
  const portrait = nearestMinePortrait(pick.camX + Math.floor(tilesX / 2), pick.camY + Math.floor(tilesY / 2), SHOWCASE_PORTRAIT_SEARCH_CHUNKS);
  const {camX, camY} = frameShowcaseCamera(pick, portrait, tilesX, tilesY);
  // The renderer reads a shallow copy of the whole state with the intro's two
  // presentation overrides: `exploredTiles` absent means "everything visible"
  // (no fog) without emptying or replacing the real state's Set, and `hideShip`
  // skips the parked ship. Every other field — the world grid, stations,
  // containers, wrecks and whatever the game draws next — is shared by reference.
  // The camera and tick are per-view scalars, so the drift mutates the view.
  const view: RendererState = {...state, exploredTiles: undefined, hideShip: true, camX, camY};
  const renderer = createRenderer({
    state: view,
    canvas,
    ctx,
    get: (x, y) => grid.get(x, y),
    rand
  });
  let lastFrame: number | null = null;

  return {
    state,
    view,
    draw(now) {
      if (!reducedMotion && lastFrame !== null) {
        const elapsed = Math.max(0, Math.min(MAX_FRAME_GAP_MS, now - lastFrame));
        const deepest = MAX_WORLD_ROW - viewport.tilesY - 1;
        view.camY = Math.min(deepest, view.camY + SHOWCASE_DRIFT_TILES_PER_SECOND * elapsed / 1000);
      }
      lastFrame = now;
      view.tick++;
      renderer.draw();
    }
  };
}

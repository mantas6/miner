import { beforeEach, describe, expect, it, vi } from 'vitest';
import { START_Y, WORLD_W } from '../../shared/constants';

// The same canvas stubbing as `renderer.test.ts`: there is no raster under
// vitest, so every drawing call lands on a spy.
const mocks = vi.hoisted(() => {
  const gradient = {addColorStop: vi.fn()};
  const createContext = () => ({
    arc: vi.fn(),
    arcTo: vi.fn(),
    beginPath: vi.fn(),
    bezierCurveTo: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    createRadialGradient: vi.fn(() => gradient),
    drawImage: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    shadowColor: '',
    shadowBlur: 0,
    globalAlpha: 1,
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    strokeText: vi.fn(),
    translate: vi.fn()
  });

  return {
    // The portrait search, answered per test so framing is checked without
    // depending on where generation happens to hang one.
    nearestMinePortrait: vi.fn((_x: number, _y: number, _maxChunks: number): {x: number; y: number} | null => null),
    mainContext: createContext(),
    chunkContext: createContext(),
    canvas: {width: 1920, height: 1280},
    viewport: {
      widthPx: 960, heightPx: 640,
      zoom: 1, targetZoom: 1,
      worldWidthPx: 960, worldHeightPx: 640,
      tilesX: 15, tilesY: 10
    }
  };
});

vi.mock('./viewport', () => ({
  viewport: mocks.viewport
}));

vi.mock('../world/world', async importOriginal => ({
  ...await importOriginal<typeof import('../world/world')>(),
  nearestMinePortrait: mocks.nearestMinePortrait
}));

import {
  createIntroShowcase,
  frameShowcaseCamera,
  pickShowcaseCamera,
  SHOWCASE_MAX_ROW,
  SHOWCASE_MIN_ROW,
  SHOWCASE_PORTRAIT_SEARCH_CHUNKS
} from './intro-showcase';

function showcase(options: {reducedMotion?: boolean; random?: () => number} = {}) {
  return createIntroShowcase({
    canvas: mocks.canvas as unknown as HTMLCanvasElement,
    ctx: mocks.mainContext as unknown as CanvasRenderingContext2D,
    ...options
  });
}

describe('pickShowcaseCamera', () => {
  it('spans the configured rows and keeps a full viewport of columns in the world', () => {
    expect(SHOWCASE_MIN_ROW).toBe(START_Y + 30);
    expect(SHOWCASE_MAX_ROW).toBe(START_Y + 700);
    expect(pickShowcaseCamera(() => 0, 15)).toEqual({camX: 0, camY: SHOWCASE_MIN_ROW});
    // Just under 1 is the far end of both ranges, never one past it.
    expect(pickShowcaseCamera(() => 0.999999, 15)).toEqual({camX: WORLD_W - 15, camY: SHOWCASE_MAX_ROW});
    // A viewport wider than the world pins the column to the left wall.
    expect(pickShowcaseCamera(() => 0.5, WORLD_W + 10).camX).toBe(0);
  });

  it('answers with whole tiles inside the ranges, the same for the same random', () => {
    for (let i = 0; i < 200; i++) {
      const {camX, camY} = pickShowcaseCamera(Math.random, 15);
      expect(Number.isInteger(camX) && Number.isInteger(camY)).toBe(true);
      expect(camX).toBeGreaterThanOrEqual(0);
      expect(camX).toBeLessThanOrEqual(WORLD_W - 15);
      expect(camY).toBeGreaterThanOrEqual(SHOWCASE_MIN_ROW);
      expect(camY).toBeLessThanOrEqual(SHOWCASE_MAX_ROW);
    }
    const sequence = () => { const values = [0.25, 0.75]; let i = 0; return () => values[i++ % values.length]; };
    expect(pickShowcaseCamera(sequence(), 15)).toEqual(pickShowcaseCamera(sequence(), 15));
  });
});

describe('frameShowcaseCamera', () => {
  const pick = {camX: 3, camY: SHOWCASE_MIN_ROW};
  const inView = (cam: {camX: number; camY: number}, p: {x: number; y: number}, tilesX: number, tilesY: number) =>
    p.x >= cam.camX && p.x < cam.camX + tilesX && p.y >= cam.camY && p.y < cam.camY + tilesY;

  it('keeps the random pick when no portrait is near', () => {
    expect(frameShowcaseCamera(pick, null, 15, 10)).toBe(pick);
  });

  it('hangs a portrait on the centre column, in the band above the title card', () => {
    const portrait = {x: Math.floor(WORLD_W / 2), y: SHOWCASE_MIN_ROW + 40};
    const framed = frameShowcaseCamera(pick, portrait, 15, 10);
    expect(framed).toEqual({camX: portrait.x - 7, camY: portrait.y - 2});
    expect(inView(framed, portrait, 15, 10)).toBe(true);
    // An even extent puts it on the right of the two middle columns; the row is a
    // fifth of the way down, rounded down.
    expect(frameShowcaseCamera(pick, portrait, 16, 22)).toEqual({camX: portrait.x - 8, camY: portrait.y - 4});
  });

  it('clamps at the left and right world walls and at the top of the world', () => {
    const left = {x: 1, y: 200};
    const right = {x: WORLD_W - 2, y: 200};
    const top = {x: 20, y: 2};
    expect(frameShowcaseCamera(pick, left, 15, 10).camX).toBe(0);
    expect(frameShowcaseCamera(pick, right, 15, 10).camX).toBe(WORLD_W - 15);
    expect(frameShowcaseCamera(pick, top, 15, 10).camY).toBe(0);
    for (const portrait of [left, right, top]) {
      expect(inView(frameShowcaseCamera(pick, portrait, 15, 10), portrait, 15, 10)).toBe(true);
    }
    // A view wider than the world pins to the left wall.
    expect(frameShowcaseCamera(pick, right, WORLD_W + 10, 10).camX).toBe(0);
  });
});

describe('createIntroShowcase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.nearestMinePortrait.mockImplementation(() => null);
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({width: 0, height: 0, getContext: vi.fn(() => mocks.chunkContext)}))
    });
  });

  it('is a real fresh game state, its world generated only as it is drawn', () => {
    const intro = showcase({random: () => 0.5});
    expect(intro.state.stations?.length).toBeGreaterThan(0);
    expect(intro.state.world).toHaveLength(0);
    expect(intro.state.soloTileDiff.size).toBe(0);
    // The renderer reads the whole state: the same world, stations and containers.
    expect(intro.view.world).toBe(intro.state.world);
    expect(intro.view.stations).toBe(intro.state.stations);
    expect(intro.view.cargoContainers).toBe(intro.state.cargoContainers);
    intro.draw(1000);
    expect(intro.state.world.length).toBeGreaterThan(SHOWCASE_MIN_ROW);
    expect(intro.state.soloTileDiff.size).toBe(0);
  });

  it('paints a fog-free, ship-free slice of the mine', () => {
    const intro = showcase({random: () => 0.5});
    expect(() => intro.draw(1000)).not.toThrow();
    expect(mocks.mainContext.fillRect).toHaveBeenCalled();
    // Terrain chunks were built and blitted from the generated world.
    expect(mocks.chunkContext.fillRect).toHaveBeenCalled();
    expect(mocks.mainContext.drawImage).toHaveBeenCalled();
    expect(intro.view.exploredTiles).toBeUndefined();
    expect(intro.view.hideShip).toBe(true);
    // The overrides live on the view; the state keeps its real fog Set.
    expect(intro.state.exploredTiles).toBeInstanceOf(Set);
    expect('hideShip' in intro.state).toBe(false);
    expect(intro.view.tick).toBe(1);
  });

  it('searches near the random pick and frames the portrait it finds', () => {
    const portrait = {x: 30, y: SHOWCASE_MIN_ROW + 90};
    mocks.nearestMinePortrait.mockImplementation(() => portrait);
    const intro = showcase({random: () => 0});
    expect(mocks.nearestMinePortrait).toHaveBeenCalledWith(7, SHOWCASE_MIN_ROW + 5, SHOWCASE_PORTRAIT_SEARCH_CHUNKS);
    expect(SHOWCASE_PORTRAIT_SEARCH_CHUNKS).toBe(4);
    expect({camX: intro.view.camX, camY: intro.view.camY}).toEqual({camX: 23, camY: portrait.y - 2});
  });

  it('drifts the camera down by elapsed time', () => {
    const intro = showcase({random: () => 0});
    intro.draw(1000);
    expect(intro.view.camY).toBe(SHOWCASE_MIN_ROW);
    intro.draw(1100);
    intro.draw(1200);
    // 0.35 tiles per second over 0.2 s, whatever the frame rate.
    expect(intro.view.camY).toBeCloseTo(SHOWCASE_MIN_ROW + 0.07, 6);
    expect(intro.view.camX).toBe(0);
    expect(intro.view.tick).toBe(3);
    // A long gap (a hidden tab) glides on instead of jumping.
    intro.draw(60_000);
    expect(intro.view.camY).toBeCloseTo(SHOWCASE_MIN_ROW + 0.105, 6);
  });

  it('holds the camera still under reduced motion', () => {
    const intro = showcase({random: () => 0, reducedMotion: true});
    intro.draw(1000);
    intro.draw(2000);
    intro.draw(3000);
    expect(intro.view.camY).toBe(SHOWCASE_MIN_ROW);
    expect(intro.view.tick).toBe(3);
    expect(intro.view.reducedMotion).toBe(true);
  });
});

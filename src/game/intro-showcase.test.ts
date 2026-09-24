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

import { createIntroShowcase, pickShowcaseCamera, SHOWCASE_MAX_ROW, SHOWCASE_MIN_ROW } from './intro-showcase';

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

describe('createIntroShowcase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({width: 0, height: 0, getContext: vi.fn(() => mocks.chunkContext)}))
    });
  });

  it('paints a fog-free, ship-free slice of its own mine', () => {
    const intro = showcase({random: () => 0.5});
    expect(() => intro.draw(1000)).not.toThrow();
    expect(mocks.mainContext.fillRect).toHaveBeenCalled();
    // Terrain chunks were built and blitted from the private world it generated.
    expect(mocks.chunkContext.fillRect).toHaveBeenCalled();
    expect(mocks.mainContext.drawImage).toHaveBeenCalled();
    expect(intro.state.world.length).toBeGreaterThan(SHOWCASE_MIN_ROW);
    expect(intro.state.exploredTiles).toBeUndefined();
    expect(intro.state.hideShip).toBe(true);
    expect(intro.state.tick).toBe(1);
  });

  it('drifts the camera down by elapsed time', () => {
    const intro = showcase({random: () => 0});
    intro.draw(1000);
    expect(intro.state.camY).toBe(SHOWCASE_MIN_ROW);
    intro.draw(1100);
    intro.draw(1200);
    // 0.35 tiles per second over 0.2 s, whatever the frame rate.
    expect(intro.state.camY).toBeCloseTo(SHOWCASE_MIN_ROW + 0.07, 6);
    expect(intro.state.camX).toBe(0);
    expect(intro.state.tick).toBe(3);
    // A long gap (a hidden tab) glides on instead of jumping.
    intro.draw(60_000);
    expect(intro.state.camY).toBeCloseTo(SHOWCASE_MIN_ROW + 0.105, 6);
  });

  it('holds the camera still under reduced motion', () => {
    const intro = showcase({random: () => 0, reducedMotion: true});
    intro.draw(1000);
    intro.draw(2000);
    intro.draw(3000);
    expect(intro.state.camY).toBe(SHOWCASE_MIN_ROW);
    expect(intro.state.tick).toBe(3);
  });
});

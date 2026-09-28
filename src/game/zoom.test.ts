import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  recenteredCamera,
  wheelPixels,
  ZOOM_KEY_LEVELS,
  zoomAfterKey,
  zoomAfterWheel
} from './zoom';

describe('clampZoom', () => {
  it('holds the supported range', () => {
    expect(clampZoom(1.4)).toBe(1.4);
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(9)).toBe(MAX_ZOOM);
  });

  it('falls back to the baseline for values that are not numbers', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('wheelPixels', () => {
  it('converts line and page deltas into pixels', () => {
    expect(wheelPixels({deltaY: 120})).toBe(120);
    expect(wheelPixels({deltaY: 3, deltaMode: 1})).toBe(48);
    expect(wheelPixels({deltaY: 1, deltaMode: 2})).toBe(400);
    expect(wheelPixels({deltaY: Number.NaN})).toBe(0);
  });
});

describe('zoomAfterWheel', () => {
  it('zooms in when the wheel scrolls up and out when it scrolls down', () => {
    expect(zoomAfterWheel(1, {deltaY: -100})).toBeGreaterThan(1);
    expect(zoomAfterWheel(1, {deltaY: 100})).toBeLessThan(1);
  });

  it('moves by the same proportion at every level, so no notch feels bigger', () => {
    const fromOne = zoomAfterWheel(1, {deltaY: -100}) / 1;
    const fromLow = zoomAfterWheel(MIN_ZOOM, {deltaY: -100}) / MIN_ZOOM;

    expect(fromLow).toBeCloseTo(fromOne, 10);
  });

  it('keeps one notch modest and cannot cross the range in a single event', () => {
    const step = zoomAfterWheel(1, {deltaY: -100});

    expect(step).toBeGreaterThan(1.05);
    expect(step).toBeLessThan(1.35);
    expect(zoomAfterWheel(1, {deltaY: -100_000})).toBe(MAX_ZOOM);
    expect(zoomAfterWheel(1, {deltaY: 100_000})).toBe(MIN_ZOOM);
  });

  it('answers a trackpad pinch far more strongly per pixel than a wheel notch', () => {
    const pinch = zoomAfterWheel(1, {deltaY: -10, ctrlKey: true});
    const wheel = zoomAfterWheel(1, {deltaY: -10});

    expect(pinch).toBeGreaterThan(wheel);
    expect(pinch).toBeLessThan(MAX_ZOOM);
  });

  it('clamps a level that somehow drifted out of range before applying the notch', () => {
    expect(zoomAfterWheel(12, {deltaY: 0})).toBe(MAX_ZOOM);
  });
});

describe('zoomAfterKey', () => {
  it('steps through the quarter levels in both directions', () => {
    expect(zoomAfterKey(1, 1)).toBe(1.25);
    expect(zoomAfterKey(1.25, 1)).toBe(1.5);
    expect(zoomAfterKey(1, -1)).toBe(0.75);
    expect(zoomAfterKey(0.75, -1)).toBe(0.5);
  });

  it('holds at either end of the range', () => {
    expect(zoomAfterKey(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(zoomAfterKey(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  it('moves a level the wheel left between two steps to the neighbouring step', () => {
    expect(zoomAfterKey(1.1, 1)).toBe(1.25);
    expect(zoomAfterKey(1.1, -1)).toBe(1);
    expect(ZOOM_KEY_LEVELS[0]).toBe(MIN_ZOOM);
    expect(ZOOM_KEY_LEVELS.at(-1)).toBe(MAX_ZOOM);
  });
});

describe('recenteredCamera', () => {
  it('keeps the view centre fixed as the visible span changes', () => {
    // 10 tiles from column 20 is centred on 25; 20 tiles has to start at 15.
    expect(recenteredCamera(20, 10, 20)).toBe(15);
    expect(recenteredCamera(15, 20, 10)).toBe(20);
    expect(recenteredCamera(20, 10, 10)).toBe(20);
  });
});

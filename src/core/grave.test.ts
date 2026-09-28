// Epitaphs: who lies in each grave, derived from the coordinate.

import { describe, expect, it } from 'vitest';
import { START_Y, WORLD_W } from '../../shared/constants';
import { GRAVE_MIN_ROW, gravesInRange } from '../world/world';
import {
  FEMALE_FIRST_NAMES,
  GRAVE,
  MALE_FIRST_NAMES,
  deathYear,
  epitaphFor,
  isGraveReachable,
  reachableGrave
} from './grave';
import { nth } from '../test-narrowing';

const GRAVES = gravesInRange(0, 0, WORLD_W - 1, 1199);
const EPITAPHS = GRAVES.map(grave => ({grave, epitaph: epitaphFor(grave.x, grave.y)}));

/** A wider sample than the generated graves, for the rolls' spread. */
const SAMPLE = Array.from({length: 600}, (_, i) => epitaphFor(3 + (i * 7) % 84, GRAVE_MIN_ROW + i * 3));

describe('epitaphFor', () => {
  it('reads the same stone every time', () => {
    for (const {grave, epitaph} of EPITAPHS) expect(epitaphFor(grave.x, grave.y)).toEqual(epitaph);
  });

  it('gives every miner a whole name, a lifespan of 19–70 years within 1890–1990, and a cause', () => {
    for (const epitaph of [...EPITAPHS.map(e => e.epitaph), ...SAMPLE]) {
      expect(epitaph.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
      expect(epitaph.born).toBeLessThan(epitaph.died);
      const age = epitaph.died - epitaph.born;
      expect(age).toBeGreaterThanOrEqual(GRAVE.minAge);
      expect(age).toBeLessThanOrEqual(GRAVE.maxAge);
      expect(epitaph.died).toBeGreaterThanOrEqual(GRAVE.earliestYear);
      expect(epitaph.died).toBeLessThanOrEqual(GRAVE.latestYear);
      expect(epitaph.cause.length).toBeGreaterThan(0);
    }
  });

  it('agrees a surname with its first name: -ov/-ev/-in/-sky for men, -ova/-eva/-ina/-skaya for women', () => {
    let men = 0, women = 0;
    for (const {name} of SAMPLE) {
      // A missing first name reads as '', which the female branch then rejects.
      const [first = '', surname] = name.split(' ');
      if (MALE_FIRST_NAMES.includes(first)) {
        men++;
        expect(surname).toMatch(/(ov|ev|in|sky)$/);
      } else {
        women++;
        expect(FEMALE_FIRST_NAMES).toContain(first);
        expect(surname).toMatch(/(ova|eva|ina|skaya)$/);
      }
    }
    // Both lie in the mine.
    expect(men).toBeGreaterThan(SAMPLE.length / 3);
    expect(women).toBeGreaterThan(SAMPLE.length / 10);
  });

  it('names the grave\'s own depth when the miner ran dry', () => {
    const dry = SAMPLE.map((epitaph, i) => ({epitaph, y: GRAVE_MIN_ROW + i * 3}))
      .filter(({epitaph}) => epitaph.cause.startsWith('Ran dry'));
    expect(dry.length).toBeGreaterThan(0);
    for (const {epitaph, y} of dry) expect(epitaph.cause).toBe(`Ran dry at ${(y - START_Y) * 10} m`);
  });

  it('dates deeper graves earlier', () => {
    expect(deathYear(GRAVE_MIN_ROW, 0)).toBe(GRAVE.latestYear);
    expect(deathYear(GRAVE_MIN_ROW + GRAVE.depthSpan, 0)).toBe(GRAVE.earliestYear);
    expect(deathYear(GRAVE_MIN_ROW + GRAVE.depthSpan * 4, 0.99)).toBe(GRAVE.earliestYear);
    expect(deathYear(GRAVE_MIN_ROW + 450, 0)).toBeLessThan(deathYear(GRAVE_MIN_ROW + 50, 0));
    // The per-grave wander only ever reaches back, never forward.
    expect(deathYear(GRAVE_MIN_ROW, 0.99)).toBe(GRAVE.latestYear - GRAVE.yearJitter);
  });
});

describe('reaching a grave', () => {
  const grave = nth(GRAVES, 0);
  const everywhere = () => true;

  it('reads from its own tile and the eight around it', () => {
    expect(isGraveReachable(grave, grave.x, grave.y)).toBe(true);
    expect(isGraveReachable(grave, grave.x + 1, grave.y - 1)).toBe(true);
    expect(isGraveReachable(grave, grave.x + 2, grave.y)).toBe(false);
    expect(reachableGrave(grave.x + 1, grave.y, everywhere)).toEqual({...grave, distance: 1});
    expect(reachableGrave(grave.x + 2, grave.y, everywhere)).toBeNull();
  });

  it('leaves one under fog out', () => {
    expect(reachableGrave(grave.x, grave.y, () => false)).toBeNull();
  });
});

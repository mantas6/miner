import { describe, expect, it } from 'vitest';
import { START_Y } from '../../shared/constants';
import {
  MAX_PORTAL_NAME_LENGTH,
  PORTAL_NAMES,
  defaultPortalName,
  portalDestinations,
  respawnPortals,
  sanitizePortalName
} from './portal';
import { createExtractor, createManufacturer, createPortal, type PlacedStation } from './stations';

describe('sanitizePortalName', () => {
  it('collapses whitespace, trims, and caps the length', () => {
    expect(sanitizePortalName('  Deep   Depot  ', 'Portal 1')).toBe('Deep Depot');
    expect(sanitizePortalName('a'.repeat(30), 'Portal 1')).toHaveLength(MAX_PORTAL_NAME_LENGTH);
  });

  it('falls back when the cleaned name is empty', () => {
    expect(sanitizePortalName('   ', 'Portal 7')).toBe('Portal 7');
    expect(sanitizePortalName('\t\n', 'Home')).toBe('Home');
  });
});

describe('defaultPortalName', () => {
  it('never collides with Home and draws from the presets', () => {
    expect(PORTAL_NAMES).not.toContain('Home');
    const name = defaultPortalName(['Home'], () => 0);
    expect(PORTAL_NAMES).toContain(name);
  });

  it('picks an unused preset, skipping the ones already taken', () => {
    // random → 0 would pick index 0 of the free list; with the first preset used,
    // the free list starts at the second preset.
    const used = [PORTAL_NAMES[0]];
    expect(defaultPortalName(used, () => 0)).toBe(PORTAL_NAMES[1]);
  });

  it('falls back to the first free Portal N once every preset is taken', () => {
    const taken = [...PORTAL_NAMES, 'Portal 1'];
    expect(defaultPortalName(taken, () => 0)).toBe('Portal 2');
  });

  it('accepts portal stations as the existing set', () => {
    const existing = [createPortal(1, 1, PORTAL_NAMES[0])];
    const name = defaultPortalName(existing, () => 0);
    expect(name).toBe(PORTAL_NAMES[1]);
  });
});

describe('portalDestinations', () => {
  const home = createPortal(45, START_Y, 'Home');
  const near = createPortal(46, START_Y, 'Depot');
  const deep = createPortal(20, START_Y + 100, 'Abyss');
  const stations: PlacedStation[] = [createManufacturer(44, START_Y), home, near, deep, createExtractor(46, START_Y + 1)];

  it('lists other portals nearest first, with depth and distance', () => {
    const from = {x: home.x, y: home.y};
    const destinations = portalDestinations(stations, from);

    // The portal on `from` itself is dropped; the extractor and manufacturer never appear.
    expect(destinations.map(d => d.name)).toEqual(['Depot', 'Abyss']);
    expect(destinations[0]).toMatchObject({x: 46, y: START_Y, name: 'Depot', distance: 1, depthMeters: 0});
    expect(destinations[1]).toMatchObject({name: 'Abyss', depthMeters: 1000});
    expect(destinations[1].distance).toBe(Math.abs(20 - 45) + Math.abs(START_Y + 100 - START_Y));
  });

  it('excludes portals within reach when asked', () => {
    const from = {x: home.x, y: home.y};
    const destinations = portalDestinations(stations, from, {excludeReachable: true});
    // Depot is one tile away (within reach 1), so only the deep portal remains.
    expect(destinations.map(d => d.name)).toEqual(['Abyss']);
  });
});

describe('respawnPortals', () => {
  it('returns every portal as a candidate respawn point', () => {
    const stations: PlacedStation[] = [
      createManufacturer(1, 1),
      createPortal(2, 2, 'Home'),
      createExtractor(3, 3),
      createPortal(4, 4, 'Depot')
    ];
    expect(respawnPortals(stations).map(p => p.name)).toEqual(['Home', 'Depot']);
  });
});

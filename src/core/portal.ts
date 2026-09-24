// Portals: the pure rules around the mine's free travel network.
//
// A portal is a `PlacedStation` (see `stations.ts`) the player crafts, sets down,
// and travels between for free; the base is seeded with one named `Home`. This
// module owns the DOM-free rules that hang off that network — how a fresh portal
// is named, how a raw rename is sanitized, which portals a given tile can travel
// to (and how far / how deep each is), and which portals a lost ship may respawn
// at. The game sim and UI (later phases) read these; nothing here touches state.

import { currentDepthMeters } from './objective';
import { isStationReachable, portals, type PlacedStation, type PortalStation } from './stations';

/** The longest a portal name may be, before sanitizing truncates it. */
export const MAX_PORTAL_NAME_LENGTH = 16;

/**
 * Preset names a fresh portal draws from, so a newly placed portal reads as a
 * place rather than `Portal 3`. None is `Home` — that name belongs to the base's
 * seeded portal. Once every preset is in use, `defaultPortalName` falls back to
 * numbered `Portal N` names.
 */
export const PORTAL_NAMES: readonly string[] = Object.freeze([
  'Depot',
  'Outpost',
  'Waypoint',
  'Junction',
  'Beacon',
  'Anchor',
  'Haven',
  'Relay',
  'Terminus',
  'Landing',
  'Foothold',
  'Shelter'
]);

/**
 * Clean a raw, player-typed portal name: collapse runs of whitespace to single
 * spaces, trim the ends, and cap the length. An empty result falls back to the
 * supplied default, so a portal is never left nameless.
 */
export function sanitizePortalName(raw: string, fallback: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const truncated = collapsed.slice(0, MAX_PORTAL_NAME_LENGTH).trim();
  return truncated.length > 0 ? truncated : fallback;
}

/** The names already taken, whether passed portals or a bare list of strings. */
function usedNames(existing: readonly PortalStation[] | readonly string[]): Set<string> {
  return new Set(existing.map(entry => (typeof entry === 'string' ? entry : entry.name)));
}

/**
 * A default name for a new portal: a random unused preset, or — once every preset
 * is taken — the first free `Portal N` (N the lowest positive integer not already
 * used). `random` is injected so a caller can make the pick deterministic.
 */
export function defaultPortalName(
  existing: readonly PortalStation[] | readonly string[],
  random: () => number = Math.random
): string {
  const used = usedNames(existing);
  const free = PORTAL_NAMES.filter(name => !used.has(name));
  if (free.length > 0) {
    const index = Math.min(free.length - 1, Math.floor(random() * free.length));
    return free[index];
  }
  let n = 1;
  while (used.has(`Portal ${n}`)) n++;
  return `Portal ${n}`;
}

/** One place a ship could travel to: a portal, with its depth and distance. */
export interface PortalDestination {
  x: number;
  y: number;
  name: string;
  /** Depth below the home row, in metres, the same figure the HUD reports. */
  depthMeters: number;
  /** Manhattan distance from the `from` tile, in tiles; the list is sorted by it. */
  distance: number;
}

/**
 * Every portal a ship at `from` could travel to, nearest first. The portal
 * standing on `from` itself is always excluded; with `excludeReachable` set, any
 * portal already within station reach of `from` is dropped too (used by the
 * carried teleporter, which is pointless when a portal is already at arm's reach).
 */
export function portalDestinations(
  stations: readonly PlacedStation[],
  from: {x: number; y: number},
  options: {excludeReachable?: boolean} = {}
): PortalDestination[] {
  const destinations: PortalDestination[] = [];
  for (const portal of portals(stations)) {
    if (portal.x === from.x && portal.y === from.y) continue;
    if (options.excludeReachable && isStationReachable(portal, from.x, from.y)) continue;
    destinations.push({
      x: portal.x,
      y: portal.y,
      name: portal.name,
      depthMeters: currentDepthMeters(portal.y),
      distance: Math.abs(portal.x - from.x) + Math.abs(portal.y - from.y)
    });
  }
  return destinations.sort((a, b) => a.distance - b.distance);
}

/** The portals a lost ship may redeploy at: every portal is a candidate. */
export function respawnPortals(stations: readonly PlacedStation[]): PortalStation[] {
  return portals(stations);
}

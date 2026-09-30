// Portals: the pure rules around the mine's free travel network.
//
// A portal is a `PlacedStation` (see `stations.ts`) the player crafts, sets down,
// and travels between for free; the base is seeded with one named `Home`. This
// module owns the DOM-free rules that hang off that network — how a fresh portal
// is named, how a raw rename is sanitized, which portals a given tile can travel
// to (and how far / how deep each is), and which portals a lost ship may respawn
// at. The game sim and UI read these; nothing here touches state.

import { rowDepthMeters } from '../../shared/constants';
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
  // Clamped into range, so a free name is found whenever there is one.
  const pick = free[Math.max(0, Math.min(free.length - 1, Math.floor(random() * free.length)))];
  if (pick !== undefined) return pick;
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
  /**
   * Respawn lists only: the fuel a replacement ship deploys with there — at home
   * what the extractor's store covers of a base tank (never under
   * `RESPAWN.homeFuelFraction`), `RESPAWN.portalFuelFraction` of one at a field
   * portal (`respawnVitals`).
   */
  respawnFuel?: number;
}

/**
 * Whether the ship may land on a tile: open space it can fly out of. The pure
 * rules cannot see the mine, so the caller that can passes this in; a portal whose
 * tile has gone solid (a save that lost its dug-out hole, a reset mine) is not a
 * destination at all, since landing there would bury the ship in rock.
 */
export type LandingCheck = (x: number, y: number) => boolean;

/**
 * Every portal a ship at `from` could travel to, nearest first. The portal
 * standing on `from` itself is always excluded; with `excludeReachable` set, any
 * portal already within station reach of `from` is dropped too (used by the
 * carried teleporter, which is pointless when a portal is already at arm's reach);
 * with `canLand` given, so is any portal whose tile the ship could not land on.
 */
export function portalDestinations(
  stations: readonly PlacedStation[],
  from: {x: number; y: number},
  options: {excludeReachable?: boolean; canLand?: LandingCheck} = {}
): PortalDestination[] {
  const destinations: PortalDestination[] = [];
  for (const portal of portals(stations)) {
    if (portal.x === from.x && portal.y === from.y) continue;
    if (options.excludeReachable && isStationReachable(portal, from.x, from.y)) continue;
    if (options.canLand && !options.canLand(portal.x, portal.y)) continue;
    destinations.push({
      x: portal.x,
      y: portal.y,
      name: portal.name,
      depthMeters: rowDepthMeters(portal.y),
      distance: Math.abs(portal.x - from.x) + Math.abs(portal.y - from.y)
    });
  }
  return destinations.sort((a, b) => a.distance - b.distance);
}

/**
 * The portals a lost ship may redeploy at: every portal is a candidate, except —
 * with `canLand` given — one whose tile the ship could not land on. With none
 * left the ship redeploys at the home base.
 */
export function respawnPortals(stations: readonly PlacedStation[], canLand?: LandingCheck): PortalStation[] {
  const candidates = portals(stations);
  return canLand ? candidates.filter(portal => canLand(portal.x, portal.y)) : candidates;
}

import { getEnemyType } from './enemy-types';
import { HOVER_DRILL_SURCHARGE_PERCENT } from './movement';
import type { Direction, EnemyKind, Tile } from './types';

export interface TerrainScannerInput {
  tile: Tile;
  direction: Direction;
  activeEnemy?: EnemyKind | boolean;
  explored?: boolean;
  /** The ship's drill power (hp removed per hit); hit counts divide by it. */
  drill?: number;
  /**
   * The drill is aimed sideways with nothing under the ship (`isHoverSideDrill`),
   * so drilling the target costs the hover surcharge; a drillable tile says so.
   */
  hovering?: boolean;
  /**
   * The tile *behind* the target, two ahead of the ship in the aimed direction —
   * the drill line's lookahead. Read through fog: when the target is known dirt,
   * the line names what the drill breaks into next ("…, then magma."), so a held
   * key never runs blind into a pocket. Nothing is revealed on the map.
   */
  beyond?: Tile;
}

/** The hover surcharge, derived from the balance constant: " Hover: +25 % fuel." */
const HOVER_SUFFIX = ` Hover: +${HOVER_DRILL_SURCHARGE_PERCENT} % fuel.`;

function directionLabel([dx, dy]: Direction): string {
  if (dx < 0) return '←';
  if (dx > 0) return '→';
  if (dy < 0) return '↑';
  return '↓';
}

/**
 * Drill hits still needed to clear a tile with `hp` left at `drill` power per
 * hit. Never below one: a tile that is still standing always takes another hit.
 */
export function hitsLeft(hp: number, drill: number): number {
  return Math.max(1, Math.ceil(hp / drill));
}

/** "1 hit" / "3 hits": `hitsLeft` with the noun agreeing — the scanner line's and the drill toasts'. */
export function hitsLabel(hp: number, drill: number): string {
  const hits = hitsLeft(hp, drill);
  return `${hits} ${hits === 1 ? 'hit' : 'hits'}`;
}

/**
 * What the lookahead calls the tile behind the target, or `null` for plain dirt —
 * dirt behind dirt is the drill line's normal and not worth a word. A dormant
 * cocoon reads as dirt here too, exactly as it does up close.
 */
function beyondLabel(tile: Tile): string | null {
  switch (tile.type) {
    case 'dirt':
    case 'enemy':
      return null;
    case 'air':
      return 'open air';
    case 'ore':
      return tile.ore.name;
    case 'rock':
      return 'solid rock';
    case 'hazard':
      return 'magma';
    case 'decor':
      return 'a decoration';
  }
}

/**
 * The lookahead's tail for a known-dirt target — ", then magma" — or '' when
 * there is nothing to say: no tile behind given, plain dirt behind, or an upward
 * aim (the drill never digs up, so there is no drill line to look along).
 */
function lookaheadSuffix(direction: Direction, beyond: Tile | undefined): string {
  if (!beyond || direction[1] < 0) return '';
  const label = beyondLabel(beyond);
  return label ? `, then ${label}` : '';
}

/** Formats a concise, DOM-free warning for the adjacent movement/drill target. */
export function formatTerrainScanner({ tile, direction, activeEnemy = false, explored = true, drill = 1, hovering = false, beyond }: TerrainScannerInput): string {
  const prefix = `Scanner ${directionLabel(direction)}:`;
  if (!explored) return `${prefix} unexplored — advance to map terrain.`;
  if (activeEnemy) {
    const name = typeof activeEnemy === 'string' ? getEnemyType(activeEnemy).name.toLowerCase() : 'fiend';
    return `${prefix} active ${name} — drill it before it chews hull.`;
  }
  // The drill never digs upward (`move.ts` refuses the step), so terrain overhead
  // is named as a ceiling rather than offered as drillable with a hit count. Rock
  // keeps its own line — it is blocked whichever way the drill points.
  if (direction[1] < 0 && tile.type !== 'air' && tile.type !== 'rock') {
    return `${prefix} ${overheadLabel(tile)} overhead — the drill cannot dig upward.`;
  }
  const line = describeTile(prefix, tile, drill, lookaheadSuffix(direction, beyond));
  // Only a tile the drill can bite warns of the surcharge: air is flown, and
  // rock already says to detour.
  return hovering && tile.type !== 'air' && tile.type !== 'rock' ? line + HOVER_SUFFIX : line;
}

/** What a solid tile above the ship is called; a cocoon keeps its dirt disguise. */
function overheadLabel(tile: Tile): string {
  switch (tile.type) {
    case 'ore':
      return tile.ore.name;
    case 'hazard':
      return 'magma';
    case 'decor':
      return 'a decoration';
    default:
      return 'dirt';
  }
}

/** One target's line; `then` is the lookahead's tail, read only by a dirt target. */
function describeTile(prefix: string, tile: Tile, drill: number, then: string): string {
  switch (tile.type) {
    case 'air':
      return `${prefix} clear route.`;
    case 'dirt':
      return `${prefix} dirt — drillable, ${hitsLabel(tile.hp, drill)}${then}.`;
    case 'ore':
      return `${prefix} ${tile.ore.name} — $${tile.ore.value}, ${hitsLabel(tile.hp, drill)}.`;
    case 'rock':
      return `${prefix} solid rock — detour; drill blocked.`;
    case 'hazard':
      return `${prefix} magma — hull risk, ${hitsLabel(tile.hp, drill)} to vent.`;
    case 'enemy':
      // A dormant cocoon passes for dirt, lookahead and all.
      return `${prefix} dirt — drillable, ${hitsLabel(tile.hp, drill)}${then}.`;
    case 'decor':
      return `${prefix} decoration — drill to recover it.`;
  }
}

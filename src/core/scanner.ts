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
}

/** The hover surcharge, derived from the balance constant: " Hover: +50 % fuel." */
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

function hitsLabel(hp: number, drill: number): string {
  const hits = hitsLeft(hp, drill);
  return `${hits} ${hits === 1 ? 'hit' : 'hits'}`;
}

/** Formats a concise, DOM-free warning for the adjacent movement/drill target. */
export function formatTerrainScanner({ tile, direction, activeEnemy = false, explored = true, drill = 1, hovering = false }: TerrainScannerInput): string {
  const prefix = `Scanner ${directionLabel(direction)}:`;
  if (!explored) return `${prefix} unexplored — advance to map terrain.`;
  if (activeEnemy) {
    const name = typeof activeEnemy === 'string' ? getEnemyType(activeEnemy).name.toLowerCase() : 'fiend';
    return `${prefix} active ${name} — drill it before it chews hull.`;
  }
  const line = describeTile(prefix, tile, drill);
  // Only a tile the drill can bite warns of the surcharge: air is flown, and
  // rock already says to detour.
  return hovering && tile.type !== 'air' && tile.type !== 'rock' ? line + HOVER_SUFFIX : line;
}

function describeTile(prefix: string, tile: Tile, drill: number): string {
  switch (tile.type) {
    case 'air':
      return `${prefix} clear route.`;
    case 'dirt':
      return `${prefix} dirt — drillable, ${hitsLabel(tile.hp, drill)}.`;
    case 'ore':
      return `${prefix} ${tile.ore.name} — $${tile.ore.value}, ${hitsLabel(tile.hp, drill)}.`;
    case 'rock':
      return `${prefix} solid rock — detour; drill blocked.`;
    case 'hazard':
      return `${prefix} magma — hull risk, ${hitsLabel(tile.hp, drill)} to vent.`;
    case 'enemy':
      return `${prefix} dirt — drillable, ${hitsLabel(tile.hp, drill)}.`;
    case 'decor':
      return `${prefix} decoration — drill to recover it.`;
  }
}

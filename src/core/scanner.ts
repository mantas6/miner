import { getEnemyType } from './enemy-types';
import type { Direction, EnemyKind, Tile } from './types';

export interface TerrainScannerInput {
  tile: Tile;
  direction: Direction;
  activeEnemy?: EnemyKind | boolean;
  explored?: boolean;
}

function directionLabel([dx, dy]: Direction): string {
  if (dx < 0) return '←';
  if (dx > 0) return '→';
  if (dy < 0) return '↑';
  return '↓';
}

function hitsLabel(hp: number): string {
  const hits = Math.max(1, Math.ceil(hp));
  return `${hits} ${hits === 1 ? 'hit' : 'hits'}`;
}

/** Formats a concise, DOM-free warning for the adjacent movement/drill target. */
export function formatTerrainScanner({ tile, direction, activeEnemy = false, explored = true }: TerrainScannerInput): string {
  const prefix = `Scanner ${directionLabel(direction)}:`;
  if (!explored) return `${prefix} unexplored — advance to map terrain.`;
  if (activeEnemy) {
    const name = typeof activeEnemy === 'string' ? getEnemyType(activeEnemy).name.toLowerCase() : 'fiend';
    return `${prefix} active ${name} — drill it before it chews hull.`;
  }

  switch (tile.type) {
    case 'air':
      return `${prefix} clear route.`;
    case 'dirt':
      return `${prefix} dirt — drillable, ${hitsLabel(tile.hp)}.`;
    case 'ore':
      return `${prefix} ${tile.ore.name} — $${tile.ore.value}, ${hitsLabel(tile.hp)}.`;
    case 'rock':
      return `${prefix} solid rock — detour; drill blocked.`;
    case 'hazard':
      return `${prefix} magma — hull risk, ${hitsLabel(tile.hp)} to vent.`;
    case 'enemy':
      return `${prefix} dirt — drillable, ${hitsLabel(tile.hp)}.`;
    case 'artifact':
      return `${prefix} RARE ${tile.artifact.name} — $${tile.artifact.value} CASH NOW, ${hitsLabel(tile.hp)}; uses no cargo.`;
    case 'motherlode':
      return `${prefix} Motherlode core — ${hitsLabel(tile.hp)} to crack; claim it and return alive.`;
  }
}

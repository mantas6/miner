// Pure deterministic world generation. DOM-free / testable.
// No imports from dom.js, game.js, or balance.js.
import { ARTIFACTS, DANGER, MAX_WORLD_ROW, MOTHERLODE_ROW, ORES, SURFACE_HEIGHT, WORLD_CHUNK_ROWS, WORLD_W } from '../../shared/constants';
import type { Tile } from '../core/types';
import { enemyHealth, enemyKindForDepthRoll } from '../core/enemy-types';

/** Deterministic pseudo-random value in [0,1) for a tile coordinate. */
export function rand(x: number, y: number): number { const n = Math.sin(x*127.1 + y*311.7) * 43758.5453; return n - Math.floor(n); }

/** Whether a natural air pocket / cave seam exists at this coordinate. */
export function naturalAirPocket(x: number, y: number): boolean {
  if (y < 5 || x < 2 || x > WORLD_W - 3) return false;
  const depth = Math.min(1, y / 85);
  const cellular = (rand(Math.floor(x/2), Math.floor(y/2)) + rand(Math.floor((x+1)/3)+41, Math.floor((y-1)/3)-17)) / 2;
  const pocketChance = 0.018 + depth * 0.035;
  if (cellular < pocketChance) return true;
  const seam = Math.abs(Math.sin(x * 0.31 + y * 0.145 + Math.sin(y * 0.071) * 2.3));
  const seamGate = rand(Math.floor(x/5) + 91, Math.floor(y/4) - 53);
  return y > 10 && seam < 0.045 + depth * 0.035 && seamGate < 0.42;
}

const STARTER_ORE_PATCHES = [
  {xOffset: 0, y: SURFACE_HEIGHT + 3, oreName: 'Coal'},
  {xOffset: -2, y: SURFACE_HEIGHT + 4, oreName: 'Coal'},
  {xOffset: 2, y: SURFACE_HEIGHT + 5, oreName: 'Copper'},
  {xOffset: -1, y: SURFACE_HEIGHT + 7, oreName: 'Copper'}
];

/**
 * A small deterministic starter seam near the shaft gives new players visible
 * low-tier goals in the first 40-80 m without flattening the whole opening.
 */
export function starterOreForCoordinate(x: number, y: number) {
  const shaftX = Math.floor(WORLD_W / 2);
  const patch = STARTER_ORE_PATCHES.find(tile => x === shaftX + tile.xOffset && y === tile.y);
  if (!patch) return null;
  return ORES.find(ore => ore.name === patch.oreName && y >= ore.min) || null;
}

export function oreSpawnChanceAtDepth(depth: number): number {
  return .10 * Math.min(2.2, 1 + depth / 90);
}

export function oreForDepthRoll(depth: number, roll: number) {
  const eligible = ORES.filter(ore => depth >= ore.min && depth <= ore.max);
  const totalWeight = eligible.reduce((total, ore) => total + ore.chance, 0);
  let target = roll * totalWeight;
  for (const ore of eligible) {
    target -= ore.chance;
    if (target < 0) return ore;
  }
  return eligible.at(-1) || null;
}

export function artifactForDepthRoll(depth: number, roll: number) {
  let target = roll;
  for (const artifact of ARTIFACTS) {
    if (depth < artifact.min || depth > artifact.max) continue;
    target -= artifact.chance;
    if (target < 0) return artifact;
  }
  return null;
}

/** Generate the tile at a world coordinate. Deterministic for a given (x,y). */
export function makeTile(x: number, y: number): Tile {
  if (y < SURFACE_HEIGHT) return {type:'air'};
  if (y === SURFACE_HEIGHT && Math.abs(x - WORLD_W/2) < 7) return {type:'dirt', hp:2, maxHp:2};
  if (naturalAirPocket(x,y)) return {type:'air'};
  const r = rand(x,y), depth = y;
  let ore = starterOreForCoordinate(x, y);
  if (!ore && r < oreSpawnChanceAtDepth(depth)) {
    ore = oreForDepthRoll(depth, rand(x + 73, y - 47));
  }
  if (y === MOTHERLODE_ROW && Math.abs(x - Math.floor(WORLD_W/2)) <= 1) return {type:'motherlode', hp:24, maxHp:24};
  if (ore) { const hp = Math.max(3, Math.ceil((depth/28)+4)); return {type:'ore', ore, hp, maxHp: hp}; }
  const artifact = artifactForDepthRoll(depth, rand(x - 181, y + 263));
  if (artifact) { const hp = Math.max(4, Math.ceil(depth/240)+3); return {type:'artifact', artifact, hp, maxHp:hp}; }
  const rockChance = y > 190 ? .036 : .018;
  if (rand(x+9,y-3) < rockChance && y >= DANGER.rockMinRow) return {type:'rock', hp: 999};
  if (y >= DANGER.hazardMinRow && rand(x+51,y-91) < Math.min(.026, .007 + y / 13000)) {
    const hp = Math.max(4, Math.ceil(3 + y / 55));
    return {type:'hazard', hp, maxHp: hp};
  }
  if (y >= DANGER.enemyMinRow && rand(x-37,y+83) < Math.min(.046, .008 + y / 6500)) {
    const kind = enemyKindForDepthRoll(y, rand(x+211,y-157));
    const hp = enemyHealth(kind, Math.max(4, Math.ceil(3 + y / 35)));
    return {type:'enemy', kind, hp, maxHp: hp};
  }
  { const hp = Math.max(2, Math.ceil(depth/42)+1 + (depth > 210 ? 2 : 0)); return {type:'dirt', hp, maxHp: hp}; }
}

/** Generate the containing row chunk on first access. */
export function ensureWorldRow(world: Tile[][], y: number, tileFactory: (x: number, y: number) => Tile = makeTile): Tile[] | undefined {
  if (!Number.isInteger(y) || y < 0 || y > MAX_WORLD_ROW) return undefined;
  if (world[y]) return world[y];
  const start = Math.floor(y / WORLD_CHUNK_ROWS) * WORLD_CHUNK_ROWS;
  const end = Math.min(MAX_WORLD_ROW + 1, start + WORLD_CHUNK_ROWS);
  for (let rowY = start; rowY < end; rowY++) {
    if (!world[rowY]) world[rowY] = Array.from({length: WORLD_W}, (_, x) => tileFactory(x, rowY));
  }
  return world[y];
}

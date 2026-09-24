// Pure deterministic world generation. DOM-free / testable.
// No imports from dom.js, game.js, or balance.js.
import { BEDROCK_ROWS, DANGER, DECOR_HP, HOME_CAVERN, HOME_CAVERN_TOP, HOME_ROW, HOME_X, MAX_WORLD_ROW, ORES, START_Y, WORLD_CHUNK_ROWS, WORLD_W, isHomeCavern } from '../../shared/constants';
import type { Tile } from '../core/types';
import { enemyHealth, enemyKindForDepthRoll } from '../core/enemy-types';

/** Deterministic pseudo-random value in [0,1) for a tile coordinate. */
export function rand(x: number, y: number): number { const n = Math.sin(x*127.1 + y*311.7) * 43758.5453; return n - Math.floor(n); }

// --- Trading posts -----------------------------------------------------------
//
// A trading post is a small kiosk that stands in an air pocket carved deep in the
// mine. It is not stored anywhere: like the home cavern, both its position and its
// cleared 3×3 pocket are *derived* from the tile coordinate, so a post survives
// death, reload and world reset for free. `state.tradeLedger` records only the
// stock the player has drawn down; everything else comes back from these rolls.

/** One trading post standing in the mine, derived from its coordinate. */
export interface TradingPost {
  x: number;
  y: number;
}

/** Side of the square chunk trading-post placement is rolled per. */
export const TRADING_POST_CHUNK = 32;
/** Chance a qualifying chunk holds a post (~12%); tuned for an 8–16% band. */
export const TRADING_POST_CHANCE = 0.12;
/** No post generates above this row, keeping the home cavern and shallows clear. */
export const TRADING_POST_MIN_ROW = START_Y + 40;

/** The chunk a coordinate falls in, on the square trading-post grid. */
function tradingChunk(v: number): number {
  return Math.floor(v / TRADING_POST_CHUNK);
}

/**
 * The post a chunk holds, or `null`. Two independent rolls: the first decides
 * whether the chunk has a post at all, the second picks its cell. The cell is kept
 * one tile in from the chunk edges, so the post's 3×3 pocket never spills into a
 * neighbouring chunk — which is what lets `tradingPostAt` and `tradingPostPocket`
 * answer from a tile's own chunk alone — and clear of the world's side walls.
 */
function tradingPostInChunk(chunkX: number, chunkY: number): TradingPost | null {
  // Only chunks whose whole span sits below the shallow band qualify, so a post is
  // always deep in the mine and never near the home cavern.
  if (chunkY * TRADING_POST_CHUNK < TRADING_POST_MIN_ROW) return null;
  if (rand(chunkX + 977, chunkY + 311) >= TRADING_POST_CHANCE) return null;
  const localX = 1 + Math.floor(rand(chunkX + 613, chunkY + 417) * (TRADING_POST_CHUNK - 2));
  const localY = 1 + Math.floor(rand(chunkX + 229, chunkY + 853) * (TRADING_POST_CHUNK - 2));
  const x = chunkX * TRADING_POST_CHUNK + localX;
  const y = chunkY * TRADING_POST_CHUNK + localY;
  // The pocket must clear the world's side walls (the same margin air pockets use).
  if (x - 1 < 2 || x + 1 > WORLD_W - 3) return null;
  return {x, y};
}

/** The trading post standing exactly on this tile, or `null`. */
export function tradingPostAt(x: number, y: number): TradingPost | null {
  const post = tradingPostInChunk(tradingChunk(x), tradingChunk(y));
  return post && post.x === x && post.y === y ? post : null;
}

/** Whether this tile falls within a post's cleared 3×3 pocket (post or a neighbour). */
export function tradingPostPocket(x: number, y: number): boolean {
  const post = tradingPostInChunk(tradingChunk(x), tradingChunk(y));
  return post !== null && Math.abs(post.x - x) <= 1 && Math.abs(post.y - y) <= 1;
}

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
  {xOffset: 0, y: HOME_ROW + 2, oreName: 'Coal'},
  {xOffset: -2, y: HOME_ROW + 3, oreName: 'Coal'},
  {xOffset: 2, y: HOME_ROW + 4, oreName: 'Iron'},
  {xOffset: -1, y: HOME_ROW + 5, oreName: 'Iron'}
];

/**
 * A small deterministic Coal/Iron seam just below the home cavern gives new
 * players visible low-tier goals in the first few metres without flattening the
 * whole opening.
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

/**
 * The two Lenin Portraits hung high in the home cavern's upper corners — its
 * leftmost and rightmost tiles on the ceiling row. Deterministic decor like the
 * stone floor: not stored in the diff, and drilled out for the item as usual.
 */
export const HOME_PORTRAITS: readonly {readonly x: number; readonly y: number}[] = Object.freeze([
  Object.freeze({x: HOME_X - HOME_CAVERN.halfWidth, y: HOME_CAVERN_TOP}),
  Object.freeze({x: HOME_X + HOME_CAVERN.halfWidth, y: HOME_CAVERN_TOP})
]);

/** Whether a coordinate is one of the home cavern's two hung portraits. */
export function homePortraitAt(x: number, y: number): boolean {
  return HOME_PORTRAITS.some(p => p.x === x && p.y === y);
}

/** Generate the tile at a world coordinate. Deterministic for a given (x,y). */
export function makeTile(x: number, y: number): Tile {
  // An indestructible bedrock cap seals the top of the world. Below it, the rows
  // between the cap and the cavern ceiling generate as ordinary terrain: they are
  // unreachable (upward digging is blocked), so they stay a fogged dark band.
  if (y < BEDROCK_ROWS) return {type:'rock', hp:999};
  // Two Lenin Portraits hang in the cavern's upper corners: deterministic decor
  // the player can drill out, checked before the cavern's air.
  if (homePortraitAt(x, y)) return {type:'decor', decor:'leninPortrait', hp: DECOR_HP, maxHp: DECOR_HP};
  // The rest of the home cavern is deterministic air, never stored in the tile diff.
  if (isHomeCavern(x, y)) return {type:'air'};
  // The cavern floor is a stone-paved base: deterministic decor tiles the player
  // can drill out (~5 s) for Stone Blocks. Like the cavern it is not stored in the
  // diff; digging through one writes air to the diff as usual.
  if (y === HOME_ROW + 1 && Math.abs(x - HOME_X) <= HOME_CAVERN.halfWidth) return {type:'decor', decor:'stoneBlock', hp: DECOR_HP, maxHp: DECOR_HP};
  // A trading post carves a cleared 3×3 air pocket for its kiosk, derived from the
  // coordinate like the cavern rather than stored in the diff.
  if (y > HOME_ROW + 1 && tradingPostPocket(x,y)) return {type:'air'};
  // Natural cave seams only open up below the cavern's immediate floor.
  if (y > HOME_ROW + 1 && naturalAirPocket(x,y)) return {type:'air'};
  const r = rand(x,y), depth = y;
  let ore = starterOreForCoordinate(x, y);
  if (!ore && r < oreSpawnChanceAtDepth(depth)) {
    ore = oreForDepthRoll(depth, rand(x + 73, y - 47));
  }
  if (ore) { const hp = Math.max(3, Math.ceil((depth/28)+4)); return {type:'ore', ore, hp, maxHp: hp}; }
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

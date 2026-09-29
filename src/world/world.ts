// Pure deterministic world generation. DOM-free / testable.
import { BEDROCK_ROWS, DANGER, DECOR_HP, HOME_CAVERN, HOME_ROW, HOME_X, MAX_WORLD_ROW, ORES, START_Y, WORLD_CHUNK_ROWS, WORLD_W, isHomeCavern } from '../../shared/constants';
import type { Tile } from '../core/types';
import { TERRAIN } from '../core/balance';
import { enemyHealth, enemyKindForDepthRoll } from '../core/enemy-types';

/** Deterministic pseudo-random value in [0,1) for a tile coordinate. */
export function rand(x: number, y: number): number { const n = Math.sin(x*127.1 + y*311.7) * 43758.5453; return n - Math.floor(n); }

/**
 * Chunk columns a memo key holds apart. Fixture chunks are at least 16 tiles wide
 * and the world is 90, so real columns sit well inside; a column outside
 * `[-CHUNK_MEMO_OFFSET, CHUNK_MEMO_STRIDE - CHUNK_MEMO_OFFSET)` skips the memo.
 */
const CHUNK_MEMO_STRIDE = 64;
const CHUNK_MEMO_OFFSET = 8;
/** Entries a memo keeps before starting over; a result is always re-rollable. */
const CHUNK_MEMO_LIMIT = 16384;

/**
 * Remember a per-chunk fixture roll. The rolls are pure functions of the chunk,
 * but world generation asks the same chunk once per tile it generates (and the
 * grave roll re-asks its neighbours' rolls twenty times over), so caching the
 * answer leaves every result identical while each chunk is rolled once. The
 * results are frozen: they are shared between every caller now.
 */
function memoiseChunkRoll<T extends object>(roll: (chunkX: number, chunkY: number) => T | null): (chunkX: number, chunkY: number) => T | null {
  const cache = new Map<number, T | null>();
  return (chunkX, chunkY) => {
    const column = chunkX + CHUNK_MEMO_OFFSET;
    if (column < 0 || column >= CHUNK_MEMO_STRIDE) return roll(chunkX, chunkY);
    const key = chunkY * CHUNK_MEMO_STRIDE + column;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const result = roll(chunkX, chunkY);
    if (cache.size >= CHUNK_MEMO_LIMIT) cache.clear();
    cache.set(key, result && Object.freeze(result));
    return result;
  };
}

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
/**
 * Chance a qualifying chunk holds a post (30%): with under three chunk columns across
 * the mine that is about one post per 40 rows, so a steady dive meets its first
 * well inside the first thousand metres.
 */
export const TRADING_POST_CHANCE = 0.3;
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
function rollTradingPostInChunk(chunkX: number, chunkY: number): TradingPost | null {
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
const tradingPostInChunk = memoiseChunkRoll(rollTradingPostInChunk);

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

/**
 * Every trading post inside an inclusive tile rectangle, one chunk roll per
 * overlapping chunk — the renderer's per-frame lookup, instead of asking every
 * visible tile whether it holds one.
 */
export function tradingPostsInRange(startX: number, startY: number, endX: number, endY: number): TradingPost[] {
  const posts: TradingPost[] = [];
  for (let cy = tradingChunk(startY); cy <= tradingChunk(endY); cy++) {
    for (let cx = tradingChunk(startX); cx <= tradingChunk(endX); cx++) {
      const post = tradingPostInChunk(cx, cy);
      if (post && post.x >= startX && post.x <= endX && post.y >= startY && post.y <= endY) posts.push(post);
    }
  }
  return posts;
}

/**
 * The post nearest a tile within a Chebyshev `radius` (a square of side
 * `2·radius+1` around it), or `null` when none stands that close. Ties on the
 * Chebyshev distance go to the smaller Manhattan distance, then to the shallower
 * post, then to the one further left, so the answer never depends on chunk order.
 */
export function nearestTradingPost(x: number, y: number, radius: number): TradingPost | null {
  let best: TradingPost | null = null;
  let bestChebyshev = Infinity;
  let bestManhattan = Infinity;
  for (const post of tradingPostsInRange(x - radius, y - radius, x + radius, y + radius)) {
    const dx = Math.abs(post.x - x), dy = Math.abs(post.y - y);
    const chebyshev = Math.max(dx, dy), manhattan = dx + dy;
    const closer = chebyshev < bestChebyshev
      || (chebyshev === bestChebyshev && (manhattan < bestManhattan
        || (manhattan === bestManhattan && best !== null && (post.y < best.y || (post.y === best.y && post.x < best.x)))));
    if (closer) {
      best = post;
      bestChebyshev = chebyshev;
      bestManhattan = manhattan;
    }
  }
  return best;
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

export function oreSpawnChanceAtDepth(row: number): number {
  const {base, rowDivisor, maxMultiplier} = TERRAIN.oreChance;
  return base * Math.min(maxMultiplier, 1 + row / rowDivisor);
}

/** How many hit points an ore tile on this absolute row starts with (`TERRAIN.oreHp`). */
export function oreHpAtRow(row: number): number {
  const {min, rowDivisor, base} = TERRAIN.oreHp;
  return Math.max(min, Math.ceil((row / rowDivisor) + base));
}

export function oreForDepthRoll(row: number, roll: number) {
  const eligible = ORES.filter(ore => row >= ore.min && row <= ore.max);
  const totalWeight = eligible.reduce((total, ore) => total + ore.chance, 0);
  let target = roll * totalWeight;
  for (const ore of eligible) {
    target -= ore.chance;
    if (target < 0) return ore;
  }
  return eligible.at(-1) || null;
}

// --- Chests ------------------------------------------------------------------
//
// Small loot chests lie buried throughout the mine. Like trading posts they are
// derived from the coordinate, never stored: per square chunk
// one roll decides whether the chunk holds a chest, two more pick its cell, and the
// chest clears only its own tile — a one-tile pocket the ship drills into like any
// other. What the chest holds is rolled from the same coordinate (`core/chest.ts`);
// `state.chestLedger` records only what the player has taken out of it.

/** One chest lying in the mine, derived from its coordinate. */
export interface Chest {
  x: number;
  y: number;
}

/** Side of the square chunk chest placement is rolled per. */
export const CHEST_CHUNK = 16;
/** Chance a chunk holds a chest — about one per thousand tiles. */
export const CHEST_CHANCE = 0.25;
/** No chest lies above this row, keeping the home cavern and its starter seam clear. */
export const CHEST_MIN_ROW = START_Y + 8;

/** The chunk a coordinate falls in, on the square chest grid. */
function chestChunk(v: number): number {
  return Math.floor(v / CHEST_CHUNK);
}

/**
 * The chest a chunk holds, or `null`. The cell is kept one tile in from the chunk
 * edges and two clear of the side walls, and a chunk whose chest would sit in — or
 * right beside — a trading post's pocket holds nothing, so a chest never shares a
 * fixture's cleared space.
 */
function rollChestInChunk(chunkX: number, chunkY: number): Chest | null {
  if (chunkX < 0 || chunkY < 0) return null;
  if (rand(chunkX + 2131, chunkY + 1471) >= CHEST_CHANCE) return null;
  const x = chunkX * CHEST_CHUNK + 1 + Math.floor(rand(chunkX + 571, chunkY + 1933) * (CHEST_CHUNK - 2));
  const y = chunkY * CHEST_CHUNK + 1 + Math.floor(rand(chunkX + 1777, chunkY + 389) * (CHEST_CHUNK - 2));
  if (x < 2 || x > WORLD_W - 3) return null;
  if (y < CHEST_MIN_ROW) return null;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (tradingPostPocket(x + dx, y + dy)) return null;
    }
  }
  return {x, y};
}
const chestInChunk = memoiseChunkRoll(rollChestInChunk);

/** The chest lying exactly on this tile, or `null`. Looted or not — see `core/chest.ts`. */
export function chestAt(x: number, y: number): Chest | null {
  const chest = chestInChunk(chestChunk(x), chestChunk(y));
  return chest && chest.x === x && chest.y === y ? chest : null;
}

/**
 * Every chest inside an inclusive tile rectangle, walking the chunks that overlap
 * it rather than every tile — one chunk roll each, which is what keeps the renderer's
 * per-frame scan cheap.
 */
export function chestsInRange(startX: number, startY: number, endX: number, endY: number): Chest[] {
  const chests: Chest[] = [];
  for (let cy = chestChunk(startY); cy <= chestChunk(endY); cy++) {
    for (let cx = chestChunk(startX); cx <= chestChunk(endX); cx++) {
      const chest = chestInChunk(cx, cy);
      if (chest && chest.x >= startX && chest.x <= endX && chest.y >= startY && chest.y <= endY) chests.push(chest);
    }
  }
  return chests;
}

// --- Graves ------------------------------------------------------------------
//
// Miners who never made it back lie in small nooks throughout the mine. Like the
// chests they are derived from the coordinate and never stored: per square chunk
// one roll decides whether the chunk holds a grave, two more pick its cell, and the
// grave clears a 3-wide, 2-tall nook with the grave on its floor — the middle of
// the bottom row. The epitaph is rolled from the same coordinate (`core/grave.ts`);
// nothing about a grave is ever consumed, so there is nothing to save.

/** One grave lying in the mine, derived from its coordinate. */
export interface Grave {
  x: number;
  y: number;
}

/** Side of the square chunk grave placement is rolled per. */
export const GRAVE_CHUNK = 16;
/** Chance a chunk holds a grave — rarer than a chest. */
export const GRAVE_CHANCE = 0.15;
/** No grave lies above this row, keeping the home cavern and its starter seam clear. */
export const GRAVE_MIN_ROW = START_Y + 6;

/** The chunk a coordinate falls in, on the square grave grid. */
function graveChunk(v: number): number {
  return Math.floor(v / GRAVE_CHUNK);
}

/**
 * The grave a chunk holds, or `null`. The cell is kept one tile in from the chunk's
 * side edges and at least one row below its top, so the whole nook (the grave's
 * row and the one above, a column either side) stays inside the chunk and the
 * lookups can answer from a tile's own chunk. A chunk whose nook would sit in — or
 * right beside — a trading post's or chest's pocket, or the starter seam, holds nothing; nor does one whose grave would hang over a natural cave.
 */
function rollGraveInChunk(chunkX: number, chunkY: number): Grave | null {
  if (chunkX < 0 || chunkY < 0) return null;
  if (rand(chunkX + 3187, chunkY + 2203) >= GRAVE_CHANCE) return null;
  const x = chunkX * GRAVE_CHUNK + 1 + Math.floor(rand(chunkX + 1291, chunkY + 2767) * (GRAVE_CHUNK - 2));
  const y = chunkY * GRAVE_CHUNK + 1 + Math.floor(rand(chunkX + 2459, chunkY + 613) * (GRAVE_CHUNK - 2));
  if (x - 1 < 2 || x + 1 > WORLD_W - 3) return null;
  if (y < GRAVE_MIN_ROW) return null;
  for (let dy = -2; dy <= 1; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const tx = x + dx, ty = y + dy;
      if (tradingPostPocket(tx, ty) || chestAt(tx, ty) || starterOreForCoordinate(tx, ty)) return null;
    }
  }
  if (naturalAirPocket(x, y + 1)) return null;
  return {x, y};
}
const graveInChunk = memoiseChunkRoll(rollGraveInChunk);

/** The grave lying exactly on this tile, or `null`. */
export function graveAt(x: number, y: number): Grave | null {
  const grave = graveInChunk(graveChunk(x), graveChunk(y));
  return grave && grave.x === x && grave.y === y ? grave : null;
}

/** Whether this tile falls within a grave's cleared nook: its row and the one above, a column either side. */
export function gravePocket(x: number, y: number): boolean {
  const grave = graveInChunk(graveChunk(x), graveChunk(y));
  return grave !== null && Math.abs(grave.x - x) <= 1 && (y === grave.y || y === grave.y - 1);
}

/** Every grave inside an inclusive tile rectangle, one chunk roll per overlapping chunk. */
export function gravesInRange(startX: number, startY: number, endX: number, endY: number): Grave[] {
  const graves: Grave[] = [];
  for (let cy = graveChunk(startY); cy <= graveChunk(endY); cy++) {
    for (let cx = graveChunk(startX); cx <= graveChunk(endX); cx++) {
      const grave = graveInChunk(cx, cy);
      if (grave && grave.x >= startX && grave.x <= endX && grave.y >= startY && grave.y <= endY) graves.push(grave);
    }
  }
  return graves;
}

/** Generate the tile at a world coordinate. Deterministic for a given (x,y). */
export function makeTile(x: number, y: number): Tile {
  // An indestructible bedrock cap seals the top of the world. Below it, the rows
  // between the cap and the cavern ceiling generate as ordinary terrain: they are
  // unreachable (upward digging is blocked), so they stay a fogged dark band.
  if (y < BEDROCK_ROWS) return {type:'rock', hp: TERRAIN.rock.hp};
  // The home cavern is deterministic air, never stored in the tile diff.
  if (isHomeCavern(x, y)) return {type:'air'};
  // The cavern floor is a stone-paved base: deterministic decor tiles the player
  // can drill out (~5 s) for Stone Blocks. Like the cavern it is not stored in the
  // diff; digging through one writes air to the diff as usual. The tile under the
  // spawn point is left as a plain dirt hatch, so the first dig down is cheap and
  // opens straight onto the starter coal below it.
  if (y === HOME_ROW + 1 && Math.abs(x - HOME_X) <= HOME_CAVERN.halfWidth) {
    if (x === HOME_X) return {type:'dirt', hp: TERRAIN.dirtHp.min, maxHp: TERRAIN.dirtHp.min};
    return {type:'decor', decor:'stoneBlock', hp: DECOR_HP, maxHp: DECOR_HP};
  }
  // A trading post carves a cleared 3×3 air pocket for its kiosk, derived from the
  // coordinate like the cavern rather than stored in the diff.
  if (y > HOME_ROW + 1 && tradingPostPocket(x,y)) return {type:'air'};
  // A buried chest clears just its own tile: a one-tile pocket drilled into like
  // any other, derived from the coordinate like a trading post.
  if (chestAt(x,y)) return {type:'air'};
  // A grave clears its 3×2 nook, the grave lying on the floor of it.
  if (gravePocket(x,y)) return {type:'air'};
  // Natural cave seams only open up below the cavern's immediate floor.
  if (y > HOME_ROW + 1 && naturalAirPocket(x,y)) return {type:'air'};
  const r = rand(x,y);
  let ore = starterOreForCoordinate(x, y);
  if (!ore && r < oreSpawnChanceAtDepth(y)) {
    ore = oreForDepthRoll(y, rand(x + 73, y - 47));
  }
  if (ore) {
    const hp = oreHpAtRow(y);
    return {type:'ore', ore, hp, maxHp: hp};
  }
  const {rock, hazard, enemy, dirtHp} = TERRAIN;
  const rockChance = y > rock.deepRow ? rock.deepChance : rock.chance;
  if (rand(x+9,y-3) < rockChance && y >= DANGER.rockMinRow) return {type:'rock', hp: rock.hp};
  if (y >= DANGER.hazardMinRow && rand(x+51,y-91) < Math.min(hazard.chanceMax, hazard.chanceBase + y / hazard.chanceRowDivisor)) {
    const hp = Math.max(hazard.hpMin, Math.ceil(hazard.hpBase + y / hazard.hpRowDivisor));
    return {type:'hazard', hp, maxHp: hp};
  }
  if (y >= DANGER.enemyMinRow && rand(x-37,y+83) < Math.min(enemy.chanceMax, enemy.chanceBase + y / enemy.chanceRowDivisor)) {
    const kind = enemyKindForDepthRoll(y, rand(x+211,y-157));
    const hp = enemyHealth(kind, Math.max(enemy.hpMin, Math.ceil(enemy.hpBase + y / enemy.hpRowDivisor)));
    return {type:'enemy', kind, hp, maxHp: hp};
  }
  const hp = Math.max(dirtHp.min, Math.ceil(y/dirtHp.rowDivisor)+dirtHp.base + (y > dirtHp.deepRow ? dirtHp.deepBonus : 0));
  return {type:'dirt', hp, maxHp: hp};
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

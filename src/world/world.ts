// Pure deterministic world generation. DOM-free / testable.
// No imports from dom.js, game.js, or balance.js.
import { BEDROCK_ROWS, DANGER, DECOR_HP, HOME_CAVERN, HOME_ROW, HOME_X, MAX_WORLD_ROW, ORES, START_Y, WORLD_CHUNK_ROWS, WORLD_W, isHomeCavern } from '../../shared/constants';
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
 * The two Lenin Portraits hung in the home cavern, on its second level either side
 * of the middle column. Deterministic decor like the stone floor: not stored in the
 * diff. They hang in open space (`isPassableDecor`): the ship flies through them and
 * the Construction Toolkit lifts them back aboard.
 */
export const HOME_PORTRAITS: readonly {readonly x: number; readonly y: number}[] = Object.freeze([
  Object.freeze({x: HOME_X - 1, y: HOME_ROW - 1}),
  Object.freeze({x: HOME_X + 1, y: HOME_ROW - 1})
]);

/** Whether a coordinate is one of the home cavern's two hung portraits. */
export function homePortraitAt(x: number, y: number): boolean {
  return HOME_PORTRAITS.some(p => p.x === x && p.y === y);
}

// --- Mine portraits ----------------------------------------------------------
//
// Rare Lenin Portraits also hang in small cave pockets throughout the mine. Like
// trading posts they are derived from the coordinate, never stored in the diff:
// per square chunk one roll decides whether the chunk holds a portrait, two more
// pick its cell, and the portrait clears its own 3×3 so it always hangs in open
// space the ship can reach once it breaks in. At 16-tile chunks and a 0.35 chance
// that is roughly one portrait per ~730 tiles — a screenful usually holds at most one.

/** Side of the square chunk mine-portrait placement is rolled per. */
export const PORTRAIT_CHUNK = 16;
/** Chance a chunk holds a portrait. */
export const PORTRAIT_CHANCE = 0.35;

/** The chunk a coordinate falls in, on the square portrait grid. */
function portraitChunk(v: number): number {
  return Math.floor(v / PORTRAIT_CHUNK);
}

/**
 * The portrait a chunk holds, or `null`. The cell is kept one tile in from the
 * chunk edges so its 3×3 pocket never spills into a neighbouring chunk (letting
 * the lookups answer from a tile's own chunk), and two tiles clear of the world's
 * side walls. The whole pocket sits below the cavern floor (`HOME_ROW + 1`), and a
 * chunk whose pocket would touch a trading post's pocket holds nothing.
 */
function minePortraitInChunk(chunkX: number, chunkY: number): {x: number; y: number} | null {
  if (chunkX < 0 || chunkY < 0) return null;
  if (rand(chunkX + 1543, chunkY + 719) >= PORTRAIT_CHANCE) return null;
  const x = chunkX * PORTRAIT_CHUNK + 1 + Math.floor(rand(chunkX + 331, chunkY + 1187) * (PORTRAIT_CHUNK - 2));
  const y = chunkY * PORTRAIT_CHUNK + 1 + Math.floor(rand(chunkX + 887, chunkY + 263) * (PORTRAIT_CHUNK - 2));
  if (x - 1 < 2 || x + 1 > WORLD_W - 3) return null;
  if (y - 1 <= HOME_ROW + 1) return null;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (tradingPostPocket(x + dx, y + dy)) return null;
    }
  }
  return {x, y};
}

/** Whether this exact tile is a Lenin Portrait hung in a mine cave pocket. */
export function minePortraitAt(x: number, y: number): boolean {
  const portrait = minePortraitInChunk(portraitChunk(x), portraitChunk(y));
  return portrait !== null && portrait.x === x && portrait.y === y;
}

/** Whether this tile falls within a mine portrait's cleared 3×3 pocket (portrait or a neighbour). */
export function minePortraitPocket(x: number, y: number): boolean {
  const portrait = minePortraitInChunk(portraitChunk(x), portraitChunk(y));
  return portrait !== null && Math.abs(portrait.x - x) <= 1 && Math.abs(portrait.y - y) <= 1;
}

/**
 * The mine portrait nearest (by straight-line distance) to a point, searching at
 * most `maxChunks` square rings of portrait chunks outward from the point's own
 * chunk (ring 0), or `null` when none hangs that close. Deterministic: rings are
 * walked in a fixed order and a tie keeps the smaller y, then the smaller x. The
 * search runs past the first ring with a hit only while a farther ring could still
 * hold something closer. Home-cavern portraits are not mine portraits.
 */
export function nearestMinePortrait(fromX: number, fromY: number, maxChunks: number): {x: number; y: number} | null {
  const cx = portraitChunk(fromX), cy = portraitChunk(fromY);
  let best: {x: number; y: number} | null = null;
  let bestDistance = Infinity;
  for (let ring = 0; ring <= maxChunks; ring++) {
    // Every tile of a ring-k chunk is more than (k-1)·chunk tiles away on some axis.
    if (best && (ring - 1) * PORTRAIT_CHUNK >= bestDistance) break;
    for (let chunkY = cy - ring; chunkY <= cy + ring; chunkY++) {
      for (let chunkX = cx - ring; chunkX <= cx + ring; chunkX++) {
        if (Math.max(Math.abs(chunkX - cx), Math.abs(chunkY - cy)) !== ring) continue;
        const portrait = minePortraitInChunk(chunkX, chunkY);
        if (!portrait) continue;
        const distance = Math.hypot(portrait.x - fromX, portrait.y - fromY);
        if (distance < bestDistance
          || (distance === bestDistance && best && (portrait.y < best.y || (portrait.y === best.y && portrait.x < best.x)))) {
          best = portrait;
          bestDistance = distance;
        }
      }
    }
  }
  return best;
}

// --- Chests ------------------------------------------------------------------
//
// Small loot chests lie buried throughout the mine. Like trading posts and mine
// portraits they are derived from the coordinate, never stored: per square chunk
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
 * right beside — a trading post's or mine portrait's pocket holds nothing, so a
 * chest never shares a fixture's cleared space.
 */
function chestInChunk(chunkX: number, chunkY: number): Chest | null {
  if (chunkX < 0 || chunkY < 0) return null;
  if (rand(chunkX + 2131, chunkY + 1471) >= CHEST_CHANCE) return null;
  const x = chunkX * CHEST_CHUNK + 1 + Math.floor(rand(chunkX + 571, chunkY + 1933) * (CHEST_CHUNK - 2));
  const y = chunkY * CHEST_CHUNK + 1 + Math.floor(rand(chunkX + 1777, chunkY + 389) * (CHEST_CHUNK - 2));
  if (x < 2 || x > WORLD_W - 3) return null;
  if (y < CHEST_MIN_ROW) return null;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (tradingPostPocket(x + dx, y + dy) || minePortraitPocket(x + dx, y + dy)) return null;
    }
  }
  return {x, y};
}

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

/** Generate the tile at a world coordinate. Deterministic for a given (x,y). */
export function makeTile(x: number, y: number): Tile {
  // An indestructible bedrock cap seals the top of the world. Below it, the rows
  // between the cap and the cavern ceiling generate as ordinary terrain: they are
  // unreachable (upward digging is blocked), so they stay a fogged dark band.
  if (y < BEDROCK_ROWS) return {type:'rock', hp:999};
  // Two Lenin Portraits hang in the cavern, flanking its middle column one row
  // above the floor: deterministic decor checked before the cavern's air.
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
  // A rare Lenin Portrait hangs in its own cleared 3×3 cave pocket, derived from
  // the coordinate like a trading post.
  if (y > HOME_ROW + 1 && minePortraitAt(x,y)) return {type:'decor', decor:'leninPortrait', hp: DECOR_HP, maxHp: DECOR_HP};
  if (y > HOME_ROW + 1 && minePortraitPocket(x,y)) return {type:'air'};
  // A buried chest clears just its own tile: a one-tile pocket drilled into like
  // any other, derived from the coordinate like a trading post.
  if (chestAt(x,y)) return {type:'air'};
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

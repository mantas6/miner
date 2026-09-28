import { describe, it, expect } from 'vitest';
import {
  CHEST_CHUNK,
  CHEST_MIN_ROW,
  GRAVE_CHUNK,
  GRAVE_MIN_ROW,
  HOME_PORTRAITS,
  PORTRAIT_CHUNK,
  TRADING_POST_CHUNK,
  TRADING_POST_MIN_ROW,
  chestAt,
  chestsInRange,
  ensureWorldRow,
  graveAt,
  gravePocket,
  gravesInRange,
  homePortraitAt,
  rand,
  naturalAirPocket,
  makeTile,
  minePortraitAt,
  minePortraitPocket,
  nearestMinePortrait,
  oreForDepthRoll,
  oreSpawnChanceAtDepth,
  starterOreForCoordinate,
  tradingPostAt,
  tradingPostPocket
} from './world';
import { BEDROCK_ROWS, DANGER, DECOR_HP, HOME_CAVERN, HOME_CAVERN_TOP, HOME_ROW, HOME_X, MAX_WORLD_ROW, ORES, START_Y, WORLD_CHUNK_ROWS, WORLD_W, isHomeCavern } from '../../shared/constants';
import type { Tile } from '../core/types';

describe('rand', () => {
  it('is deterministic for the same coordinate', () => {
    expect(rand(3, 7)).toBe(rand(3, 7));
    expect(rand(0, 0)).toBe(rand(0, 0));
    expect(rand(42, 199)).toBe(rand(42, 199));
  });

  it('returns values within [0, 1)', () => {
    const coords = [[0, 0], [3, 7], [42, 199], [89, 318], [13, 256], [1, 1]];
    for (const [x, y] of coords) {
      const v = rand(x, y);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('naturalAirPocket', () => {
  it('is deterministic', () => {
    expect(naturalAirPocket(10, 50)).toBe(naturalAirPocket(10, 50));
  });
});

describe('starterOreForCoordinate', () => {
  it('places a compact low-tier seam just below the home cavern', () => {
    const shaftX = Math.floor(WORLD_W / 2);
    const expected = [
      {x: shaftX, y: HOME_ROW + 2, name: 'Coal'},
      {x: shaftX - 2, y: HOME_ROW + 3, name: 'Coal'},
      {x: shaftX + 2, y: HOME_ROW + 4, name: 'Iron'},
      {x: shaftX - 1, y: HOME_ROW + 5, name: 'Iron'}
    ];

    for (const {x, y, name} of expected) {
      const ore = starterOreForCoordinate(x, y);
      expect(ore?.name).toBe(name);
      expect(ore?.min).toBeLessThanOrEqual(y);
    }
  });

  it('does not turn the whole opening around the shaft into ore', () => {
    const shaftX = Math.floor(WORLD_W / 2);
    let starterOreTiles = 0;
    let nonStarterTiles = 0;
    for (let y = HOME_ROW; y <= HOME_ROW + 8; y++) {
      for (let x = shaftX - 4; x <= shaftX + 4; x++) {
        if (starterOreForCoordinate(x, y)) starterOreTiles++;
        else nonStarterTiles++;
      }
    }

    expect(starterOreTiles).toBe(4);
    expect(nonStarterTiles).toBeGreaterThan(starterOreTiles * 12);
  });
});

describe('ore depth distribution', () => {
  const sampledNames = (depth: number) => {
    const names = new Set<string>();
    for (let i = 0; i < 10000; i++) {
      const ore = oreForDepthRoll(depth, (i + .5) / 10000);
      if (ore) names.add(ore.name);
    }
    return names;
  };

  it('keeps mineral bands ordered by tier and reaches the bottom of the mine', () => {
    for (let index = 1; index < ORES.length; index++) {
      expect(ORES[index].min).toBeGreaterThan(ORES[index - 1].min);
      expect(ORES[index].value).toBeGreaterThan(ORES[index - 1].value);
    }
    expect(ORES[0].min).toBeLessThanOrEqual(START_Y);
    expect(Math.max(...ORES.map(ore => ore.max))).toBe(MAX_WORLD_ROW);

    for (let depth = START_Y; depth <= START_Y + 950; depth++) {
      expect(oreForDepthRoll(depth, .5)).not.toBeNull();
    }
  });

  it('enforces both edges of every mineral band', () => {
    for (const ore of ORES) {
      expect(sampledNames(ore.min)).toContain(ore.name);
      expect(sampledNames(ore.max)).toContain(ore.name);
      expect(sampledNames(ore.min - 1)).not.toContain(ore.name);
      expect(sampledNames(ore.max + 1)).not.toContain(ore.name);
    }
  });

  it('weights low tiers early and reserves the richest tiers for deep bands', () => {
    expect([...sampledNames(START_Y + 100)]).toEqual(['Coal', 'Iron', 'Copper', 'Silver']);
    expect([...sampledNames(START_Y + 300)]).toEqual(['Copper', 'Silver', 'Gold', 'Ruby']);
    expect([...sampledNames(START_Y + 900)]).toEqual(['Alienite', 'Uranium', 'Core Shard']);

    const earlyCounts = new Map<string, number>();
    for (let i = 0; i < 10000; i++) {
      const name = oreForDepthRoll(START_Y + 100, (i + .5) / 10000)?.name;
      if (name) earlyCounts.set(name, (earlyCounts.get(name) || 0) + 1);
    }
    expect(earlyCounts.get('Coal')).toBeGreaterThan(earlyCounts.get('Copper')!);
    expect(earlyCounts.get('Copper')).toBeGreaterThan(earlyCounts.get('Silver')!);
  });

  it('keeps ore frequency stable when mineral tiers transition', () => {
    expect(oreSpawnChanceAtDepth(START_Y)).toBeGreaterThan(.10);
    expect(oreSpawnChanceAtDepth(START_Y + 600)).toBeCloseTo(.22);
    expect(oreSpawnChanceAtDepth(START_Y + 900)).toBeCloseTo(.22);
  });
});

/** The first trading post found by scanning an interior column band, or throws. */
function firstPostInBand() {
  for (let y = TRADING_POST_MIN_ROW; y < TRADING_POST_MIN_ROW + 4000; y++) {
    for (let x = TRADING_POST_CHUNK; x < TRADING_POST_CHUNK * 2; x++) {
      const post = tradingPostAt(x, y);
      if (post) return post;
    }
  }
  throw new Error('no trading post found in the sampled band');
}

describe('trading posts', () => {
  it('places a post in 8–16% of qualifying chunks, over a sampled interior band', () => {
    // The middle column of chunks (x 32..63) sits well inside the world's side
    // walls, so no post is ever rejected for lack of room — the density there is
    // exactly the placement roll.
    const chunkX = 1;
    let chunks = 0;
    let withPost = 0;
    for (let chunkY = 2; chunkY < 260; chunkY++) {
      chunks++;
      let found = false;
      for (let y = chunkY * TRADING_POST_CHUNK; y < chunkY * TRADING_POST_CHUNK + TRADING_POST_CHUNK && !found; y++) {
        for (let x = chunkX * TRADING_POST_CHUNK; x < chunkX * TRADING_POST_CHUNK + TRADING_POST_CHUNK; x++) {
          if (tradingPostAt(x, y)) { found = true; break; }
        }
      }
      if (found) withPost++;
    }
    const density = withPost / chunks;
    expect(density).toBeGreaterThanOrEqual(0.08);
    expect(density).toBeLessThanOrEqual(0.16);
  });

  it('derives the same post from a coordinate every time', () => {
    const post = firstPostInBand();
    expect(tradingPostAt(post.x, post.y)).toEqual(post);
    // A post's own tile is inside its pocket; a tile two away never is.
    expect(tradingPostPocket(post.x, post.y)).toBe(true);
    expect(tradingPostPocket(post.x + 2, post.y)).toBe(false);
  });

  it('never places a post in or near the home cavern, nor above the depth gate', () => {
    for (let y = 0; y <= HOME_ROW + 3; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        expect(tradingPostAt(x, y)).toBeNull();
        expect(tradingPostPocket(x, y)).toBe(false);
      }
    }
    // Every post found in the band sits below the depth gate and outside the cavern.
    const chunkX = 1;
    for (let chunkY = 2; chunkY < 40; chunkY++) {
      for (let y = chunkY * TRADING_POST_CHUNK; y < chunkY * TRADING_POST_CHUNK + TRADING_POST_CHUNK; y++) {
        for (let x = chunkX * TRADING_POST_CHUNK; x < chunkX * TRADING_POST_CHUNK + TRADING_POST_CHUNK; x++) {
          const post = tradingPostAt(x, y);
          if (!post) continue;
          expect(post.y).toBeGreaterThanOrEqual(TRADING_POST_MIN_ROW);
          expect(isHomeCavern(post.x, post.y)).toBe(false);
        }
      }
    }
  });
});

/** Every mine portrait in rows [y0, y1), scanning the whole world width. */
function minePortraitsIn(y0: number, y1: number): {x: number; y: number}[] {
  const found: {x: number; y: number}[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < WORLD_W; x++) if (minePortraitAt(x, y)) found.push({x, y});
  }
  return found;
}

describe('mine portraits', () => {
  const portraits = minePortraitsIn(0, 1200);

  it('hangs roughly one per three 16-tile chunks, derived the same every time', () => {
    expect(PORTRAIT_CHUNK).toBe(16);
    // ~0.35 per chunk (fewer at the walls): 1200 rows × 90 columns ≈ 420 chunks.
    expect(portraits.length).toBeGreaterThan(90);
    expect(portraits.length).toBeLessThan(170);
    for (const {x, y} of portraits.slice(0, 20)) {
      expect(minePortraitAt(x, y)).toBe(true);
      expect(makeTile(x, y)).toEqual(makeTile(x, y));
    }
  });

  it('is a Lenin Portrait decor tile in its own cleared 3×3 pocket', () => {
    for (const {x, y} of portraits) {
      expect(makeTile(x, y)).toEqual({type: 'decor', decor: 'leninPortrait', hp: DECOR_HP, maxHp: DECOR_HP});
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          expect(minePortraitPocket(x + dx, y + dy)).toBe(true);
          if (dx || dy) expect(makeTile(x + dx, y + dy)).toEqual({type: 'air'});
        }
      }
      expect(minePortraitPocket(x + 2, y)).toBe(false);
      expect(x - 1).toBeGreaterThanOrEqual(2);
      expect(x + 1).toBeLessThanOrEqual(WORLD_W - 3);
    }
  });

  it('never hangs one, or its pocket, at or above the cavern floor', () => {
    for (let y = 0; y <= HOME_ROW + 1; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        expect(minePortraitAt(x, y)).toBe(false);
        expect(minePortraitPocket(x, y)).toBe(false);
      }
    }
    expect(portraits.every(p => p.y - 1 > HOME_ROW + 1)).toBe(true);
  });

  it('never overlaps a trading post pocket', () => {
    for (const {x, y} of portraits) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) expect(tradingPostPocket(x + dx, y + dy)).toBe(false);
      }
    }
  });

  it('finds the nearest one within a few chunks of a deep point, deterministically', () => {
    for (let i = 0; i < 20; i++) {
      const fromX = Math.floor(rand(i + 5, 17) * WORLD_W);
      const fromY = 200 + Math.floor(rand(i + 11, 29) * 5000);
      const nearest = nearestMinePortrait(fromX, fromY, 3);
      expect(nearest).not.toBeNull();
      expect(minePortraitAt(nearest!.x, nearest!.y)).toBe(true);
      expect(nearestMinePortrait(fromX, fromY, 3)).toEqual(nearest);
      // Nothing in the rows around it hangs closer.
      const distance = Math.hypot(nearest!.x - fromX, nearest!.y - fromY);
      for (const other of minePortraitsIn(fromY - Math.ceil(distance), fromY + Math.ceil(distance) + 1)) {
        expect(Math.hypot(other.x - fromX, other.y - fromY)).toBeGreaterThanOrEqual(distance);
      }
    }
    expect(nearestMinePortrait(45, 0, 0)).toBeNull();
  });
});

describe('chests', () => {
  const chests = chestsInRange(0, 0, WORLD_W - 1, 1199);

  it('buries roughly one per four 16-tile chunks, derived the same every time', () => {
    expect(CHEST_CHUNK).toBe(16);
    // ~0.25 per chunk, fewer at the walls, above the depth gate and beside the
    // fixtures: 1200 rows × 90 columns ≈ 400 qualifying chunks.
    expect(chests.length).toBeGreaterThan(65);
    expect(chests.length).toBeLessThan(130);
    expect(chestsInRange(0, 0, WORLD_W - 1, 1199)).toEqual(chests);
    for (const {x, y} of chests.slice(0, 20)) expect(chestAt(x, y)).toEqual({x, y});
  });

  it('agrees tile by tile with chestAt over a scanned band', () => {
    const scanned: {x: number; y: number}[] = [];
    for (let y = 0; y < 300; y++) for (let x = 0; x < WORLD_W; x++) if (chestAt(x, y)) scanned.push({x, y});
    const ranged = chestsInRange(0, 0, WORLD_W - 1, 299);
    const order = (a: {x: number; y: number}, b: {x: number; y: number}) => a.y - b.y || a.x - b.x;
    expect(ranged.sort(order)).toEqual(scanned.sort(order));
    // A sub-rectangle keeps only what lies inside it.
    const inner = chestsInRange(20, 40, 60, 120);
    expect(inner.every(c => c.x >= 20 && c.x <= 60 && c.y >= 40 && c.y <= 120)).toBe(true);
    expect(inner.length).toBe(scanned.filter(c => c.x >= 20 && c.x <= 60 && c.y >= 40 && c.y <= 120).length);
  });

  it('clears just its own tile, below the depth gate and clear of the side walls', () => {
    for (const {x, y} of chests) {
      expect(makeTile(x, y)).toEqual({type: 'air'});
      expect(y).toBeGreaterThanOrEqual(CHEST_MIN_ROW);
      expect(x).toBeGreaterThanOrEqual(2);
      expect(x).toBeLessThanOrEqual(WORLD_W - 3);
    }
    for (let y = 0; y < CHEST_MIN_ROW; y++) for (let x = 0; x < WORLD_W; x++) expect(chestAt(x, y)).toBeNull();
  });

  it('never shares — or touches — a trading post or mine portrait pocket', () => {
    for (const {x, y} of chests) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          expect(tradingPostPocket(x + dx, y + dy)).toBe(false);
          expect(minePortraitPocket(x + dx, y + dy)).toBe(false);
        }
      }
      expect(tradingPostAt(x, y)).toBeNull();
      expect(minePortraitAt(x, y)).toBe(false);
    }
  });
});

describe('graves', () => {
  const graves = gravesInRange(0, 0, WORLD_W - 1, 1199);

  it('lays roughly one per seven 16-tile chunks, derived the same every time', () => {
    expect(GRAVE_CHUNK).toBe(16);
    // ~0.15 per chunk, fewer at the walls, above the depth gate, beside the
    // fixtures and over caves: 1200 rows × 90 columns ≈ 400 qualifying chunks.
    expect(graves.length).toBeGreaterThan(30);
    expect(graves.length).toBeLessThan(90);
    expect(gravesInRange(0, 0, WORLD_W - 1, 1199)).toEqual(graves);
    for (const {x, y} of graves.slice(0, 20)) expect(graveAt(x, y)).toEqual({x, y});
  });

  it('agrees tile by tile with graveAt over a scanned band', () => {
    const scanned: {x: number; y: number}[] = [];
    for (let y = 0; y < 300; y++) for (let x = 0; x < WORLD_W; x++) if (graveAt(x, y)) scanned.push({x, y});
    const order = (a: {x: number; y: number}, b: {x: number; y: number}) => a.y - b.y || a.x - b.x;
    expect(gravesInRange(0, 0, WORLD_W - 1, 299).sort(order)).toEqual(scanned.sort(order));
  });

  it('clears a 3-wide, 2-tall nook with the grave on its floor, below the depth gate', () => {
    for (const {x, y} of graves) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const ny of [y - 1, y]) {
          expect(gravePocket(x + dx, ny)).toBe(true);
          expect(makeTile(x + dx, ny)).toEqual({type: 'air'});
        }
        // Nothing beyond the nook belongs to it: not the row above, nor the floor.
        expect(gravePocket(x + dx, y - 2)).toBe(false);
        expect(gravePocket(x + dx, y + 1)).toBe(false);
      }
      expect(gravePocket(x - 2, y)).toBe(false);
      expect(gravePocket(x + 2, y)).toBe(false);
      // It lies on something: the tile under the grave is not open cave.
      expect(makeTile(x, y + 1).type).not.toBe('air');
      expect(y).toBeGreaterThanOrEqual(GRAVE_MIN_ROW);
      expect(x - 1).toBeGreaterThanOrEqual(2);
      expect(x + 1).toBeLessThanOrEqual(WORLD_W - 3);
    }
    for (let y = 0; y < GRAVE_MIN_ROW; y++) for (let x = 0; x < WORLD_W; x++) expect(graveAt(x, y)).toBeNull();
  });

  it('never shares — or touches — a trading post, mine portrait or chest', () => {
    for (const {x, y} of graves) {
      for (let dy = -2; dy <= 1; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          expect(tradingPostPocket(x + dx, y + dy)).toBe(false);
          expect(minePortraitPocket(x + dx, y + dy)).toBe(false);
          expect(chestAt(x + dx, y + dy)).toBeNull();
          expect(starterOreForCoordinate(x + dx, y + dy)).toBeNull();
        }
      }
    }
  });
});

describe('makeTile', () => {
  it('is deterministic', () => {
    expect(makeTile(10, 50)).toEqual(makeTile(10, 50));
    expect(makeTile(0, 0)).toEqual(makeTile(0, 0));
  });

  it('caps the world with an indestructible bedrock band at the very top', () => {
    for (let y = 0; y < BEDROCK_ROWS; y++) {
      for (let x = 0; x < WORLD_W; x += 7) {
        expect(makeTile(x, y)).toEqual({type: 'rock', hp: 999});
      }
    }
  });

  it('fills the rows between the bedrock cap and the cavern with plain dirt', () => {
    for (let y = BEDROCK_ROWS; y < HOME_CAVERN_TOP; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        // Unreachable filler above the cavern: ordinary dirt, never bedrock, ore,
        // an air pocket, a hazard, or an enemy — nothing generates this shallow.
        expect(makeTile(x, y).type).toBe('dirt');
      }
    }
  });

  it('carves a deterministic air cavern for the home base, bar its two portraits', () => {
    const cavern: Tile[] = [];
    for (let y = HOME_CAVERN_TOP; y <= HOME_ROW; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        if (isHomeCavern(x, y) && !homePortraitAt(x, y)) cavern.push(makeTile(x, y));
      }
    }

    expect(cavern.length).toBeGreaterThan(0);
    expect(cavern.every(tile => tile.type === 'air')).toBe(true);
  });

  it('hangs a Lenin Portrait either side of the cavern\'s middle column, one row up', () => {
    const left = {x: HOME_X - 1, y: HOME_ROW - 1};
    const right = {x: HOME_X + 1, y: HOME_ROW - 1};
    expect(HOME_PORTRAITS).toEqual([left, right]);
    expect(left).toEqual({x: 44, y: 19});
    expect(right).toEqual({x: 46, y: 19});
    for (const {x, y} of HOME_PORTRAITS) {
      expect(isHomeCavern(x, y)).toBe(true);
      expect(makeTile(x, y)).toEqual({type: 'decor', decor: 'leninPortrait', hp: DECOR_HP, maxHp: DECOR_HP});
    }
    // Only those two: the middle column between them and the tiles around stay air.
    expect(makeTile(HOME_X, HOME_ROW - 1)).toEqual({type: 'air'});
    expect(makeTile(left.x - 1, left.y)).toEqual({type: 'air'});
    expect(makeTile(right.x + 1, right.y)).toEqual({type: 'air'});
    expect(makeTile(left.x, left.y + 1)).toEqual({type: 'air'});
    expect(makeTile(right.x, right.y - 1)).toEqual({type: 'air'});
    expect(homePortraitAt(HOME_X, HOME_ROW - 1)).toBe(false);
  });

  it('paves the cavern floor with stone blocks', () => {
    for (let x = HOME_X - HOME_CAVERN.halfWidth; x <= HOME_X + HOME_CAVERN.halfWidth; x++) {
      expect(makeTile(x, HOME_ROW + 1)).toEqual({type: 'decor', decor: 'stoneBlock', hp: DECOR_HP, maxHp: DECOR_HP});
    }
    // Just past the cavern's width the floor row is ordinary generated terrain again.
    expect(makeTile(HOME_X - HOME_CAVERN.halfWidth - 1, HOME_ROW + 1).type).not.toBe('decor');
    expect(makeTile(HOME_X + HOME_CAVERN.halfWidth + 1, HOME_ROW + 1).type).not.toBe('decor');
  });

  it('never spawns ore above its minimum depth', () => {
    const maxY = START_Y + 952;
    for (let x = 0; x < WORLD_W; x += 3) {
      for (let y = 0; y < maxY; y++) {
        const tile = makeTile(x, y);
        if (tile.type === 'ore') {
          expect(tile.ore.min).toBeLessThanOrEqual(y);
        }
      }
    }
  });

  it('generates at least one ore in a deep scan', () => {
    let foundOre = false;
    const maxY = START_Y + 952;
    for (let x = 0; x < WORLD_W && !foundOre; x += 3) {
      for (let y = 0; y < maxY; y++) {
        if (makeTile(x, y).type === 'ore') { foundOre = true; break; }
      }
    }
    expect(foundOre).toBe(true);
  });

  it('guarantees several reachable Coal/Iron tiles just below the home cavern', () => {
    const shaftX = Math.floor(WORLD_W / 2);
    const earlyTiles = [];
    for (let y = HOME_ROW + 1; y <= HOME_ROW + 8; y++) {
      for (let x = shaftX - 3; x <= shaftX + 3; x++) {
        const tile = makeTile(x, y);
        if (tile.type === 'ore') earlyTiles.push({x, y, name: tile.ore.name});
      }
    }

    const lowTierStarterOres = earlyTiles.filter(tile =>
      (tile.name === 'Coal' || tile.name === 'Iron') &&
      tile.y >= HOME_ROW + 2 &&
      tile.y <= HOME_ROW + 5
    );
    expect(lowTierStarterOres.length).toBeGreaterThanOrEqual(4);
    expect(lowTierStarterOres.some(tile => tile.x === shaftX && tile.y === HOME_ROW + 2)).toBe(true);
  });

  it('keeps late-game hazards and dormant fiends intact', () => {
    let hazards = 0;
    let enemies = 0;
    for (let y = DANGER.hazardMinRow; y <= DANGER.hazardMinRow + 200; y++) {
      for (let x = 1; x < WORLD_W - 1; x++) {
        const type = makeTile(x, y).type;
        if (type === 'hazard') hazards++;
        if (type === 'enemy') enemies++;
      }
    }
    expect(hazards).toBeGreaterThan(0);
    expect(enemies).toBeGreaterThan(0);
  });

  it('carves an air pocket for a trading post', () => {
    const post = firstPostInBand();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        expect(makeTile(post.x + dx, post.y + dy).type).toBe('air');
      }
    }
  });

  it('generates deterministic terrain chunks on demand beyond 10,000 m', () => {
    const deepRow = START_Y + 1137;
    const first: Tile[][] = [];
    const second: Tile[][] = [];

    const firstRow = ensureWorldRow(first, deepRow);
    const secondRow = ensureWorldRow(second, deepRow);

    expect(first.length).toBe(Math.ceil((deepRow + 1) / WORLD_CHUNK_ROWS) * WORLD_CHUNK_ROWS);
    expect(first[100]).toBeUndefined();
    expect(firstRow).toEqual(secondRow);
    expect(firstRow?.[17]).toEqual(makeTile(17, deepRow));
  });
});

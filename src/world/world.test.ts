import { describe, it, expect } from 'vitest';
import { ensureWorldRow, rand, naturalAirPocket, makeTile, oreForDepthRoll, oreSpawnChanceAtDepth, starterOreForCoordinate } from './world';
import { DANGER, DECOR_HP, HOME_CAVERN, HOME_CAVERN_TOP, HOME_ROW, HOME_X, MAX_WORLD_ROW, ORES, START_Y, WORLD_CHUNK_ROWS, WORLD_W, isHomeCavern } from '../../shared/constants';
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

describe('makeTile', () => {
  it('is deterministic', () => {
    expect(makeTile(10, 50)).toEqual(makeTile(10, 50));
    expect(makeTile(0, 0)).toEqual(makeTile(0, 0));
  });

  it('caps the world with indestructible bedrock above the home cavern', () => {
    for (let y = 0; y < HOME_CAVERN_TOP; y++) {
      for (let x = 0; x < WORLD_W; x += 7) {
        expect(makeTile(x, y)).toEqual({type: 'rock', hp: 999});
      }
    }
  });

  it('carves a deterministic air cavern for the home base', () => {
    const cavern: Tile[] = [];
    for (let y = HOME_CAVERN_TOP; y <= HOME_ROW; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        if (isHomeCavern(x, y)) cavern.push(makeTile(x, y));
      }
    }

    expect(cavern.length).toBeGreaterThan(0);
    expect(cavern.every(tile => tile.type === 'air')).toBe(true);
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

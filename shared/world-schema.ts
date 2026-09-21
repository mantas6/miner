// Single source of truth for the world's data shapes.
//
// Both the browser client and the Node relay import these zod schemas, so a
// value that one side accepts is accepted by the other — the divergence between
// the old hand-written client validators and the relay's own checks used to
// silently drop mutations and desync the shared world.
//
// Every domain type below is derived from its schema with `z.infer`; the
// schemas themselves use the *stricter* of the two historical rule sets.

import { z } from 'zod';
import {
  ENEMY_KINDS,
  MAX_ENEMIES,
  MAX_EXPLORED_CHARS,
  MAX_STATE_TILE_ENTRIES,
  MAX_VALUABLE_VALUE,
  MAX_WORLD_ROW,
  WORLD_STATE_VERSION,
  WORLD_W
} from './constants.ts';
import { isEncodedExploration } from './exploration-codec.ts';

/** Any real number: zod rejects `NaN` and `±Infinity` for `z.number()`. */
const real = z.number();
/** Safe integer (zod's `int` bounds by `Number.MAX_SAFE_INTEGER`). */
const integer = z.int();
/** Remaining durability. Never negative — the relay has always required this. */
const hp = real.min(0);
/** Total durability. A destructible tile/enemy always has at least 1. */
const maxHp = real.min(1);
const column = integer.min(0).max(WORLD_W - 1);
const row = integer.min(0).max(MAX_WORLD_ROW);
/** Continuous (interpolated) world coordinates. */
const drawColumn = real.min(0).max(WORLD_W - 1);
const drawRow = real.min(0).max(MAX_WORLD_ROW);

/** Revisions identify a generation of the shared world; they start at 1. */
export const revisionSchema = integer.min(1);

export const enemyKindSchema = z.enum(ENEMY_KINDS);

/**
 * A sellable ore or artifact definition, as embedded in a tile. Bounds match
 * the tables in `shared/constants.ts`.
 */
export const valuableSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().min(1).max(32),
  value: real.min(0).max(MAX_VALUABLE_VALUE),
  min: real.min(0).max(MAX_WORLD_ROW),
  max: real.min(0).max(MAX_WORLD_ROW),
  chance: real.min(0).max(1)
});

export const oreSchema = valuableSchema;
export const artifactSchema = valuableSchema;

export const airTileSchema = z.object({ type: z.literal('air') });
export const dirtTileSchema = z.object({ type: z.literal('dirt'), hp, maxHp });
/** Rock is indestructible scenery, so it carries no `maxHp`. */
export const rockTileSchema = z.object({ type: z.literal('rock'), hp });
export const oreTileSchema = z.object({ type: z.literal('ore'), ore: oreSchema, hp, maxHp });
export const hazardTileSchema = z.object({ type: z.literal('hazard'), hp, maxHp });
export const artifactTileSchema = z.object({ type: z.literal('artifact'), artifact: artifactSchema, hp, maxHp });
export const motherlodeTileSchema = z.object({ type: z.literal('motherlode'), hp, maxHp });
/** Dormant enemy. Legacy payloads omit `kind`; they normalize to the weakest. */
export const dormantEnemyTileSchema = z.object({
  type: z.literal('enemy'),
  kind: enemyKindSchema.default('tunnelFiend'),
  hp,
  maxHp
});

export const tileSchema = z.discriminatedUnion('type', [
  airTileSchema,
  dirtTileSchema,
  rockTileSchema,
  oreTileSchema,
  hazardTileSchema,
  artifactTileSchema,
  motherlodeTileSchema,
  dormantEnemyTileSchema
]);

/** One tile mutation addressed by world coordinate. */
export const tileEntrySchema = z.object({ x: column, y: row, tile: tileSchema });

/** Generated terrain never contains air: air is the result of digging. */
export const generatedTileEntrySchema = tileEntrySchema.refine(
  entry => entry.tile.type !== 'air',
  'generated tiles must not be air'
);

/** One live enemy, as carried by snapshots and by the persisted world. */
export const enemyEntrySchema = z.object({
  id: integer.min(1),
  kind: enemyKindSchema.default('tunnelFiend'),
  x: drawColumn,
  y: drawRow,
  drawX: drawColumn,
  drawY: drawRow,
  hp,
  maxHp,
  alive: z.boolean()
});

/** Row-major exploration indexes, run-length encoded as `"12,20-28"`. */
export const explorationSchema = z.string().max(MAX_EXPLORED_CHARS).refine(
  isEncodedExploration,
  'malformed or oversized exploration ranges'
);

export const tileEntriesSchema = z.array(tileEntrySchema).max(MAX_STATE_TILE_ENTRIES);
export const generatedTileEntriesSchema = z.array(generatedTileEntrySchema).max(MAX_STATE_TILE_ENTRIES);
export const enemyEntriesSchema = z.array(enemyEntrySchema).max(MAX_ENEMIES);

/**
 * The authoritative world, shared by the relay's persisted file and the
 * `worldState` message that hydrates a joining client.
 */
export const worldStateFields = {
  version: z.literal(WORLD_STATE_VERSION),
  revision: revisionSchema,
  initialized: z.boolean(),
  tiles: tileEntriesSchema,
  enemies: enemyEntriesSchema,
  explored: explorationSchema
};

/** Persisted world-state file, with the relay's whole-file integrity rules. */
export const worldStateSchema = z.object(worldStateFields)
  .refine(
    state => new Set(state.tiles.map(entry => `${entry.x},${entry.y}`)).size === state.tiles.length,
    'duplicate tile coordinates'
  )
  .refine(
    state => state.initialized || (!state.tiles.length && !state.enemies.length && !state.explored),
    'an uninitialized world must be empty'
  );

export type Ore = z.infer<typeof oreSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type EnemyKind = z.infer<typeof enemyKindSchema>;
export type AirTile = z.infer<typeof airTileSchema>;
export type DirtTile = z.infer<typeof dirtTileSchema>;
export type RockTile = z.infer<typeof rockTileSchema>;
export type OreTile = z.infer<typeof oreTileSchema>;
export type HazardTile = z.infer<typeof hazardTileSchema>;
export type ArtifactTile = z.infer<typeof artifactTileSchema>;
export type MotherlodeTile = z.infer<typeof motherlodeTileSchema>;
export type DormantEnemyTile = z.infer<typeof dormantEnemyTileSchema>;
export type Tile = z.infer<typeof tileSchema>;
export type TileEntry = z.infer<typeof tileEntrySchema>;
export type EnemyEntry = z.infer<typeof enemyEntrySchema>;
export type WorldState = z.infer<typeof worldStateSchema>;

/** Parse a tile, returning `null` instead of throwing. */
export function parseTile(value: unknown): Tile | null {
  const result = tileSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Parse a persisted world state, returning `null` instead of throwing. */
export function parseWorldState(value: unknown): WorldState | null {
  const result = worldStateSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** A pristine world for the given revision. */
export function emptyWorldState(revision = 1): WorldState {
  return { version: WORLD_STATE_VERSION, revision, initialized: false, tiles: [], enemies: [], explored: '' };
}

// Single source of truth for the world's data shapes.
//
// Every domain type below is derived from its zod schema with `z.infer`, and the
// save's tile diff is validated against the same schemas on load, so a tile the
// game can build is exactly a tile a save can restore.

import { z } from 'zod';
import {
  DECOR_HP,
  DECOR_IDS,
  ENEMY_KINDS,
  MAX_LOADED_TILE_ENTRIES,
  MAX_VALUABLE_VALUE,
  MAX_WORLD_ROW,
  WORLD_W
} from './constants.ts';

/** Any real number: zod rejects `NaN` and `±Infinity` for `z.number()`. */
const real = z.number();
/** Safe integer (zod's `int` bounds by `Number.MAX_SAFE_INTEGER`). */
const integer = z.int();
/** Remaining durability. Never negative. */
const hp = real.min(0);
/** Total durability. A destructible tile/enemy always has at least 1. */
const maxHp = real.min(1);
const column = integer.min(0).max(WORLD_W - 1);
const row = integer.min(0).max(MAX_WORLD_ROW);

export const enemyKindSchema = z.enum(ENEMY_KINDS);

/**
 * A sellable ore definition, as embedded in a tile. Bounds match the table in
 * `shared/constants.ts`.
 */
export const oreSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().min(1).max(32),
  value: real.min(0).max(MAX_VALUABLE_VALUE),
  min: real.min(0).max(MAX_WORLD_ROW),
  max: real.min(0).max(MAX_WORLD_ROW),
  chance: real.min(0).max(1)
});

/** The craftable decoration tiles the player can set down in the mine. */
export const decorIdSchema = z.enum(DECOR_IDS);

export const airTileSchema = z.object({ type: z.literal('air') });
export const dirtTileSchema = z.object({ type: z.literal('dirt'), hp, maxHp });
/** Rock is indestructible scenery, so it carries no `maxHp`. */
export const rockTileSchema = z.object({ type: z.literal('rock'), hp });
export const oreTileSchema = z.object({ type: z.literal('ore'), ore: oreSchema, hp, maxHp });
export const hazardTileSchema = z.object({ type: z.literal('hazard'), hp, maxHp });
/**
 * A placed decoration. Cosmetic and solid: it takes several seconds of drilling
 * to break (`DECOR_HP`), then is dug back out (returning the item) or blown up.
 * `hp`/`maxHp` default to `DECOR_HP` so decor tiles saved before durability
 * existed still validate without a save-version bump.
 */
export const decorTileSchema = z.object({
  type: z.literal('decor'),
  decor: decorIdSchema,
  hp: hp.default(DECOR_HP),
  maxHp: maxHp.default(DECOR_HP)
});
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
  decorTileSchema,
  dormantEnemyTileSchema
]);

/** One tile mutation addressed by world coordinate. */
export const tileEntrySchema = z.object({ x: column, y: row, tile: tileSchema });

/** A save's whole tile diff. */
export const tileEntriesSchema = z.array(tileEntrySchema).max(MAX_LOADED_TILE_ENTRIES);

export type Ore = z.infer<typeof oreSchema>;
export type EnemyKind = z.infer<typeof enemyKindSchema>;
export type AirTile = z.infer<typeof airTileSchema>;
export type DirtTile = z.infer<typeof dirtTileSchema>;
export type RockTile = z.infer<typeof rockTileSchema>;
export type OreTile = z.infer<typeof oreTileSchema>;
export type HazardTile = z.infer<typeof hazardTileSchema>;
export type DecorId = z.infer<typeof decorIdSchema>;
export type DecorTile = z.infer<typeof decorTileSchema>;
export type DormantEnemyTile = z.infer<typeof dormantEnemyTileSchema>;
export type Tile = z.infer<typeof tileSchema>;
export type TileEntry = z.infer<typeof tileEntrySchema>;

/** Parse a tile, returning `null` instead of throwing. */
export function parseTile(value: unknown): Tile | null {
  const result = tileSchema.safeParse(value);
  return result.success ? result.data : null;
}

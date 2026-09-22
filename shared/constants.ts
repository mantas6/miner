// Keep the mine's zoom in one shared world-to-screen scale.  The previous
// 48px tile baseline is reduced by a further 25%, so rendering, camera
// coverage, and pointer-to-ship geometry all use the same 36px tile size.
export const BASE_CAMERA_TILE = 48;
export const CAMERA_ZOOM_OUT = 0.25;
export const TILE = BASE_CAMERA_TILE * (1 - CAMERA_ZOOM_OUT);
export const WORLD_W = 90;
export const WORLD_CHUNK_ROWS = 32;

// --- Home base ---------------------------------------------------------------
//
// The mine has no surface: solid bedrock caps the world, and a small
// deterministic cavern carved into the top is the ship's home base. Spawn,
// respawn, the teleporter's destination, and the depth meter's zero all hang off
// it. The cavern is generated in `makeTile` rather than stored in the tile diff,
// so it survives death and reset for free.

/** Column of the home cavern's centre, where the ship starts and returns. */
export const HOME_X = 45;
/** Floor row of the home cavern. Depth is measured downward from here. */
export const HOME_ROW = 10;
/** The carved cavern: `halfWidth` tiles either side of `HOME_X`, `height` rows tall (floor included). */
export const HOME_CAVERN = Object.freeze({ halfWidth: 6, height: 3 });
/** Fixed world objects that sit on the cavern floor (drawn/handled outside the tile grid). */
export const STATIONS = Object.freeze({
  manufacturer: { x: HOME_X - 1, y: HOME_ROW },
  extractor: { x: HOME_X + 1, y: HOME_ROW }
});
/** Reference row for depth measurement and world-generation offsets. */
export const START_Y = HOME_ROW;
/** Topmost cavern row; everything above it is indestructible bedrock. */
export const HOME_CAVERN_TOP = HOME_ROW - HOME_CAVERN.height + 1;

/** Whether a coordinate falls inside the deterministic home cavern (air). */
export function isHomeCavern(x: number, y: number): boolean {
  return Math.abs(x - HOME_X) <= HOME_CAVERN.halfWidth && y >= HOME_CAVERN_TOP && y <= HOME_ROW;
}

/**
 * Fitting slots the ship carries its equipped upgrades in. Duplicates are allowed
 * and bonuses stack; Phase 3's `applyEquipment` reads these slots to derive the
 * ship's stats. Persisted as a fixed-length `equipment` array.
 */
export const SHIP_UPGRADE_SLOTS = 2;

// Keep row-major exploration indexes exact within JavaScript's safe integers.
export const MAX_WORLD_ROW = Math.floor(Number.MAX_SAFE_INTEGER / WORLD_W) - 1;

// --- Protocol / persistence limits (shared by the client and the relay) -----

/** Schema version of the relay's persisted world-state file. */
export const WORLD_STATE_VERSION = 1;
/** Upper bound on persisted/transmitted tile mutations. */
export const MAX_STATE_TILE_ENTRIES = 100_000;
/**
 * Upper bound on tile mutations kept in the browser's solo save. Entries cost
 * roughly 40 bytes of JSON each, so this leaves the whole blob well inside the
 * ~5 MB `localStorage` budget; older mutations are dropped past it.
 */
export const MAX_SAVED_TILE_ENTRIES = 20_000;
/** Upper bound on exploration indexes carried by one message. */
export const MAX_EXPLORED_TILES = WORLD_W * 1004;
/** Upper bound on encoded exploration payload length. */
export const MAX_EXPLORED_CHARS = MAX_STATE_TILE_ENTRIES * 8;
/** Upper bound on replicated live enemies. */
export const MAX_ENEMIES = 2048;
/** Upper bound on the persisted world-state file and on a relay frame. */
export const MAX_STATE_BYTES = 16 * 1024 * 1024;
/** Highest value a valuable (ore/artifact) may declare. */
export const MAX_VALUABLE_VALUE = 1_000_000;

export const ENEMY_KINDS = ['tunnelFiend', 'skitterling', 'ironback', 'abyssStalker'] as const;

// World-generation thresholds shared with player-facing danger guidance.
// Rows are expressed as `START_Y + n` so the whole mine shifts with the home
// row while every depth (row - START_Y) stays exactly where it was balanced.
export const DANGER = Object.freeze({
  rockMinRow: START_Y + 11,
  enemyMinRow: START_Y + 13,
  hazardMinRow: START_Y + 149
});

// Chance is the relative tier weight once the independent ore-spawn roll succeeds.
// These entries are validated as `Ore` values by shared/world-schema.ts. Rows are
// `START_Y + n` offsets, so a shifted home row leaves the balance untouched.
export const ORES = [
  {name:'Coal', color:'#343434', value:8, min:START_Y+0, max:START_Y+180, chance:.10},
  {name:'Iron', color:'#8a7f75', value:12, min:START_Y+3, max:START_Y+250, chance:.09},
  {name:'Copper', color:'#c47b45', value:16, min:START_Y+6, max:START_Y+320, chance:.08},
  {name:'Silver', color:'#c8d3e0', value:36, min:START_Y+60, max:START_Y+460, chance:.055},
  {name:'Gold', color:'#ffd65c', value:70, min:START_Y+150, max:START_Y+600, chance:.04},
  {name:'Ruby', color:'#f04b73', value:135, min:START_Y+260, max:START_Y+740, chance:.026},
  {name:'Emerald', color:'#46df8b', value:220, min:START_Y+390, max:START_Y+850, chance:.018},
  {name:'Alienite', color:'#8d7cff', value:360, min:START_Y+540, max:START_Y+940, chance:.012},
  {name:'Uranium', color:'#b7ff45', value:620, min:START_Y+700, max:MAX_WORLD_ROW, chance:.008},
  {name:'Core Shard', color:'#ff7a1f', value:980, min:START_Y+850, max:MAX_WORLD_ROW, chance:.005}
];

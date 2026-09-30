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
export const HOME_ROW = 20;
/**
 * The indestructible rock cap: rows 0..BEDROCK_ROWS-1 are always solid `rock`.
 * The rows between the cap and the cavern ceiling (`HOME_CAVERN_TOP`) are
 * ordinary fogged terrain the player can never reach (upward digging is blocked),
 * so they read as a dark band above the base rather than more bedrock.
 */
export const BEDROCK_ROWS = 8;
/** The carved cavern: `halfWidth` tiles either side of `HOME_X`, `height` rows tall (floor included). */
export const HOME_CAVERN = Object.freeze({ halfWidth: 6, height: 3 });
/** The cavern-floor tiles the default stations are seeded on (`createInitialStations`). */
export const STATIONS = Object.freeze({
  manufacturer: { x: HOME_X - 1, y: HOME_ROW },
  extractor: { x: HOME_X + 1, y: HOME_ROW },
  portal: { x: HOME_X + 3, y: HOME_ROW }
});
/** Reference row for depth measurement and world-generation offsets. */
export const START_Y = HOME_ROW;
/** Metres of depth one tile row stands for, as every depth readout counts them. */
export const METERS_PER_TILE = 10;
/** Metres below `startY` a tile row lies at; the home row and above read 0 m. */
export function rowDepthMeters(row: number, startY = START_Y): number {
  return Math.max(0, row - startY) * METERS_PER_TILE;
}
/**
 * Topmost cavern row. Above it sits a band of unreachable fogged terrain and,
 * higher still (rows 0..`BEDROCK_ROWS`-1), the indestructible bedrock cap.
 */
export const HOME_CAVERN_TOP = HOME_ROW - HOME_CAVERN.height + 1;

/** Whether a coordinate falls inside the deterministic home cavern (air). */
export function isHomeCavern(x: number, y: number): boolean {
  return Math.abs(x - HOME_X) <= HOME_CAVERN.halfWidth && y >= HOME_CAVERN_TOP && y <= HOME_ROW;
}


// Keep row-major exploration indexes exact within JavaScript's safe integers.
export const MAX_WORLD_ROW = Math.floor(Number.MAX_SAFE_INTEGER / WORLD_W) - 1;

// --- Persistence limits ------------------------------------------------------

/**
 * Upper bound on tile mutations kept in the browser save. Entries cost roughly
 * 40 bytes of JSON each, so this leaves the whole blob well inside the ~5 MB
 * `localStorage` budget; older mutations are dropped past it.
 */
export const MAX_SAVED_TILE_ENTRIES = 20_000;
/**
 * Upper bound on tile mutations a save may hand back on load. Looser than
 * `MAX_SAVED_TILE_ENTRIES`, because the entries under things the player owns are
 * never capped away and can push a save past it; anything beyond this is junk.
 */
export const MAX_LOADED_TILE_ENTRIES = 100_000;
/** Upper bound on explored tiles the fog records, and so on what a save may restore. */
export const MAX_EXPLORED_TILES = WORLD_W * 1004;
/** Highest value an ore may declare. */
export const MAX_VALUABLE_VALUE = 1_000_000;

/**
 * Durability of a placed decoration tile. A base drill (`STARTING.drill = 1`)
 * lands one hit per keyboard repeat (`keyboardRepeatMs = 105`), so 48 hits is
 * ~5 s of drilling — enough that a decoration is no longer cleared by a single
 * accidental pass. Upgraded drills break it faster, which is acceptable.
 */
export const DECOR_HP = 48;

export const ENEMY_KINDS = ['tunnelFiend', 'skitterling', 'ironback', 'abyssStalker'] as const;

/**
 * Placeable cosmetic tiles the player can craft, carry, and set down — every one,
 * in catalogue order. The one list the tile schema, the inventory slots and the
 * agent harness's click allowlist all derive their decorations from.
 */
export const DECOR_IDS = ['steelPlate', 'stoneBlock', 'copperTrim', 'lampPanel'] as const;

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
// Gold opens at 1100 m and Ruby at 2300 m (raised from 1500 m / 2600 m): a Scout
// stalled five shaft-sinking trips short of the first Gold, so the Mk II parts and
// the Prospector's bill now sit a trip closer to home.
export const ORES = [
  {name:'Coal', color:'#343434', value:8, min:START_Y+0, max:START_Y+180, chance:.10},
  {name:'Iron', color:'#8a7f75', value:12, min:START_Y+3, max:START_Y+250, chance:.09},
  {name:'Copper', color:'#c47b45', value:16, min:START_Y+6, max:START_Y+320, chance:.08},
  {name:'Silver', color:'#c8d3e0', value:36, min:START_Y+60, max:START_Y+460, chance:.055},
  {name:'Gold', color:'#ffd65c', value:70, min:START_Y+110, max:START_Y+600, chance:.04},
  {name:'Ruby', color:'#f04b73', value:135, min:START_Y+230, max:START_Y+740, chance:.026},
  {name:'Emerald', color:'#46df8b', value:220, min:START_Y+390, max:START_Y+850, chance:.018},
  {name:'Alienite', color:'#8d7cff', value:360, min:START_Y+540, max:START_Y+940, chance:.012},
  {name:'Uranium', color:'#b7ff45', value:620, min:START_Y+700, max:MAX_WORLD_ROW, chance:.008},
  {name:'Core Shard', color:'#ff7a1f', value:980, min:START_Y+850, max:MAX_WORLD_ROW, chance:.005}
];

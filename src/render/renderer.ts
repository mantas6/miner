import { TILE, WORLD_W } from '../../shared/constants';
import { viewport } from '../game/viewport';
import { getVisibleTileRange } from '../world/visible-tile-range';
import { isTileExplored } from '../../shared/exploration-codec';
import { getEnemyType } from '../core/enemy-types';
import { type PlacedContainer } from '../core/cargo-container';
import { type PlacedStation } from '../core/stations';
import { type Wreck } from '../core/wreck';
import { isDynamiteFuseLit, type PlacedDynamite } from '../core/dynamite';
import { totalItems, type InventoryItemKind } from '../core/inventory';
import { isPlaceableKind, isPlacementValid, placementOverlayCells } from '../core/placement-overlay';
import { isScannerDone, scannerTileProgress, type ScannerDevice } from '../core/scanner-device';
import { chestsInRange, gravesInRange, tradingPostsInRange } from '../world/world';
import { isChestLooted } from '../core/chest';
import {
  ChunkCache,
  MAX_EXTRA_CHUNKS,
  TERRAIN_CHUNK_TILES,
  terrainCacheScale,
  terrainChunkCoordinate,
  terrainChunkKey,
  terrainChunkKeyForTile
} from './terrain-cache-policy';
import { rustPalette } from './rust-palette';
import { shipFor, shipTier, type ShipId } from '../core/ships';
import type {
  ChestLedger,
  Direction,
  Enemy,
  EnemyKind,
  Particle,
  ShipTransform,
  TeleportEffect,
  Tile
} from '../core/types';

/**
 * Room around a terrain chunk for the tiles' deliberate overdraw. The widest
 * spill is a soft blob, centred up to .09 tile past an edge and up to .66 tile
 * long — .75 tile (27px) in all — with the ore glow's blur (a 3σ reach of 24px
 * from a crystal kept well inside its tile) and the strata strokes inside that.
 * A few pixels over the blob's reach covers antialiasing.
 */
export const TERRAIN_CHUNK_PADDING = 30;
// Fog bleeds one pixel past a tile plus half a vein stroke, so it needs far less
// room around a chunk than the terrain's blob and strata overdraw.
const FOG_CHUNK_PADDING = 8;
/** How much bigger the player's hull draws per rung above the Scout (`shipTier`). */
export const SHIP_SCALE_PER_TIER = 0.04;

/**
 * The slice of the game state the renderer reads. Fields the renderer already
 * treats as absent-tolerant stay optional so partial states remain drawable.
 */
export interface RendererState {
  /** Read only as a cache identity; tiles themselves arrive through `get`. */
  world: Tile[][];
  camX: number;
  camY: number;
  tick: number;
  gameOver: boolean;
  particles: Particle[];
  enemies: Enemy[];
  player: ShipTransform;
  reducedMotion?: boolean;
  /** Absent means "everything is visible": no fog is painted. */
  exploredTiles?: Set<number>;
  /** Scanner devices left in the mine. Absent or empty means none are deployed. */
  scannerDevices?: readonly ScannerDevice[];
  /** Dynamite still burning in the mine. Absent or empty means none is planted. */
  placedDynamite?: readonly PlacedDynamite[];
  /** Cargo containers standing in the mine. Absent or empty means none is placed. */
  cargoContainers?: readonly PlacedContainer[];
  /** Wrecks standing in the mine. Absent or empty means none is left behind. */
  wrecks?: readonly Wreck[];
  /** Opened chests' contents; a `[]` entry is a chest looted bare. Absent means none opened. */
  chestLedger?: ChestLedger;
  /** Stations standing in the mine; a manufacturer or an extractor per entry. */
  stations?: readonly PlacedStation[];
  teleportEffect?: TeleportEffect | null;
  input?: {sprintDirection?: Direction | null};
  /** The carried device armed for placement, or `null`/absent when none is. */
  armedPlacement?: InventoryItemKind | null;
  /** The tile under the pointer, for the stronger placement hover highlight. */
  hoverTile?: {x: number; y: number} | null;
  /** Skip the player ship (and its teleport fade); the intro showcase has no ship. */
  hideShip?: boolean;
}

export interface RendererDeps {
  state: RendererState;
  /**
   * The visible canvas and its context, handed over by the runtime that mounted
   * them. Imported at module scope this used to make the renderer unloadable
   * before the DOM existed.
   */
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Tile at a world coordinate, generating terrain on demand. */
  get(x: number, y: number): Tile;
  /** Deterministic per-coordinate noise in [0, 1). */
  rand(x: number, y: number): number;
}

export interface Renderer {
  /** Paint one frame of the current state. */
  draw(): void;
  /** Drop one tile's terrain chunk, or the whole terrain cache. */
  invalidateTerrain(x?: number, y?: number): void;
  /** Drop one tile's fog chunk, or the whole fog cache. */
  invalidateFog(x?: number, y?: number): void;
  /**
   * Re-read one tile's durability after a write that kept its type (a drill hit),
   * which leaves the cached terrain standing but may crack or heal the tile.
   */
  refreshTileDamage(x: number, y: number): void;
}

interface CachedChunk {
  canvas: HTMLCanvasElement;
  startX: number;
  startY: number;
  width: number;
  height: number;
}

interface ChunkLayerOptions {
  /** Extra room around a chunk for draws that intentionally spill past tile bounds. */
  padding: number;
  /** Identity of the data the layer is built from; the whole cache resets when it changes. */
  source(): unknown;
  /** Draws the chunk's tiles into `drawingContext`, offset by `padding`. */
  paint(startX: number, startY: number, endX: number, endY: number, padding: number): void;
  /** Chunks that would paint nothing skip both the canvas and the per-frame blit. */
  isBlank?(startX: number, startY: number, endX: number, endY: number): boolean;
  /** Called whenever the whole cache is dropped, so derived bookkeeping can follow. */
  reset?(): void;
}

/** Whether a tile shows the cracked-durability overlay: a hurt tile that has durability at all. */
function isDamagedTile(tile: Tile): boolean {
  return tile.type !== 'air' && tile.type !== 'rock' && tile.hp < tile.maxHp;
}

/** Row-major tile index for the damaged-tile set; `x` always lies inside the world. */
function damageKey(x: number, y: number): number {
  return y * WORLD_W + x;
}

export function createRenderer({ state, canvas, ctx, get, rand }: RendererDeps): Renderer {
  let drawingContext: CanvasRenderingContext2D = ctx;
  const isExplored = (x: number, y: number) => !state.exploredTiles || isTileExplored(state.exploredTiles, x, y);

  /**
   * Tiles showing damage, so the per-frame crack pass visits only those instead of
   * reading every visible tile. A superset is fine — every entry is re-checked
   * when drawn and dropped once healed or cleared — but a hurt tile on screen must
   * never be missing: each terrain chunk build records its own tiles (the build
   * reads every one anyway), and a damage-only write that leaves the cached chunk
   * standing reports in through `refreshTileDamage`.
   */
  const damagedTiles = new Set<number>();
  function recordTileDamage(tile: Tile, x: number, y: number) {
    if (isDamagedTile(tile)) damagedTiles.add(damageKey(x, y));
    else damagedTiles.delete(damageKey(x, y));
  }
  function refreshTileDamage(x: number, y: number) {
    if (x < 0 || x >= WORLD_W || y < 0) return;
    recordTileDamage(get(x, y), x, y);
  }

  // A gradient is a paint description in the coordinates it was made in, not a
  // per-frame object: the fixed ones below are drawn in a body's own local space
  // (the caller translates the context to it), so each is built once and reused.
  let caveFill: CanvasGradient | null = null;
  let caveFillHeight = 0;
  /** The rock void behind the terrain, top to bottom of the view; rebuilt only when that height changes. */
  function caveGradient(height: number): CanvasGradient {
    if (!caveFill || caveFillHeight !== height) {
      caveFill = ctx.createLinearGradient(0,0,0,height);
      caveFill.addColorStop(0,'#0a0705'); caveFill.addColorStop(1,'#050301');
      caveFillHeight = height;
    }
    return caveFill;
  }
  /** The hull's diagonal three-stop sheen, in the hull's local space. */
  function hullGradient(top: string, middle: string, bottom: string): CanvasGradient {
    const body = ctx.createLinearGradient(-TILE*.35,-TILE*.3,TILE*.35,TILE*.30);
    body.addColorStop(0, top); body.addColorStop(.45, middle); body.addColorStop(1, bottom);
    return body;
  }
  const liveHulls = new Map<ShipId, CanvasGradient>();
  let deadHull: CanvasGradient | null = null;
  let canopyGlass: CanvasGradient | null = null;
  let portalField: CanvasGradient | null = null;
  const enemyHulls = new Map<EnemyKind, CanvasGradient>();
  const enemyHitHulls = new Map<EnemyKind, CanvasGradient>();
  /** The live hull's sheen in the colours of the ship it is (`SHIPS[id].hull`); one per hull. */
  function liveHullGradient(ship: ShipId): CanvasGradient {
    let body = liveHulls.get(ship);
    if (!body) {
      const [top, middle, bottom] = shipFor(ship).hull;
      body = hullGradient(top, middle, bottom);
      liveHulls.set(ship, body);
    }
    return body;
  }
  /** The spent-ship grey, shared by the lost player ship and every wreck. */
  function deadHullGradient(): CanvasGradient {
    return deadHull ??= hullGradient('#555', '#676767', '#333');
  }
  function canopyGradient(): CanvasGradient {
    if (!canopyGlass) {
      canopyGlass = ctx.createLinearGradient(0,-TILE*.50,0,-TILE*.24);
      canopyGlass.addColorStop(0,'#ffffff'); canopyGlass.addColorStop(.25,'#b9f3ff'); canopyGlass.addColorStop(1,'#387898');
    }
    return canopyGlass;
  }
  function portalFieldGradient(): CanvasGradient {
    if (!portalField) {
      portalField = ctx.createLinearGradient(-TILE*.20, 0, TILE*.20, 0);
      portalField.addColorStop(0, 'rgba(114,217,255,.22)');
      portalField.addColorStop(.5, 'rgba(170,238,255,.62)');
      portalField.addColorStop(1, 'rgba(114,217,255,.22)');
    }
    return portalField;
  }
  /** A haunted rig's rusted hull, or the whitened one a hit flash paints; one of each per kind. */
  function enemyHullGradient(kind: EnemyKind, hit: boolean): CanvasGradient {
    const cache = hit ? enemyHitHulls : enemyHulls;
    let body = cache.get(kind);
    if (!body) {
      const rust = rustPalette(kind);
      body = hit ? hullGradient('#fff6a8', '#fff0c0', rust[2]) : hullGradient(rust[0], rust[1], rust[2]);
      cache.set(kind, body);
    }
    return body;
  }

  // Terrain and fog both change rarely (mining / exploration) but were redrawn per
  // frame, so both use the same chunked offscreen cache: DPR-aware scale, LRU trim,
  // and per-tile dirty invalidation on the shared chunk grid.
  const terrainLayer = createChunkLayer({
    padding: TERRAIN_CHUNK_PADDING,
    source: () => state.world,
    paint: (startX, startY, endX, endY, padding) => {
      for(let wy=startY;wy<=endY;wy++) for(let wx=startX;wx<=endX;wx++) {
        const tile = get(wx,wy);
        recordTileDamage(tile, wx, wy);
        drawTile(tile, wx, wy, padding + (wx-startX)*TILE, padding + (wy-startY)*TILE);
      }
    },
    // Whole-cache resets rebuild every chunk before it is drawn again, and each
    // rebuild re-records its tiles, so the set can start over with them.
    reset: () => damagedTiles.clear()
  });
  const fogLayer = createChunkLayer({
    padding: FOG_CHUNK_PADDING,
    source: () => state.exploredTiles,
    paint: paintFog,
    isBlank: (startX, startY, endX, endY) => {
      for(let wy=startY;wy<=endY;wy++) for(let wx=startX;wx<=endX;wx++) if (!isExplored(wx, wy)) return false;
      return true;
    }
  });

  function invalidateTerrain(x?: number, y?: number){ terrainLayer.invalidate(x, y); }
  function invalidateFog(x?: number, y?: number){ fogLayer.invalidate(x, y); }

  function createChunkLayer({ padding, source, paint, isBlank, reset }: ChunkLayerOptions){
    const chunks = new ChunkCache<CachedChunk>();
    let cachedScale = 0;
    let cachedSource: unknown = null;

    function build(chunkX: number, chunkY: number, scale: number): CachedChunk | null {
      const startX = chunkX * TERRAIN_CHUNK_TILES;
      const startY = chunkY * TERRAIN_CHUNK_TILES;
      const endX = Math.min(WORLD_W - 1, startX + TERRAIN_CHUNK_TILES - 1);
      const endY = startY + TERRAIN_CHUNK_TILES - 1;
      if (isBlank?.(startX, startY, endX, endY)) return null;
      const width = (endX - startX + 1) * TILE;
      const height = (endY - startY + 1) * TILE;
      const chunkCanvas = document.createElement('canvas');
      chunkCanvas.width = Math.ceil((width + padding * 2) * scale);
      chunkCanvas.height = Math.ceil((height + padding * 2) * scale);
      const chunkContext = chunkCanvas.getContext('2d');
      if (!chunkContext) throw new Error('2D chunk cache context is unavailable.');
      chunkContext.setTransform(scale, 0, 0, scale, 0, 0);

      const mainContext = drawingContext;
      drawingContext = chunkContext;
      try {
        paint(startX, startY, endX, endY, padding);
      } finally {
        drawingContext = mainContext;
      }

      return {canvas: chunkCanvas, startX, startY, width, height};
    }

    return {
      invalidate(x?: number, y?: number){
        if (x === undefined || y === undefined) {
          chunks.clear();
          reset?.();
          return;
        }
        chunks.delete(terrainChunkKeyForTile(x, y));
      },
      draw(camX: number, camY: number){
        const range = getVisibleTileRange(camX, camY, viewport.tilesX, viewport.tilesY, WORLD_W);
        // Cache at CSS-pixel resolution (times the zoom, quantised) so high-DPI
        // screens do not multiply generation cost.
        const scale = terrainCacheScale(viewport.zoom, canvas.width / viewport.widthPx);
        const currentSource = source();
        if (cachedScale !== scale || cachedSource !== currentSource) {
          chunks.clear();
          reset?.();
          cachedScale = scale;
          cachedSource = currentSource;
        }

        const startChunkX = terrainChunkCoordinate(range.startX);
        const endChunkX = terrainChunkCoordinate(range.endX);
        const startChunkY = terrainChunkCoordinate(range.startY);
        const endChunkY = terrainChunkCoordinate(range.endY);
        let visibleChunkCount = 0;
        for(let chunkY=startChunkY;chunkY<=endChunkY;chunkY++) for(let chunkX=startChunkX;chunkX<=endChunkX;chunkX++) {
          const chunk = chunks.use(terrainChunkKey(chunkX, chunkY), () => build(chunkX, chunkY, scale));
          visibleChunkCount++;
          if (!chunk) continue;
          drawingContext.drawImage(
            chunk.canvas,
            0, 0, chunk.canvas.width, chunk.canvas.height,
            (chunk.startX-camX)*TILE-padding,
            (chunk.startY-camY)*TILE-padding,
            chunk.width+padding*2,
            chunk.height+padding*2
          );
        }

        chunks.trim(visibleChunkCount + MAX_EXTRA_CHUNKS);
      }
    };
  }

  function drawTerrainDamage(camX: number, camY: number){
    if (damagedTiles.size === 0) return;
    const range = getVisibleTileRange(camX, camY, viewport.tilesX, viewport.tilesY, WORLD_W);
    for (const key of damagedTiles) {
      const wy = Math.floor(key / WORLD_W), wx = key - wy * WORLD_W;
      if (wx < range.startX || wx > range.endX || wy < range.startY || wy > range.endY) continue;
      const tile = get(wx, wy);
      // Healed, or cleared to air since it was recorded: it has nothing left to show.
      if (!isDamagedTile(tile)) { damagedTiles.delete(key); continue; }
      if (!isExplored(wx, wy)) continue;
      drawTileDamage(tile, (wx-camX)*TILE, (wy-camY)*TILE);
    }
  }

  function draw(){
    const p = state.player;
    const camX = Math.max(0, Math.min(WORLD_W-viewport.tilesX, state.camX));
    const camY = Math.max(0, state.camY);
    // Everything below is world space: one unit is one unzoomed CSS pixel, and the
    // canvas covers `worldWidthPx` x `worldHeightPx` of it. Only the game-over
    // overlay, painted after the transform is popped, works in screen pixels.
    ctx.save();
    ctx.scale(viewport.zoom, viewport.zoom);
    // The world is solid underground now: a dark rock void backs the terrain
    // wherever a dug-out tunnel would otherwise show nothing behind it.
    ctx.fillStyle = caveGradient(viewport.worldHeightPx); ctx.fillRect(0,0,viewport.worldWidthPx,viewport.worldHeightPx);
    terrainLayer.draw(camX, camY);
    drawTerrainDamage(camX, camY);
    drawTerrainBlendOverlay();
    drawHomeStations(camX, camY);
    drawTradingPosts(camX, camY);
    drawChests(camX, camY);
    drawGraves(camX, camY);
    drawCargoContainers(camX, camY);
    drawWrecks(camX, camY);
    drawScannerDevices(camX, camY);
    drawPlacedDynamite(camX, camY);
    drawEnemies(camX, camY);
    for (const pt of state.particles) {
      if (!isExplored(Math.floor(pt.x), Math.floor(pt.y))) continue;
      const sx = (pt.x - camX) * TILE, sy = (pt.y - camY) * TILE;
      ctx.globalAlpha = Math.max(0, Math.min(1, pt.life / 28));
      ctx.fillStyle = pt.color;
      ctx.fillRect(sx, sy, pt.size*TILE, pt.size*TILE);
      ctx.globalAlpha = 1;
    }
    fogLayer.draw(camX, camY);
    drawPlacementOverlay(camX, camY);
    drawTeleportEffect(camX, camY, false);
    if (!state.hideShip) {
      const sx=(p.drawX-camX)*TILE, sy=(p.drawY-camY)*TILE;
      ctx.save();
      if (state.teleportEffect) ctx.globalAlpha = Math.min(1, .32 + state.teleportEffect.frame / Math.max(1, state.teleportEffect.duration * .42));
      // The hover bob after a move; reduced motion parks the ship still.
      const hover = state.reducedMotion ? 0 : Math.sin(state.tick*.45)*p.bob*TILE*.08;
      ctx.translate(sx+TILE*.5, sy+TILE*.5 + hover);
      ctx.rotate((p.x - p.drawX) * -0.12 + (p.y - p.drawY) * 0.08 + (p.drillDy > 0 ? p.drillAnim * 0.10 : 0));
      ctx.scale(p.facing, 1);
      drawShip(p, state.input?.sprintDirection);
      ctx.restore();
    }
    drawTeleportEffect(camX, camY, true);
    ctx.restore();
    if(state.gameOver){
      ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(0,0,viewport.widthPx,viewport.heightPx);
      // The three lines are one block centred on the viewport, whatever its height.
      const cx = viewport.widthPx/2, cy = viewport.heightPx/2;
      ctx.fillStyle='#fff'; ctx.textAlign='center';
      ctx.font='bold 38px sans-serif'; ctx.fillText('GAME OVER', cx, cy - 18);
      ctx.font='bold 24px sans-serif'; ctx.fillText('Tap anywhere to restart', cx, cy + 25);
      ctx.font='18px sans-serif'; ctx.fillText('or press R', cx, cy + 57);
      ctx.textAlign='left';
    }
  }
  /**
   * The placement grid, shown only while a placeable device is armed. Nearby
   * explored tiles are tinted green where the device would drop and red where it
   * would not, and the tile under the pointer gets a stronger fill and an outline
   * so a hover reads as "here, yes" or "here, no" at a glance. Deliberately faint,
   * so it guides the eye without hiding the terrain it is drawn over.
   */
  function drawPlacementOverlay(camX: number, camY: number) {
    const kind = state.armedPlacement;
    if (!isPlaceableKind(kind) || !state.exploredTiles) return;
    const world = {
      explored: state.exploredTiles,
      scannerDevices: state.scannerDevices ?? [],
      placedDynamite: state.placedDynamite ?? [],
      cargoContainers: state.cargoContainers ?? [],
      wrecks: state.wrecks ?? [],
      stations: state.stations ?? [],
      chestLedger: state.chestLedger ?? {},
      player: state.player,
      world: state.world,
      isOpen: (x: number, y: number) => get(x, y).type === 'air'
    };
    const cells = placementOverlayCells(kind, state.player.x, state.player.y, world);
    const hover = state.hoverTile;
    ctx.save();
    for (const cell of cells) {
      // The hovered tile is drawn separately, stronger, so skip its faint tint.
      if (hover && hover.x === cell.x && hover.y === cell.y) continue;
      const sx = (cell.x - camX) * TILE, sy = (cell.y - camY) * TILE;
      ctx.fillStyle = cell.valid ? 'rgba(90,220,130,.14)' : 'rgba(228,78,66,.14)';
      ctx.fillRect(sx, sy, TILE, TILE);
    }
    if (hover) {
      const valid = isPlacementValid(kind, hover.x, hover.y, world);
      const sx = (hover.x - camX) * TILE, sy = (hover.y - camY) * TILE;
      ctx.fillStyle = valid ? 'rgba(90,220,130,.28)' : 'rgba(228,78,66,.28)';
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.strokeStyle = valid ? 'rgba(158,255,190,.9)' : 'rgba(255,146,136,.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, TILE - 2, TILE - 2);
    }
    ctx.restore();
  }
  // Static per tile — every value is keyed off `rand(wx, wy)`, never `state.tick` —
  // so the cached image is pixel-identical to the old per-frame draw.
  function paintFog(startX: number, startY: number, endX: number, endY: number, padding: number) {
    const ctx = drawingContext;
    ctx.fillStyle = '#030608';
    for (let wy=startY; wy<=endY; wy++) for (let wx=startX; wx<=endX; wx++) {
      if (isExplored(wx, wy)) continue;
      const sx = padding + (wx-startX)*TILE, sy = padding + (wy-startY)*TILE;
      ctx.fillRect(sx-1, sy-1, TILE+2, TILE+2);

      const grainX = sx + TILE*(.14 + rand(wx+17, wy-11)*.72);
      const grainY = sy + TILE*(.14 + rand(wx-13, wy+19)*.72);
      ctx.fillStyle = `rgba(112,137,143,${.10 + rand(wx+5, wy+7)*.07})`;
      ctx.fillRect(grainX, grainY, 2 + rand(wx, wy+31)*3, 2 + rand(wx+29, wy)*2);

      const veinY = sy + TILE*(.27 + rand(wx-7, wy+3)*.46);
      ctx.strokeStyle = `rgba(77,102,108,${.16 + rand(wx+23, wy-5)*.10})`;
      ctx.lineWidth = 1 + rand(wx-17, wy+13)*1.5;
      ctx.beginPath();
      ctx.moveTo(sx+TILE*.08, veinY);
      ctx.bezierCurveTo(
        sx+TILE*.32, veinY+TILE*(rand(wx+3, wy)-.5)*.18,
        sx+TILE*.68, veinY+TILE*(rand(wx, wy+3)-.5)*.18,
        sx+TILE*.92, veinY+TILE*(rand(wx+11, wy+11)-.5)*.10
      );
      ctx.stroke();
      ctx.fillStyle = '#030608';
    }
  }
  function drawTeleportEffect(camX: number, camY: number, foreground: boolean) {
    const effect = state.teleportEffect;
    if (!effect) return;
    const progress = effect.frame / Math.max(1, effect.duration - 1);
    const arrivalX = (effect.destinationX - camX + .5) * TILE;
    const arrivalY = (effect.destinationY - camY + .5) * TILE;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'screen';

    if (!foreground) {
      const arrival = Math.min(1, progress * 2.4 + .12);
      const beam = TILE * (1.7 - arrival * .85);
      const glow = ctx.createRadialGradient(arrivalX, arrivalY, 0, arrivalX, arrivalY, beam);
      glow.addColorStop(0, `rgba(225,250,255,${.5 * (1-progress) + .12})`);
      glow.addColorStop(.25, `rgba(92,200,255,${.34 * (1-progress)})`);
      glow.addColorStop(1, 'rgba(105,92,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(arrivalX, arrivalY, beam, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = `rgba(180,239,255,${.2 * (1-progress)})`;
      ctx.fillRect(arrivalX-TILE*.17, arrivalY-TILE*2.1, TILE*.34, TILE*4.2);
    } else {
      const departure = Math.max(0, 1 - progress * 1.8);
      if (departure > 0) {
        const radius = TILE * (.18 + departure * .82);
        ctx.globalAlpha = departure;
        ctx.strokeStyle = '#8eeaff'; ctx.lineWidth = 3 + departure * 5;
        ctx.shadowColor = '#805cff'; ctx.shadowBlur = 22;
        ctx.beginPath(); ctx.arc(effect.originScreenX, effect.originScreenY, radius, 0, Math.PI*2); ctx.stroke();
        ctx.strokeStyle = '#fff4b0'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(effect.originScreenX, effect.originScreenY, radius*.54, 0, Math.PI*2); ctx.stroke();
      }

      ctx.globalAlpha = 1 - progress;
      ctx.strokeStyle = '#b7f3ff'; ctx.shadowColor = '#5cc8ff'; ctx.shadowBlur = 18;
      for (let i=0;i<3;i++) {
        const radius = TILE * (.42 + (1-progress)*(.72+i*.24));
        const rotation = effect.reducedMotion ? 0 : progress * Math.PI * (i%2 ? -1.4 : 1.7);
        ctx.lineWidth = Math.max(1, 5-i);
        ctx.beginPath(); ctx.arc(arrivalX, arrivalY, radius, rotation+i*.7, rotation+i*.7+Math.PI*1.35); ctx.stroke();
      }
      ctx.fillStyle = '#fff6bd';
      for (let i=0;i<8;i++) {
        const angle = i*Math.PI/4 + (effect.reducedMotion ? 0 : progress*1.8);
        const radius = TILE*(.48 + (i%3)*.16)*(1-progress*.5);
        ctx.fillRect(arrivalX+Math.cos(angle)*radius-2, arrivalY+Math.sin(angle)*radius-2, 4, 4);
      }
    }
    ctx.restore();
  }
  /**
   * The two fixed home-base stations, drawn on the dynamic pass (not the cached
   * terrain) so the extractor's beam can animate. The manufacturer is a workbench
   * press under a lamp; the extractor is a nodding pump-jack whose beam rocks while
   * coal is queued. Both are culled off-screen and skipped under fog.
   */
  function drawHomeStations(camX: number, camY: number) {
    for (const station of state.stations ?? []) {
      if (station.kind === 'manufacturer') {
        drawStation(station.x, station.y, camX, camY, drawManufacturerBody, false, 'Manufacturer');
      } else if (station.kind === 'extractor') {
        drawStation(station.x, station.y, camX, camY, drawExtractorBody, station.coal > 0, 'Fuel Extractor');
      } else if (station.kind === 'portal') {
        // Unlike the fixed stations, a portal wears its own name, so the label comes
        // off the station rather than a hard-coded string.
        drawStation(station.x, station.y, camX, camY, drawPortalBody, false, station.name);
      }
    }
  }
  function drawStation(
    tx: number, ty: number, camX: number, camY: number,
    body: (active: boolean) => void, active: boolean, label: string
  ) {
    if (!isExplored(tx, ty)) return;
    const sx = (tx - camX) * TILE, sy = (ty - camY) * TILE;
    if (sx < -TILE || sy < -TILE || sx > viewport.worldWidthPx + TILE || sy > viewport.worldHeightPx + TILE) return;
    ctx.save();
    ctx.translate(sx + TILE*.5, sy + TILE*.5);
    body(active);
    // Name label above the station. Reset shadowBlur first so the body painters'
    // glow doesn't smear the text.
    ctx.shadowBlur = 0;
    ctx.font = 'bold 7.5px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.strokeText(label, 0, -TILE*.36);
    ctx.fillStyle = '#dbe8ff';
    ctx.fillText(label, 0, -TILE*.36);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }
  /** Manufacturing station: a squat press bench with a work lamp glowing over it. */
  function drawManufacturerBody(_active: boolean) {
    // Bench, sitting on the tile floor.
    ctx.fillStyle = '#3a4653';
    ctx.fillRect(-TILE*.32, TILE*.04, TILE*.64, TILE*.26);
    ctx.fillStyle = 'rgba(0,0,0,.30)';
    ctx.fillRect(-TILE*.32, TILE*.22, TILE*.64, TILE*.08);
    // Press frame and the head poised over the bench.
    ctx.strokeStyle = '#8fa2b5'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-TILE*.22, TILE*.04); ctx.lineTo(-TILE*.22, -TILE*.24);
    ctx.lineTo(TILE*.16, -TILE*.24);
    ctx.stroke();
    ctx.fillStyle = '#6d7d8c';
    ctx.fillRect(-TILE*.02, -TILE*.22, TILE*.18, TILE*.14);
    // Work lamp: a warm glow that marks the bench as the crafting spot.
    ctx.fillStyle = '#ffe58a';
    ctx.shadowColor = '#ffc857'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(TILE*.24, -TILE*.20, TILE*.06, 0, Math.PI*2); ctx.fill();
  }
  /** Fuel extractor: a nodding pump-jack; its beam rocks while coal is queued. */
  function drawExtractorBody(active: boolean) {
    const nod = active && !state.reducedMotion ? Math.sin(state.tick * .12) : 0;
    // Base and derrick sitting on the tile floor.
    ctx.fillStyle = active ? '#2e4a52' : '#2a2f34';
    ctx.fillRect(-TILE*.30, TILE*.16, TILE*.60, TILE*.14);
    ctx.strokeStyle = '#141b1f'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-TILE*.16, TILE*.16); ctx.lineTo(0, -TILE*.12);
    ctx.moveTo(TILE*.16, TILE*.16); ctx.lineTo(0, -TILE*.12);
    ctx.stroke();
    // Walking beam, nodding while the rig runs.
    ctx.save();
    ctx.translate(0, -TILE*.12);
    ctx.rotate(nod * .22);
    ctx.strokeStyle = active ? '#7fd4c0' : '#5d6b78'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-TILE*.26, 0); ctx.lineTo(TILE*.26, 0); ctx.stroke();
    ctx.fillStyle = active ? '#12303a' : '#20262b';
    ctx.fillRect(TILE*.18, 0, TILE*.10, TILE*.24);
    ctx.restore();
    // Gauge lamp: lit while it pumps, dark once the queue is empty.
    ctx.fillStyle = active ? '#8fe6ff' : '#2a333c';
    if (active) { ctx.shadowColor = '#5cc8ff'; ctx.shadowBlur = 10; }
    ctx.beginPath(); ctx.arc(-TILE*.22, TILE*.06, TILE*.05, 0, Math.PI*2); ctx.fill();
  }
  /**
   * Portal: a gate machine — two emitter pylons bolted to a control plinth, a
   * crossbar bridging their tops, and the blue field they hold between them, a
   * scan line sweeping down it. Still under reduced motion.
   */
  function drawPortalBody(_active: boolean) {
    const sweep = state.reducedMotion ? .5 : (state.tick * .02) % 1;
    // Plinth the machine stands on, with a dark lower lip.
    ctx.fillStyle = '#39434e';
    ctx.fillRect(-TILE*.34, TILE*.16, TILE*.68, TILE*.14);
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.fillRect(-TILE*.34, TILE*.25, TILE*.68, TILE*.05);
    // Contained field between the pylons: a blue gradient fading at its edges.
    ctx.fillStyle = portalFieldGradient();
    ctx.fillRect(-TILE*.20, -TILE*.22, TILE*.40, TILE*.38);
    // Scan line sweeping down the field.
    ctx.fillStyle = 'rgba(225,250,255,.75)';
    ctx.shadowColor = '#72d9ff'; ctx.shadowBlur = 8;
    ctx.fillRect(-TILE*.20, -TILE*.22 + TILE*.36*sweep, TILE*.40, TILE*.02);
    ctx.shadowBlur = 0;
    // Pylons: riveted steel columns either side of the field.
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#6d7d8c';
      ctx.fillRect(side*TILE*.27 - TILE*.07, -TILE*.26, TILE*.14, TILE*.42);
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      ctx.fillRect(side*TILE*.27 - TILE*.07, -TILE*.26, TILE*.03, TILE*.42);
      ctx.fillStyle = '#2a333c';
      ctx.fillRect(side*TILE*.27 - TILE*.025, -TILE*.14, TILE*.05, TILE*.20);
      // Emitter node facing into the field.
      ctx.fillStyle = '#b7f3ff';
      ctx.shadowColor = '#72d9ff'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(side*TILE*.20, -TILE*.03, TILE*.035, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    // Crossbar bridging the pylon tops, with a status lamp at its middle.
    ctx.fillStyle = '#4f5d6b';
    ctx.fillRect(-TILE*.34, -TILE*.31, TILE*.68, TILE*.07);
    ctx.fillStyle = '#72d9ff';
    ctx.shadowColor = '#72d9ff'; ctx.shadowBlur = 8;
    ctx.fillRect(-TILE*.05, -TILE*.295, TILE*.10, TILE*.04);
    ctx.shadowBlur = 0;
    // Control panel on the plinth: a small readout and a green ready LED.
    ctx.fillStyle = '#12303a';
    ctx.fillRect(-TILE*.12, TILE*.185, TILE*.16, TILE*.06);
    ctx.fillStyle = '#5cc8ff';
    ctx.fillRect(-TILE*.105, TILE*.20, TILE*.09, TILE*.02);
    ctx.fillStyle = '#7dff9a';
    ctx.beginPath(); ctx.arc(TILE*.10, TILE*.215, TILE*.025, 0, Math.PI*2); ctx.fill();
  }
  /**
   * Trading posts, as a lit kiosk with a coin sign. Derived from the tile
   * coordinate like the home cavern (see `world.ts`), so the renderer walks the
   * chunks overlapping the view (`tradingPostsInRange`) rather than any stored list.
   * Culled off-screen and skipped under fog, exactly like the other mine fixtures.
   */
  function drawTradingPosts(camX: number, camY: number) {
    const range = getVisibleTileRange(camX, camY, viewport.tilesX, viewport.tilesY, WORLD_W);
    for (const post of tradingPostsInRange(range.startX, range.startY, range.endX, range.endY)) {
      if (!isExplored(post.x, post.y)) continue;
      drawTradingPostBody((post.x - camX) * TILE, (post.y - camY) * TILE);
    }
  }
  function drawTradingPostBody(sx: number, sy: number) {
    ctx.save();
    ctx.translate(sx + TILE * .5, sy + TILE * .5);
    // Counter and stall base, sitting on the tile floor.
    ctx.fillStyle = '#4a3a5a';
    ctx.fillRect(-TILE * .32, TILE * .04, TILE * .64, TILE * .26);
    ctx.fillStyle = 'rgba(0,0,0,.30)';
    ctx.fillRect(-TILE * .32, TILE * .22, TILE * .64, TILE * .08);
    // Awning over the counter: a warm striped canopy.
    ctx.fillStyle = '#c85a4a';
    ctx.fillRect(-TILE * .36, -TILE * .10, TILE * .72, TILE * .12);
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    for (let i = 0; i < 3; i++) ctx.fillRect(-TILE * .36 + i * TILE * .24, -TILE * .10, TILE * .12, TILE * .12);
    // Sign post and coin badge above the stall.
    ctx.strokeStyle = '#8fa2b5'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -TILE * .10); ctx.lineTo(0, -TILE * .28); ctx.stroke();
    ctx.fillStyle = '#ffd65c';
    ctx.shadowColor = '#ffc857'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(0, -TILE * .32, TILE * .09, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // A dark "$" struck into the coin.
    ctx.fillStyle = '#7a5a12';
    ctx.font = `bold ${Math.round(TILE * .16)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', 0, -TILE * .31);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }
  /**
   * Buried chests, as a small wooden chest with a brass clasp. Derived from the
   * coordinate like the trading posts, so the visible range is walked chunk by chunk
   * (`chestsInRange`) rather than read off a list; a chest under fog, or one looted
   * bare, is not painted.
   */
  function drawChests(camX: number, camY: number) {
    const range = getVisibleTileRange(camX, camY, viewport.tilesX, viewport.tilesY, WORLD_W);
    const ledger = state.chestLedger;
    for (const chest of chestsInRange(range.startX, range.startY, range.endX, range.endY)) {
      if (!isExplored(chest.x, chest.y)) continue;
      if (ledger && isChestLooted(ledger, chest.x, chest.y)) continue;
      drawChestBody((chest.x - camX) * TILE, (chest.y - camY) * TILE);
    }
  }
  function drawChestBody(sx: number, sy: number) {
    ctx.save();
    ctx.translate(sx + TILE * .5, sy + TILE * .5);
    // Body: dark planks sitting on the tile floor.
    ctx.fillStyle = '#6b4424';
    ctx.fillRect(-TILE * .28, -TILE * .02, TILE * .56, TILE * .32);
    ctx.fillStyle = 'rgba(0,0,0,.30)';
    ctx.fillRect(-TILE * .28, TILE * .20, TILE * .56, TILE * .10);
    // Domed lid, a shade lighter.
    ctx.fillStyle = '#8a5a30';
    ctx.beginPath();
    ctx.moveTo(-TILE * .30, -TILE * .02);
    ctx.lineTo(-TILE * .30, -TILE * .10);
    ctx.quadraticCurveTo(0, -TILE * .26, TILE * .30, -TILE * .10);
    ctx.lineTo(TILE * .30, -TILE * .02);
    ctx.closePath();
    ctx.fill();
    // Brass bands down both ends and a clasp on the seam.
    ctx.fillStyle = '#c9a23a';
    ctx.fillRect(-TILE * .24, -TILE * .16, TILE * .05, TILE * .46);
    ctx.fillRect(TILE * .19, -TILE * .16, TILE * .05, TILE * .46);
    ctx.fillStyle = '#ffd65c';
    ctx.shadowColor = '#e0b040'; ctx.shadowBlur = 6;
    ctx.fillRect(-TILE * .05, -TILE * .06, TILE * .10, TILE * .10);
    ctx.restore();
  }
  /**
   * Graves, as an earth mound on the nook's floor with a pale cross planted at its
   * head. Derived from the coordinate like the chests, walked chunk by chunk
   * (`gravesInRange`), and never painted under fog.
   */
  function drawGraves(camX: number, camY: number) {
    const range = getVisibleTileRange(camX, camY, viewport.tilesX, viewport.tilesY, WORLD_W);
    for (const grave of gravesInRange(range.startX, range.startY, range.endX, range.endY)) {
      if (!isExplored(grave.x, grave.y)) continue;
      drawGraveBody((grave.x - camX) * TILE, (grave.y - camY) * TILE);
    }
  }
  function drawGraveBody(sx: number, sy: number) {
    ctx.save();
    ctx.translate(sx + TILE * .5, sy + TILE * .5);
    // The mound: a low heap of turned earth along the tile floor.
    ctx.fillStyle = '#5a4030';
    ctx.beginPath();
    ctx.ellipse(0, TILE * .5, TILE * .40, TILE * .18, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    // The cross: an upright and a crossbeam, two bars.
    ctx.fillStyle = '#c9ced8';
    ctx.fillRect(-TILE * .04, -TILE * .30, TILE * .08, TILE * .58);
    ctx.fillRect(-TILE * .17, -TILE * .18, TILE * .34, TILE * .08);
    ctx.restore();
  }
  /**
   * Cargo containers, as a banded crate. A crate with something in it shows a lit
   * panel and a loaded lid; an empty one sits open and dark, so a miner picking a
   * way back through their own tunnels can see which stash is worth the detour
   * without opening anything.
   */
  function drawCargoContainers(camX: number, camY: number) {
    const containers = state.cargoContainers;
    if (!containers?.length) return;
    for (const container of containers) {
      if (!isExplored(container.x, container.y)) continue;
      const sx = (container.x - camX) * TILE, sy = (container.y - camY) * TILE;
      if (sx < -TILE || sy < -TILE || sx > viewport.worldWidthPx + TILE || sy > viewport.worldHeightPx + TILE) continue;
      drawContainerBody(sx, sy, totalItems(container.inventory) > 0);
    }
  }
  function drawContainerBody(sx: number, sy: number, loaded: boolean) {
    ctx.save();
    ctx.translate(sx + TILE*.5, sy + TILE*.5);
    // Body, sitting on the floor of the tile rather than floating in the middle.
    ctx.fillStyle = '#7a5a22';
    ctx.fillRect(-TILE*.30, -TILE*.08, TILE*.60, TILE*.38);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(-TILE*.30, TILE*.18, TILE*.60, TILE*.12);
    // Lid, raised a hair while the crate holds something.
    ctx.fillStyle = loaded ? '#c8912f' : '#6d5423';
    ctx.fillRect(-TILE*.33, -TILE*.15, TILE*.66, TILE*.09);
    // Frame and banding, which is most of what makes it read as a crate at this
    // size. One path, so the outline and the two staves cost a single stroke.
    ctx.strokeStyle = '#3b2c11'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-TILE*.30, -TILE*.08);
    ctx.lineTo(TILE*.30, -TILE*.08); ctx.lineTo(TILE*.30, TILE*.30);
    ctx.lineTo(-TILE*.30, TILE*.30); ctx.closePath();
    ctx.moveTo(-TILE*.10, -TILE*.08); ctx.lineTo(-TILE*.10, TILE*.30);
    ctx.moveTo(TILE*.10, -TILE*.08); ctx.lineTo(TILE*.10, TILE*.30);
    ctx.stroke();
    // Contents lamp: the one bit of state the crate publishes to the canvas.
    ctx.fillStyle = loaded ? '#ffe58a' : '#2a333c';
    if (loaded) { ctx.shadowColor = '#ffc857'; ctx.shadowBlur = 8; }
    ctx.beginPath(); ctx.arc(0, TILE*.04, TILE*.05, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }
  /**
   * Wrecks, as a greyed-out husk of the player's own ship — the dead-ship palette
   * `drawShip` uses when the run is over, drawn static on the tile the ship was
   * lost on. Culled off-screen and skipped under fog, exactly like the crate.
   */
  function drawWrecks(camX: number, camY: number) {
    const wrecks = state.wrecks;
    if (!wrecks?.length) return;
    for (const wreck of wrecks) {
      if (!isExplored(wreck.x, wreck.y)) continue;
      const sx = (wreck.x - camX) * TILE, sy = (wreck.y - camY) * TILE;
      if (sx < -TILE || sy < -TILE || sx > viewport.worldWidthPx + TILE || sy > viewport.worldHeightPx + TILE) continue;
      drawWreckBody(sx, sy);
    }
  }
  function drawWreckBody(sx: number, sy: number) {
    ctx.save();
    ctx.translate(sx + TILE*.5, sy + TILE*.5);
    // The dead-ship gradient and dark canopy from `drawShip`, held still: a wreck
    // reads as a spent hull without an engine flame or a drill.
    drawShipHull(deadHullGradient(), 'rgba(196,214,210,.28)', '#26384d');
    drawShipCanopy('rgba(14,20,24,.85)');
    ctx.restore();
  }
  /**
   * Deployed scanners, as a lit dish on a tripod. A working one draws a progress
   * arc that fills as it charges toward its next reveal, and a finished one has
   * lost it — so "still mapping" and "spent" are one glance apart without a label
   * on the canvas.
   */
  function drawScannerDevices(camX: number, camY: number) {
    const devices = state.scannerDevices;
    if (!devices?.length) return;
    for (const device of devices) {
      if (!isExplored(device.x, device.y)) continue;
      const sx = (device.x - camX) * TILE, sy = (device.y - camY) * TILE;
      if (sx < -TILE || sy < -TILE || sx > viewport.worldWidthPx + TILE || sy > viewport.worldHeightPx + TILE) continue;
      const done = state.exploredTiles ? isScannerDone(device, state.exploredTiles) : true;
      drawScannerBody(sx, sy, done, done ? 0 : scannerTileProgress(device));
    }
  }
  function drawScannerBody(sx: number, sy: number, done: boolean, progress: number) {
    const glow = done ? '#5d6b78' : '#7fe3ff';
    ctx.save();
    ctx.translate(sx + TILE*.5, sy + TILE*.5);
    if (!done) {
      // A charging arc for the tile being surveyed: it sweeps clockwise from the
      // top as the reveal nears, then snaps back to empty when the tile lands.
      // Subtle — one thin stroke — so a busy scanner reads as "working" at a
      // glance without cluttering the mine, and it holds still enough between
      // steps to stay legible under reduced motion.
      ctx.globalAlpha = .5;
      ctx.strokeStyle = glow; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, 0, TILE*.62, -Math.PI/2, -Math.PI/2 + progress*Math.PI*2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Tripod and mast.
    ctx.strokeStyle = '#8c9aa8'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-TILE*.18, TILE*.30); ctx.lineTo(0, TILE*.02);
    ctx.moveTo(TILE*.18, TILE*.30); ctx.lineTo(0, TILE*.02);
    ctx.moveTo(0, TILE*.30); ctx.lineTo(0, -TILE*.10);
    ctx.stroke();
    // Dish.
    ctx.fillStyle = done ? '#3f4a55' : '#cdefff';
    ctx.beginPath(); ctx.arc(0, -TILE*.12, TILE*.20, Math.PI, Math.PI*2); ctx.fill();
    ctx.strokeStyle = glow; ctx.lineWidth = 2; ctx.stroke();
    // Status lamp: lit while the survey runs, dark once it is spent.
    ctx.fillStyle = done ? '#2a333c' : '#fff6bd';
    if (!done) { ctx.shadowColor = glow; ctx.shadowBlur = 10; }
    ctx.beginPath(); ctx.arc(0, -TILE*.14, TILE*.05, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }
  /**
   * Planted dynamite, as a red stick with a spark on it. The spark blinks faster
   * the closer the fuse is to the end, which is the only warning the canvas gives
   * — and the only one it needs, because the answer is always "move".
   */
  function drawPlacedDynamite(camX: number, camY: number) {
    const sticks = state.placedDynamite;
    if (!sticks?.length) return;
    for (const stick of sticks) {
      if (!isExplored(stick.x, stick.y)) continue;
      const sx = (stick.x - camX) * TILE, sy = (stick.y - camY) * TILE;
      if (sx < -TILE || sy < -TILE || sx > viewport.worldWidthPx + TILE || sy > viewport.worldHeightPx + TILE) continue;
      drawDynamiteStick(sx, sy, stick.fuse);
    }
  }
  function drawDynamiteStick(sx: number, sy: number, fuse: number) {
    // Reduced motion keeps the spark lit rather than flashing it.
    const lit = state.reducedMotion || isDynamiteFuseLit(fuse);
    ctx.save();
    ctx.translate(sx + TILE*.5, sy + TILE*.5);
    // The charge itself, standing on the tile.
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(-TILE*.13, -TILE*.06, TILE*.26, TILE*.38);
    ctx.fillStyle = '#f0d9a0';
    ctx.fillRect(-TILE*.13, TILE*.06, TILE*.26, TILE*.06);
    // Fuse wire, and the spark travelling down it.
    ctx.strokeStyle = '#d7c9a8'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -TILE*.06); ctx.lineTo(TILE*.10, -TILE*.24); ctx.stroke();
    if (lit) {
      ctx.fillStyle = '#fff2b0';
      ctx.shadowColor = '#ff9f1c';
      ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(TILE*.10, -TILE*.24, TILE*.08, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
  function drawEnemies(camX: number, camY: number) {
    for (const e of state.enemies) {
      if (!e.alive) continue;
      if (!isExplored(Math.round(e.x), Math.round(e.y))) continue;
      const sx = (e.drawX - camX) * TILE, sy = (e.drawY - camY) * TILE;
      if (sx < -TILE || sy < -TILE || sx > viewport.worldWidthPx + TILE || sy > viewport.worldHeightPx + TILE) continue;
      drawHauntedShip(sx, sy, e.kind, e.hp / e.maxHp, e.flash);
    }
  }
  /**
   * A wrecked prospector's rig, risen. It borrows the player ship's silhouette —
   * hull, canopy, pods, drill — but flies translucent and rusted, with no engine
   * flame, so a haunted motherlode reads as a ghost of the fleet at a glance.
   * Every animation is keyed off `tick` deterministically, so the ships need no
   * per-enemy render state; a per-ship phase keeps a swarm from flickering in
   * lockstep. `save`/`restore` fences the alpha and shadow off from other draws.
   */
  function drawHauntedShip(sx: number, sy: number, kind: EnemyKind, hpPct=1, flash=0, tick=state.tick) {
    const enemyType = getEnemyType(kind);
    const rust = rustPalette(kind);
    const hit = flash > .1;
    const phase = sx * .017 + sy * .023;
    const flicker = state.reducedMotion ? .7 : 0.62 + 0.08 * Math.sin(tick * 0.3 + phase);
    const bob = state.reducedMotion ? 0 : Math.sin(tick * 0.12 + phase) * TILE * .06;
    ctx.save();
    ctx.translate(sx + TILE*.5, sy + TILE*.5 + bob);
    ctx.globalAlpha = flicker;
    ctx.shadowColor = hit ? '#fff6a8' : enemyType.glow;
    ctx.shadowBlur = hit ? 14 : 7;
    // Rusted, desaturated hull built from the type's palette; a hit flash whitens it.
    drawShipHull(enemyHullGradient(kind, hit), 'rgba(196,214,210,.28)', rust[2]);
    ctx.shadowBlur = 0;
    // Dead, dark canopy with a couple of thin cracks across the glass.
    drawShipCanopy(hit ? 'rgba(120,120,90,.85)' : 'rgba(14,20,24,.85)');
    ctx.strokeStyle = 'rgba(150,170,175,.5)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-TILE*.14,-TILE*.48); ctx.lineTo(-TILE*.02,-TILE*.34); ctx.lineTo(TILE*.05,-TILE*.42);
    ctx.moveTo(TILE*.12,-TILE*.47); ctx.lineTo(TILE*.02,-TILE*.30);
    ctx.stroke();
    // A slowly turning drill under the nose; the tip swings on `tick`, no flame.
    ctx.save();
    ctx.translate(0, TILE*.30);
    const spin = state.reducedMotion ? 0 : Math.sin(tick * .15 + phase) * TILE * .07;
    ctx.fillStyle = '#25222a';
    ctx.beginPath(); ctx.moveTo(-TILE*.16, 0); ctx.lineTo(spin, TILE*.30); ctx.lineTo(TILE*.16, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rust[2]; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
    ctx.restore();
    // HP bar at full opacity so it stays readable above the translucent hull.
    const barCx = sx + TILE*.5, barCy = sy + TILE*.5 + bob;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(barCx - TILE*.28, barCy - TILE*.43, TILE*.56, TILE*.055);
    ctx.fillStyle = enemyType.glow; ctx.fillRect(barCx - TILE*.28, barCy - TILE*.43, TILE*.56*Math.max(0,hpPct), TILE*.055);
  }
  function drawTile(tile: Tile, wx: number, wy: number, sx: number, sy: number) {
    const ctx = drawingContext;
    // A dormant enemy is camouflaged: it paints as ordinary dirt.
    const t: Tile = tile.type === 'enemy' ? {type: 'dirt', hp: tile.hp, maxHp: tile.maxHp} : tile;
    const pad = 1.5; // overdraw slightly so adjacent cells have no visible seams
    if(t.type==='air') {
      const darkness = Math.min(.76, wy/82);
      ctx.fillStyle = `rgba(17,10,7,${darkness})`;
      ctx.fillRect(sx-pad,sy-pad,TILE+pad*2,TILE+pad*2);
      // very subtle cave haze, not a grid line
      if (rand(wx, wy) > .72) {
        ctx.fillStyle = `rgba(83,55,35,${0.04 + rand(wx+2,wy)*.05})`;
        ctx.beginPath(); ctx.ellipse(sx+TILE*rand(wx+4,wy), sy+TILE*rand(wx,wy+4), TILE*.22, TILE*.11, rand(wx,wy)*Math.PI, 0, Math.PI*2); ctx.fill();
      }
      return;
    }

    if (t.type === 'hazard') {
      const g = ctx.createRadialGradient(sx+TILE*.50, sy+TILE*.45, TILE*.08, sx+TILE*.5, sy+TILE*.5, TILE*.58);
      g.addColorStop(0, '#ffd38a'); g.addColorStop(.38, '#d33b16'); g.addColorStop(1, '#200805');
      ctx.fillStyle = g; ctx.fillRect(sx-pad,sy-pad,TILE+pad*2,TILE+pad*2);
      ctx.strokeStyle = 'rgba(255,89,36,.62)'; ctx.lineWidth = 4;
      for (let i=0;i<4;i++) { ctx.beginPath(); ctx.ellipse(sx+TILE*(.30+i*.13), sy+TILE*(.42+rand(wx+i,wy)*.22), TILE*(.10+rand(wx,wy+i)*.08), TILE*.28, rand(wx+i,wy)*Math.PI, 0, Math.PI*2); ctx.stroke(); }
      return;
    }
    if (t.type === 'decor') {
      drawDecorTile(ctx, t.decor, sx, sy);
      return;
    }
    // Smooth neighbor-averaged noise keeps color variation without obvious square patches.
    const n1 = (rand(wx,wy)+rand(wx-1,wy)+rand(wx+1,wy)+rand(wx,wy-1)+rand(wx,wy+1)) / 5;
    const n2 = (rand(wx*2+11,wy*2-7)+rand((wx-1)*2+11,wy*2-7)+rand((wx+1)*2+11,wy*2-7)+rand(wx*2+11,(wy-1)*2-7)+rand(wx*2+11,(wy+1)*2-7)) / 5;
    const n3 = (rand(wx-19,wy+23)+rand(wx-20,wy+23)+rand(wx-18,wy+23)+rand(wx-19,wy+22)+rand(wx-19,wy+24)) / 5;
    const depthWarm = Math.min(48, wy * .38);
    const hueShift = (n1-.5)*13;
    const light = (n2-.5)*12;
    const baseR = 67 + depthWarm + hueShift + light;
    const baseG = 43 + Math.min(30, wy*.16) + hueShift*.35 + light*.45;
    const baseB = 24 + hueShift*.12 + light*.18;

    const g = ctx.createLinearGradient(sx-TILE*.2, sy-TILE*.15, sx+TILE*1.15, sy+TILE*1.1);
    if (t.type === 'rock') {
      const r = 28 + n1*26, gg = 29 + n2*24, b = 36 + n3*24;
      g.addColorStop(0, `rgb(${r+22},${gg+22},${b+26})`);
      g.addColorStop(.55, `rgb(${r},${gg},${b})`);
      g.addColorStop(1, `rgb(${Math.max(9,r-18)},${Math.max(9,gg-18)},${Math.max(12,b-18)})`);
    } else if (t.type === 'ore') {
      g.addColorStop(0, `rgb(${Math.max(80,baseR+18)},${Math.max(48,baseG+8)},${Math.max(28,baseB+2)})`);
      g.addColorStop(.55, `rgb(${Math.max(46,baseR-10)},${Math.max(29,baseG-10)},${Math.max(18,baseB-5)})`);
      g.addColorStop(1, '#21130d');
    } else {
      g.addColorStop(0, `rgb(${baseR+18},${baseG+12},${baseB+7})`);
      g.addColorStop(.42, `rgb(${baseR},${baseG},${baseB})`);
      g.addColorStop(1, `rgb(${Math.max(33,baseR-34)},${Math.max(22,baseG-24)},${Math.max(13,baseB-15)})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(sx-pad,sy-pad,TILE+pad*2,TILE+pad*2);

    // soft blobs crossing tile borders make dirt feel continuous rather than grid-blocked
    for (let i=0;i<9;i++) {
      const bx = sx + (rand(wx+i*13, wy-i*5) * 1.18 - .09) * TILE;
      const by = sy + (rand(wx-i*9, wy+i*17) * 1.18 - .09) * TILE;
      const rw = TILE*(.18 + rand(wx+i,wy+3)*.48);
      const rh = TILE*(.05 + rand(wx-2,wy+i)*.18);
      ctx.save();
      ctx.translate(bx, by); ctx.rotate((rand(wx+i*2,wy-i)-.5)*1.2);
      if (t.type === 'rock') ctx.fillStyle = `rgba(160,166,184,${.035 + rand(wx+i,wy)*.075})`;
      else ctx.fillStyle = i % 3 === 0 ? `rgba(255,218,145,${.035 + rand(wx+i,wy)*.06})` : `rgba(38,20,11,${.035 + rand(wx-i,wy)*.065})`;
      ctx.beginPath(); ctx.ellipse(0,0,rw,rh,0,0,Math.PI*2); ctx.fill();
      ctx.restore();
    }

    // irregular strata lines, deliberately offset beyond tile bounds
    for (let i=0;i<4;i++) {
      const yy = sy + TILE*(.16 + i*.22 + (rand(wx+i*3,wy)-.5)*.08);
      ctx.strokeStyle = t.type === 'rock' ? `rgba(220,226,240,${.045 + n2*.055})` : `rgba(245,195,120,${.035 + n3*.055})`;
      ctx.lineWidth = 2 + rand(wx+i,wy)*3;
      ctx.beginPath();
      ctx.moveTo(sx - TILE*.08, yy);
      ctx.bezierCurveTo(sx+TILE*.24, yy + (rand(wx,wy+i)-.5)*TILE*.12, sx+TILE*.70, yy + (rand(wx+i,wy+1)-.5)*TILE*.14, sx+TILE*1.08, yy + (rand(wx-i,wy+2)-.5)*TILE*.10);
      ctx.stroke();
    }

    if(t.type==='ore') {
      ctx.save(); ctx.shadowColor=t.ore.color; ctx.shadowBlur=16;
      for (let i=0;i<4;i++) {
        const cx = sx+TILE*(.28+rand(wx+i,wy)*.44), cy = sy+TILE*(.28+rand(wx,wy+i)*.44);
        const r = TILE*(.075+rand(wx+i*2,wy)*.075);
        const crystal = ctx.createLinearGradient(cx-r, cy-r, cx+r, cy+r);
        crystal.addColorStop(0, '#ffffff'); crystal.addColorStop(.18, t.ore.color); crystal.addColorStop(1, 'rgba(0,0,0,.55)');
        ctx.fillStyle=crystal; ctx.beginPath();
        ctx.moveTo(cx, cy-r*1.35); ctx.lineTo(cx+r*.95, cy-r*.22); ctx.lineTo(cx+r*.55, cy+r*.95); ctx.lineTo(cx-r*.50, cy+r*1.05); ctx.lineTo(cx-r*.92, cy-r*.15); ctx.closePath(); ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,.38)'; ctx.lineWidth=2; ctx.stroke();
      }
      ctx.fillStyle='rgba(255,255,255,.75)';
      for (let i=0;i<3;i++) ctx.fillRect(sx+TILE*(.18+rand(wx-i,wy)*.66), sy+TILE*(.18+rand(wx,wy-i)*.66), TILE*.025, TILE*.025);
      ctx.restore();
    }
    if(t.type==='rock'){
      ctx.fillStyle='rgba(210,220,240,.11)'; ctx.fillRect(sx+TILE*.12,sy+TILE*.22,TILE*.72,TILE*.10); ctx.fillRect(sx+TILE*.29,sy+TILE*.61,TILE*.56,TILE*.10);
    }
  }
  /**
   * A placed decoration: a flat panel, one of four looks. Steel is a riveted grey
   * plate, stone a grey-brown masonry slab, copper trim a warm bordered panel, and
   * the lamp panel a dark plate with a glowing strip. Deliberately simple and static
   * — no `state.tick` — so it caches with the terrain like every other tile.
   */
  function drawDecorTile(ctx: CanvasRenderingContext2D, decor: 'steelPlate' | 'stoneBlock' | 'copperTrim' | 'lampPanel', sx: number, sy: number) {
    const x = sx + TILE*.10, y = sy + TILE*.10, w = TILE*.80, h = TILE*.80;
    if (decor === 'steelPlate') {
      ctx.fillStyle = '#8fa2b5'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,.20)'; ctx.fillRect(x, y, w, TILE*.10);
      ctx.fillStyle = 'rgba(0,0,0,.30)'; ctx.fillRect(x, y + h - TILE*.10, w, TILE*.10);
      ctx.fillStyle = '#4a5866';
      for (const rx of [x + TILE*.10, x + w - TILE*.14]) for (const ry of [y + TILE*.10, y + h - TILE*.14]) {
        ctx.beginPath(); ctx.arc(rx, ry, TILE*.03, 0, Math.PI*2); ctx.fill();
      }
      return;
    }
    if (decor === 'stoneBlock') {
      // A grey-brown masonry slab: flat fill, a darker mortar border, and a couple
      // of chiselled lines to read as coursed blockwork.
      ctx.fillStyle = '#7d7a72'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#4f4c46'; ctx.lineWidth = TILE*.05;
      ctx.strokeRect(x + TILE*.03, y + TILE*.03, w - TILE*.06, h - TILE*.06);
      ctx.strokeStyle = 'rgba(60,57,52,.7)'; ctx.lineWidth = TILE*.03;
      ctx.beginPath();
      ctx.moveTo(x, y + h*.5); ctx.lineTo(x + w, y + h*.5);
      ctx.moveTo(x + w*.5, y); ctx.lineTo(x + w*.5, y + h*.5);
      ctx.moveTo(x + w*.33, y + h*.5); ctx.lineTo(x + w*.33, y + h);
      ctx.stroke();
      return;
    }
    if (decor === 'copperTrim') {
      ctx.fillStyle = '#6d4a2c'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#c47b45'; ctx.lineWidth = TILE*.08;
      ctx.strokeRect(x + TILE*.05, y + TILE*.05, w - TILE*.10, h - TILE*.10);
      ctx.fillStyle = 'rgba(255,208,150,.35)'; ctx.fillRect(x + TILE*.14, y + TILE*.14, w - TILE*.28, TILE*.08);
      return;
    }
    // lampPanel: a dark plate with a warm glowing strip down its middle.
    ctx.fillStyle = '#232a31'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#ffdf7a';
    ctx.shadowColor = '#ffc857'; ctx.shadowBlur = 12;
    ctx.fillRect(x + w*.5 - TILE*.05, y + TILE*.10, TILE*.10, h - TILE*.20);
    ctx.shadowBlur = 0;
  }
  function drawTileDamage(t: Tile, sx: number, sy: number) {
    // Air and rock carry no durability, so neither shows damage.
    if (t.type === 'air' || t.type === 'rock') return;
    if (t.hp >= t.maxHp) return;
    if (t.type === 'hazard') {
      ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(sx+TILE*.18, sy+TILE*.12, TILE*.64, TILE*.055);
      ctx.fillStyle='#ff7145'; ctx.fillRect(sx+TILE*.18, sy+TILE*.12, TILE*.64*Math.max(0,t.hp/t.maxHp), TILE*.055);
      return;
    }
    const damage = 1 - t.hp / t.maxHp;
    ctx.strokeStyle = `rgba(255,238,178,${0.25 + damage*.55})`;
    ctx.lineWidth = 2 + damage * 4;
    ctx.beginPath();
    ctx.moveTo(sx+TILE*.24, sy+TILE*.36);
    ctx.lineTo(sx+TILE*.42, sy+TILE*.48);
    ctx.lineTo(sx+TILE*.35, sy+TILE*.66);
    ctx.moveTo(sx+TILE*.58, sy+TILE*.30);
    ctx.lineTo(sx+TILE*.49, sy+TILE*.52);
    ctx.lineTo(sx+TILE*.70, sy+TILE*.70);
    ctx.stroke();
  }
  function drawTerrainBlendOverlay() {
    const width = viewport.worldWidthPx, height = viewport.worldHeightPx;
    ctx.fillStyle = 'rgba(45,24,13,.075)'; ctx.fillRect(0,0,width,height);
    const overlay = blendOverlay();
    if (!overlay) return;
    ctx.save(); ctx.globalCompositeOperation = 'soft-light';
    ctx.drawImage(overlay, 0, 0, overlay.width, overlay.height, 0, 0, width, height);
    ctx.restore();
  }
  /**
   * The soft-light wash of warm and dark ellipses over the terrain, baked once.
   * Every ellipse is laid out in fractions of the view's width and height, and a
   * zoom scales both by the same factor, so the picture depends on the canvas's
   * CSS size alone: it is painted at that size and stretched over the zoomed
   * world, rebuilt only on a resize. The ellipses blend with each other plainly
   * inside the bake and with the terrain once as a group — at a few percent alpha
   * each, the same wash the per-frame composite painted.
   */
  let blendCanvas: HTMLCanvasElement | null = null;
  let blendWidth = 0, blendHeight = 0;
  function blendOverlay(): HTMLCanvasElement | null {
    const width = viewport.widthPx, height = viewport.heightPx;
    if (blendCanvas && blendWidth === width && blendHeight === height) return blendCanvas;
    blendCanvas ??= document.createElement('canvas');
    // Resizing clears the canvas and resets its context, so the bake starts clean.
    blendCanvas.width = width;
    blendCanvas.height = height;
    const bake = blendCanvas.getContext('2d');
    if (!bake) return null;
    blendWidth = width;
    blendHeight = height;
    for (let i=0;i<10;i++) {
      bake.fillStyle = i%2 ? 'rgba(255,182,96,.035)' : 'rgba(0,0,0,.045)';
      bake.beginPath();
      bake.ellipse((i*.137%1)*width, (i*.293%1)*height, width*(.10+.025*(i%3)), height*(.06+.015*(i%4)), (i*.7)%Math.PI, 0, Math.PI*2);
      bake.fill();
    }
    return blendCanvas;
  }
  function drawShip(p: ShipTransform, sprintDirection: Direction | null = null) {
    const dead = state.gameOver;
    // Idle motion — the post-move wobble and the flame flicker — holds still under
    // reduced motion; the flame keeps its mid-length so the ship still reads as lit.
    const still = state.reducedMotion;
    const wobble = still ? 0 : Math.sin(state.tick*.22) * p.bob * TILE*.025;
    ctx.translate(0, wobble);
    if (!dead && sprintDirection) drawBoostFlames(sprintDirection, p.facing);
    // engine flame + drill pulse
    const flame = TILE*(.22 + (still ? 0 : Math.sin(state.tick*.55)*.04));
    ctx.fillStyle = dead ? '#433' : '#ffb02e'; ctx.beginPath(); ctx.moveTo(-TILE*.16,TILE*.28); ctx.lineTo(0,TILE*.54+flame*.18); ctx.lineTo(TILE*.16,TILE*.28); ctx.fill();
    ctx.fillStyle = '#9a5a16'; ctx.beginPath(); ctx.moveTo(-TILE*.08,TILE*.30); ctx.lineTo(0,TILE*.46); ctx.lineTo(TILE*.08,TILE*.30); ctx.fill();
    // A bigger hull reads bigger: ~4% per rung above the Scout, applied to the hull
    // and its nose lamp only, so the drill and the flames keep their size.
    const size = shipScale(p.ship);
    withHullScale(size, () => {
      drawShipHull(dead ? deadHullGradient() : liveHullGradient(p.ship), 'rgba(255,255,255,.35)', '#26384d');
      drawShipCanopy(canopyGradient());
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(-TILE*.12,-TILE*.46,TILE*.10,TILE*.035);
    });
    drawDirectionalDrill(p);
    withHullScale(size, () => {
      ctx.fillStyle = '#ffd35f'; ctx.fillRect(TILE*.30, -TILE*.09, TILE*.14, TILE*.18);
      ctx.fillStyle = '#182536'; ctx.fillRect(TILE*.33, -TILE*.055, TILE*.08, TILE*.11);
    });
  }
  /** Draw `paint` scaled by `size` about the hull's centre; the Scout's 1 draws it as is. */
  function withHullScale(size: number, paint: () => void) {
    if (size === 1) { paint(); return; }
    ctx.save();
    ctx.scale(size, size);
    paint();
    ctx.restore();
  }
  /**
   * The rounded hull with its dark waterline stripe and the two side pods. Shared
   * by the player ship and the haunted enemy rigs so their silhouette matches; only
   * the fills differ. Assumes the caller has centred the origin on the hull.
   */
  function drawShipHull(bodyFill: string | CanvasGradient, strokeStyle: string, podFill: string) {
    ctx.fillStyle = bodyFill; roundRect(ctx, -TILE*.36,-TILE*.30,TILE*.72,TILE*.58,TILE*.11); ctx.fill();
    ctx.strokeStyle = strokeStyle; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = 'rgba(7,20,34,.45)'; ctx.fillRect(-TILE*.31, -TILE*.02, TILE*.62, TILE*.045);
    ctx.fillStyle = podFill; ctx.fillRect(-TILE*.43, -TILE*.03, TILE*.14, TILE*.18); ctx.fillRect(TILE*.29, -TILE*.03, TILE*.14, TILE*.18);
  }
  /** The canopy bubble. The player's highlight is drawn by its caller; the haunted rig leaves it dark. */
  function drawShipCanopy(glassFill: string | CanvasGradient) {
    ctx.fillStyle = glassFill; roundRect(ctx, -TILE*.20,-TILE*.50,TILE*.40,TILE*.24,TILE*.055); ctx.fill();
  }
  function drawBoostFlames(direction: [number, number], facing: number) {
    const pulse = state.reducedMotion ? 0 : Math.sin(state.tick*.9) * TILE*.055;
    const length = TILE*.72 + pulse;
    ctx.save();
    // The ship context is mirrored by facing, so convert world travel into local coordinates first.
    ctx.rotate(Math.atan2(direction[1], direction[0] * facing));
    ctx.globalCompositeOperation = 'screen';
    ctx.shadowColor = '#43d9ff';
    ctx.shadowBlur = state.reducedMotion ? 8 : 15;
    for (const offset of [-TILE*.17, TILE*.17]) {
      ctx.fillStyle = 'rgba(65,205,255,.88)';
      ctx.beginPath();
      ctx.moveTo(-TILE*.28, offset-TILE*.085);
      ctx.lineTo(-length, offset);
      ctx.lineTo(-TILE*.28, offset+TILE*.085);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff1a3';
      ctx.beginPath();
      ctx.moveTo(-TILE*.30, offset-TILE*.035);
      ctx.lineTo(-length+TILE*.24, offset);
      ctx.lineTo(-TILE*.30, offset+TILE*.035);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  function drawDirectionalDrill(p: ShipTransform) {
    const active = p.drillAnim > 0.05;
    const shake = active && !state.reducedMotion;
    const jitter = shake ? Math.sin(state.tick * 1.8) * TILE * .025 * p.drillAnim : 0;
    ctx.save();
    if (active && p.drillDx !== 0) {
      // ctx is already scaled to facing; +X is the visual nose side after ctx.scale(p.facing, 1).
      ctx.translate(TILE*.45 + jitter, TILE*.03);
      ctx.rotate(-Math.PI / 2);
    } else {
      ctx.translate(0, jitter);
    }
    const spin = shake ? Math.sin(state.tick * 1.2) * TILE * .025 : 0;
    ctx.fillStyle = '#25222a';
    ctx.beginPath(); ctx.moveTo(-TILE*.18,TILE*.28); ctx.lineTo(spin,TILE*.62); ctx.lineTo(TILE*.18,TILE*.28); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = active ? '#fff0a6' : '#d5d0c0'; ctx.lineWidth = active ? 5 : 3; ctx.stroke();
    ctx.fillStyle = 'rgba(255,214,92,.85)';
    if (active) {
      ctx.fillRect(-TILE*.04, TILE*.38, TILE*.08, TILE*.18);
      ctx.fillStyle = 'rgba(255,244,170,.75)';
      ctx.fillRect(-TILE*.09, TILE*.56, TILE*.045, TILE*.12);
      ctx.fillRect(TILE*.06, TILE*.52, TILE*.04, TILE*.10);
    }
    ctx.restore();
  }
  /** The hull's draw scale: the Scout at 1, each rung up the ladder 4% bigger. */
  function shipScale(ship: ShipId): number {
    return 1 + SHIP_SCALE_PER_TIER * shipTier(ship);
  }
  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  }

  return { draw, invalidateTerrain, invalidateFog, refreshTileDamage };
}

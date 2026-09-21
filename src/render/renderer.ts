import { SURFACE_HEIGHT, TILE, WORLD_W } from '../../shared/constants';
import { viewport } from '../game/viewport';
import { getVisibleTileRange } from '../world/visible-tile-range';
import { isTileExplored } from '../../shared/exploration-codec';
import { getEnemyType } from '../core/enemy-types';
import { type PlacedContainer } from '../core/cargo-container';
import { isDynamiteFuseLit, type PlacedDynamite } from '../core/dynamite';
import { totalItems, type InventoryItemKind } from '../core/inventory';
import { isPlaceableKind, isPlacementValid, placementOverlayCells } from '../core/placement-overlay';
import { isScannerDone, type ScannerDevice } from '../core/scanner-device';
import { TERRAIN_CHUNK_TILES, terrainCacheScale, terrainChunkCoordinate, terrainChunkKeyForTile } from './terrain-cache-policy';
import type {
  Direction,
  Enemy,
  EnemyKind,
  Particle,
  ShipTransform,
  TeleportEffect,
  Tile
} from '../core/types';

const TERRAIN_CHUNK_PADDING = 52;
// Fog bleeds one pixel past a tile plus half a vein stroke, so it needs far less
// room around a chunk than the terrain's blob and strata overdraw.
const FOG_CHUNK_PADDING = 8;
const MAX_EXTRA_CHUNKS = 32;

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
  teleportEffect?: TeleportEffect | null;
  input?: {sprintDirection?: Direction | null};
  /** The carried device armed for placement, or `null`/absent when none is. */
  armedPlacement?: InventoryItemKind | null;
  /** The tile under the pointer, for the stronger placement hover highlight. */
  hoverTile?: {x: number; y: number} | null;
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
}

export function createRenderer({ state, canvas, ctx, get, rand }: RendererDeps): Renderer {
  let drawingContext: CanvasRenderingContext2D = ctx;
  const isExplored = (x: number, y: number) => !state.exploredTiles || isTileExplored(state.exploredTiles, x, y);

  // Terrain and fog both change rarely (mining / exploration) but were redrawn per
  // frame, so both use the same chunked offscreen cache: DPR-aware scale, LRU trim,
  // and per-tile dirty invalidation on the shared chunk grid.
  const terrainLayer = createChunkLayer({
    padding: TERRAIN_CHUNK_PADDING,
    source: () => state.world,
    paint: (startX, startY, endX, endY, padding) => {
      for(let wy=startY;wy<=endY;wy++) for(let wx=startX;wx<=endX;wx++) {
        drawTile(get(wx,wy), wx, wy, padding + (wx-startX)*TILE, padding + (wy-startY)*TILE);
      }
    }
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

  function createChunkLayer({ padding, source, paint, isBlank }: ChunkLayerOptions){
    // `null` is a cached "nothing to draw here" result, not a cache miss.
    const chunks = new Map<string, CachedChunk | null>();
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
          cachedScale = scale;
          cachedSource = currentSource;
        }

        const startChunkX = terrainChunkCoordinate(range.startX);
        const endChunkX = terrainChunkCoordinate(range.endX);
        const startChunkY = terrainChunkCoordinate(range.startY);
        const endChunkY = terrainChunkCoordinate(range.endY);
        let visibleChunkCount = 0;
        for(let chunkY=startChunkY;chunkY<=endChunkY;chunkY++) for(let chunkX=startChunkX;chunkX<=endChunkX;chunkX++) {
          const key = `${chunkX},${chunkY}`;
          const cached = chunks.has(key);
          const chunk = cached ? chunks.get(key)! : build(chunkX, chunkY, scale);
          // Re-inserting keeps the Map ordered least- to most-recently used.
          if (cached) chunks.delete(key);
          chunks.set(key, chunk);
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

        while (chunks.size > visibleChunkCount + MAX_EXTRA_CHUNKS) {
          const oldestKey = chunks.keys().next().value;
          if (oldestKey === undefined) break;
          chunks.delete(oldestKey);
        }
      }
    };
  }

  function drawTerrainDamage(camX: number, camY: number){
    const range = getVisibleTileRange(camX, camY, viewport.tilesX, viewport.tilesY, WORLD_W);
    for(let wy=range.startY;wy<=range.endY;wy++) for(let wx=range.startX;wx<=range.endX;wx++) {
      if (!isExplored(wx, wy)) continue;
      drawTileDamage(get(wx,wy), (wx-camX)*TILE, (wy-camY)*TILE);
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
    const sky = ctx.createLinearGradient(0,0,0,viewport.worldHeightPx);
    sky.addColorStop(0,'#163762'); sky.addColorStop(.25,'#0e1d31'); sky.addColorStop(.26,'#2a1a11'); sky.addColorStop(1,'#050301');
    ctx.fillStyle = sky; ctx.fillRect(0,0,viewport.worldWidthPx,viewport.worldHeightPx);
    terrainLayer.draw(camX, camY);
    drawTerrainDamage(camX, camY);
    drawTerrainBlendOverlay(camY);
    drawSurface(camX, camY);
    drawCargoContainers(camX, camY);
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
    const sx=(p.drawX-camX)*TILE, sy=(p.drawY-camY)*TILE;
    drawTeleportEffect(camX, camY, false);
    ctx.save();
    if (state.teleportEffect) ctx.globalAlpha = Math.min(1, .32 + state.teleportEffect.frame / Math.max(1, state.teleportEffect.duration * .42));
    ctx.translate(sx+TILE*.5, sy+TILE*.5 + Math.sin(state.tick*.45)*p.bob*TILE*.08);
    ctx.rotate((p.x - p.drawX) * -0.12 + (p.y - p.drawY) * 0.08 + (p.drillDy > 0 ? p.drillAnim * 0.10 : 0));
    ctx.scale(p.facing, 1);
    drawShip(p, state.input?.sprintDirection);
    ctx.restore();
    drawTeleportEffect(camX, camY, true);
    ctx.restore();
    if(state.gameOver){
      ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(0,0,viewport.widthPx,viewport.heightPx);
      ctx.fillStyle='#fff'; ctx.textAlign='center';
      ctx.font='bold 38px sans-serif'; ctx.fillText('GAME OVER', viewport.widthPx/2, 295);
      ctx.font='bold 24px sans-serif'; ctx.fillText('Tap anywhere to restart', viewport.widthPx/2, 338);
      ctx.font='18px sans-serif'; ctx.fillText('or press R', viewport.widthPx/2, 370);
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
   * Deployed scanners, as a lit dish on a tripod. A working one sweeps a ring
   * that a finished one has lost, so "still mapping" and "spent" are one glance
   * apart without a label on the canvas.
   */
  function drawScannerDevices(camX: number, camY: number) {
    const devices = state.scannerDevices;
    if (!devices?.length) return;
    for (const device of devices) {
      if (!isExplored(device.x, device.y)) continue;
      const sx = (device.x - camX) * TILE, sy = (device.y - camY) * TILE;
      if (sx < -TILE || sy < -TILE || sx > viewport.worldWidthPx + TILE || sy > viewport.worldHeightPx + TILE) continue;
      drawScannerBody(sx, sy, state.exploredTiles ? isScannerDone(device, state.exploredTiles) : true);
    }
  }
  function drawScannerBody(sx: number, sy: number, done: boolean) {
    const glow = done ? '#5d6b78' : '#7fe3ff';
    ctx.save();
    ctx.translate(sx + TILE*.5, sy + TILE*.5);
    if (!done && !state.reducedMotion) {
      // One expanding pulse per cycle: the survey, made visible.
      const pulse = (state.tick % 90) / 90;
      ctx.globalAlpha = (1 - pulse) * .45;
      ctx.strokeStyle = glow; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, TILE*(.2 + pulse*.8), 0, Math.PI*2); ctx.stroke();
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
      drawEnemyBody(sx, sy, e.kind, e.hp / e.maxHp, e.flash);
    }
  }
  function drawEnemyBody(sx: number, sy: number, kind: EnemyKind, hpPct=1, flash=0) {
    const enemyType = getEnemyType(kind);
    ctx.save();
    ctx.translate(sx + TILE*.5, sy + TILE*.5 + Math.sin(state.tick*.34)*TILE*.05);
    ctx.rotate(Math.sin(state.tick*.18) * .08);
    ctx.shadowColor = flash > .1 ? '#fff6a8' : enemyType.glow;
    ctx.shadowBlur = flash > .1 ? 22 : 10;
    const body = ctx.createRadialGradient(-TILE*.12,-TILE*.16,TILE*.06,0,0,TILE*.45);
    body.addColorStop(0, flash > .1 ? '#fff6a8' : enemyType.colors[0]);
    body.addColorStop(.45, enemyType.colors[1]);
    body.addColorStop(1, enemyType.colors[2]);
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(0, 0, TILE*.34, TILE*.28, 0, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#10180d';
    ctx.beginPath(); ctx.arc(-TILE*.12, -TILE*.06, TILE*.055, 0, Math.PI*2); ctx.arc(TILE*.12, -TILE*.06, TILE*.055, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#fff8c4';
    ctx.beginPath(); ctx.moveTo(-TILE*.12,TILE*.10); ctx.lineTo(-TILE*.05,TILE*.23); ctx.lineTo(TILE*.02,TILE*.10); ctx.lineTo(TILE*.09,TILE*.23); ctx.lineTo(TILE*.16,TILE*.10); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = enemyType.colors[2]; ctx.lineWidth = kind === 'ironback' ? 8 : 5;
    for (let i=-1;i<=1;i+=2) {
      ctx.beginPath(); ctx.moveTo(i*TILE*.24, TILE*.02); ctx.lineTo(i*TILE*.48, TILE*.14); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i*TILE*.20, -TILE*.10); ctx.lineTo(i*TILE*.42, -TILE*.25); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(-TILE*.28, -TILE*.43, TILE*.56, TILE*.055);
    ctx.fillStyle = enemyType.glow; ctx.fillRect(-TILE*.28, -TILE*.43, TILE*.56*Math.max(0,hpPct), TILE*.055);
    ctx.restore();
  }
  function drawTile(tile: Tile, wx: number, wy: number, sx: number, sy: number) {
    const ctx = drawingContext;
    // A dormant enemy is camouflaged: it paints as ordinary dirt.
    const t: Tile = tile.type === 'enemy' ? {type: 'dirt', hp: tile.hp, maxHp: tile.maxHp} : tile;
    const pad = 1.5; // overdraw slightly so adjacent cells have no visible seams
    if(t.type==='air') {
      if (wy >= SURFACE_HEIGHT){
        const darkness = Math.min(.76, wy/82);
        ctx.fillStyle = `rgba(17,10,7,${darkness})`;
        ctx.fillRect(sx-pad,sy-pad,TILE+pad*2,TILE+pad*2);
        // very subtle cave haze, not a grid line
        if (rand(wx, wy) > .72) {
          ctx.fillStyle = `rgba(83,55,35,${0.04 + rand(wx+2,wy)*.05})`;
          ctx.beginPath(); ctx.ellipse(sx+TILE*rand(wx+4,wy), sy+TILE*rand(wx,wy+4), TILE*.22, TILE*.11, rand(wx,wy)*Math.PI, 0, Math.PI*2); ctx.fill();
        }
      }
      return;
    }

    if (t.type === 'artifact') {
      const g = ctx.createRadialGradient(sx+TILE*.50, sy+TILE*.46, TILE*.06, sx+TILE*.5, sy+TILE*.5, TILE*.62);
      g.addColorStop(0, '#fff8d6'); g.addColorStop(.24, t.artifact.color); g.addColorStop(.62, '#18384a'); g.addColorStop(1, '#071018');
      ctx.fillStyle = g; ctx.fillRect(sx-pad,sy-pad,TILE+pad*2,TILE+pad*2);
      ctx.save(); ctx.shadowColor=t.artifact.color; ctx.shadowBlur=18;
      ctx.fillStyle='#ffe59a'; ctx.strokeStyle='#ffffff'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(sx+TILE*.5,sy+TILE*.17); ctx.lineTo(sx+TILE*.72,sy+TILE*.40); ctx.lineTo(sx+TILE*.62,sy+TILE*.75); ctx.lineTo(sx+TILE*.38,sy+TILE*.75); ctx.lineTo(sx+TILE*.28,sy+TILE*.40); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle='#172132'; ctx.font=`bold ${Math.floor(TILE*.24)}px sans-serif`; ctx.textAlign='center'; ctx.fillText('$',sx+TILE*.5,sy+TILE*.57); ctx.textAlign='left'; ctx.restore();
      return;
    }
    if (t.type === 'hazard' || t.type === 'motherlode') {
      const artifact = t.type === 'motherlode';
      const g = ctx.createRadialGradient(sx+TILE*.50, sy+TILE*.45, TILE*.08, sx+TILE*.5, sy+TILE*.5, TILE*.58);
      if (artifact) { g.addColorStop(0, '#fff4b5'); g.addColorStop(.35, '#ff8a1f'); g.addColorStop(1, '#3a0d05'); }
      else { g.addColorStop(0, '#ffd38a'); g.addColorStop(.38, '#d33b16'); g.addColorStop(1, '#200805'); }
      ctx.fillStyle = g; ctx.fillRect(sx-pad,sy-pad,TILE+pad*2,TILE+pad*2);
      ctx.strokeStyle = artifact ? 'rgba(255,236,150,.85)' : 'rgba(255,89,36,.62)'; ctx.lineWidth = artifact ? 5 : 4;
      for (let i=0;i<4;i++) { ctx.beginPath(); ctx.ellipse(sx+TILE*(.30+i*.13), sy+TILE*(.42+rand(wx+i,wy)*.22), TILE*(.10+rand(wx,wy+i)*.08), TILE*.28, rand(wx+i,wy)*Math.PI, 0, Math.PI*2); ctx.stroke(); }
      if (artifact) { ctx.fillStyle = '#fff2a6'; ctx.font = `bold ${Math.floor(TILE*.18)}px sans-serif`; ctx.textAlign='center'; ctx.fillText('CORE', sx+TILE*.5, sy+TILE*.55); ctx.textAlign='left'; }
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
  function drawTileDamage(t: Tile, sx: number, sy: number) {
    // Air has no durability and rock is indestructible, so neither shows damage.
    if (t.type === 'air' || t.type === 'rock') return;
    if (t.hp >= t.maxHp) return;
    if (t.type === 'hazard' || t.type === 'artifact' || t.type === 'motherlode') {
      ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(sx+TILE*.18, sy+TILE*.12, TILE*.64, TILE*.055);
      ctx.fillStyle=t.type === 'hazard'?'#ff7145':t.type === 'artifact'?t.artifact.color:'#ffe66d'; ctx.fillRect(sx+TILE*.18, sy+TILE*.12, TILE*.64*Math.max(0,t.hp/t.maxHp), TILE*.055);
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
  function drawTerrainBlendOverlay(camY: number) {
    if (camY < SURFACE_HEIGHT + .2) {
      const gy = (SURFACE_HEIGHT - camY) * TILE;
      const grad = ctx.createLinearGradient(0, gy, 0, viewport.worldHeightPx);
      grad.addColorStop(0, 'rgba(100,58,28,.10)');
      grad.addColorStop(.55, 'rgba(58,31,16,.09)');
      grad.addColorStop(1, 'rgba(22,10,5,.16)');
      ctx.fillStyle = grad; ctx.fillRect(0, Math.max(0, gy), viewport.worldWidthPx, viewport.worldHeightPx);
    } else {
      ctx.fillStyle = 'rgba(45,24,13,.075)'; ctx.fillRect(0,0,viewport.worldWidthPx,viewport.worldHeightPx);
    }
    ctx.save(); ctx.globalCompositeOperation = 'soft-light';
    for (let i=0;i<10;i++) {
      ctx.fillStyle = i%2 ? 'rgba(255,182,96,.035)' : 'rgba(0,0,0,.045)';
      ctx.beginPath();
      ctx.ellipse((i*.137%1)*viewport.worldWidthPx, (i*.293%1)*viewport.worldHeightPx, viewport.worldWidthPx*(.10+.025*(i%3)), viewport.worldHeightPx*(.06+.015*(i%4)), (i*.7)%Math.PI, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }
  function surfaceMetrics(camY: number) {
    const groundY = (SURFACE_HEIGHT - camY) * TILE;
    return { groundY, skyTop: Math.max(0, -camY * TILE), block: TILE, top: groundY - TILE };
  }
  function pole(px: number, poleTop: number) {
    ctx.fillStyle = '#5a4632'; ctx.fillRect(px - TILE*.05, poleTop, TILE*.10, TILE*2);
    ctx.fillStyle = '#43321f'; ctx.fillRect(px - TILE*.30, poleTop + TILE*.10, TILE*.60, TILE*.07); ctx.fillRect(px - TILE*.22, poleTop + TILE*.27, TILE*.44, TILE*.06);
    ctx.fillStyle = '#cfe0f0'; ctx.fillRect(px - TILE*.27, poleTop + TILE*.05, TILE*.05, TILE*.06); ctx.fillRect(px + TILE*.22, poleTop + TILE*.05, TILE*.05, TILE*.06);
  }
  function drawSurface(camX: number, camY: number) {
    if (camY >= SURFACE_HEIGHT + 1.4) return;
    const { groundY, skyTop, block, top } = surfaceMetrics(camY);
    const bx = (WORLD_W/2 - 4.4 - camX) * TILE;

    // Three full blocks of surface air above the diggable ground.
    const haze = ctx.createLinearGradient(0, skyTop, 0, groundY);
    haze.addColorStop(0, 'rgba(89,160,221,.18)');
    haze.addColorStop(.65, 'rgba(248,188,106,.10)');
    haze.addColorStop(1, 'rgba(48,92,66,.16)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, skyTop, viewport.worldWidthPx, Math.max(0, groundY - skyTop));

    // Background treelines go first so poles and buildings stay in front of the foliage.
    drawDistantTreeline(groundY);
    drawParallaxTreeShapes(camX, groundY);

    // Ground cap now sits below the 3-tile-tall surface space.
    ctx.fillStyle = '#1b623f'; ctx.fillRect(0, groundY - TILE*.12, viewport.worldWidthPx, TILE*.18);
    ctx.fillStyle = '#74451e'; ctx.fillRect(0, groundY + TILE*.06, viewport.worldWidthPx, TILE*.18);

    // Electric poles: 2 blocks tall (taller than the buildings), strung with wires. Drawn behind the buildings.
    const poleTop = groundY - TILE*2;
    const poleXs = [bx - TILE*1.0, bx + TILE*3.55, bx + TILE*9.0];
    ctx.strokeStyle = '#15100b'; ctx.lineWidth = 3; ctx.beginPath();
    for (let i=0;i<poleXs.length-1;i++) {
      const x0=poleXs[i], x1=poleXs[i+1], wy=poleTop+TILE*.16, sag=TILE*.24;
      ctx.moveTo(x0, wy); ctx.quadraticCurveTo((x0+x1)/2, wy+sag, x1, wy);
      ctx.moveTo(x0, wy+TILE*.17); ctx.quadraticCurveTo((x0+x1)/2, wy+sag+TILE*.17, x1, wy+TILE*.17);
    }
    ctx.stroke();
    for (const px of poleXs) pole(px, poleTop);

    // Buildings: each exactly one block tall, sitting on the ground.
    const building = (x: number, w: number, body: string, roof: string) => {
      ctx.fillStyle = body; roundRect(ctx, x, top, w, block, 7); ctx.fill();
      ctx.fillStyle = roof; ctx.fillRect(x - TILE*.04, top - TILE*.07, w + TILE*.08, TILE*.11);
    };
    const windows = (x: number, w: number, color: string) => {
      ctx.fillStyle = color;
      const cols = Math.max(2, Math.round(w / (TILE*.46))), gap = w / cols;
      for (let i=0;i<cols;i++) ctx.fillRect(x + gap*i + gap*.30, top + block*.34, gap*.40, block*.30);
    };

    // Central depot (labelled).
    building(bx, TILE*3.3, '#2a4565', '#1b2c42');
    ctx.fillStyle = '#ffc857'; ctx.font = 'bold 22px sans-serif'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('DEPOT', bx + TILE*.32, top + block*.60);
    drawRedStar(bx + TILE*2.9, top + block*.40, TILE*.15, '#ffdf64');

    // Refuel station.
    building(bx + TILE*3.7, TILE*1.7, '#b5472b', '#7e2f1b');
    ctx.fillStyle = '#ffe28b'; ctx.fillRect(bx + TILE*3.95, top + block*.56, TILE*.5, TILE*.22);
    drawHammerSickle(bx + TILE*4.62, top + block*.40, TILE*.19);

    // Sell shed with a small crate stack out front.
    building(bx + TILE*5.7, TILE*2.0, '#39506f', '#26384d');
    windows(bx + TILE*5.7, TILE*2.0, '#bfe0ff');
    ['#9b5f2b','#6b8f40','#b77934','#455d85'].forEach((c,i)=>{ ctx.fillStyle=c; ctx.fillRect(bx+TILE*(8.05+(i%2)*.4), groundY-TILE*(.24+Math.floor(i/2)*.22), TILE*.34, TILE*.20); });
  }

  function drawDistantTreeline(groundY: number) {
    // Distant line is horizontally screen-stable, but vertically tied to the surface ground.
    const baseY = groundY - TILE * .28;
    ctx.fillStyle = 'rgba(34,80,57,.42)';
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    for (let x=0; x<=viewport.worldWidthPx+40; x+=40) {
      const h = 18 + rand(x, 7) * 20;
      ctx.lineTo(x, baseY - h);
      ctx.lineTo(x + 20, baseY - h * .72);
    }
    ctx.lineTo(viewport.worldWidthPx, baseY + 24);
    ctx.lineTo(0, baseY + 24);
    ctx.closePath();
    ctx.fill();
  }

  function drawParallaxTreeShapes(camX: number, groundY: number) {
    // Nearer tree shapes are vertically anchored to the surface and drift horizontally slower than buildings.
    const treeBaseY = groundY - TILE * .18;
    const spacing = TILE * .72;
    const parallaxX = camX * TILE * .38;
    // Enough trunks to fill the wrap period, so a zoomed-out view widens the line
    // instead of leaving a bare stretch of horizon where the band runs out.
    const treeCount = Math.ceil((viewport.worldWidthPx + spacing * 2) / spacing);
    for (let i=-4;i<treeCount;i++) {
      const worldX = i * spacing + 17;
      const x = ((worldX - parallaxX) % (viewport.worldWidthPx + spacing * 2)) - spacing;
      const trunkH = 18 + rand(i,4)*20;
      const trunkW = 5 + rand(i,8)*5;
      const crownR = 15 + rand(i,3)*20;
      ctx.fillStyle = 'rgba(47,66,39,.78)';
      ctx.fillRect(x + crownR*.35, treeBaseY - trunkH, trunkW, trunkH);
      ctx.fillStyle = i%3 ? 'rgba(47,135,86,.88)' : 'rgba(35,93,62,.88)';
      ctx.beginPath();
      ctx.ellipse(x + crownR*.5, treeBaseY - trunkH - crownR*.22, crownR*.58, crownR*.92, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = i%2 ? 'rgba(31,92,60,.72)' : 'rgba(65,145,78,.72)';
      ctx.beginPath();
      ctx.ellipse(x + crownR*.18, treeBaseY - trunkH + crownR*.05, crownR*.34, crownR*.54, -.4, 0, Math.PI*2);
      ctx.fill();
    }
  }
  function drawShip(p: ShipTransform, sprintDirection: Direction | null = null) {
    const dead = state.gameOver;
    const wobble = Math.sin(state.tick*.22) * p.bob * TILE*.025;
    ctx.translate(0, wobble);
    if (!dead && sprintDirection) drawBoostFlames(sprintDirection, p.facing);
    // engine flame + drill pulse
    const flame = TILE*(.22 + Math.sin(state.tick*.55)*.04);
    ctx.fillStyle = dead ? '#433' : '#ffb02e'; ctx.beginPath(); ctx.moveTo(-TILE*.16,TILE*.28); ctx.lineTo(0,TILE*.54+flame*.18); ctx.lineTo(TILE*.16,TILE*.28); ctx.fill();
    ctx.fillStyle = '#9a5a16'; ctx.beginPath(); ctx.moveTo(-TILE*.08,TILE*.30); ctx.lineTo(0,TILE*.46); ctx.lineTo(TILE*.08,TILE*.30); ctx.fill();
    const body = ctx.createLinearGradient(-TILE*.35,-TILE*.3,TILE*.35,TILE*.30);
    body.addColorStop(0, dead ? '#555' : '#9ee6ff'); body.addColorStop(.45, dead ? '#676767' : '#4dbbe8'); body.addColorStop(1, dead ? '#333' : '#126a98');
    ctx.fillStyle = body; roundRect(ctx, -TILE*.36,-TILE*.30,TILE*.72,TILE*.58,TILE*.11); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = 'rgba(7,20,34,.45)'; ctx.fillRect(-TILE*.31, -TILE*.02, TILE*.62, TILE*.045);
    ctx.fillStyle = '#26384d'; ctx.fillRect(-TILE*.43, -TILE*.03, TILE*.14, TILE*.18); ctx.fillRect(TILE*.29, -TILE*.03, TILE*.14, TILE*.18);
    const glass = ctx.createLinearGradient(0,-TILE*.50,0,-TILE*.24); glass.addColorStop(0,'#ffffff'); glass.addColorStop(.25,'#b9f3ff'); glass.addColorStop(1,'#387898');
    ctx.fillStyle = glass; roundRect(ctx, -TILE*.20,-TILE*.50,TILE*.40,TILE*.24,TILE*.055); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(-TILE*.12,-TILE*.46,TILE*.10,TILE*.035);
    drawDirectionalDrill(p);
    ctx.fillStyle = '#ffd35f'; ctx.fillRect(TILE*.30, -TILE*.09, TILE*.14, TILE*.18);
    ctx.fillStyle = '#182536'; ctx.fillRect(TILE*.33, -TILE*.055, TILE*.08, TILE*.11);
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
  function drawRedStar(cx: number, cy: number, r: number, color='#ffd95a') {
    ctx.save(); ctx.fillStyle=color; ctx.beginPath();
    for (let i=0;i<10;i++) { const a=-Math.PI/2 + i*Math.PI/5; const rr=i%2===0?r:r*.42; const x=cx+Math.cos(a)*rr, y=cy+Math.sin(a)*rr; if(i) ctx.lineTo(x,y); else ctx.moveTo(x,y); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function drawHammerSickle(cx: number, cy: number, s: number) {
    ctx.save(); ctx.strokeStyle='#ffd95a'; ctx.fillStyle='#ffd95a'; ctx.lineWidth=Math.max(2,s*.16); ctx.lineCap='round';
    ctx.beginPath(); ctx.arc(cx, cy, s*.62, -Math.PI*.15, Math.PI*.92); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx-s*.52, cy+s*.46); ctx.lineTo(cx+s*.56, cy-s*.48); ctx.stroke();
    ctx.fillRect(cx-s*.18, cy-s*.55, s*.65, s*.13);
    ctx.restore();
  }
  function drawDirectionalDrill(p: ShipTransform) {
    const active = p.drillAnim > 0.05;
    const jitter = active ? Math.sin(state.tick * 1.8) * TILE * .025 * p.drillAnim : 0;
    ctx.save();
    if (active && p.drillDx !== 0) {
      // ctx is already scaled to facing; +X is the visual nose side after ctx.scale(p.facing, 1).
      ctx.translate(TILE*.45 + jitter, TILE*.03);
      ctx.rotate(-Math.PI / 2);
    } else {
      ctx.translate(0, jitter);
    }
    const spin = active ? Math.sin(state.tick * 1.2) * TILE * .025 : 0;
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
  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  }

  return { draw, invalidateTerrain, invalidateFog };
}

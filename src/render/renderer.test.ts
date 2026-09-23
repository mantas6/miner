import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TILE } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';
import { createPlacedContainer } from '../core/cargo-container';
import { DYNAMITE, DYNAMITE_ITEM } from '../core/dynamite';
import { addItem } from '../core/inventory';
import { createInitialStations } from '../core/stations';
import type { Direction } from '../core/types';

const mocks = vi.hoisted(() => {
  const gradient = {addColorStop: vi.fn()};
  const createContext = () => ({
    arc: vi.fn(),
    arcTo: vi.fn(),
    beginPath: vi.fn(),
    bezierCurveTo: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    createRadialGradient: vi.fn(() => gradient),
    drawImage: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    shadowColor: '',
    shadowBlur: 0,
    globalAlpha: 1,
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    strokeText: vi.fn(),
    translate: vi.fn()
  });

  return {
    gradient,
    mainContext: createContext(),
    terrainContext: createContext(),
    canvas: {width: 1920, height: 1280},
    viewport: {
      widthPx: 960, heightPx: 640,
      zoom: 1, targetZoom: 1,
      worldWidthPx: 960, worldHeightPx: 640,
      tilesX: 15, tilesY: 10
    },
    terrainCanvases: [] as Array<{width: number; height: number}>
  };
});

vi.mock('../game/viewport', () => ({
  viewport: mocks.viewport
}));

/** Mirror `setViewportZoom` on the mocked viewport singleton. */
function zoomViewport(zoom: number): void {
  Object.assign(mocks.viewport, {
    zoom,
    targetZoom: zoom,
    worldWidthPx: mocks.viewport.widthPx / zoom,
    worldHeightPx: mocks.viewport.heightPx / zoom,
    tilesX: Math.floor(mocks.viewport.widthPx / zoom / TILE),
    tilesY: Math.floor(mocks.viewport.heightPx / zoom / TILE)
  });
}

import { createRenderer as createRendererWithSurface, type RendererDeps } from './renderer';

/**
 * The renderer takes its canvas and context as dependencies now, so the tests
 * inject the same fakes the module mock used to supply.
 */
function createRenderer(deps: Omit<RendererDeps, 'canvas' | 'ctx'>) {
  return createRendererWithSurface({
    ...deps,
    canvas: mocks.canvas as unknown as HTMLCanvasElement,
    ctx: mocks.mainContext as unknown as CanvasRenderingContext2D
  });
}

describe('terrain cache lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    zoomViewport(1);
    mocks.terrainCanvases.length = 0;
    vi.stubGlobal('document', {
      createElement: vi.fn(() => {
        const terrainCanvas = {
          width: 0,
          height: 0,
          getContext: vi.fn(() => mocks.terrainContext)
        };
        mocks.terrainCanvases.push(terrainCanvas);
        return terrainCanvas;
      })
    });
  });

  it('renders only newly exposed chunks while the camera moves', () => {
    const state = {
      world: [],
      camX: 10.2,
      camY: 20.2,
      tick: 0,
      gameOver: false,
      particles: [],
      enemies: [],
      player: {
        x: 12,
        y: 22,
        drawX: 12,
        drawY: 22,
        facing: 1,
        bob: 0,
        drillAnim: 0,
        drillDx: 0,
        drillDy: 1
      }
    };
    const renderer = createRenderer({
      state,
      get: () => ({type: 'air'}),
      rand: () => 0
    });

    renderer.draw();
    const initialTileDraws = mocks.terrainContext.fillRect.mock.calls.length;
    expect(initialTileDraws).toBeGreaterThan(0);
    const chunkCanvasSize = 4 * TILE + 2 * 52; // 4-tile chunk plus overdraw padding
    expect(Math.max(...mocks.terrainCanvases.map(canvas => canvas.width))).toBe(chunkCanvasSize);
    expect(Math.max(...mocks.terrainCanvases.map(canvas => canvas.height))).toBe(chunkCanvasSize);

    renderer.draw();
    expect(mocks.terrainContext.fillRect).toHaveBeenCalledTimes(initialTileDraws);

    // Four-by-four blocks keep the cache stable during short camera interpolation.
    state.camX = 14.2;
    renderer.draw();
    expect(mocks.terrainContext.fillRect.mock.calls.length).toBeGreaterThan(initialTileDraws);

    state.camX = 18.2;
    renderer.draw();
    const exposedTileDraws = mocks.terrainContext.fillRect.mock.calls.length - initialTileDraws;
    expect(exposedTileDraws).toBeGreaterThan(0);
    expect(exposedTileDraws).toBeLessThan(initialTileDraws / 2);
  });

  it('invalidates one changed tile chunk without rebuilding the viewport', () => {
    const state = {
      world: [],
      camX: 10.2,
      camY: 20.2,
      tick: 0,
      gameOver: false,
      particles: [],
      enemies: [],
      player: {
        x: 12,
        y: 22,
        drawX: 12,
        drawY: 22,
        facing: 1,
        bob: 0,
        drillAnim: 0,
        drillDx: 0,
        drillDy: 1
      }
    };
    const renderer = createRenderer({
      state,
      get: () => ({type: 'air'}),
      rand: () => 0
    });

    renderer.draw();
    const initialTileDraws = mocks.terrainContext.fillRect.mock.calls.length;

    renderer.invalidateTerrain(12, 22);
    renderer.draw();
    expect(mocks.terrainContext.fillRect).toHaveBeenCalledTimes(initialTileDraws + 16);

    renderer.invalidateTerrain();
    renderer.draw();
    expect(mocks.terrainContext.fillRect.mock.calls.length).toBeGreaterThan(initialTileDraws * 1.5);
  });

  it('renders a buried enemy as ordinary dirt', () => {
    const state = {
      world: [], camX: 10, camY: 20, tick: 0, gameOver: false,
      particles: [], enemies: [],
      player: {x:12, y:22, drawX:12, drawY:22, facing:1, bob:0, drillAnim:0, drillDx:0, drillDy:1}
    };
    const renderer = createRenderer({
      state,
      get: () => ({type:'enemy', kind:'tunnelFiend' as const, hp:4, maxHp:4}),
      rand: () => 0
    });

    renderer.draw();

    expect(mocks.terrainContext.createLinearGradient).toHaveBeenCalled();
    expect(mocks.terrainContext.createRadialGradient).not.toHaveBeenCalled();
  });

  /**
   * The enemies are haunted prospector rigs now: they borrow the ship silhouette
   * but fly translucent under their type's glow, so a live one paints a hull
   * gradient with a below-one alpha and its type's glow as the shadow color.
   */
  it('draws haunted enemy ships translucent under the enemy glow', () => {
    const state = {
      world: [], camX: 10, camY: 1000, tick: 0, gameOver: false,
      particles: [],
      enemies: [{id:1, kind:'abyssStalker' as const, x:12, y:1002, drawX:12, drawY:1002, hp:8, maxHp:8, alive:true, moveTick:0, biteTick:0, flash:0}],
      player: {x:12, y:1002, drawX:12, drawY:1002, facing:1, bob:0, drillAnim:0, drillDx:0, drillDy:1}
    };
    const renderer = createRenderer({state, get: () => ({type:'air'}), rand: () => 0});

    renderer.draw();

    // The wreck flies under its type's glow, ghostly and semi-transparent.
    expect(mocks.mainContext.createLinearGradient).toHaveBeenCalled();
    expect(mocks.mainContext.shadowColor).toBe('#df76ff');
    expect(mocks.mainContext.globalAlpha).toBeGreaterThan(0);
    expect(mocks.mainContext.globalAlpha).toBeLessThan(1);
  });

  /** A struck rig whitens: the shadow and the hull's top gradient stop go pale. */
  it('whitens a haunted ship on the hit flash', () => {
    const state = {
      world: [], camX: 10, camY: 1000, tick: 0, gameOver: false,
      particles: [],
      enemies: [{id:1, kind:'abyssStalker' as const, x:12, y:1002, drawX:12, drawY:1002, hp:8, maxHp:8, alive:true, moveTick:0, biteTick:0, flash:1}],
      player: {x:12, y:1002, drawX:12, drawY:1002, facing:1, bob:0, drillAnim:0, drillDx:0, drillDy:1}
    };
    const renderer = createRenderer({state, get: () => ({type:'air'}), rand: () => 0});

    renderer.draw();

    expect(mocks.mainContext.shadowColor).toBe('#fff6a8');
    expect(mocks.gradient.addColorStop).toHaveBeenCalledWith(0, '#fff6a8');
  });

  it('renders departure and arrival feedback across a camera jump', () => {
    const state = {
      world: [], camX: 37.5, camY: 0, tick: 0, gameOver: false,
      particles: [], enemies: [],
      teleportEffect: {
        originScreenX: 480, originScreenY: 320,
        destinationX: 45, destinationY: 2,
        frame: 2, duration: 36, reducedMotion: false
      },
      player: {x:45, y:2, drawX:45, drawY:2, facing:1, bob:0, drillAnim:0, drillDx:0, drillDy:1}
    };
    const renderer = createRenderer({state, get: () => ({type:'air'}), rand: () => 0});

    renderer.draw();

    expect(mocks.mainContext.arc).toHaveBeenCalledWith(480, 320, expect.any(Number), 0, Math.PI*2);
    expect(mocks.mainContext.createRadialGradient).toHaveBeenCalled();
    expect(mocks.mainContext.fillRect).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), 4, 4);
  });

  it('paints textured unexplored tiles without leaking enemies or particles', () => {
    const state = {
      world: [], camX: 10, camY: 20, tick: 0, gameOver: false,
      exploredTiles: new Set<number>(), teleportEffect: null,
      particles: [{x:12.5, y:22.5, vx:0, vy:0, life:20, color:'#fff', size:.1}],
      enemies: [{id:1, kind:'tunnelFiend' as const, x:12, y:22, drawX:12, drawY:22, hp:4, maxHp:4, alive:true, moveTick:0, biteTick:0, flash:0}],
      player: {x:12, y:22, drawX:12, drawY:22, facing:1, bob:0, drillAnim:0, drillDx:0, drillDy:1}
    };
    const renderer = createRenderer({state, get: () => ({type:'dirt', hp:5, maxHp:5}), rand: () => 0});

    renderer.draw();

    // TILE + 2 is the fog tile's overdrawn base rect; it now lands in a cached
    // chunk canvas rather than straight on the visible context.
    expect(mocks.terrainContext.fillRect).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), TILE + 2, TILE + 2);
    expect(mocks.mainContext.fillRect).not.toHaveBeenCalledWith(expect.any(Number), expect.any(Number), TILE + 2, TILE + 2);
    expect(mocks.terrainContext.bezierCurveTo).toHaveBeenCalled();
    expect(mocks.mainContext.createRadialGradient).not.toHaveBeenCalled();
  });

  it('keeps cached fog chunks until exploration marks them dirty', () => {
    const state = {
      world: [], camX: 10.2, camY: 20.2, tick: 0, gameOver: false,
      exploredTiles: new Set<number>(), teleportEffect: null,
      particles: [], enemies: [],
      player: {x:12, y:22, drawX:12, drawY:22, facing:1, bob:0, drillAnim:0, drillDx:0, drillDy:1}
    };
    const renderer = createRenderer({state, get: () => ({type:'dirt', hp:1, maxHp:1}), rand: () => 0});
    // The fog base rect is the only draw sized TILE + 2, so it isolates fog work
    // from the terrain tiles sharing the offscreen context mock.
    const fogTileDraws = () => mocks.terrainContext.fillRect.mock.calls
      .filter(([, , width]) => width === TILE + 2).length;

    renderer.draw();
    const initial = fogTileDraws();
    expect(initial).toBeGreaterThan(0);

    renderer.draw();
    expect(fogTileDraws()).toBe(initial);

    // One newly explored tile repaints only its own 4x4 chunk, minus that tile.
    state.exploredTiles.add(explorationIndex(12, 22));
    renderer.invalidateFog(12, 22);
    renderer.draw();
    expect(fogTileDraws()).toBe(initial + 15);

    renderer.invalidateFog();
    renderer.draw();
    expect(fogTileDraws()).toBe(initial * 2 + 14);

    // A fully explored chunk caches "nothing to draw": no canvas, no blit, no paint.
    const canvasesBefore = mocks.terrainCanvases.length;
    for (let y = 20; y < 24; y++) for (let x = 12; x < 16; x++) state.exploredTiles.add(explorationIndex(x, y));
    renderer.invalidateFog(12, 22);
    renderer.draw();
    expect(fogTileDraws()).toBe(initial * 2 + 14);
    expect(mocks.terrainCanvases.length).toBe(canvasesBefore);
  });

  it('draws boost jets opposite the active travel direction only', () => {
    const state = {
      world: [], camX: 10, camY: 20, tick: 4, gameOver: false, reducedMotion: false,
      exploredTiles: new Set<number>(), teleportEffect: null,
      particles: [], enemies: [],
      input: {sprintDirection: [0, -1] as Direction | null},
      player: {x:12, y:22, drawX:12, drawY:22, facing:1, bob:0, drillAnim:0, drillDx:0, drillDy:1}
    };
    const renderer = createRenderer({state, get: () => ({type:'air'}), rand: () => 0});

    renderer.draw();

    expect(mocks.mainContext.rotate).toHaveBeenCalledWith(-Math.PI/2);
    expect(mocks.mainContext.shadowColor).toBe('#43d9ff');

    vi.clearAllMocks();
    mocks.mainContext.shadowColor = '';
    state.input.sprintDirection = null;
    renderer.draw();
    expect(mocks.mainContext.shadowColor).not.toBe('#43d9ff');
  });

  /**
   * The one thing a deployed scanner has to say on the canvas is whether it is
   * still working, and it says it with the sweep ring a finished one has lost.
   */
  it('sweeps a ring for a working scanner and drops it once the square is mapped', () => {
    const device = {x: 12, y: 24, timer: 0};
    const state = {
      world: [], camX: 10, camY: 20, tick: 4, gameOver: false, reducedMotion: false,
      exploredTiles: new Set([explorationIndex(12, 24)]), teleportEffect: null,
      particles: [], enemies: [], scannerDevices: [device],
      player: {x:12, y:22, drawX:12, drawY:22, facing:1, bob:0, drillAnim:0, drillDx:0, drillDy:1}
    };
    const renderer = createRenderer({state, get: () => ({type:'air'}), rand: () => 0});
    // The device sits two tiles below the ship: its own tile, in screen pixels.
    const at = (call: unknown[]) => call[0] === TILE*2.5 && call[1] === TILE*4.5;

    renderer.draw();
    expect(mocks.mainContext.translate.mock.calls.some(at)).toBe(true);
    const sweeping = mocks.mainContext.arc.mock.calls.length;

    // Everything around it explored: the survey is over, and the ring goes.
    vi.clearAllMocks();
    for (let y = 21; y <= 27; y++) for (let x = 9; x <= 15; x++) state.exploredTiles.add(explorationIndex(x, y));
    renderer.draw();
    expect(mocks.mainContext.translate.mock.calls.some(at)).toBe(true);
    expect(mocks.mainContext.arc.mock.calls.length).toBe(sweeping - 1);
  });

  /**
   * A planted stick has one thing to say — how close it is to going off — and it
   * says it by flashing, so what is checked is that the spark is drawn on some
   * steps and not on others as the fuse burns down.
   */
  it('flashes the spark on a burning fuse and holds it lit under reduced motion', () => {
    const stick = {x: 12, y: 24, fuse: DYNAMITE.fuseTicks};
    const state = {
      world: [], camX: 10, camY: 20, tick: 4, gameOver: false, reducedMotion: false,
      exploredTiles: new Set([explorationIndex(12, 24)]), teleportEffect: null,
      particles: [], enemies: [], placedDynamite: [stick],
      player: {x:12, y:22, drawX:12, drawY:22, facing:1, bob:0, drillAnim:0, drillDx:0, drillDy:1}
    };
    const renderer = createRenderer({state, get: () => ({type:'air'}), rand: () => 0});
    const at = (call: unknown[]) => call[0] === TILE*2.5 && call[1] === TILE*4.5;
    /** Whether this frame drew the spark: the only arc the stick ever paints. */
    const sparked = () => {
      vi.clearAllMocks();
      renderer.draw();
      expect(mocks.mainContext.translate.mock.calls.some(at)).toBe(true);
      return mocks.mainContext.arc.mock.calls.length > 0;
    };

    const frames = new Set<boolean>();
    for (let step = 0; step < 120; step++) {
      stick.fuse = DYNAMITE.fuseTicks - step;
      frames.add(sparked());
    }
    expect(frames).toEqual(new Set([true, false]));

    // Reduced motion trades the flash for a spark that simply stays lit.
    state.reducedMotion = true;
    for (let step = 0; step < 20; step++) {
      stick.fuse = DYNAMITE.fuseTicks - step;
      expect(sparked()).toBe(true);
    }
  });

  it('leaves a stick under fog unpainted, like the scanners out there', () => {
    const state = {
      world: [], camX: 10, camY: 20, tick: 4, gameOver: false, reducedMotion: false,
      exploredTiles: new Set<number>(), teleportEffect: null,
      particles: [], enemies: [], placedDynamite: [{x: 12, y: 24, fuse: 30}],
      player: {x:12, y:22, drawX:12, drawY:22, facing:1, bob:0, drillAnim:0, drillDx:0, drillDy:1}
    };
    const renderer = createRenderer({state, get: () => ({type:'air'}), rand: () => 0});

    renderer.draw();

    expect(mocks.mainContext.translate.mock.calls.some(call => call[0] === TILE*2.5 && call[1] === TILE*4.5)).toBe(false);
  });

  it('leaves a scanner under fog unpainted, like everything else out there', () => {
    const state = {
      world: [], camX: 10, camY: 20, tick: 4, gameOver: false, reducedMotion: false,
      exploredTiles: new Set<number>(), teleportEffect: null,
      particles: [], enemies: [], scannerDevices: [{x: 12, y: 24, timer: 0}],
      player: {x:12, y:22, drawX:12, drawY:22, facing:1, bob:0, drillAnim:0, drillDx:0, drillDy:1}
    };
    const renderer = createRenderer({state, get: () => ({type:'air'}), rand: () => 0});

    renderer.draw();

    expect(mocks.mainContext.translate.mock.calls.some(call => call[0] === TILE*2.5 && call[1] === TILE*4.5)).toBe(false);
  });

  /**
   * A crate says one thing on the canvas — whether it is worth the detour — and it
   * says it with a lit panel a lamp is drawn for. An empty one paints no lamp glow.
   */
  it('lights a loaded container and leaves an empty one dark and unpainted under fog', () => {
    const container = createPlacedContainer(12, 24);
    const state = {
      world: [], camX: 10, camY: 20, tick: 4, gameOver: false, reducedMotion: false,
      exploredTiles: new Set([explorationIndex(12, 24)]), teleportEffect: null,
      particles: [], enemies: [], cargoContainers: [container],
      player: {x:12, y:22, drawX:12, drawY:22, facing:1, bob:0, drillAnim:0, drillDx:0, drillDy:1}
    };
    const renderer = createRenderer({state, get: () => ({type:'air'}), rand: () => 0});
    const at = (call: unknown[]) => call[0] === TILE*2.5 && call[1] === TILE*4.5;

    renderer.draw();
    expect(mocks.mainContext.translate.mock.calls.some(at)).toBe(true);
    expect(mocks.mainContext.shadowColor).not.toBe('#ffc857');

    vi.clearAllMocks();
    container.inventory = addItem(container.inventory, DYNAMITE_ITEM, 1)!;
    renderer.draw();
    expect(mocks.mainContext.shadowColor).toBe('#ffc857');

    // And a crate out in the fog is not drawn at all, like everything else there.
    vi.clearAllMocks();
    state.exploredTiles = new Set<number>();
    renderer.draw();
    expect(mocks.mainContext.translate.mock.calls.some(at)).toBe(false);
  });

  /**
   * The home stations wear their names above them so the base reads at a glance.
   * The labels ride the same explored gate as the bodies: painted when the tiles
   * are revealed, absent while they sit under fog.
   */
  it('labels the home stations once their tiles are explored, and hides the names under fog', () => {
    const state = {
      world: [], camX: 40, camY: 15, tick: 4, gameOver: false, reducedMotion: false,
      exploredTiles: new Set([explorationIndex(44, 20), explorationIndex(46, 20)]), teleportEffect: null,
      particles: [], enemies: [], stations: createInitialStations(),
      player: {x:45, y:18, drawX:45, drawY:18, facing:1, bob:0, drillAnim:0, drillDx:0, drillDy:1}
    };
    const renderer = createRenderer({state, get: () => ({type:'air'}), rand: () => 0});
    const labelled = (name: string) => mocks.mainContext.fillText.mock.calls.some(call => call[0] === name);

    renderer.draw();
    expect(labelled('Oil Extractor')).toBe(true);
    expect(labelled('Manufacturer')).toBe(true);

    // Fog the tiles again and neither name should be painted.
    vi.clearAllMocks();
    state.exploredTiles = new Set<number>();
    renderer.draw();
    expect(labelled('Oil Extractor')).toBe(false);
    expect(labelled('Manufacturer')).toBe(false);
  });

  /**
   * While a placeable device is armed, the mine gets a preview grid: a faint tint
   * on the nearby explored tiles and a stronger outline on the tile under the
   * pointer. It vanishes the moment nothing is armed.
   */
  it('paints a placement grid while a device is armed and clears it once disarmed', () => {
    const state = {
      world: [], camX: 10, camY: 20, tick: 0, gameOver: false, reducedMotion: false,
      exploredTiles: new Set<number>(), teleportEffect: null,
      particles: [], enemies: [], scannerDevices: [], placedDynamite: [], cargoContainers: [],
      armedPlacement: 'scanner' as 'scanner' | null,
      hoverTile: {x: 12, y: 22} as {x: number; y: number} | null,
      player: {x:12, y:22, drawX:12, drawY:22, facing:1, bob:0, drillAnim:0, drillDx:0, drillDy:1}
    };
    for (let y=21;y<=23;y++) for (let x=11;x<=13;x++) state.exploredTiles.add(explorationIndex(x,y));
    const renderer = createRenderer({state, get: () => ({type:'air'}), rand: () => 0});

    renderer.draw();
    // A full-tile fill is unique to the grid, and the hovered tile carries an outline.
    expect(mocks.mainContext.fillRect).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), TILE, TILE);
    expect(mocks.mainContext.strokeRect).toHaveBeenCalled();

    vi.clearAllMocks();
    state.armedPlacement = null;
    state.hoverTile = null;
    renderer.draw();
    expect(mocks.mainContext.fillRect).not.toHaveBeenCalledWith(expect.any(Number), expect.any(Number), TILE, TILE);
    expect(mocks.mainContext.strokeRect).not.toHaveBeenCalled();
  });

  it('keeps reduced-motion boost flames static across render frames', () => {
    const state = {
      world: [], camX: 10, camY: 20, tick: 1, gameOver: false, reducedMotion: true,
      exploredTiles: new Set<number>(), teleportEffect: null,
      particles: [], enemies: [], input: {sprintDirection: [1, 0] as Direction | null},
      player: {x:12, y:22, drawX:12, drawY:22, facing:1, bob:0, drillAnim:0, drillDx:0, drillDy:1}
    };
    const renderer = createRenderer({state, get: () => ({type:'air'}), rand: () => 0});
    const flameTips = () => mocks.mainContext.lineTo.mock.calls
      .filter(([, y]) => Math.abs(y) === TILE*.17)
      .map(([x, y]) => [x, y]);

    renderer.draw();
    const firstFrame = flameTips();
    vi.clearAllMocks();
    state.tick = 17;
    renderer.draw();
    const secondFrame = flameTips();

    expect(firstFrame).not.toHaveLength(0);
    expect(firstFrame).toEqual(secondFrame);
  });
});

describe('camera zoom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    zoomViewport(1);
    mocks.terrainCanvases.length = 0;
    vi.stubGlobal('document', {
      createElement: vi.fn(() => {
        const terrainCanvas = {width: 0, height: 0, getContext: vi.fn(() => mocks.terrainContext)};
        mocks.terrainCanvases.push(terrainCanvas);
        return terrainCanvas;
      })
    });
  });

  function zoomState() {
    return {
      world: [], camX: 10, camY: 20, tick: 0, gameOver: true,
      particles: [], enemies: [], teleportEffect: null,
      player: {x:12, y:22, drawX:12, drawY:22, facing:1, bob:0, drillAnim:0, drillDx:0, drillDy:1}
    };
  }

  it('scales the world once and paints the sky across the zoomed-out world size', () => {
    const renderer = createRenderer({state: zoomState(), get: () => ({type:'air'}), rand: () => 0});
    zoomViewport(0.5);

    renderer.draw();

    expect(mocks.mainContext.scale).toHaveBeenCalledWith(0.5, 0.5);
    expect(mocks.mainContext.fillRect).toHaveBeenCalledWith(0, 0, 1920, 1280);
  });

  it('keeps the game-over overlay in screen pixels, outside the zoom transform', () => {
    const renderer = createRenderer({state: zoomState(), get: () => ({type:'air'}), rand: () => 0});
    zoomViewport(2);

    renderer.draw();

    // The overlay is painted after `restore()`, so it still covers the CSS canvas.
    expect(mocks.mainContext.fillRect).toHaveBeenCalledWith(0, 0, 960, 640);
    expect(mocks.mainContext.fillText).toHaveBeenCalledWith('GAME OVER', 480, 295);
  });

  it('cuts terrain chunks at the magnified resolution so zooming in stays crisp', () => {
    const renderer = createRenderer({state: zoomState(), get: () => ({type:'dirt', hp:1, maxHp:1}), rand: () => 0});
    zoomViewport(2);

    renderer.draw();

    const chunkPixels = (4 * TILE + 2 * 52) * 2;
    expect(Math.max(...mocks.terrainCanvases.map(canvas => canvas.width))).toBe(chunkPixels);
    expect(mocks.terrainContext.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
  });

  it('reuses cached chunks while the zoom eases within one resolution step', () => {
    const renderer = createRenderer({state: zoomState(), get: () => ({type:'dirt', hp:1, maxHp:1}), rand: () => 0});
    zoomViewport(1.2);

    renderer.draw();
    const builtAtBaseline = mocks.terrainCanvases.length;
    expect(mocks.terrainContext.setTransform).toHaveBeenLastCalledWith(1.5, 0, 0, 1.5, 0, 0);

    // 1.2 and 1.4 share the 1.5 cache step, and the tighter view exposes nothing new.
    zoomViewport(1.4);
    renderer.draw();
    expect(mocks.terrainCanvases.length).toBe(builtAtBaseline);

    // Crossing a step rebuilds once, at the higher resolution.
    zoomViewport(2);
    renderer.draw();
    expect(mocks.terrainCanvases.length).toBeGreaterThan(builtAtBaseline);
    expect(mocks.terrainContext.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
  });
});

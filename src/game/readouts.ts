// Derived HUD readouts: the terrain scanner, the trading-post beacon, the
// return-fuel forecast, and the depth-milestone tracker.
//
// All four live in `src/core` as pure formatters, but each needs live world
// data the loop owns. This module is the one place that feeds them, so they are
// evaluated from `uiSync.sync()` (`ui-sync.ts`) alongside every other HUD field
// instead of being scattered through the move handlers.
//
// Everything here is memoized on the scalars it actually depends on — the drill
// target, its tile and hit points, fuel, position, the station list — because
// `sync()` runs once per animation frame. A ship holding still reformats nothing
// and allocates nothing; only a moved ship, a chewed tile, a spent litre of fuel
// or a placed/lifted/renamed portal costs a string.

import { isTileExplored } from '../../shared/exploration-codec';
import {
  formatDepthMilestoneReached,
  getDepthMilestone,
  type DepthMilestone,
  type DepthMilestoneKind
} from '../core/depth-milestone';
import {
  fuelExitLabel,
  fuelReserveExits,
  getFuelReserveForecast,
  type FuelExit,
  type FuelReserveStatus
} from '../core/fuel-reserve';
import { isHoverSideDrill, isTraversableTile } from '../core/movement';
import { tradingPostHint } from '../core/post-beacon';
import { formatTerrainScanner } from '../core/scanner';
import type { PlacedStation } from '../core/stations';
import type { AudioController, Direction, GameState, Tile } from '../core/types';
import type { EnemySim } from './enemies';
import type { WorldGrid } from './world-grid';

/** The slice of the HUD snapshot this module owns. */
export interface HudReadoutFields {
  scanner: string;
  /** The trading-post beacon under the scanner line; empty when none is near. */
  postHint: string;
  fuelReserveStatus: FuelReserveStatus;
  /** Fuel the trip to the cheapest exit (home or a portal) would cost, rounded up. */
  fuelReserveNeeded: number;
  /** Fuel expected to survive that trip, rounded down and clamped at zero. */
  fuelReserveMargin: number;
  /** The exit that trip is priced to: `Home` or `Portal "Deep"`. */
  fuelReserveExit: string;
  depthTarget: string;
  depthTargetKind: DepthMilestoneKind;
  depthTargetRemaining: number;
}

export interface HudReadouts {
  /** Fill this frame's readout fields, announcing any landmark just cleared. */
  sync(hud: HudReadoutFields): void;
  /** The exit the last sync priced the fuel reserve to (home or a field portal), for the objective. */
  readonly fuelExit: FuelExit | null;
  /**
   * Re-arm the landmark announcements, as a wiped profile's first run would. A
   * death does not call this: the announcements count across the career.
   */
  reset(): void;
}

export interface HudReadoutDeps {
  state: GameState;
  grid: WorldGrid;
  enemies: EnemySim;
  audio: AudioController;
  atSurface(): boolean;
  toast(message: string): void;
}

function tileHp(tile: Tile): number {
  return 'hp' in tile ? tile.hp : 0;
}

export function createReadouts({state, grid, enemies, audio, atSurface, toast}: HudReadoutDeps): HudReadouts {
  /** Reused, so scanning never allocates a direction tuple. */
  const scanDirection: Direction = [0, 1];

  // Terrain scanner memo: target coordinate, aim, and what is standing there.
  let scanX = NaN;
  let scanY = NaN;
  let scanDx = NaN;
  let scanDy = NaN;
  let scanTile: Tile | null = null;
  let scanHp = NaN;
  let scanEnemyId = 0;
  let scanExplored = false;
  let scanDrill = NaN;
  let scanHovering = false;
  let scannerLine = '';

  // Trading-post beacon memo: posts never move, so the ship's tile is the whole input.
  let postX = NaN;
  let postY = NaN;
  let postLine = '';

  // Exits memo: rebuilt only when a station is placed (the list grows) or lifted
  // (the list is replaced). A rename mutates the portal the list already holds.
  const landable = (x: number, y: number) => isTraversableTile(grid.get(x, y));
  let exitsStations: readonly PlacedStation[] | null = null;
  let exitsLength = -1;
  let exits: FuelExit[] = [];

  // Return-fuel memo.
  let reserveFuel = NaN;
  let reserveX = NaN;
  let reserveY = NaN;
  let reserveSurface = false;
  let reserveGameOver = false;
  let reserveExits: FuelExit[] | null = null;
  let reserveExit: FuelExit | null = null;
  let labelledExit: FuelExit | null = null;
  let reserveExitName = '';
  let reserveStatus: FuelReserveStatus = 'safe';
  let reserveNeeded = 0;
  let reserveMargin = 0;
  let reserveLabel = fuelExitLabel(null);

  // Depth-landmark memo.
  let milestoneY = NaN;
  let milestoneTarget = '';
  let milestoneKind: DepthMilestoneKind = 'starter';
  let milestoneRemaining = 0;

  /** Depth of the landmark being approached, or -1 before the first sync. */
  let pendingDepth = -1;
  /** Its announcement, kept ready so clearing it costs no formatting. */
  let pendingLine = '';
  /** Deepest landmark already announced: one crossing, one toast. */
  let announcedDepth = -1;
  /** Where the ship stood last frame, so a portal jump or a respawn is told from a step. */
  let lastX = NaN;
  let lastY = NaN;
  /**
   * The career depth record as the previous sync left it. `advanceShip` raises
   * `stats.maxDepth` before the frame's sync runs, so the value read *now* would
   * already include the step that crosses a landmark; last frame's does not.
   */
  let careerDepthAtLastSync = -1;

  function syncScanner(hud: HudReadoutFields): void {
    const p = state.player;
    const dx = p.drillDx;
    // A ship that has never aimed anywhere still reads the tile it would dig.
    const dy = dx === 0 && p.drillDy === 0 ? 1 : p.drillDy;
    const x = p.x + dx;
    const y = p.y + dy;
    const tile = grid.get(x, y);
    const hp = tileHp(tile);
    const enemy = enemies.enemyAt(x, y);
    const enemyId = enemy?.id ?? 0;
    const explored = isTileExplored(state.exploredTiles, x, y);
    // The same predicate `move()` prices the dig with, so the readout never drifts.
    const hovering = isHoverSideDrill(dx, dy, grid.get(p.x, p.y + 1));

    if (x !== scanX || y !== scanY || dx !== scanDx || dy !== scanDy
      || tile !== scanTile || hp !== scanHp || enemyId !== scanEnemyId || explored !== scanExplored
      || p.drill !== scanDrill || hovering !== scanHovering) {
      scanX = x; scanY = y; scanDx = dx; scanDy = dy;
      scanTile = tile; scanHp = hp; scanEnemyId = enemyId; scanExplored = explored; scanDrill = p.drill;
      scanHovering = hovering;
      scanDirection[0] = dx;
      scanDirection[1] = dy;
      scannerLine = formatTerrainScanner({tile, direction: scanDirection, activeEnemy: enemy?.kind ?? false, explored, drill: p.drill, hovering});
    }
    hud.scanner = scannerLine;
  }

  function syncPostHint(hud: HudReadoutFields): void {
    const p = state.player;
    if (p.x !== postX || p.y !== postY) {
      postX = p.x; postY = p.y;
      postLine = tradingPostHint(p.x, p.y);
    }
    hud.postHint = postLine;
  }

  /** Home plus every field portal a ship could jump home from. */
  function currentExits(): FuelExit[] {
    const stations = state.stations;
    if (stations !== exitsStations || stations.length !== exitsLength) {
      exitsStations = stations;
      exitsLength = stations.length;
      exits = fuelReserveExits(stations, landable);
    }
    return exits;
  }

  function syncFuelReserve(hud: HudReadoutFields): void {
    const p = state.player;
    const surface = atSurface();
    const offered = currentExits();
    if (p.fuel !== reserveFuel || p.x !== reserveX || p.y !== reserveY || surface !== reserveSurface
      || state.gameOver !== reserveGameOver || offered !== reserveExits) {
      reserveFuel = p.fuel; reserveX = p.x; reserveY = p.y; reserveSurface = surface;
      reserveGameOver = state.gameOver; reserveExits = offered;
      const forecast = getFuelReserveForecast({
        fuel: p.fuel,
        playerX: p.x,
        playerY: p.y,
        exits: offered,
        atSurface: surface,
        gameOver: state.gameOver
      });
      reserveStatus = forecast.status;
      reserveNeeded = Math.ceil(forecast.reserve);
      reserveMargin = Math.max(0, Math.floor(forecast.fuelAfterReturn));
      reserveExit = forecast.exit;
    }
    // A rename changes only the label, never the price.
    const name = reserveExit?.name ?? '';
    if (reserveExit !== labelledExit || name !== reserveExitName) {
      labelledExit = reserveExit;
      reserveExitName = name;
      reserveLabel = fuelExitLabel(reserveExit);
    }
    hud.fuelReserveStatus = reserveStatus;
    hud.fuelReserveNeeded = reserveNeeded;
    hud.fuelReserveMargin = reserveMargin;
    hud.fuelReserveExit = reserveLabel;
  }

  /**
   * The helper reports the *next* landmark, so a landmark counts as cleared the
   * moment the reported target moves deeper. The announcements count across the
   * career: `announcedDepth` is a high-water mark (stowing at home base and
   * diving again never re-announces a seam), the career depth record silences a
   * seam some earlier ship — or an earlier session — already reached, and a
   * `jumped` ship (a portal, a teleporter, a respawn) only re-anchors, since it
   * crossed nothing on the way.
   */
  function announceCrossing(milestone: DepthMilestone, jumped: boolean): void {
    if (milestone.depthMeters === pendingDepth) return;
    const clearedDepth = pendingDepth;
    const clearedLine = pendingLine;
    pendingDepth = milestone.depthMeters;
    pendingLine = formatDepthMilestoneReached(milestone);
    if (clearedDepth < 0) return;                       // first sync: anchor only
    if (jumped) return;                                 // travelled, not descended
    if (milestone.depthMeters < clearedDepth) return;   // climbing back up
    if (clearedDepth <= Math.max(announcedDepth, careerDepthAtLastSync)) return; // already reached
    announcedDepth = clearedDepth;
    audio.milestone();
    toast(clearedLine);
  }

  function syncMilestone(hud: HudReadoutFields): void {
    const p = state.player;
    // One move is one tile; anything further was a jump.
    const jumped = Math.abs(p.x - lastX) > 1 || Math.abs(p.y - lastY) > 1;
    lastX = p.x;
    lastY = p.y;
    if (p.y !== milestoneY) {
      milestoneY = p.y;
      const milestone = getDepthMilestone(p.y);
      milestoneTarget = milestone.target;
      milestoneKind = milestone.kind;
      milestoneRemaining = milestone.remainingMeters;
      announceCrossing(milestone, jumped);
    }
    hud.depthTarget = milestoneTarget;
    hud.depthTargetKind = milestoneKind;
    hud.depthTargetRemaining = milestoneRemaining;
  }

  /** Re-arm the announcements from scratch: a wiped profile starts a new career. */
  function reset(): void {
    pendingDepth = -1;
    pendingLine = '';
    announcedDepth = -1;
    milestoneY = NaN;
    lastX = NaN;
    lastY = NaN;
    careerDepthAtLastSync = -1;
  }

  return {
    sync(hud) {
      syncScanner(hud);
      syncPostHint(hud);
      syncFuelReserve(hud);
      syncMilestone(hud);
      careerDepthAtLastSync = state.stats.maxDepth;
    },
    get fuelExit() {
      return reserveExit;
    },
    reset
  };
}

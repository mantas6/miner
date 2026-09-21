// Derived HUD readouts: the terrain scanner, the return-fuel forecast, and the
// depth-milestone tracker.
//
// All three live in `src/core` as pure formatters, but each needs live world
// data the loop owns. This module is the one place that feeds them, so they are
// evaluated from `syncUi()` alongside every other HUD field instead of being
// scattered through the move handlers.
//
// Everything here is memoized on the scalars it actually depends on — the drill
// target, its tile and hit points, fuel, depth — because `sync()` runs once per
// animation frame. A ship holding still reformats nothing and allocates nothing;
// only a moved ship, a chewed tile, or a spent litre of fuel costs a string.

import { START_Y } from '../../shared/constants';
import { isTileExplored } from '../../shared/exploration-codec';
import {
  formatDepthMilestoneReached,
  getDepthMilestone,
  type DepthMilestone,
  type DepthMilestoneKind
} from '../core/depth-milestone';
import { getFuelReserveForecast, type FuelReserveStatus } from '../core/fuel-reserve';
import { formatTerrainScanner } from '../core/scanner';
import type { Direction, GameState, Tile } from '../core/types';
import type { EnemySim } from './enemies';
import type { WorldGrid } from './world-grid';

/** The slice of the HUD snapshot this module owns. */
export interface HudReadoutFields {
  scanner: string;
  fuelReserveStatus: FuelReserveStatus;
  /** Fuel the conservative climb home would cost, rounded up. */
  fuelReserveNeeded: number;
  /** Fuel expected to survive that climb, rounded down and clamped at zero. */
  fuelReserveMargin: number;
  depthTarget: string;
  depthTargetKind: DepthMilestoneKind;
  depthTargetRemaining: number;
}

export interface HudReadouts {
  /** Fill this frame's readout fields, announcing any landmark just cleared. */
  sync(hud: HudReadoutFields): void;
  /** Re-arm the landmark announcements, as a fresh run would. */
  reset(): void;
}

export interface HudReadoutDeps {
  state: GameState;
  grid: WorldGrid;
  enemies: EnemySim;
  atSurface(): boolean;
  toast(message: string): void;
}

function tileHp(tile: Tile): number {
  return 'hp' in tile ? tile.hp : 0;
}

export function createReadouts({state, grid, enemies, atSurface, toast}: HudReadoutDeps): HudReadouts {
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
  let scannerLine = '';

  // Return-fuel memo.
  let reserveFuel = NaN;
  let reserveY = NaN;
  let reserveSurface = false;
  let reserveGameOver = false;
  let reserveStatus: FuelReserveStatus = 'safe';
  let reserveNeeded = 0;
  let reserveMargin = 0;

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
  let wasGameOver = false;

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

    if (x !== scanX || y !== scanY || dx !== scanDx || dy !== scanDy
      || tile !== scanTile || hp !== scanHp || enemyId !== scanEnemyId || explored !== scanExplored) {
      scanX = x; scanY = y; scanDx = dx; scanDy = dy;
      scanTile = tile; scanHp = hp; scanEnemyId = enemyId; scanExplored = explored;
      scanDirection[0] = dx;
      scanDirection[1] = dy;
      scannerLine = formatTerrainScanner({tile, direction: scanDirection, activeEnemy: enemy?.kind ?? false, explored});
    }
    hud.scanner = scannerLine;
  }

  function syncFuelReserve(hud: HudReadoutFields): void {
    const p = state.player;
    const surface = atSurface();
    if (p.fuel !== reserveFuel || p.y !== reserveY || surface !== reserveSurface || state.gameOver !== reserveGameOver) {
      reserveFuel = p.fuel; reserveY = p.y; reserveSurface = surface; reserveGameOver = state.gameOver;
      const forecast = getFuelReserveForecast({
        fuel: p.fuel,
        playerY: p.y,
        startY: START_Y,
        atSurface: surface,
        gameOver: state.gameOver
      });
      reserveStatus = forecast.status;
      reserveNeeded = Math.ceil(forecast.reserve);
      reserveMargin = Math.max(0, Math.floor(forecast.fuelAfterReturn));
    }
    hud.fuelReserveStatus = reserveStatus;
    hud.fuelReserveNeeded = reserveNeeded;
    hud.fuelReserveMargin = reserveMargin;
  }

  /**
   * The helper reports the *next* landmark, so a landmark counts as cleared the
   * moment the reported target moves deeper. `announcedDepth` is a high-water
   * mark, so stowing at home base and diving again never re-announces a seam.
   */
  function announceCrossing(milestone: DepthMilestone): void {
    if (milestone.depthMeters === pendingDepth) return;
    const clearedDepth = pendingDepth;
    const clearedLine = pendingLine;
    pendingDepth = milestone.depthMeters;
    pendingLine = formatDepthMilestoneReached(milestone);
    if (clearedDepth < 0) return;                       // first sync: anchor only
    if (milestone.depthMeters < clearedDepth) return;   // climbing back up
    if (clearedDepth <= announcedDepth) return;         // already announced this run
    announcedDepth = clearedDepth;
    toast(clearedLine);
  }

  function syncMilestone(hud: HudReadoutFields): void {
    const p = state.player;
    if (p.y !== milestoneY) {
      milestoneY = p.y;
      const milestone = getDepthMilestone(p.y);
      milestoneTarget = milestone.target;
      milestoneKind = milestone.kind;
      milestoneRemaining = milestone.remainingMeters;
      announceCrossing(milestone);
    }
    hud.depthTarget = milestoneTarget;
    hud.depthTargetKind = milestoneKind;
    hud.depthTargetRemaining = milestoneRemaining;
  }

  function reset(): void {
    pendingDepth = -1;
    pendingLine = '';
    announcedDepth = -1;
    milestoneY = NaN;
  }

  return {
    sync(hud) {
      // A death and its replacement ship are a new run, so the seams announce again.
      if (wasGameOver && !state.gameOver) reset();
      wasGameOver = state.gameOver;
      syncScanner(hud);
      syncFuelReserve(hud);
      syncMilestone(hud);
    },
    reset
  };
}

// The three derived HUD readouts, driven through the same object the loop hands
// them: what the drill is aimed at, whether the fuel left still buys a climb
// home, and which depth landmark is next. Copy belongs to the core formatters
// and is asserted there; here it is the decisions and the crossing bookkeeping.

import { describe, expect, it } from 'vitest';
import { START_Y } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';
import { createInitialState, isAtHome } from '../core/state';
import type { Enemy, Tile } from '../core/types';
import { createReadouts, type HudReadoutFields } from './readouts';
import { createEnemySimStub, createFakeGrid, createToastLog } from './test-support';

function blankReadouts(): HudReadoutFields {
  return {
    scanner: '',
    fuelReserveStatus: 'safe',
    fuelReserveNeeded: 0,
    fuelReserveMargin: 0,
    depthTarget: '',
    depthTargetKind: 'starter',
    depthTargetRemaining: 0
  };
}

function setup(fill: (x: number, y: number) => Tile = () => ({type: 'dirt', hp: 3, maxHp: 3})) {
  const state = createInitialState();
  const grid = createFakeGrid(fill);
  const enemies = createEnemySimStub();
  const toasts = createToastLog();
  const hud = blankReadouts();
  const readouts = createReadouts({
    state,
    grid,
    enemies,
    atSurface: () => isAtHome(state.player),
    toast: toasts.toast
  });
  return {
    state, grid, enemies, toasts, hud, readouts,
    sync() {
      readouts.sync(hud);
      return hud;
    },
    /** Put the ship this many tiles below the home base, all of it mapped. */
    descend(tiles: number) {
      state.player.y = START_Y + tiles;
      for (let y = START_Y; y <= state.player.y + 1; y++) {
        state.exploredTiles.add(explorationIndex(state.player.x, y));
      }
    }
  };
}

describe('terrain scanner readout', () => {
  it('reads the tile the drill is aimed at, and keeps fog secret', () => {
    const game = setup((_x, y) => (y > START_Y + 5 ? {type: 'rock', hp: 999} : {type: 'dirt', hp: 3, maxHp: 3}));

    // Fresh ship: aimed down at the unmapped starter shaft.
    expect(game.sync().scanner).toBe('Scanner ↓: unexplored — advance to map terrain.');

    game.descend(1);
    expect(game.sync().scanner).toBe('Scanner ↓: dirt — drillable, 3 hits.');

    // Aim sideways and the readout follows the drill, not the ship.
    game.state.player.drillDx = -1;
    game.state.player.drillDy = 0;
    game.state.exploredTiles.add(explorationIndex(game.state.player.x - 1, game.state.player.y));
    expect(game.sync().scanner).toBe('Scanner ←: dirt — drillable, 3 hits.');
  });

  it('follows the target tile as the drill chews it and as fiends move in', () => {
    const game = setup();
    game.descend(2);
    const target = game.grid.get(game.state.player.x, game.state.player.y + 1);
    if (!('hp' in target)) throw new Error('expected a drillable target tile');

    target.hp = 1;
    expect(game.sync().scanner).toBe('Scanner ↓: dirt — drillable, 1 hit.');

    const fiend: Enemy = {
      id: 7, kind: 'tunnelFiend', x: game.state.player.x, y: game.state.player.y + 1,
      drawX: 0, drawY: 0, hp: 4, maxHp: 4, alive: true, moveTick: 0, biteTick: 0, flash: 0
    };
    game.enemies.standingEnemy = fiend;
    expect(game.sync().scanner).toContain('active tunnel fiend');

    game.enemies.standingEnemy = undefined;
    expect(game.sync().scanner).toBe('Scanner ↓: dirt — drillable, 1 hit.');
  });
});

describe('return-fuel forecast', () => {
  it('grades the climb home from depth and remaining fuel', () => {
    const game = setup();
    game.descend(10);

    game.state.player.fuel = 50;
    expect(game.sync()).toMatchObject({fuelReserveStatus: 'safe', fuelReserveNeeded: 4, fuelReserveMargin: 46});

    game.state.player.fuel = 4.5;
    expect(game.sync().fuelReserveStatus).toBe('caution');

    game.state.player.fuel = 3.3;
    expect(game.sync()).toMatchObject({fuelReserveStatus: 'urgent', fuelReserveMargin: 0});
  });

  it('has nothing to reserve at the home base and gives up once the ship is disabled', () => {
    const game = setup();
    game.state.player.fuel = 12;
    expect(game.sync()).toMatchObject({fuelReserveStatus: 'safe', fuelReserveNeeded: 0, fuelReserveMargin: 12});

    game.descend(10);
    game.state.gameOver = true;
    expect(game.sync().fuelReserveStatus).toBe('urgent');
  });
});

describe('depth landmark tracker', () => {
  it('reports the next landmark and announces each crossing exactly once', () => {
    const game = setup();

    expect(game.sync()).toMatchObject({depthTargetKind: 'starter', depthTargetRemaining: 30});
    expect(game.toasts.messages).toEqual([]);

    game.descend(3);
    expect(game.sync()).toMatchObject({depthTarget: 'Copper', depthTargetKind: 'ore', depthTargetRemaining: 30});
    expect(game.toasts.messages).toHaveLength(1);
    expect(game.toasts.last).toContain('Depth 30 m');

    game.sync();
    game.descend(3);
    game.sync();
    expect(game.toasts.messages).toHaveLength(1);
  });

  it('does not re-announce a seam after stowing at home and diving again', () => {
    const game = setup();
    game.sync();
    game.descend(3);
    game.sync();

    game.descend(0);
    expect(game.sync().depthTargetKind).toBe('starter');
    game.descend(3);
    game.sync();

    expect(game.toasts.messages).toHaveLength(1);
  });

  it('re-arms the announcements for the replacement ship after a death', () => {
    const game = setup();
    game.sync();
    game.descend(3);
    game.sync();

    game.state.gameOver = true;
    game.sync();
    game.state.gameOver = false;
    game.descend(0);
    game.sync();
    game.descend(3);
    game.sync();

    expect(game.toasts.messages).toHaveLength(2);
  });

  it('re-arms on an explicit reset too', () => {
    const game = setup();
    game.sync();
    game.descend(3);
    game.sync();

    game.readouts.reset();
    game.descend(0);
    game.sync();
    game.descend(3);
    game.sync();

    expect(game.toasts.messages).toHaveLength(2);
  });
});

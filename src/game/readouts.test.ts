// The three derived HUD readouts, driven through the same object the loop hands
// them: what the drill is aimed at, whether the fuel left still buys a climb
// home, and which depth landmark is next. Copy belongs to the core formatters
// and is asserted there; here it is the decisions and the crossing bookkeeping.

import { describe, expect, it } from 'vitest';
import { HOME_X, START_Y, STATIONS, WORLD_W, rowDepthMeters } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';
import { fuelExitCost } from '../core/fuel-reserve';
import { createInitialState, isAtHome } from '../core/state';
import { createPortal } from '../core/stations';
import type { Enemy, Tile } from '../core/types';
import { nth } from '../test-narrowing';
import { tradingPostsInRange } from '../world/world';
import { createReadouts, type HudReadoutFields } from './readouts';
import { createAudioStub, createEnemySimStub, createFakeGrid, createToastLog } from './test-support';

function blankReadouts(): HudReadoutFields {
  return {
    scanner: '',
    postHint: '',
    fuelReserveStatus: 'safe',
    fuelReserveNeeded: 0,
    fuelReserveMargin: 0,
    fuelReserveExit: '',
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
  const audio = createAudioStub();
  const hud = blankReadouts();
  const readouts = createReadouts({
    state,
    grid,
    enemies,
    audio,
    atSurface: () => isAtHome(state.player),
    toast: toasts.toast
  });
  /**
   * Put the ship this many tiles below the home base, all of it mapped, and —
   * as `advanceShip` does before the frame's sync — raise the career record. One
   * call is one frame's move, so a call further than a tile away reads as a jump.
   */
  function descend(tiles: number): void {
    state.player.y = START_Y + tiles;
    state.stats.maxDepth = Math.max(state.stats.maxDepth, rowDepthMeters(state.player.y));
    for (let y = START_Y; y <= state.player.y + 1; y++) {
      state.exploredTiles.add(explorationIndex(state.player.x, y));
    }
  }
  return {
    state, grid, enemies, toasts, audio, hud, readouts, descend,
    sync() {
      readouts.sync(hud);
      return hud;
    },
    /** Fly one row per frame, up or down, to `tiles` below home, syncing each frame. */
    fly(tiles: number) {
      const step = Math.sign(tiles - (state.player.y - START_Y));
      while (state.player.y - START_Y !== tiles) {
        descend(state.player.y - START_Y + step);
        readouts.sync(hud);
      }
      return hud;
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
      drawX: 0, drawY: 0, hp: 4, maxHp: 4, alive: true, moveTick: 0, biteTick: 0, flash: 0, origin: {x: 0, y: 0}
    };
    game.enemies.standingEnemy = fiend;
    expect(game.sync().scanner).toContain('active tunnel fiend');

    game.enemies.standingEnemy = undefined;
    expect(game.sync().scanner).toBe('Scanner ↓: dirt — drillable, 1 hit.');
  });

  it('recounts the hits when the drill power changes under the same tile', () => {
    const game = setup(() => ({type: 'dirt', hp: 6, maxHp: 6}));
    game.descend(1);
    game.state.player.drill = 1;
    expect(game.sync().scanner).toBe('Scanner ↓: dirt — drillable, 6 hits.');

    game.state.player.drill = 3;
    expect(game.sync().scanner).toBe('Scanner ↓: dirt — drillable, 2 hits.');
  });

  it('flags the hover surcharge when the drill aims sideways over open air, and drops it on a floor', () => {
    const game = setup();
    game.descend(2);
    const {x, y} = game.state.player;
    game.state.player.drillDx = 1;
    game.state.player.drillDy = 0;
    game.state.exploredTiles.add(explorationIndex(x + 1, y));

    // Standing on dirt: a plain side dig.
    expect(game.sync().scanner).toBe('Scanner →: dirt — drillable, 3 hits.');

    // The floor goes (a blast, say) and the same aim now reads as a hover drill.
    game.grid.put(x, y + 1, {type: 'air'});
    expect(game.sync().scanner).toBe('Scanner →: dirt — drillable, 3 hits. Hover: +25 % fuel.');

    // Aiming down again is never a hover drill.
    game.state.player.drillDx = 0;
    game.state.player.drillDy = 1;
    expect(game.sync().scanner).toBe('Scanner ↓: clear route.');
  });
});

describe('trading-post beacon', () => {
  const post = nth(tradingPostsInRange(0, 0, WORLD_W - 1, START_Y + 400), 0);

  it('points at a post within twelve tiles, fog or not, and goes quiet in reach', () => {
    const game = setup();
    // At home there is nothing to point at.
    expect(game.sync().postHint).toBe('');

    // Nine rows above a post nobody has mapped: the beacon still hears it.
    game.state.player.x = post.x;
    game.state.player.y = post.y - 9;
    expect(game.sync().postHint).toBe('Trading post ≈9 tiles ↓');

    // Beside it, the Space hint takes over and the beacon falls silent.
    game.state.player.y = post.y - 1;
    expect(game.sync().postHint).toBe('');

    // Out past the radius, silent too.
    game.state.player.y = post.y - 13;
    expect(game.sync().postHint).toBe('');
  });

  it('keeps the same line while the ship holds still', () => {
    const game = setup();
    game.state.player.x = post.x;
    game.state.player.y = post.y - 5;
    const first = game.sync().postHint;
    game.hud.postHint = 'stale';
    expect(game.sync().postHint).toBe(first);
  });
});

describe('return-fuel forecast', () => {
  /** A dirt mine with the seeded Home portal's tile open and one field portal dug out. */
  function withPortal(x: number, row: number, name = 'Deep') {
    const game = setup();
    const portal = createPortal(x, START_Y + row, name);
    game.state.stations.push(portal);
    game.grid.put(STATIONS.portal.x, STATIONS.portal.y, {type: 'air'});
    game.grid.put(portal.x, portal.y, {type: 'air'});
    return {game, portal};
  }

  it('grades the climb home from depth and remaining fuel', () => {
    const game = setup();
    game.descend(10);

    // 10 rows of clear flight home, padded by the allowance: 2.2 fuel.
    game.state.player.fuel = 50;
    expect(game.sync()).toMatchObject({fuelReserveStatus: 'safe', fuelReserveNeeded: 3, fuelReserveMargin: 47, fuelReserveExit: 'Home'});

    game.state.player.fuel = 3;
    expect(game.sync().fuelReserveStatus).toBe('caution');

    game.state.player.fuel = 2;
    expect(game.sync()).toMatchObject({fuelReserveStatus: 'urgent', fuelReserveMargin: 0});
  });

  it('has nothing to reserve at the home base and gives up once the ship is disabled', () => {
    const game = setup();
    game.state.player.fuel = 12;
    expect(game.sync()).toMatchObject({fuelReserveStatus: 'safe', fuelReserveNeeded: 0, fuelReserveMargin: 12, fuelReserveExit: 'Home'});

    game.descend(10);
    game.state.gameOver = true;
    expect(game.sync().fuelReserveStatus).toBe('urgent');
  });

  it('prices the reserve to a nearer portal, and follows a rename and a lift', () => {
    const {game, portal} = withPortal(HOME_X, 77);
    game.descend(80);
    game.state.player.fuel = 10;

    // Three rows under the portal, it is by far the cheaper way home.
    const toPortal = fuelExitCost(HOME_X, START_Y + 80, portal);
    expect(game.sync()).toMatchObject({
      fuelReserveStatus: 'safe',
      fuelReserveNeeded: Math.ceil(toPortal),
      fuelReserveExit: 'Portal "Deep"'
    });
    // The objective reads the chosen exit itself, not the label.
    expect(game.readouts.fuelExit).toBe(portal);

    portal.name = 'Shaft';
    expect(game.sync().fuelReserveExit).toBe('Portal "Shaft"');

    // The Construction Toolkit lifts it: the forecast falls back to the climb home.
    game.state.stations = game.state.stations.filter(station => station !== portal);
    expect(game.sync()).toMatchObject({fuelReserveStatus: 'urgent', fuelReserveExit: 'Home'});
  });

  it('weighs the trip across the mine, not just the climb', () => {
    const {game} = withPortal(3, 20, 'West');
    game.descend(20);

    // Level with the portal and a tile from it: jumping home from there is cheapest.
    game.state.player.x = 4;
    expect(game.sync().fuelReserveExit).toBe('Portal "West"');

    // Same row, but under the home cavern: the climb beats the long flight across.
    game.state.player.x = HOME_X;
    expect(game.sync().fuelReserveExit).toBe('Home');
  });

  it('ignores a portal buried in rock, and every field portal once home has none', () => {
    const {game, portal} = withPortal(HOME_X, 77);
    game.grid.put(portal.x, portal.y, {type: 'rock', hp: 999});
    game.descend(80);
    expect(game.sync().fuelReserveExit).toBe('Home');

    const open = withPortal(HOME_X, 77);
    open.game.state.stations = open.game.state.stations.filter(station => station.kind !== 'portal' || station === open.portal);
    open.game.descend(80);
    expect(open.game.sync().fuelReserveExit).toBe('Home');
  });
});

describe('depth landmark tracker', () => {
  it('reports the next landmark and announces each crossing exactly once', () => {
    const game = setup();

    expect(game.sync()).toMatchObject({depthTargetKind: 'starter', depthTargetRemaining: 30});
    expect(game.toasts.messages).toEqual([]);
    expect(game.audio.played).toEqual([]);

    expect(game.fly(3)).toMatchObject({depthTarget: 'Copper', depthTargetKind: 'ore', depthTargetRemaining: 30});
    expect(game.toasts.messages).toHaveLength(1);
    expect(game.toasts.last).toContain('Depth 30 m');
    expect(game.audio.played).toEqual(['milestone']);

    game.sync();
    game.fly(5);
    expect(game.toasts.messages).toHaveLength(1);
    expect(game.audio.played).toEqual(['milestone']);
  });

  it('does not re-announce a seam after stowing at home and diving again', () => {
    const game = setup();
    game.sync();
    game.fly(3);

    expect(game.fly(0).depthTargetKind).toBe('starter');
    game.fly(3);

    expect(game.toasts.messages).toHaveLength(1);
  });

  it('stays silent for the replacement ship after a death: the count is the career', () => {
    const game = setup();
    game.sync();
    game.fly(3);

    game.state.gameOver = true;
    game.sync();
    game.state.gameOver = false;
    game.descend(0);
    game.sync();
    game.fly(3);

    expect(game.toasts.messages).toHaveLength(1);
    // A seam no ship has reached yet still announces.
    game.fly(6);
    expect(game.toasts.messages).toHaveLength(2);
    expect(game.toasts.last).toContain('Depth 60 m');
  });

  it('keeps a returning career quiet down to its depth record', () => {
    const game = setup();
    // A reloaded save: fresh readouts, but the record of an earlier session.
    game.state.stats.maxDepth = 40;
    game.sync();
    game.fly(3);
    expect(game.toasts.messages).toEqual([]);

    game.fly(6);
    expect(game.toasts.messages).toHaveLength(1);
    expect(game.toasts.last).toContain('Depth 60 m');
  });

  it('only re-anchors after a portal jump, then announces the next seam dived past', () => {
    const game = setup();
    game.sync();

    // Straight from home to 50 m in one frame: past the starter seam, but no dive.
    game.descend(5);
    expect(game.sync()).toMatchObject({depthTarget: 'Copper', depthTargetRemaining: 10});
    expect(game.toasts.messages).toEqual([]);
    expect(game.audio.played).toEqual([]);

    game.fly(6);
    expect(game.toasts.messages).toHaveLength(1);
    expect(game.toasts.last).toContain('Depth 60 m');
  });

  it('treats a jump across the mine as travel even when it lands one row down', () => {
    const game = setup();
    game.sync();
    game.fly(2);

    // A portal twenty columns over, one row deeper, on the starter seam.
    game.state.player.x = HOME_X - 20;
    game.descend(3);
    game.sync();
    expect(game.toasts.messages).toEqual([]);
  });

  it('re-arms on a wiped profile', () => {
    const game = setup();
    game.sync();
    game.fly(3);

    // resetPlayer zeroes the stats; the readouts are reset alongside.
    game.readouts.reset();
    game.state.stats.maxDepth = 0;
    game.descend(0);
    game.sync();
    game.fly(3);

    expect(game.toasts.messages).toHaveLength(2);
  });
});

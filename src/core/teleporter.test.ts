import { describe, expect, it } from 'vitest';
import { START_Y } from '../../shared/constants';
import { addItem } from './inventory';
import { createInitialState } from './state';
import { createPortal, type PlacedStation } from './stations';
import {
  REDUCED_TELEPORT_EFFECT_FRAMES,
  TELEPORTER_ITEM,
  TELEPORT_EFFECT_FRAMES,
  advanceTeleportEffect,
  canUsePortableTeleporter,
  createTeleportEffect,
  movePlayerTo,
  teleportersCarried
} from './teleporter';
import type { Player } from './types';

/** Load the bay with `count` teleporters, the only place a charge lives. */
function carrying(player: Player, count: number): void {
  player.inventory = addItem(player.inventory, TELEPORTER_ITEM, count) ?? player.inventory;
}

describe('teleporters carried', () => {
  it('counts the charges riding in the bay', () => {
    const player = createInitialState().player;
    expect(teleportersCarried(player)).toBe(0);
    carrying(player, 3);
    expect(teleportersCarried(player)).toBe(3);
  });
});

describe('canUsePortableTeleporter', () => {
  const away = createPortal(20, START_Y + 60, 'Depot');
  const stations: PlacedStation[] = [createPortal(45, START_Y, 'Home'), away];

  it('needs a charge aboard and a portal beyond arm’s reach', () => {
    const player = createInitialState().player;
    Object.assign(player, {x: 8, y: START_Y + 5});

    // No charge: refused even with portals in the world.
    expect(canUsePortableTeleporter(player, stations)).toBe(false);

    carrying(player, 1);
    expect(canUsePortableTeleporter(player, stations)).toBe(true);
  });

  it('is refused when every portal is already within reach', () => {
    const player = createInitialState().player;
    carrying(player, 1);
    // Standing on the only portal beside the reachable one: nothing left to jump to.
    Object.assign(player, {x: away.x, y: away.y});
    expect(canUsePortableTeleporter(player, [away])).toBe(false);
  });
});

describe('movePlayerTo', () => {
  it('snaps the logical and render position and settles the animation', () => {
    const player = createInitialState().player;
    Object.assign(player, {bob: 4, drillAnim: 9});

    movePlayerTo(player, 12, START_Y + 40);

    expect(player).toMatchObject({
      x: 12,
      y: START_Y + 40,
      drawX: 12,
      drawY: START_Y + 40,
      bob: 0,
      drillAnim: 0
    });
  });
});

describe('the teleport effect', () => {
  it('captures both visible endpoints and expires without a timer', () => {
    let effect = createTeleportEffect(320, 240, 45, START_Y);

    expect(effect).toMatchObject({
      originScreenX: 320,
      originScreenY: 240,
      destinationX: 45,
      destinationY: START_Y,
      frame: 0,
      duration: TELEPORT_EFFECT_FRAMES,
      reducedMotion: false
    });
    for (let frame = 1; frame <= TELEPORT_EFFECT_FRAMES; frame++) {
      effect = advanceTeleportEffect(effect)!;
      if (frame < TELEPORT_EFFECT_FRAMES) expect(effect.frame).toBe(frame);
    }
    expect(effect).toBeNull();
    expect(advanceTeleportEffect(effect)).toBeNull();
  });

  it('uses a brief static lifecycle for reduced motion', () => {
    const effect = createTeleportEffect(100, 120, 45, START_Y, true);

    expect(effect.reducedMotion).toBe(true);
    expect(effect.duration).toBe(REDUCED_TELEPORT_EFFECT_FRAMES);
    expect(effect.duration).toBeLessThan(TELEPORT_EFFECT_FRAMES);
  });
});

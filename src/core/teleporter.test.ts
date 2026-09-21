import { describe, expect, it } from 'vitest';
import { HOME_ROW, HOME_X, ORES, START_Y } from '../../shared/constants';
import { addItem, addOre, countOres, createInventory } from './inventory';
import { createInitialState } from './state';
import {
  MIN_TELEPORT_HOME_DISTANCE,
  REDUCED_TELEPORT_EFFECT_FRAMES,
  TELEPORTER_ITEM,
  TELEPORT_EFFECT_FRAMES,
  advanceTeleportEffect,
  canTeleport,
  canUseTeleporter,
  createTeleportEffect,
  teleportPlayerToHome,
  teleportPlayerToReturn,
  teleportersCarried
} from './teleporter';
import type { Player } from './types';

/** Load the bay with `count` teleporters, the only place a charge lives now. */
function carrying(player: Player, count: number): void {
  player.inventory = addItem(player.inventory, TELEPORTER_ITEM, count) ?? player.inventory;
}

describe('home teleporter', () => {
  it('rejects a jump within 10 tiles of home and allows it at exactly 10', () => {
    const player = createInitialState().player;
    carrying(player, 2);

    Object.assign(player, {x: HOME_X, y: HOME_ROW + MIN_TELEPORT_HOME_DISTANCE - 1, drawX: HOME_X});
    expect(canTeleport(player)).toBe(false);
    expect(canUseTeleporter(player, null)).toBe(false);
    expect(teleportPlayerToHome(player)).toBeNull();
    expect(player.y).toBe(HOME_ROW + 9);
    expect(teleportersCarried(player)).toBe(2);

    Object.assign(player, {x: HOME_X, y: HOME_ROW + MIN_TELEPORT_HOME_DISTANCE});
    expect(canTeleport(player)).toBe(true);
    expect(canUseTeleporter(player, null)).toBe(true);
    expect(teleportPlayerToHome(player)).toEqual({x: HOME_X, y: HOME_ROW + 10});
    expect(teleportersCarried(player)).toBe(1);
  });

  it('spends one teleporter out of the bay and moves home without free services', () => {
    const state = createInitialState();
    const player = state.player;
    state.cash = 90;
    Object.assign(player, {
      x: 4, y: 120, drawX: 4, drawY: 120, fuel: 17, hull: 42,
      inventory: addOre(createInventory(), ORES[3], 10)!
    });
    carrying(player, 2);

    expect(teleportPlayerToHome(player)).toEqual({x: 4, y: 120});
    expect(player).toMatchObject({
      x: HOME_X,
      y: HOME_ROW,
      drawX: HOME_X,
      drawY: HOME_ROW,
      fuel: 17,
      hull: 42
    });
    expect(teleportersCarried(player)).toBe(1);
    // The trip carries the ore home with the ship; only the charge is spent.
    expect(countOres(player.inventory)).toBe(1);
    expect(state.cash).toBe(90);
  });

  it('does nothing at home or with an empty bay', () => {
    const player = createInitialState().player;
    carrying(player, 1);
    // A fresh ship parks at home, well within the teleport threshold.
    expect(teleportPlayerToHome(player)).toBeNull();
    expect(teleportersCarried(player)).toBe(1);

    Object.assign(player, {x: 20, y: 120});
    player.inventory = createInventory();
    expect(teleportPlayerToHome(player)).toBeNull();
    expect(player.y).toBe(120);
  });

  it('frees the slot once the last teleporter is spent', () => {
    const player = createInitialState().player;
    Object.assign(player, {x: 7, y: 143, drawX: 7, drawY: 143});
    carrying(player, 1);

    expect(teleportPlayerToHome(player)).toEqual({x: 7, y: 143});

    expect(teleportersCarried(player)).toBe(0);
    expect(player.inventory.every(slot => slot === null)).toBe(true);
  });

  it('returns to the exact departure point without consuming another charge and supports another round trip', () => {
    const player = createInitialState().player;
    Object.assign(player, {x: 7, y: 143, drawX: 7, drawY: 143});
    carrying(player, 2);

    const firstReturn = teleportPlayerToHome(player);
    expect(firstReturn).toEqual({x: 7, y: 143});
    expect(teleportPlayerToReturn(player, firstReturn)).toBe(true);
    expect(player).toMatchObject({x: 7, y: 143, drawX: 7, drawY: 143});
    expect(teleportersCarried(player)).toBe(1);

    player.x = 11;
    player.y = 176;
    const secondReturn = teleportPlayerToHome(player);
    expect(secondReturn).toEqual({x: 11, y: 176});
    expect(teleportPlayerToReturn(player, secondReturn)).toBe(true);
    expect(player).toMatchObject({x: 11, y: 176});
    expect(teleportersCarried(player)).toBe(0);
  });

  it('keeps a pending home return enabled at base without another charge', () => {
    const player = createInitialState().player;
    const returnPosition = {x: 7, y: START_Y + 10};

    expect(teleportersCarried(player)).toBe(0);
    expect(canUseTeleporter(player, returnPosition)).toBe(true);
    expect(teleportPlayerToReturn(player, returnPosition)).toBe(true);
    expect(player).toMatchObject(returnPosition);
    expect(teleportersCarried(player)).toBe(0);
  });

  it('does not return without a pending point or from away from home', () => {
    const player = createInitialState().player;

    expect(teleportPlayerToReturn(player, null)).toBe(false);
    Object.assign(player, {x: 20, y: 120});
    expect(teleportPlayerToReturn(player, {x: 4, y: 120})).toBe(false);
    expect(player.y).toBe(120);
  });

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

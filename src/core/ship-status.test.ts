import { describe, expect, it } from 'vitest';
import { formatShipStatusAnnouncement, type ShipStatusInput } from './ship-status';

/** A healthy ship parked at home base with room in the holds. */
const parked: ShipStatusInput = {
  gameOver: false,
  atSurface: true,
  cargoFull: false,
  hullCritical: false
};

function announcement(patch: Partial<ShipStatusInput>): string {
  return formatShipStatusAnnouncement({...parked, ...patch});
}

describe('spoken ship status', () => {
  it('reports where the ship is', () => {
    expect(announcement({})).toBe('At home base.');
    expect(announcement({atSurface: false})).toBe('In the mine.');
  });

  it('adds what is going wrong, holds before hull', () => {
    expect(announcement({atSurface: false, cargoFull: true})).toBe('In the mine. Cargo hold full.');
    expect(announcement({atSurface: false, hullCritical: true})).toBe('In the mine. Hull critical.');
    expect(announcement({atSurface: false, cargoFull: true, hullCritical: true}))
      .toBe('In the mine. Cargo hold full. Hull critical.');
    expect(announcement({cargoFull: true, hullCritical: true}))
      .toBe('At home base. Cargo hold full. Hull critical.');
  });

  it('says only that the ship is gone once it is lost, and how to get another', () => {
    expect(announcement({gameOver: true, atSurface: false, cargoFull: true, hullCritical: true}))
      .toBe('Ship lost. Press R to deploy a replacement.');
  });

  /** The point of the whole module: a live region must not talk every frame. */
  it('says the same thing for every state that is not a crossed threshold', () => {
    expect(announcement({})).toBe(announcement({}));
    expect(new Set([
      announcement({atSurface: false}),
      announcement({atSurface: false, cargoFull: false, hullCritical: false})
    ]).size).toBe(1);
  });
});

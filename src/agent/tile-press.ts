// Whether a harness tile press can do anything, decided before the click.
//
// A press on the mine never moves the ship: it plants the armed device, lets the
// armed toolkit lift a station, restarts after a lost ship, or opens the station,
// trading post, container, wreck, chest or grave it lands on — each of those only
// from within its one-tile reach. An unarmed press further out does nothing at all
// in the game, except that, as the first trusted pointer gesture of a session, it
// is what unlocks the browser's audio (the soundtrack then starts, which read as
// the music button toggling). So the harness refuses it with the reason instead
// of clicking, and the agent learns to fly there with the keys.
//
// Pure: it reads the state the press would be judged against, nothing else.

import { CARGO_CONTAINER } from '../core/cargo-container';
import { CHEST } from '../core/chest';
import { GRAVE } from '../core/grave';
import { STATION_REACH } from '../core/stations';
import { TRADING_POST_REACH } from '../core/trading';
import type { GameState } from '../core/types';
import { WRECK } from '../core/wreck';

/** How far from the ship an unarmed press can still open something: the widest reach. */
export const TILE_PRESS_REACH = Math.max(STATION_REACH, TRADING_POST_REACH, CARGO_CONTAINER.reach, WRECK.reach, CHEST.reach, GRAVE.reach);

/** Why a press on tile `x`/`y` would do nothing, or `null` when it can land on something. */
export function tilePressRefusal(state: Pick<GameState, 'player' | 'gameOver' | 'armedPlacement'>, x: number, y: number): string | null {
  // A lost ship: any press deploys the next one.
  if (state.gameOver) return null;
  // An armed device judges its own target, and reports a refusal in `placement`.
  if (state.armedPlacement !== null) return null;
  const {x: px, y: py} = state.player;
  const distance = Math.max(Math.abs(x - px), Math.abs(y - py));
  if (distance <= TILE_PRESS_REACH) return null;
  return `Tile (${x}, ${y}) is ${distance} tiles from the ship at (${px}, ${py}), too far for a tile press: `
    + 'a press never moves the ship — unarmed, it only opens a station, trading post, container, wreck, chest '
    + `or grave within ${TILE_PRESS_REACH} tile of the ship. Fly there with press/hold first.`;
}

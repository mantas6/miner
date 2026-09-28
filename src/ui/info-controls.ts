// The Info screen's Controls tab, as data.
//
// The rows are declared here rather than written out in JSX so the same table
// feeds both the panel a sighted player reads and the agent observation's `info`
// payload (`src/agent/observation.ts`): the two can never disagree about what the
// keys do. Each row's keys cell is a run of parts — a key badge, an emphasised
// control name, or plain joining text — so the panel can still style them apart.

import { HULL, REVEAL_FOOTPRINT } from '../core/balance';
import { CARGO_CONTAINER } from '../core/cargo-container';
import { DYNAMITE } from '../core/dynamite';
import { SCANNER_DEVICE } from '../core/scanner-device';

/** One piece of a row's keys cell. */
export type ControlKeyPart =
  | {kind: 'key'; text: string}
  | {kind: 'control'; text: string}
  | {kind: 'text'; text: string};

export interface ControlRow {
  keys: readonly ControlKeyPart[];
  action: string;
}

const key = (text: string): ControlKeyPart => ({kind: 'key', text});
const control = (text: string): ControlKeyPart => ({kind: 'control', text});
const text = (value: string): ControlKeyPart => ({kind: 'text', text: value});

export const CONTROL_ROWS: readonly ControlRow[] = [
  {keys: [key('WASD'), text(' / '), key('Arrows')], action: 'Move, fly, and dig'},
  {keys: [control('Fog map')], action: `Movement permanently reveals a ${REVEAL_FOOTPRINT}x${REVEAL_FOOTPRINT} footprint around the ship.`},
  {keys: [key('Shift'), text(' + movement')], action: 'Boost through open space at increased fuel cost (requires a Booster fitted). Open-space descent is free and drilling stays normal. Slamming a boosted ship into rock, a ceiling, or a wall buckles the hull.'},
  {keys: [key('Space')], action: 'Use what the ship is parked beside: the Manufacturing Station to stow cargo and craft, the Fuel Extractor to refuel, a Portal to travel, a Trading Post to sell and buy, or a grave to read it'},
  {keys: [key('E'), text(' / '), control('Dynamite slot'), text(' then a mine tile')], action: `Plant one carried stick on explored, cleared ground. It blows a ${DYNAMITE.radius}-tile radius after a ${DYNAMITE.fuseSeconds}-second fuse: blasts yield no cargo, and a ship still inside the radius takes hull damage. Escape cancels.`},
  {keys: [key('T'), text(' / '), control('Teleport button')], action: 'With a teleporter in the cargo bay, open the portal list (the portals out of reach) and pick one to jump straight there; the trip spends one teleporter. Travel between built portals is otherwise free.'},
  {keys: [control('Scanner slot'), text(' then a mine tile')], action: `Deploy one carried scanner onto explored, cleared ground; it maps its ${SCANNER_DEVICE.size}×${SCANNER_DEVICE.size} surroundings, one fogged tile every ${SCANNER_DEVICE.intervalSeconds} seconds, then goes inert. Escape cancels.`},
  {keys: [control('Container, station or decoration slot'), text(' then a mine tile')], action: 'Set one carried cargo container, Manufacturing Station, Fuel Extractor, Portal or decoration down on explored, cleared ground. Escape cancels.'},
  {keys: [control('Toolkit slot'), text(' then a station')], action: 'Pack an empty station, portal or container the ship can reach back into the cargo bay. Escape cancels.'},
  {keys: [control('Repair Kit slot')], action: `Spend one kit to restore ${Math.round(HULL.repairKitFraction * 100)}% of max hull.`},
  {keys: [key('C'), text(' / press the crate')], action: `Open the placed container, wreck or chest the ship is on or beside. Press a stack in either column to move it across; a crate holds up to ${CARGO_CONTAINER.capacity} items and keeps them through death and reload, and anything taken back aboard still obeys the cargo-bay limit.`},
  {keys: [key('+'), text(' / '), key('-'), text(' / wheel')], action: 'Zoom the mine view in and out'},
  {keys: [key('Esc')], action: 'Close the open screen, or cancel an armed placement'},
  {keys: [key('R'), text(' then '), key('R')], action: 'Confirm reset while alive'}
];

/** A row's keys cell as one line of plain text, e.g. `WASD / Arrows`. */
export function controlKeysText(row: ControlRow): string {
  return row.keys.map(part => part.text).join('');
}

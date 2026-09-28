// Graves: who lies in each one, when they lived, and what the mine did to them.
//
// A grave is a coordinate, nothing more (see `graveAt` in `world.ts`), and so is
// its epitaph: `epitaphFor` rolls a Russian name, a lifespan and a cause of death
// from the same coordinate, so every player reads the same stone at the same spot.
// The deeper the grave, the longer ago its miner went down: the shallows hold the
// recently lost, the deep mine the first ones in. Nothing is ever stored.
//
// Everything here is pure and DOM-free.

import { rowDepthMeters } from '../../shared/constants';
import { GRAVE_MIN_ROW, graveAt, rand, type Grave } from '../world/world';
import type { NonEmpty } from './types';

/** What a gravestone says. */
export interface Epitaph {
  name: string;
  born: number;
  died: number;
  cause: string;
}

export const GRAVE = Object.freeze({
  /** How far a grave can be read from: its own tile and the eight around it. */
  reach: 1,
  /** The year the shallowest graves were dug in. */
  latestYear: 1990,
  /** The year the deepest were — no one went down before it. */
  earliestYear: 1890,
  /** Rows below the first grave row over which the death year falls to the earliest. */
  depthSpan: 900,
  /** A grave's year wanders up to this many years earlier than its depth alone says. */
  yearJitter: 8,
  minAge: 19,
  maxAge: 70
});

export const MALE_FIRST_NAMES: NonEmpty<string> = Object.freeze([
  'Ivan', 'Pyotr', 'Aleksei', 'Dmitri', 'Nikolai', 'Sergei', 'Mikhail', 'Vasily',
  'Grigori', 'Fyodor', 'Yakov', 'Boris', 'Anatoly', 'Leonid', 'Yuri', 'Viktor',
  'Konstantin', 'Stepan', 'Semyon', 'Arkady', 'Gennady', 'Timofei'
]);

export const FEMALE_FIRST_NAMES: NonEmpty<string> = Object.freeze([
  'Anna', 'Maria', 'Olga', 'Tatiana', 'Yelena', 'Natalia', 'Irina', 'Svetlana',
  'Lyudmila', 'Galina', 'Vera', 'Nadezhda', 'Zoya', 'Valentina', 'Yekaterina',
  'Nina', 'Raisa', 'Klavdia', 'Darya', 'Praskovya'
]);

/** Surname endings, masculine and feminine. */
export const SURNAME_ENDINGS = Object.freeze({
  ov: {male: 'ov', female: 'ova'},
  ev: {male: 'ev', female: 'eva'},
  in: {male: 'in', female: 'ina'},
  sky: {male: 'sky', female: 'skaya'}
});

type SurnameEnding = keyof typeof SURNAME_ENDINGS;

/** Surname stems, each with the ending it takes. */
const SURNAME_STEMS: NonEmpty<{stem: string; ending: SurnameEnding}> = Object.freeze([
  {stem: 'Petr', ending: 'ov'}, {stem: 'Ivan', ending: 'ov'}, {stem: 'Smirn', ending: 'ov'},
  {stem: 'Kuznets', ending: 'ov'}, {stem: 'Pop', ending: 'ov'}, {stem: 'Volk', ending: 'ov'},
  {stem: 'Moroz', ending: 'ov'}, {stem: 'Kozl', ending: 'ov'}, {stem: 'Sokol', ending: 'ov'},
  {stem: 'Orl', ending: 'ov'}, {stem: 'Sidor', ending: 'ov'}, {stem: 'Frol', ending: 'ov'},
  {stem: 'Lebed', ending: 'ev'}, {stem: 'Medved', ending: 'ev'}, {stem: 'Vasili', ending: 'ev'},
  {stem: 'Grigori', ending: 'ev'}, {stem: 'Gus', ending: 'ev'}, {stem: 'Belya', ending: 'ev'},
  {stem: 'Fom', ending: 'in'}, {stem: 'Lap', ending: 'in'}, {stem: 'Nikit', ending: 'in'},
  {stem: 'Zim', ending: 'in'}, {stem: 'Borod', ending: 'in'}, {stem: 'Kalin', ending: 'in'},
  {stem: 'Galk', ending: 'in'},
  {stem: 'Pokrov', ending: 'sky'}, {stem: 'Uspen', ending: 'sky'}, {stem: 'Ostrov', ending: 'sky'},
  {stem: 'Kamen', ending: 'sky'}, {stem: 'Zagor', ending: 'sky'}, {stem: 'Bel', ending: 'sky'},
  {stem: 'Voskresen', ending: 'sky'}
]);

/** How the mine took them. The depth-free ones; `ran dry` names the grave's own depth. */
const CAUSES: NonEmpty<string> = Object.freeze([
  'Struck a magma pocket',
  'Crushed under rock',
  'Bitten by a burrower',
  'Never found the surface',
  'Fuse too short',
  'Went back for one more ore',
  'Hull gave out',
  'Drilled into a Tunnel Fiend',
  'Lamp went out',
  'Cave-in on the night shift',
  'Trusted the old map',
  'Mistook rock for dirt'
]);

/** Pick one entry of a list from a roll in [0,1). */
function pick<T>(list: NonEmpty<T>, roll: number): T {
  // Clamped into range, so only a roll outside [0,1) could reach the fallback.
  return list[Math.max(0, Math.min(list.length - 1, Math.floor(roll * list.length)))] ?? list[0];
}

/**
 * The year a miner lying at this row died: the shallowest graves are the most
 * recent, the year falling steadily with depth to the earliest, with a little
 * per-grave wander so a band of graves is not all one year.
 */
export function deathYear(y: number, roll: number): number {
  const depth = Math.min(1, Math.max(0, (y - GRAVE_MIN_ROW) / GRAVE.depthSpan));
  const span = GRAVE.latestYear - GRAVE.earliestYear;
  const year = GRAVE.latestYear - Math.round(depth * span) - Math.floor(roll * (GRAVE.yearJitter + 1));
  return Math.max(GRAVE.earliestYear, Math.min(GRAVE.latestYear, year));
}

/** The epitaph on the grave at a coordinate. Deterministic for a given (x,y). */
export function epitaphFor(x: number, y: number): Epitaph {
  const female = rand(x + 401, y + 977) < 0.3;
  const first = pick(female ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES, rand(x + 1609, y + 83));
  const surname = pick(SURNAME_STEMS, rand(x + 59, y + 1321));
  const ending = SURNAME_ENDINGS[surname.ending][female ? 'female' : 'male'];
  const died = deathYear(y, rand(x + 733, y + 1543));
  const age = GRAVE.minAge + Math.floor(rand(x + 2003, y + 271) * (GRAVE.maxAge - GRAVE.minAge + 1));
  // One cause in every few is running out of fuel, at the depth the grave lies at.
  const causeRoll = rand(x + 887, y + 1999);
  const cause = causeRoll < 0.2
    ? `Ran dry at ${rowDepthMeters(y)} m`
    : pick(CAUSES, (causeRoll - 0.2) / 0.8);
  return {name: `${first} ${surname.stem}${ending}`, born: died - age, died, cause};
}

/** Whether a ship at (x,y) stands close enough to read this grave. */
export function isGraveReachable(grave: Grave, x: number, y: number): boolean {
  return Math.max(Math.abs(grave.x - x), Math.abs(grave.y - y)) <= GRAVE.reach;
}

/**
 * The grave a ship at (x,y) would read with Space: the nearest one on its own tile
 * or the eight around it, by Manhattan distance, with its distance; `null` when
 * none is in reach. `isExplored` keeps a grave still under fog out of it.
 */
export function reachableGrave(
  x: number,
  y: number,
  isExplored: (x: number, y: number) => boolean
): (Grave & {distance: number}) | null {
  let best: (Grave & {distance: number}) | null = null;
  for (let dy = -GRAVE.reach; dy <= GRAVE.reach; dy++) {
    for (let dx = -GRAVE.reach; dx <= GRAVE.reach; dx++) {
      const grave = graveAt(x + dx, y + dy);
      if (!grave || !isExplored(grave.x, grave.y)) continue;
      const distance = Math.abs(dx) + Math.abs(dy);
      if (!best || distance < best.distance) best = {...grave, distance};
    }
  }
  return best;
}

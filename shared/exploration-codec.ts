import { HOME_CAVERN_TOP, MAX_EXPLORED_TILES, MAX_WORLD_ROW, WORLD_W } from './constants.ts';

const RANGE = /^(\d+)(?:-(\d+))?$/;
// The indestructible bedrock ceiling above the home cavern is always visible, so
// exploration only ever stores rows at or below it.
const MIN_INDEX = HOME_CAVERN_TOP * WORLD_W;
const MAX_INDEX = MAX_WORLD_ROW * WORLD_W + WORLD_W - 1;

export function explorationIndex(x: number, y: number): number {
  return y * WORLD_W + x;
}

export function isTileExplored(explored: ReadonlySet<number>, x: number, y: number): boolean {
  return y < HOME_CAVERN_TOP || explored.has(explorationIndex(x, y));
}

/**
 * Even footprints anchor the ship in the top-left tile of the central 2x2.
 * Thus a 4x4 footprint uses offsets -1..2 on both axes, with no odd-size rounding.
 */
export function revealFootprint(explored: Set<number>, x: number, y: number, size: number): number[] {
  const footprint = Math.max(1, Math.floor(size));
  const startX = x - Math.floor((footprint - 1) / 2);
  const startY = y - Math.floor((footprint - 1) / 2);
  const added: number[] = [];

  for (let wy = startY; wy < startY + footprint; wy++) {
    if (wy < HOME_CAVERN_TOP || wy > MAX_WORLD_ROW) continue;
    for (let wx = startX; wx < startX + footprint; wx++) {
      if (wx < 0 || wx >= WORLD_W) continue;
      const index = explorationIndex(wx, wy);
      if (explored.has(index)) continue;
      explored.add(index);
      added.push(index);
    }
  }
  return added;
}

/**
 * Whether an encoded payload is a well-formed, in-bounds, size-capped set of
 * ranges. This is the validation half of the codec, shared by the client's
 * message schema and the relay, so both reject exactly the same payloads.
 */
export function isEncodedExploration(encoded: string): boolean {
  if (!encoded) return true;
  let count = 0;
  for (const range of encoded.split(',')) {
    const match = RANGE.exec(range);
    if (!match) return false;
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return false;
    if (end < start || start < MIN_INDEX || end > MAX_INDEX) return false;
    count += end - start + 1;
    if (count > MAX_EXPLORED_TILES) return false;
  }
  return true;
}

export function encodeExploration(explored: Iterable<number>): string {
  const indexes = [...new Set(explored)]
    .filter(index => Number.isSafeInteger(index) && index >= MIN_INDEX && index <= MAX_INDEX)
    .sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < indexes.length; i++) {
    const start = indexes[i];
    let end = start;
    while (i + 1 < indexes.length && indexes[i + 1] === end + 1) end = indexes[++i];
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
  }
  return ranges.join(',');
}

export function mergeExploration(explored: Set<number>, encoded: unknown): number[] {
  if (typeof encoded !== 'string' || !encoded) return [];
  const added: number[] = [];
  for (const range of encoded.split(',')) {
    const match = RANGE.exec(range);
    if (!match) continue;
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || start < MIN_INDEX || end > MAX_INDEX) continue;
    for (let index = start; index <= end; index++) {
      if (explored.has(index)) continue;
      explored.add(index);
      added.push(index);
    }
  }
  return added;
}

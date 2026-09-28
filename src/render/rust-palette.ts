import { getEnemyType } from '../core/enemy-types';
import type { EnemyKind } from '../core/types';

/** A haunted rig's three hull colors, top to bottom of its sheen, as `rgb(...)` strings. */
export type RustPalette = readonly [string, string, string];

/**
 * Desaturate a palette color and pull it toward rust, giving the haunted rigs a
 * dead-metal hull that still reads as their type. Enemy colors are all `#rrggbb`.
 */
export function rustColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const luma = 0.3 * r + 0.59 * g + 0.11 * b;
  const mix = (c: number, target: number, amount: number) => c + (target - c) * amount;
  const rust = (c: number, target: number) => Math.round(mix(mix(c, luma, .5), target, .16) * .82);
  return `rgb(${rust(r, 122)},${rust(g, 74)},${rust(b, 50)})`;
}

const palettes = new Map<EnemyKind, RustPalette>();

/**
 * The rusted hull colors for an enemy kind. A kind's palette is fixed, so it is
 * worked out once and the same tuple handed back to every later frame instead of
 * re-parsing the hex on each draw of each rig.
 */
export function rustPalette(kind: EnemyKind): RustPalette {
  let palette = palettes.get(kind);
  if (!palette) {
    const [top, middle, bottom] = getEnemyType(kind).colors;
    palette = [rustColor(top), rustColor(middle), rustColor(bottom)];
    palettes.set(kind, palette);
  }
  return palette;
}

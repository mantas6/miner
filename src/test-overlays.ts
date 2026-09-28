// Overlay fixtures for tests, now that the store's `overlay` carries each screen's
// contents: a test that only needs "the station screen is up" gets one with
// nothing in it. Test-only — nothing in the game imports it.

import type { Overlay, OverlayId, OverlayOf } from './ui/store';

const EMPTY: {[K in OverlayId]: () => OverlayOf<K>} = {
  info: () => ({kind: 'info'}),
  ship: () => ({kind: 'ship'}),
  container: () => ({kind: 'container', slots: []}),
  wreck: () => ({kind: 'wreck', slots: []}),
  chest: () => ({kind: 'chest', slots: []}),
  station: () => ({kind: 'station', slots: []}),
  extractor: () => ({kind: 'extractor', extractor: {coal: 0, fuel: 0, progress: 0}}),
  trade: () => ({kind: 'trade', offers: []}),
  portal: () => ({kind: 'portal', portal: {mode: 'travel', destinations: []}}),
  grave: () => ({kind: 'grave', epitaph: {name: 'A. Miner', born: 2001, died: 2042, cause: 'Lost in the dark.'}})
};

/** The overlay `kind` with empty contents. */
export function emptyOverlay<K extends OverlayId>(kind: K): OverlayOf<K>;
export function emptyOverlay(kind: OverlayId): Overlay {
  return EMPTY[kind]();
}

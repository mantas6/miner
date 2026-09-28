// Reading a grave: the wiring between the sim, the bell and the stone the UI shows.
//
// The rules themselves are core/grave.test.ts; what is checked here is that a press
// or Space in reach raises the epitaph with the `grave` bell (and no other cue),
// that fog and distance keep a stone shut, and that a lost ship puts it away.

import { describe, expect, it } from 'vitest';
import { WORLD_W } from '../../shared/constants';
import { explorationIndex } from '../../shared/exploration-codec';
import { epitaphFor, type Epitaph } from '../core/grave';
import { createInitialState } from '../core/state';
import type { GameState } from '../core/types';
import { gravesInRange } from '../world/world';
import { createGraves, type GraveSim } from './graves';
import { createAudioStub, createToastLog, type AudioStub } from './test-support';

const GRAVE = gravesInRange(0, 0, WORLD_W - 1, 400)[0];
const EPITAPH = epitaphFor(GRAVE.x, GRAVE.y);

interface Harness {
  state: GameState;
  graves: GraveSim;
  audio: AudioStub;
  toasts: ReturnType<typeof createToastLog>;
  /** Every epitaph push the UI received; `null` means the stone was put away. */
  ui: (Epitaph | null)[];
}

/** A ship parked one tile east of the first generated grave, its tile explored. */
function harness(): Harness {
  const state = createInitialState();
  Object.assign(state.player, {x: GRAVE.x + 1, y: GRAVE.y});
  state.exploredTiles.add(explorationIndex(GRAVE.x, GRAVE.y));
  const audio = createAudioStub();
  const toasts = createToastLog();
  const ui: (Epitaph | null)[] = [];
  const graves = createGraves({state, audio, toast: toasts.toast, setGraveUi: epitaph => { ui.push(epitaph); }});
  return {state, graves, audio, toasts, ui};
}

describe('reading a grave', () => {
  it('shows the epitaph under a press, with the bell and nothing else', () => {
    const h = harness();

    expect(h.graves.openAt(GRAVE.x, GRAVE.y)).toBe(true);
    expect(h.graves.open).toEqual(GRAVE);
    expect(h.ui).toEqual([EPITAPH]);
    expect(h.audio.played).toEqual(['grave']);

    // A second press on the same stone is not a second bell.
    expect(h.graves.openAt(GRAVE.x, GRAVE.y)).toBe(true);
    expect(h.audio.played).toEqual(['grave']);
  });

  it('puts the stone away on close, once', () => {
    const h = harness();
    h.graves.openAt(GRAVE.x, GRAVE.y);

    h.graves.close();
    h.graves.close();

    expect(h.graves.open).toBeNull();
    expect(h.ui).toEqual([EPITAPH, null]);
  });

  it('opens with Space beside it, and Space again puts it away', () => {
    const h = harness();

    expect(h.graves.nearest()).toEqual({...GRAVE, distance: 1});
    expect(h.graves.openNearest()).toBe(true);
    expect(h.ui).toEqual([EPITAPH]);
    expect(h.graves.openNearest()).toBe(true);
    expect(h.ui).toEqual([EPITAPH, null]);
  });

  it('refuses a stone out of reach with a toast, and ignores one under fog or bare rock', () => {
    const h = harness();
    h.state.player.x = GRAVE.x + 2;
    expect(h.graves.openAt(GRAVE.x, GRAVE.y)).toBe(false);
    expect(h.toasts.messages.at(-1)).toContain('Too far from the grave');
    expect(h.graves.openNearest()).toBe(false);
    expect(h.toasts.messages.at(-1)).toBe('No grave within reach.');

    h.state.player.x = GRAVE.x + 1;
    h.state.exploredTiles.clear();
    expect(h.graves.openAt(GRAVE.x, GRAVE.y)).toBe(false);
    expect(h.graves.nearest()).toBeNull();

    h.state.exploredTiles.add(explorationIndex(GRAVE.x + 1, GRAVE.y));
    expect(h.graves.openAt(GRAVE.x + 1, GRAVE.y)).toBe(false);
    expect(h.ui).toEqual([]);
    expect(h.audio.played).toEqual([]);
  });

  it('puts the stone away when the ship is lost', () => {
    const h = harness();
    h.graves.openAt(GRAVE.x, GRAVE.y);

    h.state.gameOver = true;
    h.graves.tick();

    expect(h.graves.open).toBeNull();
    expect(h.ui.at(-1)).toBeNull();
    expect(h.graves.openAt(GRAVE.x, GRAVE.y)).toBe(false);
  });
});

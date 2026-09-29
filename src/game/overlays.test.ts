// The overlay session: the open cue only on the transition, the close cue only for
// a screen actually up (and never over a lost ship), held keys dropped as a screen
// rises, placements stood down by the screens that cover the mine, and a repaint
// with unchanged contents writing nothing to the store.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uiStore, type InventorySlotView } from '../ui/store';
import { createOverlaySession, type OverlaySession } from './overlays';
import { createAudioStub, type AudioStub } from './test-support';

const pristine = {...uiStore.getState()};

const SLOT: InventorySlotView = {index: 0, kind: 'repairKit', label: 'Repair Kit', color: '#7be08a', count: 2};

let audio: AudioStub;
let clearKeys: ReturnType<typeof vi.fn<() => void>>;
let disarmPlacements: ReturnType<typeof vi.fn<() => void>>;
let gameOver: boolean;
let session: OverlaySession;

beforeEach(() => {
  audio = createAudioStub();
  clearKeys = vi.fn<() => void>();
  disarmPlacements = vi.fn<() => void>();
  gameOver = false;
  session = createOverlaySession({audio, clearKeys, disarmPlacements, isGameOver: () => gameOver});
});

afterEach(() => {
  uiStore.setState(pristine, true);
});

describe('the overlay session', () => {
  it('cues the open once, however often the screen is repainted', () => {
    session.raise({kind: 'station', slots: [], supply: false});
    session.raise({kind: 'station', slots: [SLOT], supply: false});

    expect(audio.played).toEqual(['open']);
    expect(clearKeys).toHaveBeenCalledTimes(2);
    expect(session.active()).toBe('station');
  });

  it('cues the close only for the screen actually up, and never over a lost ship', () => {
    session.raise({kind: 'ship'});
    session.drop('info');
    expect(session.active()).toBe('ship');
    expect(audio.played).toEqual(['open']);

    session.drop('ship');
    session.drop('ship');
    expect(session.active()).toBeNull();
    expect(audio.played).toEqual(['open', 'close']);

    session.raise({kind: 'info'});
    gameOver = true;
    session.drop('info');
    expect(audio.played).toEqual(['open', 'close', 'open']);
  });

  it('builds publishers that show, repaint and drop one screen', () => {
    const trade = session.publisher('trade', (offers: []) => ({kind: 'trade', offers}), {standDown: true});
    const chest = session.publisher('chest', (slots: InventorySlotView[]) => ({kind: 'chest', slots}), {cue: false});

    trade([]);
    expect(disarmPlacements).toHaveBeenCalledOnce();
    expect(session.active()).toBe('trade');
    trade(null, true);
    expect(session.active()).toBeNull();
    // Quiet: the action that shut it plays its own cue.
    expect(audio.played).toEqual(['open']);

    chest([SLOT]);
    // The stash's opener stands its own placements down; the lid is the open cue.
    expect(disarmPlacements).toHaveBeenCalledOnce();
    expect(audio.played).toEqual(['open']);
    expect(uiStore.getState().overlay).toEqual({kind: 'chest', slots: [SLOT]});
  });

  it('writes nothing to the store for a repaint that changed nothing', () => {
    session.raise({kind: 'station', slots: [SLOT], supply: false});
    const listener = vi.fn<() => void>();
    const unsubscribe = uiStore.subscribe(listener);

    session.raise({kind: 'station', slots: [{...SLOT}], supply: false});
    session.raise({kind: 'extractor', extractor: {coal: 1, fuel: 2, progress: 3, supply: false}});
    session.raise({kind: 'extractor', extractor: {coal: 1, fuel: 2, progress: 3, supply: false}});
    unsubscribe();

    // Only the switch to the extractor was a change.
    expect(listener).toHaveBeenCalledOnce();
  });

  it('opens Info on its first tab, but keeps the tab through a repaint', () => {
    session.raise({kind: 'info'});
    uiStore.getState().setInfoTab('info-settings');
    session.raise({kind: 'info'});
    expect(uiStore.getState().infoTab).toBe('info-settings');

    session.drop('info');
    session.raise({kind: 'info'});
    expect(uiStore.getState().infoTab).not.toBe('info-settings');
  });

  it('takes the runtime-bound screens down at teardown, and leaves Info and Ship up', () => {
    session.raise({kind: 'portal', portal: {mode: 'respawn', destinations: []}});
    session.closeRuntimeScreens();
    expect(session.active()).toBeNull();

    session.raise({kind: 'info'});
    session.closeRuntimeScreens();
    expect(session.active()).toBe('info');
  });
});

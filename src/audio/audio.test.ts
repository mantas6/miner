// @vitest-environment happy-dom
//
// The gesture rules that decide when audio may start, the remembered
// preferences, and the two independent switches the HUD drives: muting the
// soundtrack must leave the drill audible, and muting the effects must leave the
// soundtrack playing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudio } from './audio';
import { shouldAttemptAutoAudio } from './audio-permission';
import { AUDIO_SETTINGS_KEY, loadAudioSettings, saveAudioSettings } from './audio-settings';
import type { AudioController } from '../core/types';
import { uiStore } from '../ui/store';

describe('audio startup permission helpers', () => {
  it('does not auto-enable sound from keyboard, synthetic startup, or non-gesture paths', () => {
    expect(shouldAttemptAutoAudio({ wantsSound: true, enabled: false })).toBe(false);
    expect(shouldAttemptAutoAudio({ wantsSound: true, enabled: false, eventType: 'keydown', isTrusted: true })).toBe(false);
    expect(shouldAttemptAutoAudio({ wantsSound: true, enabled: false, eventType: 'pointerdown', isTrusted: false })).toBe(false);
  });

  it('allows trusted pointer and touch gestures to try enabling audio once requested', () => {
    expect(shouldAttemptAutoAudio({ wantsSound: true, enabled: false, eventType: 'pointerdown', isTrusted: true })).toBe(true);
    expect(shouldAttemptAutoAudio({ wantsSound: true, enabled: false, eventType: 'touchstart', isTrusted: true })).toBe(true);
  });

  it('does not retry auto-audio when sound is disabled by preference or already enabled', () => {
    expect(shouldAttemptAutoAudio({ wantsSound: false, enabled: false, eventType: 'pointerdown', isTrusted: true })).toBe(false);
    expect(shouldAttemptAutoAudio({ wantsSound: true, enabled: true, eventType: 'pointerdown', isTrusted: true })).toBe(false);
  });
});

describe('audio preferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults both switches to on for a first visit and for unreadable storage', () => {
    expect(loadAudioSettings()).toEqual({music: true, sfx: true});

    localStorage.setItem(AUDIO_SETTINGS_KEY, '{bad json');
    expect(loadAudioSettings()).toEqual({music: true, sfx: true});
  });

  it('round-trips the two switches independently', () => {
    saveAudioSettings({music: false, sfx: true});
    expect(loadAudioSettings()).toEqual({music: false, sfx: true});

    saveAudioSettings({music: true, sfx: false});
    expect(loadAudioSettings()).toEqual({music: true, sfx: false});
  });

  it('falls back to the default for a side that was never written', () => {
    localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify({music: false}));
    expect(loadAudioSettings()).toEqual({music: false, sfx: true});
  });

  it('does not fail when storage is unavailable', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(() => saveAudioSettings({music: false, sfx: false})).not.toThrow();

    setItem.mockRestore();
  });
});

// --- Fake WebAudio ---------------------------------------------------------
// Just enough of the API for the controller to wire its graph up, plus a count
// of the oscillators it started, which is how these tests hear an effect.

let oscillators = 0;
/** Noise bursts started, the other half of what a cue can be built from. */
let noiseBursts = 0;

function fakeParam() {
  return {value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn()};
}

function fakeNode() {
  return {
    type: '', buffer: null as unknown, gain: fakeParam(), frequency: fakeParam(),
    connect: vi.fn(), start: vi.fn(), stop: vi.fn()
  };
}

class FakeAudioContext {
  state = 'suspended';
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  resume = vi.fn(async () => { this.state = 'running'; });
  createGain = () => fakeNode();
  createBiquadFilter = () => fakeNode();
  createBufferSource = () => { noiseBursts++; return fakeNode(); };
  createBuffer = (_channels: number, length: number) => ({getChannelData: () => new Float32Array(length)});
  createOscillator = () => { oscillators++; return fakeNode(); };
}

class FakeMusicElement {
  static last: FakeMusicElement | null = null;
  src = '';
  loop = false;
  preload = '';
  volume = 1;
  currentTime = 0;
  paused = true;
  canPlayType = () => 'probably';
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  constructor() { FakeMusicElement.last = this; }
}

/** Effects that actually reached the graph since the last check. */
function heardEffects(run: () => void): number {
  const before = oscillators + noiseBursts;
  run();
  return oscillators + noiseBursts - before;
}

/** The per-action cues the game plays in place of a generic blip. */
const NAMED_CUES = [
  'refuel', 'craft', 'sell', 'buy', 'stow', 'take', 'place', 'lift', 'portal',
  'upgradeFit', 'upgradeRemove', 'repair', 'open', 'close', 'arm', 'disarm',
  'respawn', 'bounty', 'milestone', 'surveyDone', 'click', 'chestOpen', 'grave'
] as const satisfies readonly (keyof AudioController)[];

describe('music and sound effects mute independently', () => {
  const pristineStore = {...uiStore.getState()};
  let toasts: string[];

  beforeEach(() => {
    localStorage.clear();
    uiStore.setState(pristineStore);
    uiStore.getState().clearToasts();
    oscillators = 0;
    noiseBursts = 0;
    toasts = [];
    FakeMusicElement.last = null;
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('Audio', FakeMusicElement);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeAudio() {
    return createAudio(message => { toasts.push(message); });
  }

  it('starts both sides on the unlock gesture and lights both buttons', async () => {
    const audio = makeAudio();

    expect(await audio.enable()).toBe(true);

    expect(FakeMusicElement.last?.play).toHaveBeenCalled();
    expect(heardEffects(() => audio.mine())).toBeGreaterThan(0);
    expect(uiStore.getState().musicOn).toBe(true);
    expect(uiStore.getState().sfxOn).toBe(true);
  });

  it('keeps effects audible when the soundtrack is muted', async () => {
    const audio = makeAudio();
    await audio.enable();

    await audio.toggleMusic();

    expect(audio.musicEnabled).toBe(false);
    expect(audio.sfxEnabled).toBe(true);
    expect(FakeMusicElement.last?.pause).toHaveBeenCalled();
    expect(heardEffects(() => audio.mine())).toBeGreaterThan(0);
    expect(uiStore.getState().musicOn).toBe(false);
    expect(uiStore.getState().sfxOn).toBe(true);
    expect(toasts.at(-1)).toBe('Music off');
  });

  it('keeps the soundtrack playing when the effects are muted', async () => {
    const audio = makeAudio();
    await audio.enable();
    const music = FakeMusicElement.last!;
    music.pause.mockClear();

    await audio.toggleSfx();

    expect(audio.sfxEnabled).toBe(false);
    expect(audio.musicEnabled).toBe(true);
    expect(music.pause).not.toHaveBeenCalled();
    expect(heardEffects(() => { audio.mine(); audio.cash(); audio.bump(); audio.explosion(); })).toBe(0);
    expect(uiStore.getState().musicOn).toBe(true);
    expect(uiStore.getState().sfxOn).toBe(false);
    expect(toasts.at(-1)).toBe('Sound effects off');
  });

  it('restores a muted side on its own button, without touching the other', async () => {
    const audio = makeAudio();
    await audio.enable();
    await audio.toggleMusic();
    await audio.toggleSfx();

    await audio.toggleMusic();

    expect(audio.musicEnabled).toBe(true);
    expect(audio.sfxEnabled).toBe(false);
    expect(uiStore.getState().musicOn).toBe(true);
    expect(uiStore.getState().sfxOn).toBe(false);
  });

  it('remembers each switch for the next visit', async () => {
    const audio = makeAudio();
    await audio.enable();
    await audio.toggleMusic();

    expect(loadAudioSettings()).toEqual({music: false, sfx: true});

    // A fresh controller boots muted, and the unlock gesture leaves it that way.
    const revisit = makeAudio();
    expect(revisit.musicEnabled).toBe(false);
    expect(revisit.sfxEnabled).toBe(true);

    await revisit.enable();
    expect(FakeMusicElement.last?.play).not.toHaveBeenCalled();
    expect(heardEffects(() => revisit.mine())).toBeGreaterThan(0);
  });

  it('only spends a gesture on the unlock while one of the switches is on', async () => {
    const audio = makeAudio();
    expect(audio.wantsSound).toBe(true);

    await audio.enable();
    await audio.toggleMusic();
    expect(audio.wantsSound).toBe(true);

    await audio.toggleSfx();
    expect(audio.wantsSound).toBe(false);
  });

  it('sounds every named cue while effects are on, and none of them muted', async () => {
    const audio = makeAudio();
    await audio.enable();

    for (const cue of NAMED_CUES) {
      expect(heardEffects(() => audio[cue]()), cue).toBeGreaterThan(0);
    }

    await audio.toggleSfx();
    for (const cue of NAMED_CUES) {
      expect(heardEffects(() => audio[cue]()), cue).toBe(0);
    }
  });

  it('keeps every named cue silent before the context is unlocked', () => {
    const audio = makeAudio();
    for (const cue of NAMED_CUES) {
      expect(heardEffects(() => audio[cue]()), cue).toBe(0);
    }
  });

  it('turns a switch on from the button even though the context is still locked', async () => {
    saveAudioSettings({music: false, sfx: false});
    const audio = makeAudio();

    expect(uiStore.getState().musicOn).toBe(false);
    await audio.toggleMusic();

    expect(audio.enabled).toBe(true);
    expect(audio.musicEnabled).toBe(true);
    expect(FakeMusicElement.last?.play).toHaveBeenCalled();
    // The effects stay muted: this button only speaks for the soundtrack.
    expect(audio.sfxEnabled).toBe(false);
    expect(uiStore.getState().sfxOn).toBe(false);
  });
});

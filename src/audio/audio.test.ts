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
import type { TrackId } from './tracks';
import { uiStore } from '../ui/store';
import { nth } from '../test-narrowing';

/** The build ships one track; a second one lets the swap path run. */
const SECOND_TRACK = 'second-track' as TrackId;

vi.mock('./tracks', async importOriginal => {
  const actual = await importOriginal<typeof import('./tracks')>();
  return {
    ...actual,
    TRACKS: {
      ...actual.TRACKS,
      'second-track': {id: 'second-track', title: 'Second', mp3: 'assets/music/second.mp3', ogg: 'assets/music/second.ogg'}
    }
  };
});

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
    onended: null as unknown,
    connect: vi.fn(), start: vi.fn(), stop: vi.fn()
  };
}

type FakeNode = ReturnType<typeof fakeNode>;

class FakeAudioContext {
  static last: FakeAudioContext | null = null;
  state = 'suspended';
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  /** Every oscillator made, effects and synth notes alike, in creation order. */
  oscillatorNodes: FakeNode[] = [];
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  createGain = () => fakeNode();
  createBiquadFilter = () => fakeNode();
  createBufferSource = () => { noiseBursts++; return fakeNode(); };
  createBuffer = vi.fn((_channels: number, length: number) => ({getChannelData: () => new Float32Array(length)}));
  createOscillator = () => {
    oscillators++;
    const node = fakeNode();
    this.oscillatorNodes.push(node);
    return node;
  };
  constructor() { FakeAudioContext.last = this; }
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
  removeAttribute = vi.fn((name: string) => { if (name === 'src') this.src = ''; });
  load = vi.fn();
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
    FakeAudioContext.last = null;
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

describe('audio lifecycle', () => {
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
    FakeAudioContext.last = null;
    vi.useFakeTimers();
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('Audio', FakeMusicElement);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function makeAudio() {
    return createAudio(message => { toasts.push(message); });
  }

  /** Unlocked with the shipped soundtrack refused, so the synth loop runs. */
  async function withSynthLoop(): Promise<AudioController> {
    const audio = makeAudio();
    audio.init();
    FakeMusicElement.last!.play.mockRejectedValueOnce(new DOMException('no source', 'NotSupportedError'));
    await audio.enable();
    expect(audio.musicTimer).not.toBeNull();
    return audio;
  }

  it('attaches the soundtrack source only once music actually plays', async () => {
    saveAudioSettings({music: false, sfx: true});
    const audio = makeAudio();
    await audio.enable();
    const music = FakeMusicElement.last!;

    expect(music.src).toBe('');
    expect(music.preload).toBe('none');

    await audio.toggleMusic();
    expect(music.src).toContain('golden-signal');
    expect(music.preload).toBe('auto');
    expect(music.play).toHaveBeenCalled();
  });

  it('swallows an interrupted play without falling back to the synth', async () => {
    const audio = makeAudio();
    await audio.enable();
    FakeMusicElement.last!.play.mockRejectedValueOnce(new DOMException('interrupted by pause()', 'AbortError'));

    await expect(audio.startMusic()).resolves.toBe(false);
    expect(audio.musicTimer).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('falls back to the synth loop when play fails for any other reason', async () => {
    const audio = await withSynthLoop();

    expect(vi.getTimerCount()).toBe(1);
    const before = oscillators;
    vi.advanceTimersByTime(240);
    expect(oscillators).toBeGreaterThan(before);
    audio.dispose();
  });

  it('replaces the synth loop on a second start instead of running two', async () => {
    const audio = await withSynthLoop();

    audio.startSynthMusic();
    audio.startSynthMusic();

    expect(vi.getTimerCount()).toBe(1);
    audio.dispose();
  });

  it('does not start the synth loop while music is off', async () => {
    saveAudioSettings({music: false, sfx: true});
    const audio = makeAudio();
    await audio.enable();

    audio.startSynthMusic();

    expect(audio.musicTimer).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('restarts the new track from its start when the track changes mid-play', async () => {
    const audio = makeAudio();
    await audio.enable();
    const music = FakeMusicElement.last!;
    music.currentTime = 42;
    music.play.mockClear();

    audio.setTrack(SECOND_TRACK);
    await Promise.resolve();

    expect(audio.currentTrackId).toBe(SECOND_TRACK);
    expect(music.pause).toHaveBeenCalled();
    expect(music.src).toContain('second');
    expect(music.currentTime).toBe(0);
    expect(music.play).toHaveBeenCalledTimes(1);
  });

  it('defers the source swap for a stopped soundtrack until it plays again', async () => {
    const audio = makeAudio();
    await audio.enable();
    await audio.toggleMusic();
    const music = FakeMusicElement.last!;
    music.play.mockClear();

    audio.setTrack(SECOND_TRACK);
    expect(music.src).toContain('golden-signal');
    expect(music.play).not.toHaveBeenCalled();

    await audio.toggleMusic();
    expect(music.src).toContain('second');
  });

  it('reports a refused unlock and keeps both sides silent', async () => {
    class BlockedAudioContext extends FakeAudioContext {
      override resume = vi.fn(async () => { throw new DOMException('gesture required', 'NotAllowedError'); });
    }
    vi.stubGlobal('AudioContext', BlockedAudioContext);
    const audio = makeAudio();

    await expect(audio.enable()).resolves.toBe(false);

    expect(audio.enabled).toBe(false);
    expect(FakeMusicElement.last?.play).not.toHaveBeenCalled();
    expect(heardEffects(() => audio.mine())).toBe(0);
    expect(uiStore.getState().musicOn).toBe(false);
    expect(uiStore.getState().sfxOn).toBe(false);
    expect(toasts.at(-1)).toMatch(/blocked/i);
  });

  it('schedules every step of a cue on the context clock, not on timers', async () => {
    const audio = makeAudio();
    await audio.enable();
    const ctx = FakeAudioContext.last!;
    ctx.currentTime = 5;
    const first = ctx.oscillatorNodes.length;

    audio.respawn();

    const starts = ctx.oscillatorNodes.slice(first).map(node => nth(node.start.mock.calls, 0)[0] as number);
    expect(starts.map(t => t.toFixed(2))).toEqual(['5.00', '5.18', '5.26']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reuses one noise buffer per burst length', async () => {
    const audio = makeAudio();
    await audio.enable();
    const ctx = FakeAudioContext.last!;
    ctx.createBuffer.mockClear();

    audio.mine();
    audio.mine();
    expect(ctx.createBuffer).toHaveBeenCalledTimes(1);

    audio.enemyHit();
    expect(ctx.createBuffer).toHaveBeenCalledTimes(2);

    audio.explosion();
    audio.explosion();
    expect(ctx.createBuffer).toHaveBeenCalledTimes(3); // Its debris tail, once.
  });

  it('cuts a cue short when effects are muted mid-cue, even if a voice refuses to stop', async () => {
    const audio = makeAudio();
    await audio.enable();
    const ctx = FakeAudioContext.last!;
    const first = ctx.oscillatorNodes.length;
    audio.chestOpen();
    const voices = ctx.oscillatorNodes.slice(first);
    nth(voices, 0).stop.mockImplementation(() => { throw new DOMException('already stopped', 'InvalidStateError'); });

    await expect(audio.toggleSfx()).resolves.toBeUndefined();

    for (const voice of voices) expect(voice.stop).toHaveBeenLastCalledWith();
  });

  it('ends the synth loop when music is muted mid-loop', async () => {
    const audio = await withSynthLoop();
    vi.advanceTimersByTime(240);

    await expect(audio.toggleMusic()).resolves.toBeUndefined();
    expect(audio.musicTimer).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    // A mute that bypasses stopMusic still ends the loop on its next tick.
    localStorage.clear();
    const again = await withSynthLoop();
    again.musicEnabled = false;
    const before = oscillators;
    expect(() => vi.advanceTimersByTime(240)).not.toThrow();
    expect(oscillators).toBe(before);
    expect(again.musicTimer).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('disposes the loop, the soundtrack element and the context, then ignores every call', async () => {
    const audio = await withSynthLoop();
    const music = FakeMusicElement.last!;
    const ctx = FakeAudioContext.last!;

    audio.dispose();

    expect(audio.musicTimer).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(music.removeAttribute).toHaveBeenCalledWith('src');
    expect(music.load).toHaveBeenCalled();
    expect(music.src).toBe('');
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(audio.ctx).toBeNull();
    expect(audio.enabled).toBe(false);

    const toastCount = toasts.length;
    const settings = loadAudioSettings();
    music.play.mockClear();
    audio.dispose();
    await audio.toggleMusic();
    await audio.toggleSfx();
    await expect(audio.enable()).resolves.toBe(false);
    await expect(audio.startMusic()).resolves.toBe(false);
    audio.startSynthMusic();
    audio.setTrack(SECOND_TRACK);
    audio.init();
    expect(heardEffects(() => { audio.mine(); audio.explosion(); audio.respawn(); audio.grave(); })).toBe(0);

    expect(FakeAudioContext.last).toBe(ctx);
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(music.play).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(toasts.length).toBe(toastCount);
    expect(loadAudioSettings()).toEqual(settings);
  });
});

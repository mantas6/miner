import { setMusicIcon, setSfxIcon, setSoundBlockedStatus, setSoundUnavailableStatus } from '../ui/store';
import { loadAudioSettings, saveAudioSettings } from './audio-settings';
import { pickSource, prefersMp3 } from './encoding';
import { DEFAULT_TRACK_ID, TRACKS } from './tracks';
import type { MusicTrack, TrackId } from './tracks';
import type { AudioController } from '../core/types';

type ToastFn = (message: string) => void;

export function createAudio(toast: ToastFn): AudioController {
  /** Which encoding this browser gets; decided once, when the element is made. */
  let preferMp3 = true;
  const settings = loadAudioSettings();

  function trackSrc(track: MusicTrack): string {
    return pickSource(track, preferMp3);
  }

  function persist(): void {
    saveAudioSettings({music: audio.musicEnabled, sfx: audio.sfxEnabled});
  }

  /**
   * The buttons show what is *audible*, not what is merely wanted: before the
   * browser grants audio both read as off, so pressing one retries the unlock.
   */
  function syncButtons(): void {
    setMusicIcon(audio.enabled && audio.musicEnabled);
    setSfxIcon(audio.enabled && audio.sfxEnabled);
  }

  /** Resume the shared context. Every way of turning audio on funnels in here. */
  async function unlock(): Promise<boolean> {
    if (audio.enabled) return true;
    try {
      audio.init();
      if (!audio.ctx) return false;
      if (audio.ctx.state === 'suspended') await audio.ctx.resume();
      audio.enabled = true;
      return true;
    } catch {
      audio.enabled = false;
      setSoundBlockedStatus();
      toast('Audio blocked by browser — press Music or Sound after a tap/click.');
      return false;
    }
  }

  /** Effects are unlocked and switched on, so a cue is worth building at all. */
  function sfxLive(): boolean {
    return audio.enabled && audio.sfxEnabled && audio.ctx !== null && audio.master !== null;
  }

  /** Torn down for good: every entry point is a no-op from here on. */
  let disposed = false;
  /**
   * The track the element's `src` currently points at, or `null` before music
   * was ever started. The source is attached lazily so a player who keeps the
   * soundtrack off never downloads it.
   */
  let loadedTrack: TrackId | null = null;
  /** Effect voices scheduled but not yet ended, so a mute can cut a cue short. */
  const voices = new Set<AudioScheduledSourceNode>();
  /** Decaying white-noise bursts, one per sample length (see `noise`). */
  const noiseBuffers = new Map<number, AudioBuffer>();
  /** The explosion's squared-fade debris, one per sample length. */
  const debrisBuffers = new Map<number, AudioBuffer>();

  function track(node: AudioScheduledSourceNode): void {
    voices.add(node);
    node.onended = () => { voices.delete(node); };
  }

  /** Cut every effect voice still sounding or waiting for its start time. */
  function silenceEffects(): void {
    for (const voice of voices) {
      // A voice that already ran out may refuse a second stop on older engines.
      try { voice.stop(); } catch { /* already stopped */ }
    }
    voices.clear();
  }

  /** One noise buffer per length and shape, filled once and replayed after. */
  function noiseBuffer(ctx: AudioContext, cache: Map<number, AudioBuffer>, length: number, shape: (fade: number) => number): AudioBuffer {
    const cached = cache.get(length);
    if (cached) return cached;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<data.length;i++) data[i] = (Math.random()*2-1) * shape(1 - i/data.length);
    cache.set(length, buffer);
    return buffer;
  }

  /** Point the element at the current track, unless it already is. */
  function loadTrack(el: HTMLAudioElement): void {
    if (loadedTrack === audio.currentTrackId) return;
    el.preload = 'auto';
    el.src = trackSrc(TRACKS[audio.currentTrackId]);
    el.currentTime = 0;
    loadedTrack = audio.currentTrackId;
  }

  /** `play()` rejects this way whenever a `pause()` or a new `src` interrupts it. */
  function isAbortError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as {name?: unknown}).name === 'AbortError';
  }

  const audio: AudioController = {
    ctx: null,
    enabled: false,
    musicEnabled: settings.music,
    sfxEnabled: settings.sfx,
    get wantsSound() { return this.musicEnabled || this.sfxEnabled; },
    master: null,
    musicGain: null,
    musicEl: null,
    musicTimer: null,
    step: 0,
    currentTrackId: DEFAULT_TRACK_ID,
    lastMove: 0,
    lastLowFuel: 0,
    init() {
      if (this.ctx || disposed) return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        setSoundUnavailableStatus();
        return toast('Audio is not supported in this browser.');
      }
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.065;
      this.musicGain.connect(this.master);
      this.musicEl = new Audio();
      preferMp3 = prefersMp3(this.musicEl);
      // No `src` yet: `startMusic` attaches it the first time music really plays.
      this.musicEl.preload = 'none';
      this.musicEl.loop = true;
      this.musicEl.volume = 0.36;
    },
    /** The gesture-unlock path: bring back whatever the player left switched on. */
    async enable() {
      if (disposed || !await unlock()) return false;
      if (this.musicEnabled) await this.startMusic();
      syncButtons();
      if (this.sfxEnabled) this.blip(720, 0.10, 'square', 0.11);
      if (this.wantsSound) toast(this.musicEnabled ? 'Soundtrack on' : 'Sound effects on');
      return true;
    },
    async toggleMusic() {
      if (disposed) return;
      if (this.enabled && this.musicEnabled) {
        this.musicEnabled = false;
        this.stopMusic();
        persist();
        syncButtons();
        return toast('Music off');
      }
      this.musicEnabled = true;
      persist();
      if (!await unlock()) return;
      await this.startMusic();
      syncButtons();
      toast('Music on');
    },
    async toggleSfx() {
      if (disposed) return;
      if (this.enabled && this.sfxEnabled) {
        this.sfxEnabled = false;
        silenceEffects();
        persist();
        syncButtons();
        return toast('Sound effects off');
      }
      this.sfxEnabled = true;
      persist();
      if (!await unlock()) return;
      syncButtons();
      this.blip(720, 0.10, 'square', 0.11);
      toast('Sound effects on');
    },
    blip(freq=440, dur=0.08, type: OscillatorType = 'sine', gain=0.06, slide=0, delay=0) {
      if (!this.enabled || !this.sfxEnabled || !this.ctx || !this.master) return;
      const now = this.ctx.currentTime + Math.max(0, delay);
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), now + dur);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(gain, now + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(g); g.connect(this.master);
      track(osc);
      osc.start(now); osc.stop(now + dur + 0.02);
    },
    noise(dur=0.12, gain=0.05, filterFreq=700, delay=0) {
      if (!this.enabled || !this.sfxEnabled || !this.ctx || !this.master) return;
      const now = this.ctx.currentTime + Math.max(0, delay);
      const length = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buffer = noiseBuffer(this.ctx, noiseBuffers, length, fade => fade);
      const src = this.ctx.createBufferSource();
      const filter = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      filter.type = 'lowpass'; filter.frequency.value = filterFreq;
      g.gain.setValueAtTime(gain, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.buffer = buffer; src.connect(filter); filter.connect(g); g.connect(this.master);
      track(src);
      src.start(now); src.stop(now + dur);
    },
    /**
     * A layered boom rather than a single burst: a pitch-swept sine carries the
     * body, noise under a closing lowpass supplies the debris tail, and a short
     * bright crack on top keeps it reading as an impact instead of a rumble.
     */
    explosion(power=1) {
      if (!this.enabled || !this.sfxEnabled || !this.ctx || !this.master) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const tail = 0.72 * power;

      // Body: 150 Hz dropping to sub-bass, near-instant attack, long decay.
      const thump = ctx.createOscillator();
      const thumpGain = ctx.createGain();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(150, now);
      thump.frequency.exponentialRampToValueAtTime(32, now + tail * 0.65);
      thumpGain.gain.setValueAtTime(0.0001, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.28 * power, now + 0.006);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + tail);
      thump.connect(thumpGain); thumpGain.connect(this.master);
      track(thump);
      thump.start(now); thump.stop(now + tail + 0.05);

      // Debris: noise shaped by its own squared fade, then darkened over time so
      // the crack at the front settles into a low rumble.
      const length = Math.max(1, Math.floor(ctx.sampleRate * tail));
      const buffer = noiseBuffer(ctx, debrisBuffers, length, fade => fade * fade);
      const src = ctx.createBufferSource();
      const lowpass = ctx.createBiquadFilter();
      const noiseGain = ctx.createGain();
      src.buffer = buffer;
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(2400, now);
      lowpass.frequency.exponentialRampToValueAtTime(140, now + tail);
      noiseGain.gain.setValueAtTime(0.20 * power, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + tail);
      src.connect(lowpass); lowpass.connect(noiseGain); noiseGain.connect(this.master);
      track(src);
      src.start(now); src.stop(now + tail);

      this.blip(240, 0.09, 'sawtooth', 0.11 * power, -190);
      this.blip(58, 0.26, 'sine', 0.07 * power, -20, 0.14);
    },
    mine() { this.noise(0.13, 0.16, 620); this.blip(92, 0.10, 'sawtooth', 0.10, -35); },
    ore(value=20) { this.blip(520, 0.10, 'triangle', 0.14, 220); this.blip(760 + Math.min(500,value), 0.12, 'triangle', 0.12, 0, 0.07); },
    cash(_value=10) { [0,0.06,0.12].forEach((d,i)=>this.blip(740+i*120, 0.08, 'square', 0.11, 0, d)); },
    bump() { this.blip(70, 0.15, 'sawtooth', 0.13, -25); },
    enemyHit() { this.noise(0.10, 0.10, 360); this.blip(230, 0.08, 'sawtooth', 0.10, -80); },
    enemyWake() { this.blip(110, 0.10, 'square', 0.12); this.blip(150, 0.12, 'square', 0.10, 0, 0.085); },
    alarm() { this.blip(180, 0.12, 'square', 0.13); this.blip(130, 0.16, 'square', 0.13, 0, 0.12); },
    lowFuel() { this.blip(880, 0.09, 'square', 0.10, -120); this.blip(660, 0.13, 'square', 0.10, -90, 0.12); },
    // --- Named cues ---------------------------------------------------------
    // Each is built from `blip`/`noise`, every step scheduled up front on the
    // context clock (the trailing `delay` argument, in seconds). Each bails out
    // up front when effects are off, and muting cuts any steps still pending.
    /** Rising three-step gurgle: fuel glugging into the tank. */
    refuel() {
      if (!sfxLive()) return;
      [0, 0.09, 0.18].forEach((d, i) => {
        this.noise(0.07, 0.05, 380 + i*160, d);
        this.blip(220 + i*90, 0.09, 'sine', 0.10, 70, d);
      });
    },
    /** Metallic double clank: the press coming down twice. */
    craft() {
      if (!sfxLive()) return;
      const clank = (d: number) => {
        this.noise(0.05, 0.07, 2600, d);
        this.blip(1180, 0.07, 'square', 0.06, -380, d);
        this.blip(1730, 0.05, 'triangle', 0.04, 0, d);
      };
      clank(0);
      clank(0.12);
    },
    sell(value=10) { if (sfxLive()) this.cash(value); },
    /** Two falling notes: money going out. */
    buy() {
      if (!sfxLive()) return;
      this.blip(880, 0.06, 'square', 0.08);
      this.blip(587, 0.10, 'triangle', 0.09, 0, 0.07);
    },
    /** A soft downward thunk: cargo going into storage. */
    stow() {
      if (!sfxLive()) return;
      this.noise(0.04, 0.03, 500);
      this.blip(420, 0.07, 'triangle', 0.07, -120);
    },
    /** A soft upward lift: cargo coming aboard. */
    take() {
      if (!sfxLive()) return;
      this.blip(560, 0.07, 'triangle', 0.07, 180);
    },
    /** Set-down thud with a light tap on top. */
    place() {
      if (!sfxLive()) return;
      this.noise(0.08, 0.08, 420);
      this.blip(140, 0.10, 'square', 0.07, -60);
      this.blip(320, 0.05, 'triangle', 0.05, 0, 0.06);
    },
    /** Two-step rising ratchet: packing a device back up. */
    lift() {
      if (!sfxLive()) return;
      this.blip(300, 0.06, 'square', 0.05, 200);
      this.blip(520, 0.07, 'triangle', 0.06, 160, 0.07);
    },
    /** Whoosh sweep: air rushing past under a climbing tone. */
    portal() {
      if (!sfxLive()) return;
      this.noise(0.45, 0.07, 1800);
      this.blip(180, 0.42, 'sine', 0.10, 1400);
      this.blip(360, 0.34, 'triangle', 0.05, 1800, 0.09);
    },
    /** Lock-in click then a rising fifth. */
    upgradeFit() {
      if (!sfxLive()) return;
      this.noise(0.03, 0.05, 3000);
      this.blip(440, 0.06, 'square', 0.06);
      this.blip(660, 0.09, 'square', 0.07, 0, 0.08);
    },
    /** The same pair falling: the part coming out. */
    upgradeRemove() {
      if (!sfxLive()) return;
      this.noise(0.03, 0.05, 3000);
      this.blip(660, 0.06, 'square', 0.06);
      this.blip(392, 0.09, 'square', 0.06, 0, 0.08);
    },
    /** A wrench rasp, then a bright rising arpeggio. */
    repair() {
      if (!sfxLive()) return;
      this.noise(0.06, 0.05, 1500);
      [523, 659, 784].forEach((f, i) => this.blip(f, 0.09, 'triangle', 0.08, 0, i*0.07));
    },
    open() { if (sfxLive()) this.blip(480, 0.07, 'triangle', 0.06, 160); },
    close() { if (sfxLive()) this.blip(520, 0.07, 'triangle', 0.05, -200); },
    /** Two rising ticks: a device ready in hand. */
    arm() {
      if (!sfxLive()) return;
      this.blip(980, 0.04, 'square', 0.05);
      this.blip(1320, 0.05, 'square', 0.045, 0, 0.05);
    },
    /** The ticks reversed: stood down. */
    disarm() {
      if (!sfxLive()) return;
      this.blip(1320, 0.04, 'square', 0.045);
      this.blip(880, 0.05, 'square', 0.04, 0, 0.05);
    },
    /** A rising sweep landing on a two-note chime: a ship deployed. */
    respawn() {
      if (!sfxLive()) return;
      this.blip(220, 0.35, 'sine', 0.09, 660);
      this.blip(880, 0.16, 'triangle', 0.08, 0, 0.18);
      this.blip(1175, 0.20, 'triangle', 0.07, 0, 0.26);
    },
    /** A two-note coin. */
    bounty() {
      if (!sfxLive()) return;
      this.blip(988, 0.06, 'square', 0.08);
      this.blip(1319, 0.16, 'square', 0.08, 0, 0.07);
    },
    /** A short rising fanfare, the last note held. */
    milestone() {
      if (!sfxLive()) return;
      [523, 659, 784, 1047].forEach((f, i) => this.blip(f, i === 3 ? 0.30 : 0.10, 'triangle', 0.09, 0, i*0.09));
    },
    /** Two fading sonar pings. */
    surveyDone() {
      if (!sfxLive()) return;
      this.blip(1400, 0.18, 'sine', 0.08, -200);
      this.blip(1400, 0.28, 'sine', 0.06, -200, 0.22);
    },
    /** The softest tick, for switches and small UI confirmations. */
    click() { if (sfxLive()) this.blip(1500, 0.018, 'square', 0.03); },
    /** A hinge creak, then a bright little chime. */
    chestOpen() {
      if (!sfxLive()) return;
      this.noise(0.12, 0.04, 900);
      this.blip(160, 0.18, 'sawtooth', 0.05, 120);
      this.blip(784, 0.10, 'triangle', 0.08, 0, 0.16);
      this.blip(1047, 0.16, 'triangle', 0.07, 0, 0.23);
    },
    /**
     * A low bell: a soft strike over the partials of a church bell (hum, prime,
     * minor third, fifth, nominal), each decaying at its own rate.
     */
    grave() {
      if (!sfxLive()) return;
      this.noise(0.03, 0.05, 1200);
      this.blip(65, 2.2, 'sine', 0.08);
      this.blip(130, 1.8, 'sine', 0.12);
      this.blip(156, 1.4, 'sine', 0.05);
      this.blip(195, 1.1, 'sine', 0.04);
      this.blip(260, 0.9, 'sine', 0.05);
    },
    async startMusic() {
      this.stopMusic();
      if (disposed || !this.enabled || !this.musicEnabled) return false;
      const el = this.musicEl;
      if (el) {
        loadTrack(el);
        try {
          await el.play();
          return true;
        } catch (error) {
          // A pause or a track swap interrupted this play; whoever did that owns
          // what happens next, so falling back to the synth would be wrong.
          if (isAbortError(error)) return false;
          this.startSynthMusic();
          return false;
        }
      }
      this.startSynthMusic();
      return false;
    },
    startSynthMusic() {
      if (disposed || !this.musicEnabled) return;
      // A second start must replace the loop, not run alongside it.
      if (this.musicTimer !== null) clearInterval(this.musicTimer);
      const bass = [55,55,65.4,55,73.4,65.4,49,49];
      const lead = [220,0,247,262,0,196,185,0,220,247,294,262,0,196,165,0];
      const timer = window.setInterval(() => {
        if (disposed || !this.musicEnabled) {
          // Muted without a stop (or torn down): end the loop rather than idle.
          clearInterval(timer);
          if (this.musicTimer === timer) this.musicTimer = null;
          return;
        }
        if (!this.enabled || !this.ctx) return;
        const i = this.step++;
        const now = this.ctx.currentTime;
        const root = bass[i % bass.length];
        this.musicNote(root, 0.28, 'sine', 0.026, now);
        if (i % 2 === 0) {
          const f = lead[(i/2) % lead.length | 0];
          if (f) this.musicNote(f, 0.16, 'triangle', 0.018, now + 0.02);
        }
      }, 240);
      this.musicTimer = timer;
    },
    musicNote(freq: number, dur: number, type: OscillatorType, gain: number, start: number) {
      if (!this.ctx || !this.musicGain) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const filt = this.ctx.createBiquadFilter();
      osc.type = type; osc.frequency.value = freq;
      filt.type = 'lowpass'; filt.frequency.value = 850;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(gain, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(filt); filt.connect(g); g.connect(this.musicGain);
      osc.start(start); osc.stop(start + dur + 0.05);
    },
    stopMusic() {
      if (this.musicTimer !== null) clearInterval(this.musicTimer);
      this.musicTimer = null;
      if (this.musicEl) this.musicEl.pause();
    },
    setTrack(trackId: TrackId) {
      if (disposed || trackId === this.currentTrackId) return;
      // Swapping the source pauses the element, so remember the state first and
      // pick playback back up on the new track from its own beginning. A stopped
      // soundtrack keeps its old source until `startMusic` next loads one.
      const wasPlaying = this.musicTimer !== null || (this.musicEl !== null && !this.musicEl.paused);
      this.currentTrackId = trackId;
      if (wasPlaying) void this.startMusic();
    },
    dispose() {
      if (disposed) return;
      this.stopMusic();
      silenceEffects();
      disposed = true;
      this.enabled = false;
      if (this.musicEl) {
        // Dropping the source and reloading is what actually frees the decoder
        // and any buffered download; a bare pause keeps both alive.
        this.musicEl.removeAttribute('src');
        this.musicEl.load();
        this.musicEl = null;
      }
      loadedTrack = null;
      noiseBuffers.clear();
      debrisBuffers.clear();
      const ctx = this.ctx;
      this.ctx = null;
      this.master = null;
      this.musicGain = null;
      // A leaked AudioContext survives the mount and browsers only allow a handful.
      if (ctx) void ctx.close().catch(() => { /* already closed */ });
    }
  };

  return audio;
}

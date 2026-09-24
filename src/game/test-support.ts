// Test doubles for the game modules.
//
// After the game.ts split every module takes its collaborators as a dependency
// object, so unit tests only need small honest stand-ins for the two awkward
// ones: the enemy simulation and audio. They live here instead of in each test
// file because both are wide interfaces whose details are irrelevant to any
// single behaviour under test.

import { vi } from 'vitest';
import { DEFAULT_TRACK_ID } from '../audio/tracks';
import type { AudioController, Enemy, Tile } from '../core/types';
import type { EnemySim } from './enemies';
import type { GameInput } from './input';
import type { PortalMode, PortalsSim } from './portals';
import type { WorldGrid } from './world-grid';

/** An in-memory tile grid: no lazy generation, every write recorded. */
export interface FakeGrid extends WorldGrid {
  /** Seed a tile without recording a write. */
  put(x: number, y: number, tile: Tile): void;
  /** Every `set` in order. */
  readonly writes: {x: number; y: number; tile: Tile}[];
}

export function createFakeGrid(fill: (x: number, y: number) => Tile = () => ({type: 'air'})): FakeGrid {
  const tiles = new Map<string, Tile>();
  const writes: FakeGrid['writes'] = [];
  const rows: Tile[][] = [];
  return {
    writes,
    get world() {
      return rows;
    },
    get(x, y) {
      const key = `${x},${y}`;
      const existing = tiles.get(key);
      if (existing) return existing;
      const created = fill(x, y);
      tiles.set(key, created);
      return created;
    },
    set(x, y, tile) {
      tiles.set(`${x},${y}`, tile);
      writes.push({x, y, tile});
    },
    ensureRow() {
      return undefined;
    },
    put(x, y, tile) {
      tiles.set(`${x},${y}`, tile);
    }
  };
}

export interface EnemySimStub extends EnemySim {
  /** The enemy `enemyAt` reports, if any. */
  standingEnemy: Enemy | undefined;
}

export function createEnemySimStub(): EnemySimStub {
  const stub: EnemySimStub = {
    standingEnemy: undefined,
    enemyAt: () => stub.standingEnemy,
    wakeEnemiesNear: vi.fn(),
    resetExposure: vi.fn(),
    clearExposure: vi.fn(),
    damageEnemy: vi.fn(),
    damageEnemyTile: vi.fn(() => true),
    update: vi.fn()
  };
  return stub;
}

export function createInputStub(): GameInput {
  return {tick: vi.fn(), clearKeys: vi.fn(), reset: vi.fn(), attach: vi.fn(() => () => {})};
}

/**
 * A portal sim double: every method a `vi.fn` spy, with a `mode` a test can set
 * to stand in for an open overlay. The methods keep the real `PortalsSim`
 * signatures (contextually typed from the object literal), so they double as spies.
 */
export interface PortalsSimStub extends PortalsSim {
  /** Settable, unlike the real sim's read-only getter. */
  mode: PortalMode | null;
}

export function createPortalsSimStub(): PortalsSimStub {
  return {
    mode: null,
    openTravel: vi.fn(() => true),
    openTeleporter: vi.fn(() => true),
    openRespawn: vi.fn(),
    close: vi.fn(),
    rename: vi.fn(),
    travelTo: vi.fn(() => true),
    tick: vi.fn()
  };
}

export interface AudioStub extends AudioController {
  /** Names of the effect methods that fired, in order. */
  readonly played: string[];
}

/** A silent AudioController that only records which cues were requested. */
export function createAudioStub(): AudioStub {
  const played: string[] = [];
  const cue = (name: string) => () => { played.push(name); };
  return {
    played,
    ctx: null,
    enabled: false,
    musicEnabled: false,
    sfxEnabled: false,
    wantsSound: false,
    master: null,
    musicGain: null,
    musicEl: null,
    musicTimer: null,
    step: 0,
    currentTrackId: DEFAULT_TRACK_ID,
    lastMove: 0,
    lastLowFuel: 0,
    init: cue('init'),
    enable: async () => { played.push('enable'); return true; },
    toggleMusic: async () => { played.push('toggleMusic'); },
    toggleSfx: async () => { played.push('toggleSfx'); },
    blip: cue('blip'),
    noise: cue('noise'),
    explosion: cue('explosion'),
    mine: cue('mine'),
    ore: cue('ore'),
    cash: cue('cash'),
    bump: cue('bump'),
    enemyHit: cue('enemyHit'),
    enemyWake: cue('enemyWake'),
    alarm: cue('alarm'),
    lowFuel: cue('lowFuel'),
    startMusic: async () => { played.push('startMusic'); return true; },
    startSynthMusic: cue('startSynthMusic'),
    musicNote: cue('musicNote'),
    stopMusic: cue('stopMusic'),
    setTrack: cue('setTrack')
  };
}

/** Collects toast copy so tests can assert on intent without matching prose. */
export function createToastLog() {
  const messages: string[] = [];
  return {
    messages,
    toast: (message: string) => { messages.push(message); },
    /** Whether any toast so far contains this fragment. */
    saw: (fragment: string) => messages.some(message => message.includes(fragment)),
    get last() {
      return messages[messages.length - 1];
    }
  };
}

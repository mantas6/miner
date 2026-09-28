// @vitest-environment happy-dom
//
// The save scheduler on its own: the debounce, the dirty-only interval, the hooks
// that write on the spot, and the silence a reset or an import puts on every
// writer. `save-cadence.test.ts` checks the same cadence through a whole runtime.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDisposalScope, type DisposalScope } from './disposal';
import { SAVE_DEBOUNCE_MS, SAVE_INTERVAL_MS, createSaveScheduler, type SaveScheduler } from './save-scheduler';

let writeRun: ReturnType<typeof vi.fn<() => void>>;
let writeZoom: ReturnType<typeof vi.fn<() => void>>;
let saves: SaveScheduler;
let scope: DisposalScope;
let onVisible: ReturnType<typeof vi.fn<() => void>>;

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', {configurable: true, get: () => hidden});
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  writeRun = vi.fn<() => void>();
  writeZoom = vi.fn<() => void>();
  onVisible = vi.fn<() => void>();
  saves = createSaveScheduler({writeRun, writeZoom});
  scope = createDisposalScope();
  saves.attach(scope, onVisible);
});

afterEach(() => {
  scope.dispose();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'hidden');
});

describe('the save scheduler', () => {
  it('folds a burst of scheduled saves into one trailing write', () => {
    saves.schedule();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 1);
    saves.schedule();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 1);
    expect(writeRun).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(writeRun).toHaveBeenCalledOnce();
  });

  it('writes on the minute only when something changed since the last write', () => {
    vi.advanceTimersByTime(SAVE_INTERVAL_MS * 3);
    expect(writeRun).not.toHaveBeenCalled();

    // A committed tile marks the run dirty without starting the debounce.
    saves.markDirty();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(writeRun).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SAVE_INTERVAL_MS);
    expect(writeRun).toHaveBeenCalledOnce();

    // Clean again: the next tick has nothing to do.
    vi.advanceTimersByTime(SAVE_INTERVAL_MS);
    expect(writeRun).toHaveBeenCalledOnce();
  });

  it('writes now and drops the pending debounce', () => {
    saves.schedule();
    saves.saveNow();
    expect(writeRun).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(writeRun).toHaveBeenCalledOnce();
  });

  it('debounces the zoom apart from the run', () => {
    saves.scheduleZoom();
    saves.scheduleZoom();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(writeZoom).toHaveBeenCalledOnce();
    expect(writeRun).not.toHaveBeenCalled();
  });

  it('banks the run and the zoom when the tab hides or unloads, and hands a return back', () => {
    saves.scheduleZoom();
    setHidden(true);
    expect(writeRun).toHaveBeenCalledOnce();
    expect(writeZoom).toHaveBeenCalledOnce();
    // The flush replaced the pending zoom write rather than adding to it.
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(writeZoom).toHaveBeenCalledOnce();
    expect(onVisible).not.toHaveBeenCalled();

    setHidden(false);
    expect(onVisible).toHaveBeenCalledOnce();

    window.dispatchEvent(new Event('beforeunload'));
    expect(writeRun).toHaveBeenCalledTimes(2);
    expect(writeZoom).toHaveBeenCalledTimes(2);
  });

  it('writes nothing at all once silenced, and carries on once resumed', () => {
    saves.schedule();
    saves.scheduleZoom();
    saves.silence();
    vi.advanceTimersByTime(SAVE_INTERVAL_MS);
    saves.saveNow();
    saves.flushAll();
    window.dispatchEvent(new Event('beforeunload'));
    expect(writeRun).not.toHaveBeenCalled();
    expect(writeZoom).not.toHaveBeenCalled();

    saves.resume();
    saves.saveNow();
    expect(writeRun).toHaveBeenCalledOnce();
  });

  it('stops the interval and the hooks with its scope', () => {
    scope.dispose();
    saves.markDirty();
    vi.advanceTimersByTime(SAVE_INTERVAL_MS);
    window.dispatchEvent(new Event('beforeunload'));
    setHidden(true);
    expect(writeRun).not.toHaveBeenCalled();
  });
});

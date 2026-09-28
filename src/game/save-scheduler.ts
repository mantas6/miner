// When the runtime writes to `localStorage`.
//
// `localStorage` is synchronous and a dug mine is megabytes of JSON, so gameplay
// changes only ever *schedule* a save: a trailing-edge debounce folds a burst of
// transfers, a long tunnel or a run of sales into one write. The minute interval
// only writes a run that actually changed since the last write, so an idle tab
// stops rewriting the same JSON every minute. The moments a debounce could lose
// the run — a hidden tab, an unload, a teardown, game over — write on the spot.
//
// The camera framing is saved apart from the run, on its own debounce: one wheel
// scroll is dozens of events and dozens of eased frames, and only the level the
// view settles on is worth writing.
//
// A full reset or an imported save silences every writer for good: the page is on
// its way out, and `beforeunload`, the interval or a pending debounce would
// otherwise write the old run straight back before the reload takes effect.

import type { DisposalScope } from './disposal';

/** The trailing-edge delay every scheduled write waits out. */
export const SAVE_DEBOUNCE_MS = 500;
/** How often a changed run is banked even with no burst to end. */
export const SAVE_INTERVAL_MS = 60_000;

export interface SaveSchedulerDeps {
  /** Write the run. */
  writeRun(): void;
  /** Write the camera framing. */
  writeZoom(): void;
}

export interface SaveScheduler {
  /** A gameplay change: mark the run dirty and (re)start the debounce. */
  schedule(): void;
  /** Something worth keeping changed, but a write can wait for the interval (a committed tile). */
  markDirty(): void;
  /**
   * Write the run now, dropping any pending debounce. Reserved for the moments a
   * debounce could lose it and for the explicit resets.
   */
  saveNow(): void;
  /** The minute interval's save: only when something changed since the last write. */
  saveIfDirty(): void;
  /** The zoom glide settled: debounce a write of the level it landed on. */
  scheduleZoom(): void;
  /** Write the run and the zoom now — a hidden tab, an unload, a teardown. */
  flushAll(): void;
  /**
   * Stop every writer and drop anything pending: the stored game is about to be
   * replaced (a full reset, an import) and the page reloaded.
   */
  silence(): void;
  /** Undo `silence()` — the replacement was refused, so the run carries on saving. */
  resume(): void;
  /**
   * Install the minute interval, the unload save and the visibility hook. Mobile
   * browsers routinely discard a hidden tab without ever firing `beforeunload`, so
   * hiding is the last reliable chance to keep the run; `onVisible` is the rest of
   * the runtime's answer to the tab coming back.
   */
  attach(scope: DisposalScope, onVisible: () => void): void;
}

/** A trailing-edge debounce, so a long tunnel does not save on every tile. */
function createDebounce(flush: () => void, delayMs: number) {
  let timer = 0;
  return {
    schedule() { clearTimeout(timer); timer = window.setTimeout(flush, delayMs); },
    cancel() { clearTimeout(timer); }
  };
}

export function createSaveScheduler(deps: SaveSchedulerDeps): SaveScheduler {
  /** Set by a full reset or an import; the page is on its way out. */
  let silenced = false;
  /** Whether anything worth keeping changed since the last write. */
  let dirty = false;

  function saveNow(): void {
    if (silenced) return;
    runSave.cancel();
    deps.writeRun();
    dirty = false;
  }

  function writeZoom(): void {
    if (!silenced) deps.writeZoom();
  }

  const runSave = createDebounce(saveNow, SAVE_DEBOUNCE_MS);
  const zoomSave = createDebounce(writeZoom, SAVE_DEBOUNCE_MS);

  function flushAll(): void {
    saveNow();
    zoomSave.cancel();
    writeZoom();
  }

  return {
    schedule() { dirty = true; runSave.schedule(); },
    markDirty() { dirty = true; },
    saveNow,
    saveIfDirty() { if (dirty) saveNow(); },
    scheduleZoom() { zoomSave.schedule(); },
    flushAll,
    silence() {
      silenced = true;
      runSave.cancel();
      zoomSave.cancel();
    },
    resume() { silenced = false; },
    attach(scope, onVisible) {
      scope.interval(() => { if (dirty) saveNow(); }, SAVE_INTERVAL_MS);
      scope.onWindow('beforeunload', flushAll);
      scope.onDocument('visibilitychange', () => {
        if (document.hidden) flushAll();
        else onVisible();
      });
    }
  };
}

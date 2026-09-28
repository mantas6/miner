// Mount-scoped side effects, collected so they can all be undone at once.
//
// The runtime installs window listeners, timers and an animation-frame loop.
// React can tear a mount down and build it straight back up — StrictMode does it
// on every dev boot, Fast Refresh does it on edits, an error boundary does it on
// a crash — so every one of those has to be revocable. A leaked `setInterval` or
// rAF loop would keep a discarded runtime simulating and writing to the store
// forever, which is exactly the class of bug that made StrictMode unusable here.
//
// Deliberately DOM-only and React-free: the game layer never imports React, and
// this is the seam that lets a React effect own the runtime's lifetime anyway.

export interface DisposalScope {
  /** Whether `dispose()` has already run. */
  readonly disposed: boolean;
  /**
   * Register a teardown. Registering after disposal runs it immediately, so a
   * resource acquired by an in-flight async step cannot outlive the scope.
   */
  add(teardown: () => void): void;
  onWindow<K extends keyof WindowEventMap>(
    type: K,
    handler: (event: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions
  ): void;
  onDocument<K extends keyof DocumentEventMap>(
    type: K,
    handler: (event: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions
  ): void;
  interval(handler: () => void, ms: number): void;
  timeout(handler: () => void, ms: number): void;
  /**
   * A self-rescheduling animation-frame loop. The first pass runs synchronously,
   * so the caller can rely on one frame having been drawn before it returns.
   */
  frameLoop(handler: (now: number) => void): void;
  /** Idempotent: the second call does nothing. */
  dispose(): void;
}

export function createDisposalScope(): DisposalScope {
  const teardowns: (() => void)[] = [];
  let disposed = false;

  function add(teardown: () => void): void {
    if (disposed) {
      teardown();
      return;
    }
    teardowns.push(teardown);
  }

  return {
    get disposed() {
      return disposed;
    },

    add,

    onWindow(type, handler, options) {
      const listener = handler as EventListener;
      window.addEventListener(type, listener, options);
      add(() => window.removeEventListener(type, listener, options));
    },

    onDocument(type, handler, options) {
      const listener = handler as EventListener;
      document.addEventListener(type, listener, options);
      add(() => document.removeEventListener(type, listener, options));
    },

    interval(handler, ms) {
      const timer = window.setInterval(handler, ms);
      add(() => clearInterval(timer));
    },

    timeout(handler, ms) {
      const timer = window.setTimeout(() => {
        if (!disposed) handler();
      }, ms);
      add(() => clearTimeout(timer));
    },

    frameLoop(handler) {
      let frame = 0;
      const step = (now: number): void => {
        if (disposed) return;
        handler(now);
        frame = requestAnimationFrame(step);
      };
      step(performance.now());
      add(() => cancelAnimationFrame(frame));
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      // Reverse order, so the last thing wired up is the first thing undone, and
      // one failing teardown cannot strand the others.
      const pending = teardowns.splice(0);
      for (let index = pending.length - 1; index >= 0; index--) {
        try {
          // In range by the loop bound; `?.` only satisfies the checker.
          pending[index]?.();
        } catch (error) {
          console.error('Game runtime teardown failed', error);
        }
      }
    }
  };
}

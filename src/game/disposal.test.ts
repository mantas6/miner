// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDisposalScope } from './disposal';
import { nth } from '../test-narrowing';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('disposal scope', () => {
  it('removes listeners with the options they were added with', () => {
    const scope = createDisposalScope();
    const onKey = vi.fn();
    const onVisibility = vi.fn();

    scope.onWindow('keydown', onKey, {capture: true});
    scope.onDocument('visibilitychange', onVisibility);
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'a'}));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(onVisibility).toHaveBeenCalledTimes(1);

    scope.dispose();
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'a'}));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(onVisibility).toHaveBeenCalledTimes(1);
  });

  it('cancels timers and stops the frame loop, including a frame already queued', () => {
    const frames = new Map<number, (now: number) => void>();
    let nextHandle = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: (now: number) => void) => {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => { frames.delete(handle); });

    const scope = createDisposalScope();
    const onFrame = vi.fn();
    const onInterval = vi.fn();
    const onTimeout = vi.fn();
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

    scope.frameLoop(onFrame);
    scope.interval(onInterval, 1000);
    scope.timeout(onTimeout, 0);

    // The first pass is synchronous, and exactly one frame is queued behind it.
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(1);

    const queued = nth([...frames.values()], 0);
    scope.dispose();

    expect(frames.size).toBe(0);
    expect(clearIntervalSpy).toHaveBeenCalled();
    // A frame the browser had already scheduled must not restart the loop.
    queued(1);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('never runs a timeout callback after disposal', async () => {
    const scope = createDisposalScope();
    const late = vi.fn();

    scope.timeout(late, 0);
    scope.dispose();
    await new Promise(resolve => setTimeout(resolve, 5));

    expect(late).not.toHaveBeenCalled();
  });

  it('disposes once, and runs a late registration immediately', () => {
    const scope = createDisposalScope();
    const first = vi.fn();
    const late = vi.fn();

    scope.add(first);
    expect(scope.disposed).toBe(false);
    scope.dispose();
    scope.dispose();
    expect(scope.disposed).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);

    // A resource acquired by an async step that lost the race must not survive.
    scope.add(late);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('keeps tearing down after one teardown throws', () => {
    const scope = createDisposalScope();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const survivor = vi.fn();

    scope.add(survivor);
    scope.add(() => { throw new Error('teardown exploded'); });
    scope.dispose();

    expect(survivor).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
  });
});

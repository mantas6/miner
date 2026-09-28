// @vitest-environment happy-dom
//
// The live `prefers-reduced-motion` watch: the boot-time answer, every later flip,
// and silence once the runtime's scope is disposed.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDisposalScope } from './disposal';
import { watchReducedMotion } from './reduced-motion';

/** A stand-in media query list whose `change` listeners the test can fire. */
function fakeMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    matches,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => { listeners.add(listener); }),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => { listeners.delete(listener); }),
    flip(next: boolean) {
      media.matches = next;
      for (const listener of listeners) listener({matches: next} as MediaQueryListEvent);
    },
    listeners
  };
  return media;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('watchReducedMotion', () => {
  it('reports the preference at boot and every flip after it', () => {
    const media = fakeMedia(true);
    const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
    const scope = createDisposalScope();
    const onChange = vi.fn();

    expect(watchReducedMotion(scope, onChange)).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(onChange).not.toHaveBeenCalled();

    media.flip(false);
    media.flip(true);
    expect(onChange.mock.calls).toEqual([[false], [true]]);
  });

  it('stops listening once the runtime scope is disposed', () => {
    const media = fakeMedia(false);
    vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
    const scope = createDisposalScope();
    const onChange = vi.fn();

    watchReducedMotion(scope, onChange);
    expect(media.listeners.size).toBe(1);
    scope.dispose();

    expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(media.listeners.size).toBe(0);
    media.flip(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('answers false where the browser has no matchMedia', () => {
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {configurable: true, writable: true, value: undefined});
    try {
      expect(watchReducedMotion(createDisposalScope(), vi.fn())).toBe(false);
    } finally {
      Object.defineProperty(window, 'matchMedia', {configurable: true, writable: true, value: original});
    }
  });
});

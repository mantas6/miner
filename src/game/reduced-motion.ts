// The player's `prefers-reduced-motion` setting, followed live.
//
// Read once at boot it would go stale the moment the OS toggle flips mid-session,
// so the query's `change` event keeps the runtime in step, and the listener is
// tied to the runtime's disposal scope so a torn-down mount stops hearing it.

import type { DisposalScope } from './disposal';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Report the current preference, and call `onChange` with every later flip until
 * `scope` is disposed. Where `matchMedia` is missing the answer is a fixed `false`.
 */
export function watchReducedMotion(scope: DisposalScope, onChange: (reduced: boolean) => void): boolean {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
  if (!media) return false;
  const listener = (event: MediaQueryListEvent): void => onChange(event.matches);
  media.addEventListener('change', listener);
  scope.add(() => media.removeEventListener('change', listener));
  return media.matches;
}

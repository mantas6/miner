// Narrowing helpers for tests, now that `noUncheckedIndexedAccess` types every
// `list[i]` as possibly `undefined`.
//
// A test that indexes a fixture it just built "knows" the element is there, but
// that knowledge is exactly what the test should check rather than assume: these
// throw a readable error instead of letting a missing element surface later as a
// `TypeError` on some property read. Test-only — nothing in the game imports it.
// Shared by the Vitest suites and the Playwright specs, so it stays free of both
// runners and of any DOM or Node API.

/**
 * `list[index]` (a negative index counts from the end, like `Array#at`), failing
 * with a readable message when there is no element there.
 */
export function nth<T>(list: ArrayLike<T>, index: number): T {
  const value = list[index < 0 ? list.length + index : index];
  if (value === undefined) throw new Error(`expected an element at index ${index}, but the list has ${list.length}`);
  return value;
}

/** `value` with `undefined` and `null` ruled out, failing with `what` when it is missing. */
export function defined<T>(value: T | null | undefined, what = 'value'): T {
  if (value === undefined || value === null) throw new Error(`expected ${what} to be defined`);
  return value;
}

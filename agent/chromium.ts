// Where the harness and the Playwright config both find a Chromium to drive.
//
// This lived inline in `playwright.config.ts`; it now lives here so the agent
// session (`agent/session.ts`), which launches its own headed Chromium outside
// the test runner, resolves the browser the exact same way the e2e suite does.
// The config imports `resolveChromiumExecutable()`; nothing about its behaviour
// changed by the move.
//
// Two paths, because a Playwright-downloaded Chromium does not run on NixOS (it
// is dynamically linked against an FHS layout that is not there):
//
//   CI     `npx playwright install --with-deps chromium` provides the pinned
//          download, and `resolveChromiumExecutable()` returns `undefined` so
//          Playwright uses it.
//   local  `PLAYWRIGHT_CHROMIUM_PATH` if set, otherwise the first system
//          chromium/chrome found on `PATH`. Version skew against the pinned build
//          is accepted: the game only uses ordinary DOM behaviour.

import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

/** Binaries that are a stock Chromium as far as this project is concerned. */
export const CHROMIUM_BINARIES = ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome', 'chrome'];

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The first Chromium on `PATH`, or `undefined` when there is none. */
export function findSystemChromium(): string | undefined {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    for (const binary of CHROMIUM_BINARIES) {
      const candidate = join(directory, binary);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * The executable Playwright should launch, or `undefined` to let it use its own
 * pinned download. `PLAYWRIGHT_CHROMIUM_PATH` wins when set; otherwise a system
 * Chromium is used locally, but never in CI — falling back to whatever the image
 * happens to ship would make the run non-reproducible.
 */
export function resolveChromiumExecutable(): string | undefined {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_PATH?.trim();
  return explicit || (process.env.CI ? undefined : findSystemChromium());
}

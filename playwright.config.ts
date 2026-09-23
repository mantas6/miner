// End-to-end configuration: one Chromium project against the Vite dev server.
//
// The dev server, not `vite preview`, on purpose. React only double-invokes
// effects under `<StrictMode>` in a development build, so the dev bundle is the
// only one where every spec below boots a runtime that has already been
// constructed, disposed and constructed again. A production preview would quietly
// stop testing that the teardown works at all.
//
// Browser resolution has two paths, because a Playwright-downloaded Chromium does
// not run on NixOS (it is dynamically linked against an FHS layout that is not
// there). The logic is shared with the agent harness, so it lives in
// `agent/chromium.ts`; see the notes there.

import { defineConfig, devices } from '@playwright/test';
import { resolveChromiumExecutable } from './agent/chromium';

/** Ports the suite owns, so it never fights a dev server the developer is using. */
const PORT = 5199;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const executablePath = resolveChromiumExecutable();

export default defineConfig({
  testDir: './e2e',
  // Every spec boots its own game in its own context, so nothing is shared.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  // In CI: annotations on the diff, a line-by-line log, and an HTML report the
  // workflow uploads when something fails (it carries the retry's trace with it).
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', {open: 'never'}]]
    : [['list']],
  // The game runs a 60 Hz loop and the assertions poll HUD text, so the default
  // 5 s expect window is plenty; the per-test budget covers the first dev-server
  // module transform, which is the slowest thing in the suite.
  timeout: 30_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: {browserName: 'chromium', launchOptions: {executablePath}}
    }
  ],
  webServer: {
    // `--strictPort` because Vite would otherwise hop to the next free port and
    // serve the suite from a URL it is not watching. Locally an already-running
    // server on this port is reused; in CI there is never one to reuse, and a busy
    // port should fail rather than be worked around.
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe'
  }
});

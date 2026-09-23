// The programmatic-play harness, end to end and headless.
//
// This exercises the real thing the MCP server will drive — `openGameSession`
// itself — rather than the Playwright `page` fixture, so the session's own Vite
// startup, Chromium launch, pause model and bridge round trip are all under test.
// It reuses the suite's webServer by naming the same port the Playwright config
// serves on, so the session finds a server already listening and does not fight it.
//
// One session, seeded with a plain 2-hp dirt tile under the spawn (the same seed
// `e2e/support/game.ts` uses) so a single held key digs a real tile and the ASCII
// view moves; the tests run in order against it.

import { expect, test } from '@playwright/test';
import { openGameSession, type GameSession } from '../agent/session';

/** The port the Playwright config's webServer serves the game on. */
const PORT = 5199;

/** Seed a solo save with a soft dirt tile directly under the spawn (45, 21). */
function seedDirtUnderHome(): void {
  localStorage.setItem('moleload-progress-v1', JSON.stringify({
    version: 16,
    tiles: [{x: 45, y: 21, tile: {type: 'dirt', hp: 2, maxHp: 2}}]
  }));
}

test.describe.serial('agent harness', () => {
  let session: GameSession;

  test.beforeAll(async () => {
    session = await openGameSession({headless: true, port: PORT, initScript: seedDirtUnderHome});
  });

  test.afterAll(async () => {
    await session?.close();
  });

  test('observes the ship at the home base', async () => {
    const observation = await session.observe();
    expect(observation.ship.x).toBe(45);
    expect(observation.ship.y).toBe(20);
    expect(observation.ship.atSurface).toBe(true);
    // The window is centred on the ship, which paints as `@`.
    expect(observation.view.rows.join('')).toContain('@');
  });

  test('pause freezes the tick between decisions', async () => {
    // The default real-time model keeps the sim frozen between actions.
    const before = await session.observe();
    await new Promise(resolve => setTimeout(resolve, 300));
    const after = await session.observe();
    expect(after.tick).toBe(before.tick);
  });

  test('starting the run brings the player into play', async () => {
    const observation = await session.startRun();
    expect(observation.phase).toBe('playing');
    expect(observation.gameOver).toBe(false);
  });

  test('Space at the home base opens the station overlay', async () => {
    const observation = await session.press(' ');
    expect(observation.activeOverlay).toBe('station');
    expect(observation.overlay?.kind).toBe('station');
    if (observation.overlay?.kind === 'station') {
      // The station mirror is only present while the screen is open.
      expect(Array.isArray(observation.overlay.recipes)).toBe(true);
    }
  });

  test('holding ArrowDown burns fuel and moves the view down', async () => {
    // Shut the station Space opened, so the key drives the mine again.
    const closed = await session.press(' ');
    expect(closed.activeOverlay).toBeNull();
    // Closing the modal dropped focus to the body; put it back on the mine so the
    // held key reaches the ship rather than nothing.
    await session.page.locator('#game').focus();

    const before = await session.observe();
    const after = await session.hold('ArrowDown', 1200);
    // Every drill hit charges fuel, whether or not a tile cleared.
    expect(after.ship.fuel).toBeLessThan(before.ship.fuel);
    // The sim advanced while the key was held.
    expect(after.tick).toBeGreaterThan(before.tick);
    // Two hits clear the seeded dirt, so the ship stands a tile lower and the
    // window — origin fixed to the ship — has scrolled down with it.
    expect(after.ship.y).toBeGreaterThan(before.ship.y);
    expect(after.view.origin.y).toBeGreaterThan(before.view.origin.y);
  });
});

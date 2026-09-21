// The boot flow, which is the one path every other spec depends on: splash → live
// run on a single press, with the keyboard landing on the canvas and no complaint
// from the browser along the way.

import { expect, test } from '@playwright/test';
import { activeElementId, collectPageFailures, openIntro, startSoloRun } from './support/game';

test.describe('boot', () => {
  test('renders the title card with its start prompt', async ({page}) => {
    await openIntro(page);
    await expect(page.locator('#intro')).toContainText('Stalinload');
    await expect(page.locator('#introStartBtn')).toBeVisible();
    // The canvas takes the keyboard immediately, which is what makes Enter on the
    // splash work without anything having been clicked first.
    await expect(page.locator('#game')).toBeFocused();
  });

  test('Enter starts the run straight from the splash', async ({page}) => {
    await startSoloRun(page, 'keyboard');
  });

  test('a press anywhere on the card starts it too', async ({page}) => {
    await startSoloRun(page, 'click');
  });

  test('the press starts the run, focuses the canvas and shows the HUD', async ({page}) => {
    await startSoloRun(page);
    await expect(page.locator('#intro')).toHaveCount(0);
    // The chrome the run needs: meters, readouts, and the home-base actions.
    await expect(page.locator('#cash')).toHaveText('$60');
    await expect(page.locator('#depth')).toHaveText('0 m');
    await expect(page.locator('#fuelLabel')).toHaveText('100/100');
    // The Ship button is always visible: it fits and unfits upgrades from the
    // cargo bay and needs no proximity to a station.
    await expect(page.locator('#shipBtn')).toBeVisible();
    await expect(page.locator('#infoBtn')).toBeVisible();
    // The loop has run at least once against the generated world: the scanner is
    // reading the real tile under the ship instead of its pre-boot placeholder.
    await expect(page.locator('#scanner')).toContainText('dirt');
    // Neither failure notice: the runtime reported `ready`.
    await expect(page.locator('#runtime-failure')).toHaveCount(0);
    await expect(page.locator('#app-failure')).toHaveCount(0);
  });

  // The regression this guards: hull and cargo were native `<meter>`s, whose bar
  // each engine paints to its own metrics, so the three tracks were never the same
  // height and disagreed between Chrome and Firefox. Measuring is the only way to
  // see it — nothing in the DOM says how tall a widget an engine decided to draw.
  test('the fuel, hull and cargo bars are exactly one height', async ({page}) => {
    await startSoloRun(page);
    for (const width of [1280, 700]) {
      await page.setViewportSize({width, height: 800});
      const heights = await page.evaluate(() =>
        ['fuel', 'hull', 'cargo'].map(id => document.getElementById(id)!.getBoundingClientRect().height)
      );
      expect(heights[0]).toBeGreaterThan(0);
      expect(heights).toEqual([heights[0], heights[0], heights[0]]);
    }
  });

  test('the canvas is the game surface\'s only tab stop', async ({page}) => {
    await startSoloRun(page);
    // One Tab leaves the mine for the HUD; the panel around the canvas is layout
    // and must not have collected a tab stop of its own.
    await page.keyboard.press('Tab');
    expect(await activeElementId(page)).toBe('musicBtn');
    await page.keyboard.press('Shift+Tab');
    expect(await activeElementId(page)).toBe('game');
  });

  test('the whole flow is free of console errors and page errors', async ({page}) => {
    const failures = collectPageFailures(page);
    await startSoloRun(page);
    // Wait for the loop to have drawn and synced at least once, so anything that
    // only throws from inside a frame has had its chance.
    await expect(page.locator('#scanner')).toContainText('dirt');
    expect(failures).toEqual([]);
  });
});

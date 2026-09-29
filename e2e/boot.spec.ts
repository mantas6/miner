// The boot flow, which is the one path every other spec depends on: splash → live
// run on a single press, with the keyboard landing on the canvas and no complaint
// from the browser along the way.

import { expect, test } from '@playwright/test';
import { activeElementId, collectPageFailures, openIntro, startRun } from './support/game';

test.describe('boot', () => {
  test('renders the title card with its start prompt', async ({page}) => {
    await openIntro(page);
    await expect(page.locator('#intro')).toContainText('Stalinload');
    await expect(page.locator('#introStartBtn')).toBeVisible();
    // The translucent splash sits over the live canvas, which paints the intro's
    // showcase slice of the mine behind the card.
    await expect(page.locator('#game')).toBeVisible();
    // The canvas takes the keyboard immediately, which is what makes Enter on the
    // splash work without anything having been clicked first.
    await expect(page.locator('#game')).toBeFocused();
  });

  test('Enter starts the run straight from the splash', async ({page}) => {
    await startRun(page, 'keyboard');
  });

  test('a press anywhere on the card starts it too', async ({page}) => {
    await startRun(page, 'click');
  });

  test('the press starts the run, focuses the canvas and shows the HUD', async ({page}) => {
    await startRun(page);
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
    // reading the real tile under the ship — the cavern floor's dirt hatch — instead
    // of its pre-boot open-air placeholder.
    await expect(page.locator('#scanner')).toContainText('dirt');
    // Neither failure notice: the runtime reported `ready`.
    await expect(page.locator('#runtime-failure')).toHaveCount(0);
    await expect(page.locator('#app-failure')).toHaveCount(0);
  });

  test('the canvas is the game surface\'s only tab stop', async ({page}) => {
    await startRun(page);
    // One Tab leaves the mine for the HUD; the panel around the canvas is layout
    // and must not have collected a tab stop of its own.
    await page.keyboard.press('Tab');
    expect(await activeElementId(page)).toBe('musicBtn');
    await page.keyboard.press('Shift+Tab');
    expect(await activeElementId(page)).toBe('game');
  });

  test('the whole flow is free of console errors and page errors', async ({page}) => {
    const failures = collectPageFailures(page);
    await startRun(page);
    // Wait for the loop to have drawn and synced at least once, so anything that
    // only throws from inside a frame has had its chance.
    await expect(page.locator('#scanner')).toContainText('dirt');
    expect(failures).toEqual([]);
  });
});

test.describe('HUD adapts to the viewport and motion preference', () => {
  test('a short viewport compacts the HUD without changing its layout', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 800});
    await startRun(page);
    const size = () => page.locator('#musicBtn').evaluate(element => element.getBoundingClientRect().height);
    const tall = await size();

    // A landscape phone: short but wide, so only the height breakpoint applies.
    await page.setViewportSize({width: 900, height: 400});
    await expect.poll(size).toBeLessThan(tall);
    await expect(page.locator('#shipBtn')).toBeVisible();
    await expect(page.locator('#fuelLabel')).toBeVisible();
  });

  test('the icon-only audio buttons carry fixed names and their state in aria-pressed', async ({page}) => {
    await startRun(page);
    const music = page.locator('#musicBtn');
    await expect(music).toHaveAccessibleName('Music');
    await expect(page.locator('#sfxBtn')).toHaveAccessibleName('Sound effects');
    await expect(music.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    await expect(music).toHaveAttribute('aria-pressed', /^(true|false)$/);
    // The store's label — the next action, or why sound is blocked — is the tooltip.
    await expect(music).toHaveAttribute('title', /\S/);
  });

  test('reduced motion stops the toast sliding and the buttons shifting', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await startRun(page);
    const toast = await page.locator('#toast').evaluate(element => {
      const style = getComputedStyle(element);
      return {translate: style.translate, transition: style.transitionProperty};
    });
    expect(toast.transition).toBe('opacity');
    expect(toast.translate).toBe('-50%');
    await page.locator('#shipBtn').hover();
    const transform = await page.locator('#shipBtn').evaluate(element => getComputedStyle(element).transform);
    expect(transform).toBe('none');
  });
});
